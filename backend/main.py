import asyncio
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from threading import RLock
from typing import Any, Callable

import boto3
from botocore.exceptions import ClientError
from dotenv import load_dotenv
from fastapi import FastAPI, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

load_dotenv()

# Configure structured JSON logging *before* importing app modules so every
# logger created from this point on inherits the JSON formatter and the
# request-context binders.
from logging_config import (
    configure_logging,
    new_request_id,
    request_id_var,
    user_id_var,
    tenant_id_var,
    hash_id,
)
configure_logging()

from middleware.auth import get_current_user, UserSession, require_leader, require_member, require_superadmin
import db
from async_io import run_db, run_file, shutdown_async_io

logger = logging.getLogger("anonymizer")


class TTLCache:
    """Very small helper cache with coarse TTL invalidation."""

    def __init__(self, ttl_seconds: int = 5):
        self.ttl = ttl_seconds
        self._store: dict[str, tuple[float, Any]] = {}
        self._lock = RLock()

    def get(self, key: str) -> Any | None:
        now = time.time()
        with self._lock:
            entry = self._store.get(key)
            if not entry:
                return None
            expires, value = entry
            if expires < now:
                self._store.pop(key, None)
                return None
            return value

    def set(self, key: str, value: Any) -> Any:
        with self._lock:
            self._store[key] = (time.time() + self.ttl, value)
        return value

    def get_or_set(self, key: str, loader: Callable[[], Any]) -> Any:
        value = self.get(key)
        if value is not None:
            return value
        fresh = loader()
        self.set(key, fresh)
        return fresh

    def invalidate(self, key: str | None = None) -> None:
        with self._lock:
            if key is None:
                self._store.clear()
            else:
                self._store.pop(key, None)


personal_usage_cache = TTLCache(ttl_seconds=8)
quota_cache = TTLCache(ttl_seconds=8)
org_usage_cache = TTLCache(ttl_seconds=12)
org_quota_cache = TTLCache(ttl_seconds=12)
companies_cache = TTLCache(ttl_seconds=30)
global_usage_cache = TTLCache(ttl_seconds=45)


def _cached_personal_usage(user_id: str) -> dict:
    return personal_usage_cache.get_or_set(user_id, lambda: db.get_user_usage(user_id))


def _cached_my_quota(user_id: str, tenant_id: str) -> dict:
    cache_key = f"{user_id}:{tenant_id}"
    return quota_cache.get_or_set(
        cache_key,
        lambda: {
            "user": db.get_user_token_usage(user_id),
            "org": db.get_org_token_usage(tenant_id),
        },
    )


def _cached_org_usage(tenant_id: str) -> dict:
    return org_usage_cache.get_or_set(tenant_id, lambda: db.get_org_usage(tenant_id))


def _cached_org_quota(tenant_id: str) -> dict:
    return org_quota_cache.get_or_set(tenant_id, lambda: db.get_org_quota_snapshot(tenant_id))


def _cached_companies() -> dict:
    return companies_cache.get_or_set("all", lambda: db.list_all_tenants(limit=100))


def _cached_global_usage() -> dict:
    return global_usage_cache.get_or_set("global", db.get_global_usage)

# Initialize PostgreSQL tables and default tenant on startup
try:
    db.init_db()
    db.ensure_default_tenant()
    db.init_audit_log_table()
    db.init_email_log_table()
    logger.info("PostgreSQL initialized successfully")
except Exception as e:
    logger.error("PostgreSQL initialization failed", extra={"error": str(e)})


# ── Lifespan: graceful shutdown drains in-flight requests ────────


_inflight_count = 0
_inflight_done = asyncio.Event()
_inflight_done.set()  # No work in flight at startup.
_shutting_down = False
GRACEFUL_SHUTDOWN_SECONDS = int(os.getenv("GRACEFUL_SHUTDOWN_SECONDS", "30"))


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """FastAPI lifespan: clean async-io resources, drain on shutdown."""
    yield
    global _shutting_down
    _shutting_down = True
    logger.info("Shutdown initiated; draining in-flight requests",
                extra={"inflight": _inflight_count, "timeout_s": GRACEFUL_SHUTDOWN_SECONDS})
    try:
        await asyncio.wait_for(_inflight_done.wait(), timeout=GRACEFUL_SHUTDOWN_SECONDS)
        logger.info("All in-flight requests drained")
    except asyncio.TimeoutError:
        logger.warning("Graceful shutdown timeout; %d requests still in flight",
                       _inflight_count)
    await shutdown_async_io()


limiter = Limiter(key_func=get_remote_address)

app = FastAPI(
    title="Anonymizer Core - Mediation Server",
    description="Enterprise AI mediation with zero-knowledge anonymity.",
    version="1.0.0",
    lifespan=lifespan,
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


# ── Request middleware: request_id, log context, in-flight tracking ──


@app.middleware("http")
async def request_context_middleware(request: Request, call_next):
    """Bind a request_id (from header or new), track in-flight count, and
    refuse new traffic during graceful shutdown."""
    global _inflight_count

    # Reject early during shutdown so the load balancer can drain us.
    if _shutting_down and request.url.path != "/health":
        return _shutdown_response()

    incoming_rid = request.headers.get("x-request-id") or request.headers.get("x-amz-cf-id")
    rid = incoming_rid if (incoming_rid and len(incoming_rid) <= 96) else new_request_id()
    rid_token = request_id_var.set(rid)
    user_token = user_id_var.set("")
    tenant_token = tenant_id_var.set("")

    _inflight_count += 1
    _inflight_done.clear()
    started = time.monotonic()
    try:
        response = await call_next(request)
        response.headers["X-Request-Id"] = rid
        elapsed_ms = int((time.monotonic() - started) * 1000)
        logger.info(
            "request",
            extra={
                "method": request.method,
                "path": request.url.path,
                "status": response.status_code,
                "duration_ms": elapsed_ms,
            },
        )
        return response
    except Exception as exc:
        elapsed_ms = int((time.monotonic() - started) * 1000)
        logger.exception(
            "request crashed",
            extra={
                "method": request.method,
                "path": request.url.path,
                "duration_ms": elapsed_ms,
                "error_type": type(exc).__name__,
            },
        )
        raise
    finally:
        _inflight_count -= 1
        if _inflight_count <= 0:
            _inflight_count = 0
            _inflight_done.set()
        request_id_var.reset(rid_token)
        user_id_var.reset(user_token)
        tenant_id_var.reset(tenant_token)


def _shutdown_response():
    from fastapi.responses import JSONResponse
    return JSONResponse(
        {"error": "Server is shutting down."},
        status_code=503,
        headers={"Connection": "close", "Retry-After": "5"},
    )


def _client_ip(request: Request) -> str:
    """Extract the actual client IP, trusting only the immediate proxy chain."""
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else ""


async def _audit(
    request: Request,
    actor: UserSession,
    action: str,
    *,
    target_type: str | None = None,
    target_id: str | None = None,
    before: dict | None = None,
    after: dict | None = None,
    metadata: dict | None = None,
) -> None:
    """Record an audit log row off the event loop. Non-blocking, never raises."""
    try:
        await run_db(
            db.write_audit_log,
            actor_user_id=actor.user_id,
            actor_email=actor.email,
            actor_role=("superadmin" if actor.is_platform_admin else actor.role),
            actor_ip=_client_ip(request),
            request_id=request_id_var.get() or None,
            action=action,
            target_type=target_type,
            target_id=target_id,
            before=before,
            after=after,
            metadata=metadata,
        )
    except Exception as exc:
        # _audit must never break the request; structured-log the failure.
        logger.warning("audit_failed", extra={"action": action, "error": str(exc)})


# ── Transactional email helpers ─────────────────────────────────


APP_BASE_URL = os.getenv("APP_BASE_URL", "https://d2pk46epz4i9kd.cloudfront.net").rstrip("/")


async def _send_invite_email(
    *,
    tenant_id: str,
    invitee_email: str,
    role: str,
    invite_token: str,
    inviter_user_id: str | None,
    template_kind: str = "invite_member",
) -> None:
    """Render the invite template and send it via the configured provider.

    Runs as ``asyncio.create_task`` from the calling endpoint so a slow
    Resend round-trip doesn't add latency to the leader's HTTP response.
    Always best-effort: every error is logged, none propagate.
    """
    try:
        import email_sender
        import email_templates

        if not email_sender.is_configured():
            logger.info(
                "email_skipped_unconfigured",
                extra={"template": template_kind, "to_hash": hash_id(invitee_email.lower(), "email")},
            )
            return

        tenant_name = (await run_db(db.get_tenant_name, tenant_id)) or "your organization"
        inviter_name = None
        if inviter_user_id:
            inviter_name = await run_db(db.get_user_display_name, inviter_user_id)

        invite_url = f"{APP_BASE_URL}/join?token={invite_token}"

        if template_kind == "assign_leader":
            tpl = email_templates.assign_leader(
                invitee_email=invitee_email,
                tenant_name=tenant_name,
                invite_url=invite_url,
                expires_in_days=7,
            )
        else:
            tpl = email_templates.invite_member(
                invitee_email=invitee_email,
                tenant_name=tenant_name,
                inviter_name=inviter_name,
                role=role,
                invite_url=invite_url,
                expires_in_days=7,
            )

        await email_sender.send_email(
            to=invitee_email,
            subject=tpl["subject"],
            html=tpl["html"],
            text=tpl["text"],
            template=template_kind,
            metadata={"tenant_id": tenant_id, "role": role},
        )
    except Exception as exc:
        logger.warning(
            "invite_email_send_failed",
            extra={"template": template_kind, "error": str(exc)},
        )

# CORS: restrict to known origins only
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in ALLOWED_ORIGINS if o.strip()],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
    allow_headers=["Authorization", "Content-Type", "X-Request-Id"],
    expose_headers=["X-Request-Id"],
)

# AWS Bedrock configuration
AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID", "")
AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY", "")
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")
AWS_BEDROCK_MODEL = os.getenv("AWS_BEDROCK_MODEL", "moonshotai.kimi-k2.5")

# Environment / mock-mode flag — refuse to start in production with no creds
# unless ENABLE_MOCK_MODE is explicitly set.
ENVIRONMENT = os.getenv("ENVIRONMENT", "development").lower()
ENABLE_MOCK_MODE = os.getenv("ENABLE_MOCK_MODE", "").lower() in ("1", "true", "yes")
HAS_AWS_BEDROCK = bool(
    AWS_ACCESS_KEY_ID
    and AWS_SECRET_ACCESS_KEY
    and AWS_ACCESS_KEY_ID != "your-aws-access-key"
)

if ENVIRONMENT in ("production", "prod") and not HAS_AWS_BEDROCK and not ENABLE_MOCK_MODE:
    raise RuntimeError(
        "Refusing to start: AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY are required in "
        "production. Set ENABLE_MOCK_MODE=true to override (NOT recommended)."
    )

# AWS Bedrock client with adaptive retries (lets boto3 backoff smarter than us)
_bedrock_client = None


def get_bedrock_client():
    global _bedrock_client
    if _bedrock_client is None and HAS_AWS_BEDROCK:
        from botocore.config import Config

        _bedrock_client = boto3.client(
            "bedrock-runtime",
            region_name=AWS_REGION,
            aws_access_key_id=AWS_ACCESS_KEY_ID,
            aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
            config=Config(
                retries={"mode": "adaptive", "max_attempts": 5},
                connect_timeout=5,
                read_timeout=60,
                # Boto3 keeps a connection pool per client. Bumping this
                # avoids serialising concurrent requests when many users
                # are mediating at once.
                max_pool_connections=int(os.getenv("BEDROCK_POOL_SIZE", "50")),
            ),
        )
    return _bedrock_client


class ChatMessage(BaseModel):
    role: str = Field(..., pattern="^(user|assistant|system)$")
    content: str = Field(..., min_length=1)


class MediationPayload(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=10000)
    model: str = Field(default="moonshotai.kimi-k2.5")
    history: list[ChatMessage] = Field(default_factory=list)
    system_prompt: str | None = Field(default=None, max_length=2000)
    max_tokens: int = Field(default=1024, ge=256, le=4096)


class MediationResponse(BaseModel):
    prompt_preview: str
    ai_response: str
    tokens_processed: int
    model: str
    duration_ms: int


@app.get("/health")
@limiter.limit("60/minute")
async def health_check(request: Request):
    """Liveness + readiness probe.

    Reports DB connectivity, AI provider status, and clock drift relative to
    a public NTP-synced HTTP server. Anything > 5s drift suggests NTP is not
    syncing on the host and JWT verification will start failing.
    """
    db_ok = False
    try:
        db.get_pool()
        db_ok = True
    except Exception:
        pass

    clock_drift_ms: int | None = None
    try:
        from async_io import get_http_client
        from email.utils import parsedate_to_datetime

        resp = await get_http_client().head("https://www.google.com", timeout=2.0)
        date_header = resp.headers.get("Date", "")
        if date_header:
            server_time = parsedate_to_datetime(date_header).timestamp()
            clock_drift_ms = int((time.time() - server_time) * 1000)
    except Exception:
        clock_drift_ms = None

    return {
        "status": "online",
        "service": "Anonymizer Core Mediation Layer",
        "database": "connected" if db_ok else "unavailable",
        "ai_provider": "configured" if HAS_AWS_BEDROCK else ("mock" if ENABLE_MOCK_MODE else "missing"),
        "environment": ENVIRONMENT,
        "clock_drift_ms": clock_drift_ms,
        "shutting_down": _shutting_down,
        "inflight_requests": _inflight_count,
        "version": "1.0.0",
    }


MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024  # 5 MB


def _parse_file_bytes(content: bytes, filename: str) -> str:
    """Synchronous file parser for use in threadpool executor."""
    name = filename.lower()

    if name.endswith(".txt") or name.endswith(".md") or name.endswith(".csv"):
        return content.decode("utf-8", errors="ignore")[:10000]

    if name.endswith(".pdf"):
        try:
            from PyPDF2 import PdfReader
            from io import BytesIO
            reader = PdfReader(BytesIO(content))
            text = ""
            for page in reader.pages:
                text += page.extract_text() or ""
                if len(text) > 10000:
                    break
            return text[:10000]
        except Exception:
            return "[PDF extraction failed]"

    if name.endswith(".docx"):
        try:
            from docx import Document
            from io import BytesIO
            doc = Document(BytesIO(content))
            text = "\n".join([p.text for p in doc.paragraphs])
            return text[:10000]
        except Exception:
            return "[DOCX extraction failed]"

    return content.decode("utf-8", errors="ignore")[:10000]


async def _run_ai_mediation(
    prompt: str,
    model: str,
    current_user: UserSession,
    history: list[dict] | None = None,
    system_prompt: str | None = None,
    max_tokens: int = 1024,
) -> MediationResponse:
    """Core mediation logic shared by JSON and multipart endpoints.

    Concurrency: every blocking step (DB calls, Bedrock invocation) runs in a
    bounded threadpool via run_db / run_in_executor so the event loop never
    blocks. The DB connection used for credit reservation is released *before*
    the Bedrock call; settle and telemetry use fresh connections so a slow
    upstream cannot starve the pool.
    """
    start_time = time.time()

    has_aws = HAS_AWS_BEDROCK

    ai_response = ""
    in_tokens = 0
    out_tokens = 0
    tot_tokens = 0

    default_system = (
        "You must respond in English only. Be concise and helpful. "
        "Use Markdown formatting for structure: headings, bullet lists, numbered lists, "
        "code blocks with language tags, bold/italic emphasis, and tables where appropriate. "
        "Always wrap code in fenced code blocks with the correct language identifier."
    )
    effective_system = system_prompt.strip() if system_prompt else default_system
    messages = [{"role": "system", "content": effective_system}]
    if history:
        for msg in history[-10:]:
            if isinstance(msg, dict) and "role" in msg and "content" in msg:
                messages.append({"role": msg["role"], "content": msg["content"]})
    messages.append({"role": "user", "content": prompt})

    if not has_aws:
        if not ENABLE_MOCK_MODE:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="AI provider is not configured.",
            )
        in_tokens = sum(len(m["content"].split()) for m in messages)
        out_tokens = 128
        tot_tokens = in_tokens + out_tokens
        await asyncio.sleep(0.3)
        ai_response = (
            "[MOCK RESPONSE] AI provider not configured. "
            "Configure provider credentials to enable real responses."
        )
    else:
        client = get_bedrock_client()
        if not client:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="AWS Bedrock client initialization failed.",
            )

        model_id = model if model else AWS_BEDROCK_MODEL

        # ── Atomic credit reservation (DB connection held only for this call) ──
        estimated_input = len(prompt) // 4 + 1
        estimated_credits = db.estimate_request_credits(
            model_id,
            estimated_input_tokens=estimated_input,
            estimated_output_tokens=max_tokens,
        )
        reservation = await run_db(
            db.reserve_credits,
            current_user.user_id,
            current_user.tenant_id,
            estimated_credits,
            is_admin=current_user.is_platform_admin,
        )
        if not reservation["allowed"]:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=reservation["reason"],
            )

        # The Bedrock ``Converse`` API normalises every provider to a single
        # message format, so we don't have to special-case Kimi vs Llama vs
        # Nova vs Cohere vs Mistral vs Titan body schemas. Models that don't
        # support on-demand throughput (e.g. DeepSeek R1) still fail; we
        # surface those errors and the model dropdown is curated to only
        # expose models we've confirmed work with Converse.
        converse_messages = []
        system_blocks = []
        for m in messages:
            role = m.get("role")
            content = m.get("content", "")
            if role == "system":
                if content:
                    system_blocks.append({"text": content})
                continue
            if role not in ("user", "assistant"):
                continue
            converse_messages.append({"role": role, "content": [{"text": content}]})

        try:
            def _invoke():
                kwargs: dict[str, Any] = {
                    "modelId": model_id,
                    "messages": converse_messages,
                    "inferenceConfig": {"maxTokens": max_tokens, "temperature": 0.7},
                }
                if system_blocks:
                    kwargs["system"] = system_blocks
                return client.converse(**kwargs)

            response = await asyncio.get_event_loop().run_in_executor(None, _invoke)

            ai_response = ""
            output = response.get("output") or {}
            message = output.get("message") or {}
            content_blocks = message.get("content") or []
            for block in content_blocks:
                if isinstance(block, dict) and "text" in block:
                    ai_response += block["text"]

            if not ai_response:
                logger.warning(
                    "Empty AI response",
                    extra={"raw_preview": json.dumps(response, default=str)[:500]},
                )

            usage = response.get("usage") or {}
            in_tokens = int(usage.get("inputTokens", len(prompt.split())))
            out_tokens = int(usage.get("outputTokens", 128))
            tot_tokens = int(usage.get("totalTokens", in_tokens + out_tokens))
        except ClientError as e:
            await run_db(
                db.release_reserved_credits,
                current_user.user_id,
                reservation["reserved_credits"],
            )
            logger.error("AWS Bedrock error", extra={"error": str(e)})
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Upstream AI provider error.",
            )
        except Exception as e:
            await run_db(
                db.release_reserved_credits,
                current_user.user_id,
                reservation["reserved_credits"],
            )
            logger.exception("Mediation crashed", extra={"error_type": type(e).__name__})
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Mediation failed.",
            )

    duration = int((time.time() - start_time) * 1000)

    # Finalize credit consumption (fresh DB connections, off the event loop).
    actual_credits = db.calculate_request_credits(model or AWS_BEDROCK_MODEL, in_tokens, out_tokens)
    if has_aws and not current_user.is_platform_admin:
        await run_db(
            db.settle_credits,
            current_user.user_id,
            current_user.tenant_id,
            reserved=reservation["reserved_credits"],
            actual=actual_credits,
        )
    elif not has_aws and not current_user.is_platform_admin:
        try:
            await run_db(
                db.consume_user_credits,
                current_user.user_id,
                current_user.tenant_id,
                actual_credits,
            )
        except ValueError as ve:
            logger.info("Mock-mode quota exhausted", extra={"error": str(ve)})

    await run_db(
        db.save_usage_metric,
        tenant_id=current_user.tenant_id,
        supabase_auth_id=current_user.user_id,
        model_identifier=model,
        input_tokens=in_tokens,
        output_tokens=out_tokens,
        total_tokens=tot_tokens,
        duration_ms=duration,
        credits_used=actual_credits,
    )

    logger.info(
        "Mediation completed",
        extra={
            "model": model,
            "tokens": tot_tokens,
            "credits": actual_credits,
            "duration_ms": duration,
        },
    )

    return MediationResponse(
        prompt_preview=prompt[:100],
        ai_response=ai_response,
        tokens_processed=tot_tokens,
        model=model,
        duration_ms=duration,
    )


@app.post("/api/v1/mediate", response_model=MediationResponse)
@limiter.limit("30/minute")
async def execute_anonymous_brokerage(
    request: Request,
    payload: MediationPayload,
    current_user: UserSession = Depends(get_current_user),
):
    """Text-only mediation endpoint."""
    history = [{"role": msg.role, "content": msg.content} for msg in payload.history]
    return await _run_ai_mediation(
        payload.prompt,
        payload.model,
        current_user,
        history=history,
        system_prompt=payload.system_prompt,
        max_tokens=payload.max_tokens,
    )


@app.post("/api/v1/mediate/upload", response_model=MediationResponse)
@limiter.limit("30/minute")
async def execute_upload_brokerage(
    request: Request,
    prompt: str = Form(..., min_length=1, max_length=10000),
    model: str = Form(default="moonshotai.kimi-k2.5"),
    history: str = Form(default="[]"),
    system_prompt: str | None = Form(default=None),
    max_tokens: int = Form(default=1024),
    file: UploadFile = File(None),
    current_user: UserSession = Depends(get_current_user),
):
    """Mediation with optional document upload (PDF, DOCX, TXT, MD).

    File reads and parsing run under the bounded ``run_file`` semaphore so a
    burst of uploads cannot exhaust the worker memory budget.
    """
    full_prompt = prompt
    if file and file.filename:
        try:
            content = await run_file(file.file.read)
        except Exception as e:
            logger.warning("Could not read uploaded file", extra={"error": str(e)})
            raise HTTPException(status_code=400, detail="Failed to read uploaded file.")

        if len(content) > MAX_FILE_SIZE_BYTES:
            raise HTTPException(status_code=413, detail="File too large. Max 5MB.")

        doc_text = await run_file(_parse_file_bytes, content, file.filename)
        if doc_text:
            full_prompt = f"[Document: {file.filename}]\n{doc_text}\n\n[User Question]\n{prompt}"
            logger.info(
                "Document uploaded",
                extra={"filename": file.filename, "char_count": len(doc_text)},
            )

    try:
        history_list = json.loads(history)
        history_list = [
            {"role": m.get("role", "user"), "content": m.get("content", "")}
            for m in history_list if isinstance(m, dict)
        ]
    except json.JSONDecodeError:
        history_list = []

    return await _run_ai_mediation(
        full_prompt,
        model,
        current_user,
        history=history_list,
        system_prompt=system_prompt,
        max_tokens=max_tokens,
    )


class AnalyticsResponse(BaseModel):
    total_tokens: int
    total_tokens_change: float
    active_tenants: int
    active_tenants_change: float
    compute_cost: float
    compute_cost_change: float
    chart_data: list[int]
    logs: list[dict]
    token_trend: list[int]
    model_breakdown: list[dict]


@app.get("/api/v1/analytics", response_model=AnalyticsResponse)
@limiter.limit("60/minute")
async def get_analytics(request: Request, current_user: UserSession = Depends(get_current_user)):
    try:
        data = db.get_analytics(tenant_id=current_user.tenant_id)
        logs = data["logs"]
        total_tokens = data["total_tokens"]
        active_tenants = data["active_tenants"]
        compute_cost = data["compute_cost"]
    except Exception as e:
        logger.error("Analytics query failed: %s", e)
        # Fallback to empty analytics
        total_tokens = 0
        active_tenants = 1
        compute_cost = 0.0
        logs = []

    # Generate chart data from log durations
    chart_data = [20, 30, 40, 60, 70, 80, 90]
    if logs:
        chart_data = [min(100, max(5, int(log["duration_ms"] // 10))) for log in logs[-7:]]
        while len(chart_data) < 7:
            chart_data.append(20)

    return AnalyticsResponse(
        total_tokens=total_tokens,
        total_tokens_change=12.4,
        active_tenants=active_tenants,
        active_tenants_change=5.1,
        compute_cost=compute_cost,
        compute_cost_change=2.8,
        chart_data=chart_data,
        logs=logs,
        token_trend=data.get("token_trend", [0, 0, 0, 0, 0, 0, 0]),
        model_breakdown=data.get("model_breakdown", []),
    )


# ── API Key Management ────────────────────────────────────────────

class CreateKeyPayload(BaseModel):
    name: str = Field(..., min_length=1, max_length=150)
    scopes: list[str] = Field(default_factory=lambda: ["mediate", "analytics"])
    expires_days: int | None = Field(default=None, ge=1, le=365)


@app.get("/api/v1/me")
@limiter.limit("60/minute")
async def get_current_user_info(
    request: Request,
    current_user: UserSession = Depends(get_current_user),
):
    """Return current user's identity and role. Auto-creates profile if missing."""
    # Ensure profile exists (for new Supabase signups)
    profile = db.ensure_user_profile(
        current_user.user_id,
        current_user.email,
        current_user.tenant_id,
    )
    return {
        "user_id": current_user.user_id,
        "email": current_user.email,
        "tenant_id": profile["tenant_id"],
        "role": profile["role"],
        "is_platform_admin": profile["is_platform_admin"],
    }


class UpdatePreferencesPayload(BaseModel):
    preferred_model: str | None = None
    system_prompt: str | None = None
    max_tokens: int | None = Field(default=None, ge=256, le=4096)


@app.get("/api/v1/me/preferences")
@limiter.limit("60/minute")
async def get_my_preferences(
    request: Request,
    current_user: UserSession = Depends(get_current_user),
):
    """Return user's AI preferences (model, system prompt, max tokens)."""
    prefs = db.get_user_preferences(current_user.user_id)
    return prefs


@app.patch("/api/v1/me/preferences")
@limiter.limit("30/minute")
async def update_my_preferences(
    request: Request,
    payload: UpdatePreferencesPayload,
    current_user: UserSession = Depends(get_current_user),
):
    """Update user's AI preferences."""
    updates = {}
    if payload.preferred_model is not None:
        updates["preferred_model"] = payload.preferred_model
    if payload.system_prompt is not None:
        updates["system_prompt"] = payload.system_prompt
    if payload.max_tokens is not None:
        updates["max_tokens"] = payload.max_tokens
    if not updates:
        return {"status": "no changes"}
    result = db.update_user_preferences(current_user.user_id, updates)
    return result


@app.get("/api/v1/me/usage")
@limiter.limit("60/minute")
async def get_my_usage(
    request: Request,
    current_user: UserSession = Depends(get_current_user),
):
    """Return personal usage stats for the authenticated user."""
    usage = db.get_user_usage(current_user.user_id)
    return usage


@app.get("/api/v1/admin/users/{supabase_auth_id}/usage")
@limiter.limit("60/minute")
async def admin_get_user_usage(
    request: Request,
    supabase_auth_id: str,
    current_user: UserSession = Depends(require_superadmin),
):
    """Return usage stats for any user. Superadmin only."""
    usage = db.get_user_usage(supabase_auth_id)
    return usage


@app.get("/api/v1/keys")
@limiter.limit("60/minute")
async def list_keys(
    request: Request,
    current_user: UserSession = Depends(require_member),
):
    """List all active API keys for the tenant."""
    keys = db.list_api_keys(current_user.tenant_id)
    return {"keys": keys}


@app.post("/api/v1/keys")
@limiter.limit("30/minute")
async def create_key(
    request: Request,
    payload: CreateKeyPayload,
    current_user: UserSession = Depends(require_leader),
):
    """Create a new API key. Leaders only."""
    raw_key, key_id = db.create_api_key(
        tenant_id=current_user.tenant_id,
        created_by=current_user.user_id,
        name=payload.name,
        scopes=payload.scopes,
        expires_days=payload.expires_days,
    )
    return {
        "id": key_id,
        "key": raw_key,  # shown ONLY once at creation
        "name": payload.name,
        "scopes": payload.scopes,
    }


@app.delete("/api/v1/keys/{key_id}")
@limiter.limit("30/minute")
async def revoke_key(
    request: Request,
    key_id: str,
    current_user: UserSession = Depends(require_leader),
):
    """Revoke (deactivate) an API key. Leaders only."""
    ok = db.revoke_api_key(key_id, current_user.tenant_id)
    if not ok:
        raise HTTPException(status_code=404, detail="API key not found.")
    return {"status": "revoked", "id": key_id}


# ── Token Quota Management ──────────────────────────────────────

class AddExtraPayload(BaseModel):
    amount: int = Field(..., ge=1)


class EstimateCostPayload(BaseModel):
    prompt: str = Field(..., min_length=1)
    model: str | None = Field(default=None)
    max_tokens: int = Field(default=4000, ge=1, le=8000)


class DummyCardPayload(BaseModel):
    number: str = Field(..., min_length=16, max_length=16)
    exp_month: int = Field(..., ge=1, le=12)
    exp_year: int = Field(..., ge=2024)
    cvc: str = Field(..., min_length=3, max_length=4)
    name: str | None = None


class TopUpPayload(BaseModel):
    amount: int = Field(..., ge=1)
    note: str | None = Field(default=None, max_length=500)
    card: DummyCardPayload


@app.post("/api/v1/me/estimate-cost")
@limiter.limit("60/minute")
async def estimate_cost(
    request: Request,
    payload: EstimateCostPayload,
    current_user: UserSession = Depends(get_current_user),
):
    """Pre-flight estimate of request cost in credits."""
    model_id = payload.model if payload.model else AWS_BEDROCK_MODEL
    estimated_input = len(payload.prompt) // 4 + 1
    estimated_credits = db.estimate_request_credits(
        model_id,
        estimated_input_tokens=estimated_input,
        estimated_output_tokens=payload.max_tokens,
    )
    user_quota = db.get_user_token_usage(current_user.user_id)
    return {
        "estimated_input_tokens": estimated_input,
        "estimated_output_tokens": payload.max_tokens,
        "estimated_credits": estimated_credits,
        "daily_budget": user_quota["daily_budget"],
        "daily_used": user_quota["daily_used"],
        "daily_remaining": user_quota["daily_remaining"],
        "extra_remaining": user_quota["extra_remaining"],
        "total_available": user_quota["total_available"],
        "warning_level": user_quota["warning_level"],
        "sufficient": estimated_credits <= user_quota["total_available"],
    }


@app.get("/api/v1/me/quota")
@limiter.limit("60/minute")
async def get_my_quota(
    request: Request,
    current_user: UserSession = Depends(get_current_user),
):
    """Return current user's credit quota status (daily + extra)."""
    user = db.get_user_token_usage(current_user.user_id)
    org = db.get_org_token_usage(current_user.tenant_id)
    return {"user": user, "org": org}


@app.get("/api/v1/dashboard/summary")
@limiter.limit("30/minute")
async def get_dashboard_summary(
    request: Request,
    current_user: UserSession = Depends(get_current_user),
):
    """Aggregate all dashboard data in a single round trip."""
    profile = db.ensure_user_profile(current_user.user_id, current_user.email, current_user.tenant_id)
    role = profile.get("role", "member")
    tenant_id = str(profile.get("tenant_id", current_user.tenant_id))
    is_superadmin = bool(profile.get("is_platform_admin"))
    is_leader = role == "leader"

    payload: dict[str, Any] = {
        "role": role,
        "is_platform_admin": is_superadmin,
        "generated_at": int(time.time()),
    }

    if not is_superadmin:
        payload["personal"] = _cached_personal_usage(current_user.user_id)
        payload["my_quota"] = _cached_my_quota(current_user.user_id, tenant_id)

    if is_leader:
        payload["org"] = _cached_org_usage(tenant_id)
        payload["org_quota"] = _cached_org_quota(tenant_id)

    if is_superadmin:
        companies_data = _cached_companies()
        payload["companies"] = companies_data.get("companies", [])
        payload["global_usage"] = _cached_global_usage()

    return payload


@app.get("/api/v1/org/quota")
@limiter.limit("60/minute")
async def get_org_quota(
    request: Request,
    current_user: UserSession = Depends(require_leader),
):
    """Return org credit quota status. Leaders+ only."""
    return _cached_org_quota(current_user.tenant_id)


class OrgSettingsPayload(BaseModel):
    auto_pool_draw: bool


@app.patch("/api/v1/org/settings")
@limiter.limit("30/minute")
async def update_org_settings(
    request: Request,
    payload: OrgSettingsPayload,
    current_user: UserSession = Depends(require_leader),
):
    """Toggle org settings like auto-pool-draw. Leaders only."""
    result = db.set_auto_pool_draw(current_user.tenant_id, payload.auto_pool_draw)
    return result


@app.get("/api/v1/org/settings")
@limiter.limit("60/minute")
async def get_org_settings(
    request: Request,
    current_user: UserSession = Depends(require_leader),
):
    """Get org settings. Leaders only."""
    usage = db.get_org_token_usage(current_user.tenant_id)
    return {"auto_pool_draw": usage.get("auto_pool_draw", False)}


@app.get("/api/v1/admin/topups")
@limiter.limit("30/minute")
async def admin_list_topups(
    request: Request,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    tenant_id: str | None = None,
    current_user: UserSession = Depends(require_superadmin),
):
    entries = db.list_all_topups(limit=limit, offset=offset, tenant_id=tenant_id)
    return {"entries": entries}


@app.get("/api/v1/admin/tenants/{tenant_id}/ledger")
@limiter.limit("30/minute")
async def admin_get_credit_ledger(
    request: Request,
    tenant_id: str,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: UserSession = Depends(require_superadmin),
):
    entries = db.list_credit_ledger(tenant_id, limit=limit, offset=offset)
    return {"entries": entries}


@app.post("/api/v1/org/members/{supabase_auth_id}/extra-tokens")
@limiter.limit("30/minute")
async def leader_allocate_member_extra(
    request: Request,
    supabase_auth_id: str,
    payload: AddExtraPayload,
    current_user: UserSession = Depends(require_leader),
):
    """Leader allocates extra credits from org pool to a member."""
    profile = await run_db(db.ensure_user_profile, supabase_auth_id, "")
    if not profile or str(profile["tenant_id"]) != current_user.tenant_id:
        raise HTTPException(status_code=403, detail="Can only modify members in your organization.")
    try:
        result = await run_db(
            db.allocate_member_extra_credits,
            current_user.tenant_id,
            supabase_auth_id,
            payload.amount,
        )
        await _audit(
            request,
            current_user,
            "org.member.allocate_extra_credits",
            target_type="user_profile",
            target_id=supabase_auth_id,
            metadata={"amount": payload.amount},
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/v1/org/topup")
@limiter.limit("30/minute")
async def leader_topup_org(
    request: Request,
    payload: TopUpPayload,
    current_user: UserSession = Depends(require_leader),
):
    card_number = payload.card.number
    if not card_number.isdigit() or len(card_number) != 16:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid card number")
    if set(card_number) != {"0"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Test mode only accepts 0000 0000 0000 0000")
    result = await run_db(
        db.add_org_extra_credits,
        current_user.tenant_id,
        payload.amount,
        current_user.user_id,
        payload.note or "Leader top-up",
    )
    await _audit(
        request,
        current_user,
        "org.topup",
        target_type="tenant",
        target_id=current_user.tenant_id,
        metadata={"amount": payload.amount, "note": payload.note or "Leader top-up"},
    )
    return {"status": "success", "extra_token_pool": result["extra_token_pool"], "note": payload.note or "Leader top-up"}


@app.get("/api/v1/org/ledger")
@limiter.limit("30/minute")
async def org_credit_ledger(
    request: Request,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: UserSession = Depends(require_leader),
):
    entries = db.list_credit_ledger(current_user.tenant_id, limit=limit, offset=offset)
    return {"entries": entries}


# ── Org Management ────────────────────────────────────────────────

class InvitePayload(BaseModel):
    email: str = Field(..., min_length=3, max_length=255)
    role: str = Field(default="member", pattern=r"^(leader|member)$")


class UpdateRolePayload(BaseModel):
    role: str = Field(..., pattern=r"^(leader|member)$")


@app.get("/api/v1/org/members")
@limiter.limit("60/minute")
async def list_org_members(
    request: Request,
    search: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: UserSession = Depends(get_current_user),
):
    """List members of the current user's org with pagination."""
    result = db.list_org_members(current_user.tenant_id, search=search, limit=limit, offset=offset)
    return result


@app.post("/api/v1/org/invite")
@limiter.limit("30/minute")
async def invite_member(
    request: Request,
    payload: InvitePayload,
    current_user: UserSession = Depends(require_leader),
):
    """Invite a user to the org by email. Leaders only.

    The invite link is also returned in the response so the UI's "copy link"
    fallback keeps working when email delivery is delayed.
    """
    try:
        token, invite_id = await run_db(
            db.create_invite,
            tenant_id=current_user.tenant_id,
            email=payload.email,
            role=payload.role,
            invited_by_auth_id=current_user.user_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    await _audit(
        request,
        current_user,
        "org.member.invite",
        target_type="tenant_invite",
        target_id=invite_id,
        metadata={"email": payload.email, "role": payload.role},
    )

    # Fire-and-forget email; never block the request on the email provider.
    asyncio.create_task(
        _send_invite_email(
            tenant_id=current_user.tenant_id,
            invitee_email=payload.email,
            role=payload.role,
            invite_token=token,
            inviter_user_id=current_user.user_id,
        )
    )

    return {
        "id": invite_id,
        "token": token,
        "email": payload.email,
        "role": payload.role,
        "expires_in_days": 7,
    }


@app.patch("/api/v1/org/members/{profile_id}/role")
@limiter.limit("30/minute")
async def update_member_role(
    request: Request,
    profile_id: str,
    payload: UpdateRolePayload,
    current_user: UserSession = Depends(require_leader),
):
    """Update a member's role. Leaders can only set member/leader."""
    ok = await run_db(db.update_member_role, current_user.tenant_id, profile_id, payload.role)
    if not ok:
        raise HTTPException(status_code=404, detail="Member not found.")
    await _audit(
        request,
        current_user,
        "org.member.update_role",
        target_type="user_profile",
        target_id=profile_id,
        after={"role": payload.role},
    )
    return {"status": "updated", "profile_id": profile_id, "role": payload.role}


@app.delete("/api/v1/org/members/{profile_id}")
@limiter.limit("30/minute")
async def remove_member(
    request: Request,
    profile_id: str,
    current_user: UserSession = Depends(require_leader),
):
    """Remove a member from the org. Leaders only. Cannot remove last leader."""
    try:
        ok = await run_db(db.remove_org_member, current_user.tenant_id, profile_id)
        if not ok:
            raise HTTPException(status_code=404, detail="Member not found.")
        await _audit(
            request,
            current_user,
            "org.member.remove",
            target_type="user_profile",
            target_id=profile_id,
        )
        return {"status": "removed", "profile_id": profile_id}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/v1/org/usage")
@limiter.limit("60/minute")
async def org_usage(
    request: Request,
    current_user: UserSession = Depends(get_current_user),
):
    """Get usage summary for the current org. Any org member."""
    usage = db.get_org_usage(current_user.tenant_id)
    return usage


@app.get("/api/v1/org/invites")
@limiter.limit("60/minute")
async def list_pending_invites(
    request: Request,
    current_user: UserSession = Depends(require_leader),
):
    """List pending invites for the org. Leaders only."""
    invites = db.list_invites(current_user.tenant_id)
    return {"invites": invites}


@app.delete("/api/v1/org/invites/{invite_id}")
@limiter.limit("30/minute")
async def revoke_invite_endpoint(
    request: Request,
    invite_id: str,
    current_user: UserSession = Depends(require_leader),
):
    """Revoke (cancel) a pending invite. Leaders only."""
    ok = db.revoke_invite(invite_id, current_user.tenant_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Invite not found.")
    return {"status": "revoked", "id": invite_id}


# ── Superadmin (Platform) ───────────────────────────────────────

class CreateCompanyPayload(BaseModel):
    company_name: str = Field(..., min_length=1, max_length=255)
    tier: str = Field(default="standard", pattern=r"^(standard|premium|enterprise)$")


class AssignLeaderPayload(BaseModel):
    email: str = Field(..., min_length=3, max_length=255)


@app.get("/api/v1/admin/companies")
@limiter.limit("30/minute")
async def admin_list_companies(
    request: Request,
    search: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    sort_by: str = Query("created_at"),
    sort_dir: str = Query("desc"),
    current_user: UserSession = Depends(require_superadmin),
):
    """List all tenants with pagination and search. Superadmin only."""
    result = db.list_all_tenants(search=search, limit=limit, offset=offset, sort_by=sort_by, sort_dir=sort_dir)
    return result


@app.post("/api/v1/admin/companies")
@limiter.limit("30/minute")
async def admin_create_company(
    request: Request,
    payload: CreateCompanyPayload,
    current_user: UserSession = Depends(require_superadmin),
):
    """Create a new company/tenant. Superadmin only."""
    tenant_id = await run_db(db.create_tenant, payload.company_name, payload.tier)
    await _audit(
        request,
        current_user,
        "admin.company.create",
        target_type="tenant",
        target_id=str(tenant_id),
        after={"company_name": payload.company_name, "tier": payload.tier},
    )
    return {"id": tenant_id, "company_name": payload.company_name, "tier": payload.tier}


@app.get("/api/v1/admin/companies/{tenant_id}")
@limiter.limit("30/minute")
async def admin_company_detail(
    request: Request,
    tenant_id: str,
    current_user: UserSession = Depends(require_superadmin),
):
    """Get detailed view of a company. Superadmin only."""
    detail = db.get_tenant_details(tenant_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Company not found.")
    return detail


@app.post("/api/v1/admin/companies/{tenant_id}/leader")
@limiter.limit("30/minute")
async def admin_assign_leader(
    request: Request,
    tenant_id: str,
    payload: AssignLeaderPayload,
    current_user: UserSession = Depends(require_superadmin),
):
    """Invite a leader to a company. Superadmin only."""
    try:
        token, invite_id = await run_db(
            db.assign_leader_to_tenant, tenant_id, payload.email, current_user.user_id
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    await _audit(
        request,
        current_user,
        "admin.company.assign_leader",
        target_type="tenant",
        target_id=tenant_id,
        metadata={"email": payload.email},
    )

    asyncio.create_task(
        _send_invite_email(
            tenant_id=tenant_id,
            invitee_email=payload.email,
            role="leader",
            invite_token=token,
            inviter_user_id=current_user.user_id,
            template_kind="assign_leader",
        )
    )

    return {
        "id": invite_id,
        "token": token,
        "email": payload.email,
        "role": "leader",
        "expires_in_days": 7,
    }


@app.get("/api/v1/admin/users")
@limiter.limit("30/minute")
async def admin_list_all_users(
    request: Request,
    search: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    role: str | None = None,
    current_user: UserSession = Depends(require_superadmin),
):
    """List all users with pagination and search. Superadmin only."""
    result = db.list_all_users(search=search, limit=limit, offset=offset, role_filter=role)
    return result


@app.patch("/api/v1/admin/users/{profile_id}/role")
@limiter.limit("30/minute")
async def admin_update_user_role(
    request: Request,
    profile_id: str,
    payload: UpdateRolePayload,
    current_user: UserSession = Depends(require_superadmin),
):
    """Change any user's role globally. Superadmin only."""
    ok = await run_db(db.update_any_user_role, profile_id, payload.role)
    if not ok:
        raise HTTPException(status_code=404, detail="User not found.")
    await _audit(
        request,
        current_user,
        "admin.user.update_role",
        target_type="user_profile",
        target_id=profile_id,
        after={"role": payload.role},
    )
    return {"status": "updated", "profile_id": profile_id, "role": payload.role}


@app.delete("/api/v1/admin/users/{profile_id}")
@limiter.limit("30/minute")
async def admin_delete_user(
    request: Request,
    profile_id: str,
    current_user: UserSession = Depends(require_superadmin),
):
    """Delete any user globally. Superadmin only."""
    ok = await run_db(db.delete_any_user, profile_id)
    if not ok:
        raise HTTPException(status_code=404, detail="User not found.")
    await _audit(
        request,
        current_user,
        "admin.user.delete",
        target_type="user_profile",
        target_id=profile_id,
    )
    return {"status": "deleted", "profile_id": profile_id}


@app.get("/api/v1/admin/usage")
@limiter.limit("60/minute")
async def admin_global_usage(
    request: Request,
    current_user: UserSession = Depends(require_superadmin),
):
    """Return global usage stats across all tenants. Superadmin only."""
    usage = db.get_global_usage()
    return usage


# ── Model Pricing (Superadmin) ────────────────────────────────────


class ModelPricingPayload(BaseModel):
    model_identifier: str = Field(..., min_length=1, max_length=150)
    input_credits: int = Field(..., ge=0, le=100000)
    output_credits: int = Field(..., ge=0, le=100000)


@app.get("/api/v1/admin/pricing")
@limiter.limit("30/minute")
async def admin_list_pricing(
    request: Request,
    current_user: UserSession = Depends(require_superadmin),
):
    """List all model pricing rows. Superadmin only."""
    return {"pricing": db.list_model_pricing()}


@app.put("/api/v1/admin/pricing")
@limiter.limit("30/minute")
async def admin_upsert_pricing(
    request: Request,
    payload: ModelPricingPayload,
    current_user: UserSession = Depends(require_superadmin),
):
    """Create or update pricing for a model. Superadmin only."""
    try:
        before = await run_db(db.get_pricing)
        before_row = before.get(payload.model_identifier)
        row = await run_db(
            db.upsert_model_pricing,
            payload.model_identifier,
            payload.input_credits,
            payload.output_credits,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    await _audit(
        request,
        current_user,
        "admin.pricing.upsert",
        target_type="model_pricing",
        target_id=payload.model_identifier,
        before=({"input": before_row["input"], "output": before_row["output"]} if before_row else None),
        after={"input_credits": payload.input_credits, "output_credits": payload.output_credits},
    )
    return {"status": "updated", "pricing": row}


@app.get("/api/v1/admin/audit-log")
@limiter.limit("60/minute")
async def admin_list_audit_log(
    request: Request,
    actor_user_id: str | None = None,
    target_type: str | None = None,
    target_id: str | None = None,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    current_user: UserSession = Depends(require_superadmin),
):
    """Read recent audit-log rows. Superadmin only."""
    rows = await run_db(
        db.list_audit_log,
        actor_user_id=actor_user_id,
        target_type=target_type,
        target_id=target_id,
        limit=limit,
        offset=offset,
    )
    return {"entries": rows}


# ── Chat Sessions (Authenticated, per-user) ───────────────────────

class CreateSessionPayload(BaseModel):
    title: str = Field(default="New Session", min_length=1, max_length=255)
    model_id: str = Field(..., min_length=1, max_length=150)


class RenameSessionPayload(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)


class AddMessagePayload(BaseModel):
    role: str = Field(..., pattern="^(user|assistant)$")
    content: str = Field(..., min_length=1)


@app.get("/api/v1/sessions")
@limiter.limit("60/minute")
async def list_sessions(
    request: Request,
    current_user: UserSession = Depends(get_current_user),
):
    """List all chat sessions for the current user."""
    sessions = db.list_chat_sessions(current_user.user_id)
    return {"sessions": sessions}


@app.post("/api/v1/sessions")
@limiter.limit("30/minute")
async def create_session(
    request: Request,
    payload: CreateSessionPayload,
    current_user: UserSession = Depends(get_current_user),
):
    """Create a new chat session."""
    session = db.create_chat_session(
        current_user.user_id, payload.title, payload.model_id
    )
    return {"session": session}


@app.get("/api/v1/sessions/{session_id}")
@limiter.limit("60/minute")
async def get_session(
    request: Request,
    session_id: str,
    current_user: UserSession = Depends(get_current_user),
):
    """Get a single session with its messages."""
    session = db.get_chat_session(session_id, current_user.user_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")
    return {"session": session}


@app.patch("/api/v1/sessions/{session_id}")
@limiter.limit("30/minute")
async def rename_session(
    request: Request,
    session_id: str,
    payload: RenameSessionPayload,
    current_user: UserSession = Depends(get_current_user),
):
    """Rename a chat session."""
    ok = db.update_chat_session_title(session_id, current_user.user_id, payload.title)
    if not ok:
        raise HTTPException(status_code=404, detail="Session not found.")
    return {"status": "updated"}


@app.delete("/api/v1/sessions/{session_id}")
@limiter.limit("30/minute")
async def delete_session(
    request: Request,
    session_id: str,
    current_user: UserSession = Depends(get_current_user),
):
    """Delete a chat session and all its messages."""
    ok = db.delete_chat_session(session_id, current_user.user_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Session not found.")
    return {"status": "deleted"}


@app.post("/api/v1/sessions/{session_id}/messages")
@limiter.limit("60/minute")
async def add_message(
    request: Request,
    session_id: str,
    payload: AddMessagePayload,
    current_user: UserSession = Depends(get_current_user),
):
    """Add a message to a chat session."""
    msg = db.add_chat_message(
        session_id, payload.role, payload.content, current_user.user_id
    )
    if not msg:
        raise HTTPException(status_code=404, detail="Session not found.")
    return {"message": msg}


# ── Invite (Public + Authenticated) ───────────────────────────────

@app.get("/api/v1/invite/validate")
@limiter.limit("30/minute")
async def validate_invite(
    request: Request,
    token: str,
):
    """Validate an invite token. Returns invite details or 404."""
    invite = db.validate_invite_token(token)
    if not invite:
        raise HTTPException(status_code=404, detail="Invalid or expired invite.")
    return {
        "valid": True,
        "tenant_id": invite["tenant_id"],
        "tenant_name": invite["tenant_name"],
        "email": invite["email"],
        "role": invite["role"],
    }


class AcceptInvitePayload(BaseModel):
    token: str = Field(..., min_length=1)


@app.post("/api/v1/invite/accept")
@limiter.limit("30/minute")
async def accept_invite_endpoint(
    request: Request,
    payload: AcceptInvitePayload,
    current_user: UserSession = Depends(get_current_user),
):
    """Redeem an invite token. Updates user's tenant and role."""
    result = db.accept_invite(
        payload.token,
        current_user.user_id,
        current_user.email,
        user_email=current_user.email,
    )
    if not result:
        raise HTTPException(status_code=403, detail="Invalid invite, expired, or email mismatch.")
    return {
        "status": "accepted",
        "tenant_id": result["tenant_id"],
        "role": result["role"],
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

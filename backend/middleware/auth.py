"""Supabase JWT verification middleware.

Validates the Bearer token against Supabase's JWKS endpoint and resolves the
calling user's tenant + role from our DB.

Production hardening:
- JWKS stale cache is capped at JWKS_MAX_STALE_SECONDS (default 6h);
  beyond that we fail closed.
- JWK → PEM uses the cryptography library (EC P-256 + RSA).
- pyjwt.decode runs with a 30s leeway; larger drift surfaces via /health.
- Optional **fingerprint pinning**: if SUPABASE_JWKS_FINGERPRINTS is set
  (comma-separated SHA-256 hex digests over the JSON-canonicalised JWK),
  we reject any key whose fingerprint isn't on the list. This protects
  against a compromised Supabase JWKS endpoint serving rogue keys.
- Logger context is bound (user_id, tenant_id) so every log line emitted
  during auth-aware request handling is auto-tagged.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import re
import threading
import time
import hashlib
from dataclasses import dataclass
from typing import Optional

import httpx
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from fastapi import HTTPException, Security, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import jwt as pyjwt
from pydantic import BaseModel

import db
from logging_config import (
    hash_id,
    tenant_id_var,
    user_id_var,
)
import logging

logger = logging.getLogger("auth")

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
JWKS_CACHE_TTL_SECONDS = int(os.getenv("JWKS_CACHE_TTL_SECONDS", "1800"))
JWKS_MAX_STALE_SECONDS = int(os.getenv("JWKS_MAX_STALE_SECONDS", "21600"))
JWT_LEEWAY_SECONDS = int(os.getenv("JWT_LEEWAY_SECONDS", "30"))

# Optional security: comma-separated SHA-256 fingerprints of JWKs we trust.
# Empty = trust any key Supabase serves (current behaviour).
_PINNED_FPS = {
    fp.strip().lower()
    for fp in os.getenv("SUPABASE_JWKS_FINGERPRINTS", "").split(",")
    if fp.strip()
}


@dataclass
class _JwksState:
    keys: dict
    fetched_at: float


_jwks_state: Optional[_JwksState] = None
_jwks_lock = threading.Lock()
# Async-aware lock used inside the FastAPI event loop to prevent multiple
# concurrent refresh fetches from racing.
_jwks_async_lock = asyncio.Lock()


def _b64url_decode(val: str) -> bytes:
    padding = 4 - len(val) % 4
    if padding != 4:
        val += "=" * padding
    return base64.urlsafe_b64decode(val)


def _jwk_fingerprint(jwk: dict) -> str:
    """Stable SHA-256 fingerprint over a JWK's canonical JSON form."""
    # Sort keys to make the digest stable regardless of dict ordering.
    canonical = json.dumps(jwk, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


async def _fetch_jwks_remote() -> Optional[dict]:
    """Fetch the JWKS document via httpx.AsyncClient. Returns None on failure."""
    if not SUPABASE_URL:
        return None
    from async_io import get_http_client

    client = get_http_client()
    urls = [
        f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json",
        f"{SUPABASE_URL}/.well-known/jwks.json",
    ]
    for url in urls:
        try:
            resp = await client.get(url, headers={"Accept": "application/json"})
            if resp.status_code == 200:
                doc = resp.json()
                logger.info(
                    "Loaded JWKS",
                    extra={"jwks_url": url, "key_count": len(doc.get("keys", []))},
                )
                return doc
            logger.warning(
                "JWKS fetch returned non-200",
                extra={"jwks_url": url, "status": resp.status_code},
            )
        except Exception as e:
            logger.warning(
                "JWKS fetch failed",
                extra={"jwks_url": url, "error": str(e)},
            )
    return None


async def _get_jwks_async() -> Optional[dict]:
    """Async refresh path. Used inside the FastAPI request lifecycle."""
    global _jwks_state
    now = time.time()

    state = _jwks_state
    if state and (now - state.fetched_at) < JWKS_CACHE_TTL_SECONDS:
        return state.keys

    async with _jwks_async_lock:
        # Re-check after acquiring lock — another coroutine may have refreshed.
        state = _jwks_state
        if state and (now - state.fetched_at) < JWKS_CACHE_TTL_SECONDS:
            return state.keys

        fresh = await _fetch_jwks_remote()
        if fresh is not None:
            with _jwks_lock:
                _jwks_state = _JwksState(keys=fresh, fetched_at=now)
            return fresh

        # Fresh fetch failed — fall back to stale within the hard window.
        if state and (now - state.fetched_at) < JWKS_MAX_STALE_SECONDS:
            logger.warning(
                "Using stale JWKS cache",
                extra={"age_s": int(now - state.fetched_at)},
            )
            return state.keys

        if state:
            logger.error(
                "JWKS cache exceeded max stale; failing closed",
                extra={"max_stale_s": JWKS_MAX_STALE_SECONDS},
            )
            with _jwks_lock:
                _jwks_state = None
        return None


def _is_uuid(val: str) -> bool:
    return bool(re.match(
        r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        val.lower(),
    ))


def _jwk_to_pem(jwk: dict) -> Optional[str]:
    """Convert a JWK (EC P-256 or RSA) to PEM SubjectPublicKeyInfo."""
    kty = jwk.get("kty")
    try:
        if kty == "EC" and jwk.get("crv") == "P-256":
            x = int.from_bytes(_b64url_decode(jwk["x"]), "big")
            y = int.from_bytes(_b64url_decode(jwk["y"]), "big")
            pubkey = ec.EllipticCurvePublicNumbers(x, y, ec.SECP256R1()).public_key(default_backend())
        elif kty == "RSA":
            n = int.from_bytes(_b64url_decode(jwk["n"]), "big")
            e = int.from_bytes(_b64url_decode(jwk["e"]), "big")
            pubkey = rsa.RSAPublicNumbers(e, n).public_key(default_backend())
        else:
            logger.warning("Unsupported JWK", extra={"kty": kty, "crv": jwk.get("crv")})
            return None
        pem = pubkey.public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        return pem.decode("ascii")
    except Exception as exc:
        logger.exception("JWK→PEM conversion failed", extra={"error": str(exc)})
        return None


async def _get_key_for_token(token: str) -> Optional[str]:
    jwks = await _get_jwks_async()
    if not jwks:
        return None
    keys = jwks.get("keys") or []
    if not keys:
        return None

    try:
        header_part = token.split(".")[0]
        header = json.loads(base64.urlsafe_b64decode(header_part + "==").decode("utf-8"))
    except Exception:
        header = {}

    token_kid = header.get("kid")
    for jwk in keys:
        if jwk.get("kid") != token_kid:
            continue
        # Optional fingerprint pinning.
        if _PINNED_FPS:
            fp = _jwk_fingerprint(jwk)
            if fp not in _PINNED_FPS:
                logger.error(
                    "Rejecting JWK that does not match pinned fingerprints",
                    extra={"kid": token_kid, "fingerprint": fp},
                )
                return None
        return _jwk_to_pem(jwk)
    return None


class UserSession(BaseModel):
    user_id: str
    email: str
    tenant_id: str
    role: str = "member"
    is_platform_admin: bool = False


def _resolve_role(user_id: str) -> str:
    try:
        return db.get_user_role(user_id)
    except Exception:
        return "member"


def _resolve_is_platform_admin(user_id: str) -> bool:
    try:
        return db.is_platform_admin(user_id)
    except Exception:
        return False


def _resolve_tenant_from_db(user_id: str) -> str | None:
    try:
        profile = db.ensure_user_profile(user_id, "")
        if not profile or not profile.get("tenant_id"):
            return None
        return str(profile["tenant_id"])
    except Exception:
        return None


def _try_api_key_auth(token: str) -> UserSession | None:
    try:
        key_data = db.validate_api_key(token)
        if not key_data:
            return None
        tenant_id = (
            str(key_data["tenant_id"])
            if _is_uuid(str(key_data["tenant_id"]))
            else db.DEFAULT_TENANT_ID
        )
        return UserSession(
            user_id=f"apikey:{key_data['id']}",
            email="",
            tenant_id=tenant_id,
            role="member",
            is_platform_admin=False,
        )
    except Exception as e:
        logger.warning("API key auth failed", extra={"error": str(e)})
        return None


security_backend = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Security(security_backend),
) -> UserSession:
    token = credentials.credentials

    if token.startswith("ak_"):
        api_user = _try_api_key_auth(token)
        if api_user:
            user_id_var.set(hash_id(api_user.user_id, "api"))
            tenant_id_var.set(hash_id(api_user.tenant_id, "tn"))
            return api_user
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key.",
        )

    key = await _get_key_for_token(token)
    if not key:
        logger.warning("No matching JWKS key for token")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials.",
        )

    try:
        payload = pyjwt.decode(
            token,
            key,
            algorithms=["ES256", "RS256"],
            audience="authenticated",
            leeway=JWT_LEEWAY_SECONDS,
        )
        user_id = payload.get("sub", "")
        email = payload.get("email", "")
        # Resolve in a worker thread; keeps the loop responsive even when
        # the DB pool happens to be slow.
        from async_io import run_db

        db_tenant = await run_db(_resolve_tenant_from_db, user_id)
        if db_tenant:
            tenant_id = db_tenant
        else:
            raw_tenant = payload.get("user_metadata", {}).get("tenant_id", "")
            tenant_id = raw_tenant if _is_uuid(raw_tenant) else db.DEFAULT_TENANT_ID
        role = await run_db(_resolve_role, user_id)
        is_admin = await run_db(_resolve_is_platform_admin, user_id)

        # Bind log context for the rest of the request.
        user_id_var.set(hash_id(user_id, "u"))
        tenant_id_var.set(hash_id(tenant_id, "tn"))

        return UserSession(
            user_id=user_id,
            email=email,
            tenant_id=tenant_id,
            role=role,
            is_platform_admin=is_admin,
        )
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired.",
        )
    except pyjwt.InvalidTokenError as e:
        logger.warning("Invalid token", extra={"error_type": type(e).__name__, "error": str(e)})
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials.",
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error("JWT verification error", extra={"error_type": type(e).__name__, "error": str(e)})
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials.",
        )


# ── Role-based access control ────────────────────────────────────


class RoleChecker:
    def __init__(self, allowed_roles: list[str]):
        self.allowed_roles = allowed_roles

    async def __call__(self, user: UserSession = Security(get_current_user)) -> UserSession:
        if user.role not in self.allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Required role: one of {self.allowed_roles}",
            )
        return user


require_leader = RoleChecker(["superadmin", "leader"])
require_member = RoleChecker(["superadmin", "leader", "member"])


async def require_superadmin(user: UserSession = Security(get_current_user)) -> UserSession:
    if user.role != "superadmin" and not user.is_platform_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. Superadmin required.",
        )
    return user

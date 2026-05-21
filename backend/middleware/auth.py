"""Supabase JWT verification middleware.

Validates the Bearer token against Supabase's JWKS endpoint and resolves the
calling user's tenant + role from our DB.

Hardened for production:
- JWKS stale-cache fallback is capped at JWKS_MAX_STALE_SECONDS (default 6h);
  after that we fail closed rather than accepting tokens we can't re-verify.
- JWK → PEM conversion uses the `cryptography` library (already a dep) so we
  support both EC P-256 (Supabase default) and RSA out of the box.
- pyjwt.decode runs with a 30s leeway to tolerate small clock skew between
  Supabase auth and this host. Larger drift is surfaced via /health.
"""

import logging
import os
import base64
import json
import re
import threading
import time
import urllib.request
from dataclasses import dataclass
from typing import Optional

from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature  # noqa: F401 (kept for type discoverability)

from fastapi import HTTPException, Security, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import jwt as pyjwt
from pydantic import BaseModel

import db

logger = logging.getLogger("auth")

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
JWKS_CACHE_TTL_SECONDS = 1800  # 30 min — re-fetch happily within this window
JWKS_MAX_STALE_SECONDS = int(os.getenv("JWKS_MAX_STALE_SECONDS", "21600"))  # 6 hours hard cap
JWT_LEEWAY_SECONDS = 30


@dataclass
class _JwksState:
    keys: dict
    fetched_at: float


_jwks_state: Optional[_JwksState] = None
_jwks_lock = threading.Lock()


def _b64url_decode(val: str) -> bytes:
    padding = 4 - len(val) % 4
    if padding != 4:
        val += "=" * padding
    return base64.urlsafe_b64decode(val)


def _fetch_jwks_remote() -> Optional[dict]:
    """Attempt to fetch the JWKS document from Supabase. Returns None on failure."""
    if not SUPABASE_URL:
        return None
    urls = [
        f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json",
        f"{SUPABASE_URL}/.well-known/jwks.json",
    ]
    for url in urls:
        try:
            req = urllib.request.Request(url, headers={"Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=5) as resp:
                doc = json.loads(resp.read().decode("utf-8"))
                logger.info("Loaded %d JWKS keys from %s", len(doc.get("keys", [])), url)
                return doc
        except Exception as e:
            logger.warning("Failed to fetch JWKS from %s: %s", url, e)
    return None


def _get_jwks() -> Optional[dict]:
    """Return the currently-trusted JWKS, refreshing if expired.

    Stale cache (older than the TTL but younger than the hard max) is allowed
    while we attempt a re-fetch; if the re-fetch fails we fall back to the
    stale copy. Anything older than ``JWKS_MAX_STALE_SECONDS`` is discarded
    and we fail closed.
    """
    global _jwks_state
    now = time.time()

    with _jwks_lock:
        state = _jwks_state
        if state and (now - state.fetched_at) < JWKS_CACHE_TTL_SECONDS:
            return state.keys

        # Either no cache or it's beyond the soft TTL — try a fresh fetch.
        fresh = _fetch_jwks_remote()
        if fresh is not None:
            _jwks_state = _JwksState(keys=fresh, fetched_at=now)
            return fresh

        # Fresh fetch failed; only use stale cache if within the hard window.
        if state and (now - state.fetched_at) < JWKS_MAX_STALE_SECONDS:
            logger.warning(
                "Using stale JWKS cache (age=%.0fs)",
                now - state.fetched_at,
            )
            return state.keys

        if state:
            logger.error(
                "JWKS cache exceeded max stale age (%ds). Rejecting tokens until refresh.",
                JWKS_MAX_STALE_SECONDS,
            )
            _jwks_state = None  # Force fresh attempts every request.
        return None


def _is_uuid(val: str) -> bool:
    return bool(re.match(
        r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        val.lower(),
    ))


def _jwk_to_pem(jwk: dict) -> Optional[str]:
    """Convert a JWK (EC P-256 or RSA) to PEM-encoded SubjectPublicKeyInfo.

    Uses cryptography's ``EllipticCurvePublicNumbers`` / ``RSAPublicNumbers``
    constructors instead of hand-rolled DER. Supports the formats Supabase has
    historically used (EC) and may use in the future (RSA).
    """
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
            logger.warning("Unsupported JWK kty=%s crv=%s", kty, jwk.get("crv"))
            return None
        pem = pubkey.public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        return pem.decode("ascii")
    except Exception as exc:
        logger.exception("Failed to convert JWK to PEM: %s", exc)
        return None


def _get_key_for_token(token: str) -> Optional[str]:
    """Get the PEM public key matching the token's kid from JWKS."""
    jwks = _get_jwks()
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
        if jwk.get("kid") == token_kid:
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
    """Attempt API key authentication. Returns UserSession on success, None otherwise."""
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
        logger.warning("API key auth failed: %s", e)
        return None


security_backend = HTTPBearer()


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Security(security_backend),
) -> UserSession:
    token = credentials.credentials

    if token.startswith("ak_"):
        api_user = _try_api_key_auth(token)
        if api_user:
            return api_user
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key.",
        )

    key = _get_key_for_token(token)
    if not key:
        logger.warning("No matching JWKS key found for token")
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
        db_tenant = _resolve_tenant_from_db(user_id)
        if db_tenant:
            tenant_id = db_tenant
        else:
            raw_tenant = payload.get("user_metadata", {}).get("tenant_id", "")
            tenant_id = raw_tenant if _is_uuid(raw_tenant) else db.DEFAULT_TENANT_ID
        role = _resolve_role(user_id)
        is_admin = _resolve_is_platform_admin(user_id)
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
        logger.warning("Invalid token: %s: %s", type(e).__name__, e)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials.",
        )
    except Exception as e:
        logger.error("JWT verification error: %s: %s", type(e).__name__, e)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials.",
        )


# ── Role-based access control ────────────────────────────────────


class RoleChecker:
    def __init__(self, allowed_roles: list[str]):
        self.allowed_roles = allowed_roles

    def __call__(self, user: UserSession = Security(get_current_user)) -> UserSession:
        if user.role not in self.allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Required role: one of {self.allowed_roles}",
            )
        return user


require_leader = RoleChecker(["superadmin", "leader"])
require_member = RoleChecker(["superadmin", "leader", "member"])


def require_superadmin(user: UserSession = Security(get_current_user)) -> UserSession:
    if user.role != "superadmin" and not user.is_platform_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. Superadmin required.",
        )
    return user

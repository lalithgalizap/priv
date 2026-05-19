import logging
import os
import base64
import json
import time
import urllib.request
from typing import Optional

from fastapi import HTTPException, Security, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import jwt as pyjwt
from pydantic import BaseModel

import db

logger = logging.getLogger("auth")

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
JWKS_CACHE_TTL_SECONDS = 1800  # 30 minutes

# Cache for JWKS keys
_jwks_cache: dict = {}
_jwks_cache_time: float = 0.0


def _is_jwks_cache_valid() -> bool:
    return bool(_jwks_cache) and (time.time() - _jwks_cache_time) < JWKS_CACHE_TTL_SECONDS


def _b64url_decode(val: str) -> bytes:
    padding = 4 - len(val) % 4
    if padding != 4:
        val += "=" * padding
    return base64.urlsafe_b64decode(val)


def _fetch_jwks() -> dict:
    """Fetch JWKS from Supabase well-known endpoint. Uses cached keys if still valid."""
    global _jwks_cache, _jwks_cache_time
    if _is_jwks_cache_valid():
        return _jwks_cache
    if not SUPABASE_URL:
        return {}
    urls = [
        f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json",
        f"{SUPABASE_URL}/.well-known/jwks.json",
    ]
    for url in urls:
        try:
            req = urllib.request.Request(url, headers={"Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=5) as resp:
                _jwks_cache = json.loads(resp.read().decode("utf-8"))
                _jwks_cache_time = time.time()
                logger.info("Loaded %d keys from %s", len(_jwks_cache.get("keys", [])), url)
                return _jwks_cache
        except Exception as e:
            logger.warning("Failed to fetch JWKS from %s: %s", url, e)
    # If fetch fails but we have stale cache, use it as fallback
    if _jwks_cache:
        logger.info("Using stale JWKS cache as fallback")
        return _jwks_cache
    return {}


def _is_uuid(val: str) -> bool:
    """Check if string is a valid UUID format."""
    import re
    return bool(re.match(
        r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        val.lower()
    ))


def _jwk_to_pem(jwk: dict) -> str:
    """Convert EC P-256 JWK to PEM public key."""
    import base64

    x_bytes = _b64url_decode(jwk["x"])
    y_bytes = _b64url_decode(jwk["y"])

    # Uncompressed point: 04 || x || y
    point = b"\x04" + x_bytes + y_bytes

    # Build SubjectPublicKeyInfo DER
    # AlgorithmIdentifier for EC P-256
    # SEQUENCE { OID ecPublicKey, OID prime256v1 }
    alg_id = bytes([
        0x30, 0x13,  # SEQUENCE, length 19
        0x06, 0x07, 0x2A, 0x86, 0x48, 0xCE, 0x3D, 0x02, 0x01,  # ecPublicKey
        0x06, 0x08, 0x2A, 0x86, 0x48, 0xCE, 0x3D, 0x03, 0x01, 0x07,  # prime256v1
    ])

    # BIT STRING wrapping the point
    bit_str = bytes([0x00]) + point  # unused bits = 0
    bit_str = bytes([0x03, len(bit_str)]) + bit_str

    # SubjectPublicKeyInfo
    spki = alg_id + bit_str
    spki = bytes([0x30, len(spki)]) + spki

    b64 = base64.b64encode(spki).decode("ascii")
    lines = ["-----BEGIN PUBLIC KEY-----"]
    for i in range(0, len(b64), 64):
        lines.append(b64[i:i+64])
    lines.append("-----END PUBLIC KEY-----")
    return "\n".join(lines)


def _get_key_for_token(token: str) -> Optional[str]:
    """Get the PEM public key matching the token's kid from JWKS."""
    jwks = _fetch_jwks()
    keys = jwks.get("keys", [])
    if not keys:
        return None

    # Extract kid from JWT header (no verification needed)
    try:
        header = json.loads(base64.urlsafe_b64decode(token.split(".")[0] + "=="))
    except Exception:
        header = {}

    token_kid = header.get("kid")
    for jwk in keys:
        if jwk.get("kid") == token_kid:
            if jwk.get("kty") == "EC" and jwk.get("crv") == "P-256":
                return _jwk_to_pem(jwk)
            # If it's RSA, we could handle that too
            if jwk.get("kty") == "RSA":
                return None  # RSA not implemented here yet
    return None


class UserSession(BaseModel):
    user_id: str
    email: str
    tenant_id: str
    role: str = "member"
    is_platform_admin: bool = False


def _resolve_role(user_id: str) -> str:
    """Look up role from DB; fall back to member if not found."""
    try:
        return db.get_user_role(user_id)
    except Exception:
        return "member"


def _resolve_is_platform_admin(user_id: str) -> bool:
    """Look up platform admin status from DB."""
    try:
        return db.is_platform_admin(user_id)
    except Exception:
        return False


def _resolve_tenant_from_db(user_id: str) -> str | None:
    """Look up tenant_id from user profile. Returns None if no profile."""
    try:
        profile = db.ensure_user_profile(user_id, "")
        return str(profile["tenant_id"]) if profile else None
    except Exception:
        return None


def _try_api_key_auth(token: str) -> UserSession | None:
    """Attempt API key authentication. Returns UserSession on success, None otherwise."""
    try:
        key_data = db.validate_api_key(token)
        if not key_data:
            return None
        tenant_id = str(key_data["tenant_id"]) if _is_uuid(str(key_data["tenant_id"])) else db.DEFAULT_TENANT_ID
        return UserSession(
            user_id=f"apikey:{key_data['id']}",
            email="",
            tenant_id=tenant_id,
            role="member",  # API keys act as member-level
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

    # Try API key auth first (tokens starting with ak_)
    if token.startswith("ak_"):
        api_user = _try_api_key_auth(token)
        if api_user:
            return api_user
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key.",
        )

    # JWT auth
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
        )
        user_id = payload.get("sub", "")
        email = payload.get("email", "")
        # Resolve tenant from DB profile; fallback to JWT metadata then default
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


# Role-based access control helpers

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

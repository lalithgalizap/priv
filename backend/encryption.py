"""Per-user AES-256-GCM encryption for data at rest.

Each user's data is encrypted with a unique key derived from:
  HMAC-SHA256(master_secret, user_id)

This means:
- Each user has a different encryption key
- A DB dump alone is useless (no keys)
- The master secret alone is useless (need user_id to derive keys)
- Compromising one user's derived key only exposes that user's data

Storage format: "enc:" + base64(nonce[12] + ciphertext + tag[16])

Production hardening:
- The module fails closed in production: if ENCRYPTION_KEY is unset or
  malformed and ENVIRONMENT=production, importing this module raises.
- Decryption failures (corrupted ciphertext, wrong key) raise
  ``DecryptionError`` instead of silently returning the raw stored value,
  so call sites can handle the error explicitly. Legacy unencrypted rows
  (no "enc:" prefix) are still returned as-is to support migrations.
"""

import base64
import hashlib
import hmac
import logging
import os

from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("encryption")

ENVIRONMENT = os.getenv("ENVIRONMENT", "development").lower()
_MASTER_SECRET = os.getenv("ENCRYPTION_KEY", "")
_MASTER_BYTES = (
    bytes.fromhex(_MASTER_SECRET)
    if _MASTER_SECRET and len(_MASTER_SECRET) == 64
    else None
)

if ENVIRONMENT in ("production", "prod") and _MASTER_BYTES is None:
    raise RuntimeError(
        "ENCRYPTION_KEY is required in production and must be 64 hex chars (32 bytes)."
    )


class DecryptionError(Exception):
    """Raised when ciphertext is present but cannot be decrypted."""


def is_configured() -> bool:
    return _MASTER_BYTES is not None


def _derive_user_key(user_id: str) -> bytes:
    """Derive a unique 256-bit key for a specific user."""
    return hmac.new(_MASTER_BYTES, user_id.encode("utf-8"), hashlib.sha256).digest()


def encrypt(plaintext: str, user_id: str) -> str:
    """Encrypt plaintext with a per-user derived key. Returns prefixed base64."""
    if not plaintext:
        return ""
    if not is_configured():
        # Dev-only: pass through. Production raised at import time so we
        # never reach this branch with real user data.
        return plaintext

    from Crypto.Cipher import AES
    from Crypto.Random import get_random_bytes

    key = _derive_user_key(user_id)
    nonce = get_random_bytes(12)
    cipher = AES.new(key, AES.MODE_GCM, nonce=nonce)
    ciphertext, tag = cipher.encrypt_and_digest(plaintext.encode("utf-8"))
    packed = nonce + ciphertext + tag
    return "enc:" + base64.b64encode(packed).decode("ascii")


def decrypt(stored: str, user_id: str) -> str:
    """Decrypt a per-user encrypted string.

    - Empty string → empty string
    - Stored without the ``enc:`` prefix → returned unchanged (legacy data)
    - Decryption failure → raises ``DecryptionError`` with an audit log entry
    """
    if not stored:
        return ""
    if not stored.startswith("enc:"):
        return stored  # Legacy unencrypted row — let the caller decide.
    if not is_configured():
        # In dev with no key set, ciphertext we can't decrypt is a bug.
        raise DecryptionError("ENCRYPTION_KEY not configured.")

    from Crypto.Cipher import AES

    try:
        key = _derive_user_key(user_id)
        packed = base64.b64decode(stored[4:])
        if len(packed) < 28:  # 12 nonce + 16 tag minimum
            raise DecryptionError("Ciphertext too short.")
        nonce = packed[:12]
        tag = packed[-16:]
        ciphertext = packed[12:-16]
        cipher = AES.new(key, AES.MODE_GCM, nonce=nonce)
        plaintext = cipher.decrypt_and_verify(ciphertext, tag)
        return plaintext.decode("utf-8")
    except DecryptionError:
        raise
    except Exception as exc:
        logger.error(
            "Decryption failed for user_id=%s prefix=%s: %s",
            user_id[:8],
            stored[:8],
            exc,
        )
        raise DecryptionError("Failed to decrypt stored value.") from exc


def safe_decrypt(stored: str, user_id: str, *, placeholder: str = "[encrypted: cannot decrypt]") -> str:
    """Decrypt and return ``placeholder`` on failure.

    Use at presentation boundaries (API responses) so a corrupted single row
    does not break a whole list payload. Auditing happens via the logger in
    ``decrypt`` itself.
    """
    try:
        return decrypt(stored, user_id)
    except DecryptionError:
        return placeholder

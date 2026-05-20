"""Per-user AES-256-GCM encryption for data at rest.

Each user's data is encrypted with a unique key derived from:
  HMAC-SHA256(master_secret, user_id)

This means:
- Each user has a different encryption key
- A DB dump alone is useless (no keys)
- The master secret alone is useless (need user_id to derive keys)
- Compromising one user's derived key only exposes that user's data

Storage format: "enc:" + base64(nonce[12] + ciphertext + tag[16])
"""

import base64
import hashlib
import hmac
import os

from dotenv import load_dotenv

load_dotenv()

_MASTER_SECRET = os.getenv("ENCRYPTION_KEY", "")
_MASTER_BYTES = bytes.fromhex(_MASTER_SECRET) if _MASTER_SECRET and len(_MASTER_SECRET) == 64 else None


def is_configured() -> bool:
    return _MASTER_BYTES is not None


def _derive_user_key(user_id: str) -> bytes:
    """Derive a unique 256-bit key for a specific user."""
    return hmac.new(_MASTER_BYTES, user_id.encode("utf-8"), hashlib.sha256).digest()


def encrypt(plaintext: str, user_id: str) -> str:
    """Encrypt plaintext with a per-user derived key. Returns prefixed base64 string."""
    if not plaintext:
        return ""
    if not is_configured():
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
    """Decrypt a per-user encrypted string. Handles legacy unencrypted data."""
    if not stored:
        return ""
    if not stored.startswith("enc:"):
        return stored  # Legacy unencrypted data — return as-is
    if not is_configured():
        return stored

    from Crypto.Cipher import AES

    try:
        key = _derive_user_key(user_id)
        packed = base64.b64decode(stored[4:])
        nonce = packed[:12]
        tag = packed[-16:]
        ciphertext = packed[12:-16]
        cipher = AES.new(key, AES.MODE_GCM, nonce=nonce)
        plaintext = cipher.decrypt_and_verify(ciphertext, tag)
        return plaintext.decode("utf-8")
    except (ValueError, KeyError, IndexError):
        return stored  # Decryption failed — return raw

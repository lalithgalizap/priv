"""Transport encoding for sensitive payloads.

Encodes/decodes data so it's not human-readable in browser DevTools Network tab.
Uses double base64 + reverse to obfuscate.
"""

import base64


def encode_payload(data: str) -> str:
    """Encode a string for transport (matches frontend encodePayload)."""
    if not data:
        return ""
    first = base64.b64encode(data.encode("utf-8")).decode("ascii")
    reversed_str = first[::-1]
    return base64.b64encode(reversed_str.encode("ascii")).decode("ascii")


def decode_payload(encoded: str) -> str:
    """Decode a transport-encoded string (matches frontend decodePayload)."""
    if not encoded:
        return ""
    try:
        reversed_str = base64.b64decode(encoded).decode("ascii")
        first = reversed_str[::-1]
        return base64.b64decode(first).decode("utf-8")
    except Exception:
        return encoded  # Return as-is if not encoded

/**
 * Transport encoding for sensitive payloads.
 * Encodes data before sending over the network so it's not human-readable in DevTools.
 * The backend decodes on receipt and encodes responses.
 */

export function encodePayload(data: string): string {
  if (!data) return "";
  // Double base64 + reverse to make it unreadable
  const first = btoa(unescape(encodeURIComponent(data)));
  const reversed = first.split("").reverse().join("");
  return btoa(reversed);
}

export function decodePayload(encoded: string): string {
  if (!encoded) return "";
  try {
    const reversed = atob(encoded);
    const first = reversed.split("").reverse().join("");
    return decodeURIComponent(escape(atob(first)));
  } catch {
    return encoded; // Return as-is if not encoded (legacy data)
  }
}

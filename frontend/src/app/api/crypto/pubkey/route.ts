import { NextResponse } from "next/server";
import { getServerPubKeyB64 } from "@/lib/server-crypto";

/**
 * Public endpoint: returns the server's static ECDH P-256 public key.
 * The key is public — knowing it lets you encrypt a request to the server,
 * which is exactly what we want.
 */
export async function GET() {
  try {
    const pub = getServerPubKeyB64();
    return NextResponse.json(
      { pub, v: 1 },
      { headers: { "Cache-Control": "public, max-age=300" } }
    );
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}

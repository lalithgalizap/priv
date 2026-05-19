import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token");
    if (!token) return NextResponse.json({ error: "Missing token." }, { status: 400 });
    const res = await fetch(`${BACKEND_URL}/api/v1/invite/validate?token=${encodeURIComponent(token)}`);
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: text.slice(0, 200) }, { status: res.status });
    }
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ error: "Service unavailable." }, { status: 500 });
  }
}

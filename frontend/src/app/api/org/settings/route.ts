import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const res = await fetch(`${BACKEND_URL}/api/v1/org/settings`, {
      headers: authHeader ? { Authorization: authHeader } : {},
    });
    if (!res.ok) return NextResponse.json({ error: "Failed" }, { status: res.status });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ error: "Service unavailable." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const body = await request.json();
    const res = await fetch(`${BACKEND_URL}/api/v1/org/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...(authHeader ? { Authorization: authHeader } : {}) },
      body: JSON.stringify(body),
    });
    if (!res.ok) return NextResponse.json({ error: "Failed" }, { status: res.status });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ error: "Service unavailable." }, { status: 500 });
  }
}

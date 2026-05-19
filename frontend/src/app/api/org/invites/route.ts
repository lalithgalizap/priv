import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const res = await fetch(`${BACKEND_URL}/api/v1/org/invites`, {
      headers: authHeader ? { Authorization: authHeader } : {},
    });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: text.slice(0, 200) }, { status: res.status });
    }
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ error: "Service unavailable." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
    const authHeader = request.headers.get("authorization");
    const res = await fetch(`${BACKEND_URL}/api/v1/org/invites/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: authHeader ? { Authorization: authHeader } : {},
    });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: text.slice(0, 200) }, { status: res.status });
    }
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ error: "Service unavailable." }, { status: 500 });
  }
}

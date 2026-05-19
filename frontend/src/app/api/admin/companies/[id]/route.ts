import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const authHeader = request.headers.get("authorization");
    const res = await fetch(`${BACKEND_URL}/api/v1/admin/companies/${encodeURIComponent(id)}`, {
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

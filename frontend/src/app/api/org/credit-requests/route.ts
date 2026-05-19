import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const token = request.headers.get("authorization") || "";
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const backendUrl = process.env.BACKEND_URL || "http://127.0.0.1:8000";
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const query = status ? `?status=${encodeURIComponent(status)}` : "";

  try {
    const res = await fetch(`${backendUrl}/api/v1/org/credit-requests${query}`, {
      headers: { Authorization: token },
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "Failed to load credit requests" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const token = request.headers.get("authorization") || "";
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const backendUrl = process.env.BACKEND_URL || "http://127.0.0.1:8000";

  try {
    const body = await request.json();
    const res = await fetch(`${backendUrl}/api/v1/org/credit-requests`, {
      method: "POST",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "Failed to create credit request" }, { status: 500 });
  }
}

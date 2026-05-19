import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = request.headers.get("authorization") || "";
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const backendUrl = process.env.BACKEND_URL || "http://127.0.0.1:8000";
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const query = status ? `?status=${encodeURIComponent(status)}` : "";

  try {
    const res = await fetch(`${backendUrl}/api/v1/admin/tenants/${id}/credit-requests${query}`, {
      headers: { Authorization: token },
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "Failed to load requests" }, { status: 500 });
  }
}

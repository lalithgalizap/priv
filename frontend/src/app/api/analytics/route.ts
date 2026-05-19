import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");

    const backendRes = await fetch(`${BACKEND_URL}/api/v1/analytics`, {
      method: "GET",
      headers: {
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
    });

    if (!backendRes.ok) {
      const text = await backendRes.text();
      return NextResponse.json(
        { error: text.slice(0, 200) || "Analytics unavailable." },
        { status: backendRes.status }
      );
    }

    const data = await backendRes.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Analytics proxy error:", error);
    return NextResponse.json(
      { error: "Analytics unavailable." },
      { status: 500 }
    );
  }
}

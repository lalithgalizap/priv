import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const contentType = request.headers.get("content-type") || "";

    let backendRes: Response;

    if (contentType.includes("multipart/form-data")) {
      // Forward multipart upload directly
      const formData = await request.formData();
      backendRes = await fetch(`${BACKEND_URL}/api/v1/mediate/upload`, {
        method: "POST",
        headers: {
          ...(authHeader ? { Authorization: authHeader } : {}),
        },
        body: formData,
      });
    } else {
      // JSON text-only mediation
      const body = await request.json();
      backendRes = await fetch(`${BACKEND_URL}/api/v1/mediate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authHeader ? { Authorization: authHeader } : {}),
        },
        body: JSON.stringify(body),
      });
    }

    if (!backendRes.ok) {
      const text = await backendRes.text();
      return NextResponse.json(
        { error: text.slice(0, 200) || "Broker pipeline transaction dropped." },
        { status: backendRes.status }
      );
    }

    const data = await backendRes.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Mediation proxy error:", error);
    return NextResponse.json(
      { error: "Broker pipeline transaction dropped." },
      { status: 500 }
    );
  }
}

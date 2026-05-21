import { NextRequest, NextResponse } from "next/server";
import { openRequest } from "@/lib/server-crypto";
import { logout } from "@/lib/supabase-admin";
import { clearSessionCookies, cookieNames } from "@/lib/cookies";

export async function POST(request: NextRequest) {
  let envelope: { v?: number; epk?: string; n?: string; c?: string } | null = null;
  try {
    envelope = await request.json();
  } catch {
    envelope = null;
  }

  let seal: (data: unknown) => { n: string; c: string } = (data) => ({
    n: "",
    c: Buffer.from(JSON.stringify(data || {}), "utf-8").toString("base64"),
  });
  if (envelope && envelope.epk && envelope.n && envelope.c) {
    try {
      const url = new URL(request.url);
      const opened = openRequest(envelope, url.pathname);
      seal = opened.seal;
    } catch {
      // ignore — still clear cookies
    }
  }

  const access =
    request.cookies.get(cookieNames.access)?.value ||
    (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (access) await logout(access);

  const response = NextResponse.json(seal({ ok: true }));
  clearSessionCookies(response);
  return response;
}

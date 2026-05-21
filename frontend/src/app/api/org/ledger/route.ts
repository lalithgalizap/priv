import { dispatchEnvelope } from "@/lib/envelope";
import { callBackend } from "@/lib/backend";
import { NextRequest } from "next/server";

export const POST = dispatchEnvelope({
  GET: async (ctx) => {
    if (!ctx.authHeader) ctx.fail(401, "Unauthorized");
    const url = new URL((ctx.request as NextRequest).url);
    const limit = url.searchParams.get("limit") || "50";
    const offset = url.searchParams.get("offset") || "0";
    const res = await callBackend({
      path: "/api/v1/org/ledger",
      authHeader: ctx.authHeader,
      query: { limit, offset },
    });
    if (!res.ok) ctx.fail(res.status, (res.data as { error?: string })?.error || `HTTP ${res.status}`);
    return res.data;
  },
});

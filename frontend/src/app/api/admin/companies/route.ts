import { dispatchEnvelope } from "@/lib/envelope";
import { callBackend } from "@/lib/backend";
import { NextRequest } from "next/server";

export const POST = dispatchEnvelope({
  GET: async (ctx) => {
    const url = new URL((ctx.request as NextRequest).url);
    const query: Record<string, string> = {};
    url.searchParams.forEach((v, k) => { query[k] = v; });
    const res = await callBackend({
      path: "/api/v1/admin/companies",
      authHeader: ctx.authHeader,
      query,
    });
    if (!res.ok) ctx.fail(res.status, (res.data as { error?: string })?.error || `HTTP ${res.status}`);
    return res.data;
  },
  POST: async (ctx) => {
    const res = await callBackend({
      method: "POST",
      path: "/api/v1/admin/companies",
      authHeader: ctx.authHeader,
      body: ctx.body,
    });
    if (!res.ok) ctx.fail(res.status, (res.data as { error?: string })?.error || `HTTP ${res.status}`);
    return res.data;
  },
});

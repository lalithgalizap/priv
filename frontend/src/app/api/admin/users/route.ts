import { dispatchEnvelope } from "@/lib/envelope";
import { callBackend } from "@/lib/backend";
import { NextRequest } from "next/server";

export const POST = dispatchEnvelope({
  GET: async (ctx) => {
    const url = new URL((ctx.request as NextRequest).url);
    const query: Record<string, string> = {};
    url.searchParams.forEach((v, k) => { query[k] = v; });
    const res = await callBackend({
      path: "/api/v1/admin/users",
      authHeader: ctx.authHeader,
      query,
    });
    if (!res.ok) ctx.fail(res.status, (res.data as { error?: string })?.error || `HTTP ${res.status}`);
    return res.data;
  },
  PATCH: async (ctx) => {
    const url = new URL((ctx.request as NextRequest).url);
    const id = url.searchParams.get("id") || (ctx.body as { id?: string })?.id;
    if (!id) ctx.fail(400, "Missing id.");
    const res = await callBackend({
      method: "PATCH",
      path: `/api/v1/admin/users/${encodeURIComponent(id!)}/role`,
      authHeader: ctx.authHeader,
      body: ctx.body,
    });
    if (!res.ok) ctx.fail(res.status, (res.data as { error?: string })?.error || `HTTP ${res.status}`);
    return res.data;
  },
  DELETE: async (ctx) => {
    const url = new URL((ctx.request as NextRequest).url);
    const id = url.searchParams.get("id") || (ctx.body as { id?: string })?.id;
    if (!id) ctx.fail(400, "Missing id.");
    const res = await callBackend({
      method: "DELETE",
      path: `/api/v1/admin/users/${encodeURIComponent(id!)}`,
      authHeader: ctx.authHeader,
    });
    if (!res.ok) ctx.fail(res.status, (res.data as { error?: string })?.error || `HTTP ${res.status}`);
    return res.data;
  },
});

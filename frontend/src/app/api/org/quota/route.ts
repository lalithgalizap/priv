import { dispatchEnvelope } from "@/lib/envelope";
import { callBackend } from "@/lib/backend";

export const POST = dispatchEnvelope({
  GET: async (ctx) => {
    if (!ctx.authHeader) ctx.fail(401, "Unauthorized");
    const res = await callBackend({
      path: "/api/v1/org/quota",
      authHeader: ctx.authHeader,
    });
    if (!res.ok) ctx.fail(res.status, (res.data as { error?: string })?.error || `HTTP ${res.status}`);
    return res.data;
  },
  PATCH: async (ctx) => {
    if (!ctx.authHeader) ctx.fail(401, "Unauthorized");
    const body = (ctx.body || {}) as { supabase_auth_id?: string; token_limit?: number };
    if (!body.supabase_auth_id) ctx.fail(400, "Missing supabase_auth_id.");
    const res = await callBackend({
      method: "PATCH",
      path: `/api/v1/org/members/${encodeURIComponent(body.supabase_auth_id!)}/quota`,
      authHeader: ctx.authHeader,
      body: { token_limit: body.token_limit },
    });
    if (!res.ok) ctx.fail(res.status, (res.data as { error?: string })?.error || `HTTP ${res.status}`);
    return res.data;
  },
});

import { dispatchEnvelope } from "@/lib/envelope";
import { callBackend } from "@/lib/backend";

export const POST = dispatchEnvelope({
  GET: async (ctx) => {
    const res = await callBackend({
      path: "/api/v1/sessions",
      authHeader: ctx.authHeader,
    });
    if (!res.ok) ctx.fail(res.status, (res.data as { error?: string })?.error || `HTTP ${res.status}`);
    return res.data;
  },
  POST: async (ctx) => {
    const res = await callBackend({
      method: "POST",
      path: "/api/v1/sessions",
      authHeader: ctx.authHeader,
      body: ctx.body,
    });
    if (!res.ok) ctx.fail(res.status, (res.data as { error?: string })?.error || `HTTP ${res.status}`);
    return res.data;
  },
});

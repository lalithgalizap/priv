import { dispatchEnvelope } from "@/lib/envelope";
import { callBackend } from "@/lib/backend";

export const POST = dispatchEnvelope<{ id: string }>({
  GET: async (ctx, params) => {
    const res = await callBackend({
      path: `/api/v1/sessions/${encodeURIComponent(params.id)}`,
      authHeader: ctx.authHeader,
    });
    if (!res.ok) ctx.fail(res.status, (res.data as { error?: string })?.error || `HTTP ${res.status}`);
    return res.data;
  },
  PATCH: async (ctx, params) => {
    const res = await callBackend({
      method: "PATCH",
      path: `/api/v1/sessions/${encodeURIComponent(params.id)}`,
      authHeader: ctx.authHeader,
      body: ctx.body,
    });
    if (!res.ok) ctx.fail(res.status, (res.data as { error?: string })?.error || `HTTP ${res.status}`);
    return res.data;
  },
  DELETE: async (ctx, params) => {
    const res = await callBackend({
      method: "DELETE",
      path: `/api/v1/sessions/${encodeURIComponent(params.id)}`,
      authHeader: ctx.authHeader,
    });
    if (!res.ok) ctx.fail(res.status, (res.data as { error?: string })?.error || `HTTP ${res.status}`);
    return res.data;
  },
});

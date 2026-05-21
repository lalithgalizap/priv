import { dispatchEnvelope } from "@/lib/envelope";
import { callBackend } from "@/lib/backend";

export const POST = dispatchEnvelope<{ id: string }>({
  POST: async (ctx, params) => {
    const res = await callBackend({
      method: "POST",
      path: `/api/v1/sessions/${encodeURIComponent(params.id)}/messages`,
      authHeader: ctx.authHeader,
      body: ctx.body,
    });
    if (!res.ok) ctx.fail(res.status, (res.data as { error?: string })?.error || `HTTP ${res.status}`);
    return res.data;
  },
});

import { dispatchEnvelope } from "@/lib/envelope";
import { callBackend } from "@/lib/backend";

export const POST = dispatchEnvelope<{ id: string }>({
  GET: async (ctx, params) => {
    const res = await callBackend({
      path: `/api/v1/admin/users/${encodeURIComponent(params.id)}/usage`,
      authHeader: ctx.authHeader,
    });
    if (!res.ok) ctx.fail(res.status, (res.data as { error?: string })?.error || `HTTP ${res.status}`);
    return res.data;
  },
});

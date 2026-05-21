import { dispatchEnvelope } from "@/lib/envelope";
import { callBackend } from "@/lib/backend";

export const POST = dispatchEnvelope<{ id: string }>({
  POST: async (ctx, params) => {
    if (!ctx.authHeader) ctx.fail(401, "Unauthorized");
    const res = await callBackend({
      method: "POST",
      path: `/api/v1/org/members/${encodeURIComponent(params.id)}/extra-tokens`,
      authHeader: ctx.authHeader,
      body: ctx.body,
    });
    if (!res.ok) ctx.fail(res.status, (res.data as { error?: string })?.error || `HTTP ${res.status}`);
    return res.data;
  },
});

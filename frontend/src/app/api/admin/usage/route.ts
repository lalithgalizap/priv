import { dispatchEnvelope } from "@/lib/envelope";
import { callBackend } from "@/lib/backend";

export const POST = dispatchEnvelope({
  GET: async (ctx) => {
    if (!ctx.authHeader) ctx.fail(401, "Unauthorized");
    const res = await callBackend({
      path: "/api/v1/admin/usage",
      authHeader: ctx.authHeader,
    });
    if (!res.ok) ctx.fail(res.status, (res.data as { error?: string })?.error || `HTTP ${res.status}`);
    return res.data;
  },
});

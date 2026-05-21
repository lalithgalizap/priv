import { dispatchEnvelope } from "@/lib/envelope";
import { callBackend } from "@/lib/backend";

export const POST = dispatchEnvelope({
  POST: async (ctx) => {
    if (!ctx.authHeader) ctx.fail(401, "Unauthorized");
    const res = await callBackend({
      method: "POST",
      path: "/api/v1/me/quota/reset",
      authHeader: ctx.authHeader,
    });
    if (!res.ok) ctx.fail(res.status, (res.data as { error?: string })?.error || `HTTP ${res.status}`);
    return res.data;
  },
});

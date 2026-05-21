import { dispatchEnvelope } from "@/lib/envelope";
import { callBackend } from "@/lib/backend";
import { NextRequest } from "next/server";

export const POST = dispatchEnvelope({
  POST: async (ctx) => {
    const url = new URL((ctx.request as NextRequest).url);
    const tenantId = url.searchParams.get("tenantId") || (ctx.body as { tenantId?: string })?.tenantId;
    if (!tenantId) ctx.fail(400, "Missing tenantId.");
    const fwdBody = { ...(ctx.body as Record<string, unknown>) };
    delete fwdBody.tenantId;
    const res = await callBackend({
      method: "POST",
      path: `/api/v1/admin/companies/${encodeURIComponent(tenantId!)}/leader`,
      authHeader: ctx.authHeader,
      body: fwdBody,
    });
    if (!res.ok) ctx.fail(res.status, (res.data as { error?: string })?.error || `HTTP ${res.status}`);
    return res.data;
  },
});

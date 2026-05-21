import { dispatchEnvelope } from "@/lib/envelope";
import { callBackend } from "@/lib/backend";

interface ValidateBody {
  token?: string;
}

export const POST = dispatchEnvelope({
  POST: async (ctx) => {
    const body = (ctx.body || {}) as ValidateBody;
    if (!body.token) ctx.fail(400, "Missing token.");
    const res = await callBackend({
      path: `/api/v1/invite/validate`,
      query: { token: body.token },
    });
    if (!res.ok) ctx.fail(res.status, (res.data as { error?: string })?.error || `HTTP ${res.status}`);
    return res.data;
  },
});

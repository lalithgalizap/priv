import { dispatchEnvelope } from "@/lib/envelope";
import { callBackend } from "@/lib/backend";

interface FilePart {
  __file: true;
  name: string;
  type?: string;
  size?: number;
  b64: string;
}

interface MediateBody {
  prompt?: string;
  model?: string;
  history?: unknown;
  system_prompt?: string | null;
  max_tokens?: number;
  file?: FilePart | string | null;
}

function isFilePart(v: unknown): v is FilePart {
  return !!v && typeof v === "object" && (v as FilePart).__file === true && typeof (v as FilePart).b64 === "string";
}

export const POST = dispatchEnvelope({
  POST: async (ctx) => {
    if (!ctx.authHeader) ctx.fail(401, "Unauthorized");
    const body = (ctx.body || {}) as MediateBody;

    if (isFilePart(body.file)) {
      const fp = body.file;
      const fileBytes = Buffer.from(fp.b64, "base64");
      const blob = new Blob([new Uint8Array(fileBytes)], {
        type: fp.type || "application/octet-stream",
      });
      const fd = new FormData();
      fd.append("prompt", String(body.prompt ?? ""));
      fd.append("model", String(body.model ?? "moonshotai.kimi-k2.5"));
      fd.append("history", JSON.stringify(body.history ?? []));
      if (body.system_prompt) fd.append("system_prompt", String(body.system_prompt));
      fd.append("max_tokens", String(body.max_tokens ?? 1024));
      fd.append("file", blob, fp.name || "upload");

      const res = await callBackend({
        method: "POST",
        path: "/api/v1/mediate/upload",
        authHeader: ctx.authHeader,
        formData: fd,
      });
      if (!res.ok) ctx.fail(res.status, (res.data as { error?: string })?.error || `HTTP ${res.status}`);
      return res.data;
    }

    const res = await callBackend({
      method: "POST",
      path: "/api/v1/mediate",
      authHeader: ctx.authHeader,
      body: {
        prompt: body.prompt,
        model: body.model,
        history: body.history,
        system_prompt: body.system_prompt,
        max_tokens: body.max_tokens,
      },
    });
    if (!res.ok) ctx.fail(res.status, (res.data as { error?: string })?.error || `HTTP ${res.status}`);
    return res.data;
  },
});

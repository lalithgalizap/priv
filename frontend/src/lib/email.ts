/**
 * Server-only email sender for Next.js API routes.
 *
 * Provider selected by ``EMAIL_PROVIDER``:
 *   - ``resend``  — Resend REST API (requires ``RESEND_API_KEY``)
 *   - ``smtp``    — generic SMTP (Gmail App Password, SES SMTP, Mailgun…).
 *                  Required env: SMTP_HOST, SMTP_PORT, SMTP_USERNAME,
 *                  SMTP_PASSWORD. Optional: SMTP_USE_TLS, SMTP_USE_SSL.
 *                  For Gmail: enable 2FA, then create an App Password at
 *                  https://myaccount.google.com/apppasswords. ``EMAIL_FROM``
 *                  must use the same address as ``SMTP_USERNAME`` or Gmail
 *                  silently rewrites it.
 *   - ``console`` — local dev fallback; logs the email instead of sending.
 *
 * SMTP is implemented via Node's built-in ``net`` / ``tls`` (we keep the
 * surface tiny and avoid adding ``nodemailer`` to the dependency graph for
 * this single use case).
 */

import { connect as netConnect, type Socket } from "node:net";
import { connect as tlsConnect, type TLSSocket } from "node:tls";

const EMAIL_PROVIDER = (process.env.EMAIL_PROVIDER || "console").toLowerCase();
const EMAIL_FROM = process.env.EMAIL_FROM || "Quintal AI <onboarding@resend.dev>";
const EMAIL_REPLY_TO = process.env.EMAIL_REPLY_TO || "";

// Resend
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";

// SMTP
const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = Number(process.env.SMTP_PORT || "587");
const SMTP_USERNAME = process.env.SMTP_USERNAME || "";
const SMTP_PASSWORD = process.env.SMTP_PASSWORD || "";
const SMTP_USE_TLS = (process.env.SMTP_USE_TLS || "true").toLowerCase() !== "false";
const SMTP_USE_SSL = (process.env.SMTP_USE_SSL || "false").toLowerCase() === "true";

interface SendArgs {
  to: string;
  subject: string;
  html: string;
  text: string;
  template: string;
  metadata?: Record<string, unknown>;
}

interface SendResult {
  ok: boolean;
  id?: string | null;
  error?: string;
}

/** Send a single transactional email. Never throws. */
export async function sendEmail(args: SendArgs): Promise<SendResult> {
  if (!args.to || !args.subject) {
    return { ok: false, error: "Missing recipient or subject" };
  }

  if (EMAIL_PROVIDER === "console") {
    console.info("[email:console]", {
      template: args.template,
      to: args.to,
      subject: args.subject,
      metadata: args.metadata,
    });
    return { ok: true, id: "console" };
  }

  if (EMAIL_PROVIDER === "resend") {
    if (!RESEND_API_KEY) {
      console.warn("[email] RESEND_API_KEY not set; skipping send");
      return { ok: false, error: "RESEND_API_KEY missing" };
    }
    try {
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: EMAIL_FROM,
          to: [args.to],
          subject: args.subject,
          html: args.html,
          text: args.text,
          tags: [{ name: "template", value: args.template }],
          ...(EMAIL_REPLY_TO ? { reply_to: EMAIL_REPLY_TO } : {}),
        }),
      });
      if (resp.status >= 400) {
        const body = await resp.text().catch(() => "");
        console.warn("[email] resend send failed", resp.status, body.slice(0, 200));
        return { ok: false, error: body.slice(0, 200) };
      }
      const data = (await resp.json().catch(() => ({}))) as { id?: string };
      console.info("[email:resend]", {
        template: args.template,
        provider_id: data.id,
      });
      return { ok: true, id: data.id || null };
    } catch (e) {
      console.warn("[email] resend send crashed", (e as Error).message);
      return { ok: false, error: (e as Error).message };
    }
  }

  if (EMAIL_PROVIDER === "smtp") {
    if (!SMTP_HOST || !SMTP_USERNAME || !SMTP_PASSWORD) {
      console.warn("[email] SMTP env not configured");
      return { ok: false, error: "SMTP credentials missing" };
    }
    try {
      await smtpSend({
        from: EMAIL_FROM,
        to: args.to,
        subject: args.subject,
        html: args.html,
        text: args.text,
        replyTo: EMAIL_REPLY_TO || undefined,
      });
      console.info("[email:smtp]", { template: args.template });
      return { ok: true, id: null };
    } catch (e) {
      console.warn("[email] smtp send failed", (e as Error).message);
      return { ok: false, error: (e as Error).message };
    }
  }

  return { ok: false, error: `Unknown EMAIL_PROVIDER=${EMAIL_PROVIDER}` };
}


// ── SMTP (RFC 5321 / 5322 / 6376 minimal client) ────────────────


interface SmtpArgs {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}

/**
 * Minimal SMTP client. Only what we need:
 *   - implicit TLS via 465 OR STARTTLS via 587
 *   - PLAIN auth (Gmail / SES / Mailgun all accept this)
 *   - multipart/alternative HTML + text body
 *
 * Errors propagate as ``Error`` so the caller can log them.
 */
async function smtpSend(args: SmtpArgs): Promise<void> {
  const host = SMTP_HOST;
  const port = SMTP_PORT;

  // Step 1 — open the right kind of socket.
  let sock: Socket | TLSSocket;
  if (SMTP_USE_SSL || port === 465) {
    sock = tlsConnect({ host, port, servername: host });
  } else {
    sock = netConnect({ host, port });
  }

  const conn = new SmtpConn(sock);
  try {
    await conn.expect(220);
    await conn.command(`EHLO ${hostnameFromEmail(SMTP_USERNAME)}`, [250]);

    if (!(SMTP_USE_SSL || port === 465) && SMTP_USE_TLS) {
      await conn.command("STARTTLS", [220]);
      sock = await upgradeToTls(sock as Socket, host);
      conn.attach(sock);
      await conn.command(`EHLO ${hostnameFromEmail(SMTP_USERNAME)}`, [250]);
    }

    // PLAIN auth: \0username\0password, base64-encoded.
    const authPayload = Buffer.from(
      `\0${SMTP_USERNAME}\0${SMTP_PASSWORD}`,
      "utf-8",
    ).toString("base64");
    await conn.command(`AUTH PLAIN ${authPayload}`, [235]);

    const mailFrom = extractAddr(args.from);
    const rcptTo = extractAddr(args.to);
    await conn.command(`MAIL FROM:<${mailFrom}>`, [250]);
    await conn.command(`RCPT TO:<${rcptTo}>`, [250, 251]);
    await conn.command("DATA", [354]);

    const message = buildMimeMessage(args);
    // SMTP DATA terminator: \r\n.\r\n. Lines beginning with `.` must be dot-stuffed.
    const stuffed = message.replace(/\r\n\./g, "\r\n..");
    await conn.writeRaw(stuffed + "\r\n.\r\n");
    await conn.expect(250);

    await conn.command("QUIT", [221]).catch(() => undefined);
  } finally {
    try {
      sock.destroy();
    } catch {
      /* already closed */
    }
  }
}


/**
 * Wrap a chatty raw socket in something that lets us send a command and
 * await the multi-line reply, with a simple expected-status assertion.
 */
class SmtpConn {
  private sock: Socket | TLSSocket;
  private buffer = "";
  private resolvers: { code: number[]; resolve: (text: string) => void; reject: (e: Error) => void; want: number[] }[] = [];

  constructor(sock: Socket | TLSSocket) {
    this.sock = sock;
    this.attach(sock);
  }

  attach(sock: Socket | TLSSocket): void {
    this.sock = sock;
    sock.setEncoding("utf-8");
    sock.on("data", (chunk: string) => this.onData(chunk));
    sock.on("error", (err: Error) => this.onError(err));
    sock.on("close", () => this.onError(new Error("SMTP connection closed")));
  }

  private onData(chunk: string) {
    this.buffer += chunk;
    // Parse complete responses. Each line ends with \r\n. A line where the
    // 4th character is ' ' (not '-') is the last line of a response group.
    while (true) {
      const lineEnd = this.buffer.indexOf("\r\n");
      if (lineEnd < 0) return;
      // Find the end of the current multi-line response.
      let scan = 0;
      let endOfBlock = -1;
      while (true) {
        const next = this.buffer.indexOf("\r\n", scan);
        if (next < 0) return; // wait for more data
        const line = this.buffer.slice(scan, next);
        // RFC 5321: code SP text  → final line. code "-" text → continuation.
        if (line.length >= 4 && line[3] === " ") {
          endOfBlock = next + 2;
          break;
        }
        scan = next + 2;
      }
      const block = this.buffer.slice(0, endOfBlock).trimEnd();
      this.buffer = this.buffer.slice(endOfBlock);
      this.deliver(block);
    }
  }

  private deliver(block: string) {
    const m = block.match(/^(\d{3})/);
    const code = m ? Number(m[1]) : 0;
    const waiter = this.resolvers.shift();
    if (!waiter) return; // unsolicited; ignore
    if (waiter.want.length === 0 || waiter.want.includes(code)) {
      waiter.resolve(block);
    } else {
      waiter.reject(new Error(`SMTP unexpected response: ${block}`));
    }
  }

  private onError(err: Error) {
    while (this.resolvers.length) {
      const w = this.resolvers.shift();
      if (w) w.reject(err);
    }
  }

  /** Wait for the next response without sending a command. */
  expect(want: number | number[]): Promise<string> {
    const wants = Array.isArray(want) ? want : [want];
    return new Promise((resolve, reject) => {
      this.resolvers.push({ code: wants, want: wants, resolve, reject });
    });
  }

  /** Send a command and assert the response status code. */
  command(line: string, want: number | number[]): Promise<string> {
    const wants = Array.isArray(want) ? want : [want];
    return new Promise((resolve, reject) => {
      this.resolvers.push({ code: wants, want: wants, resolve, reject });
      this.sock.write(line + "\r\n", (err) => {
        if (err) reject(err);
      });
    });
  }

  writeRaw(data: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.sock.write(data, (err) => (err ? reject(err) : resolve()));
    });
  }
}


function upgradeToTls(plain: Socket, host: string): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    const tls = tlsConnect({ socket: plain, servername: host }, () => resolve(tls));
    tls.once("error", (err) => reject(err));
  });
}


function buildMimeMessage(args: SmtpArgs): string {
  // Boundary needs to be unique within the message — long random hex is fine.
  const boundary = "qbnd_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  const headers = [
    `From: ${args.from}`,
    `To: ${args.to}`,
    `Subject: ${args.subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    `Date: ${new Date().toUTCString()}`,
  ];
  if (args.replyTo) headers.push(`Reply-To: ${args.replyTo}`);

  const body = [
    "",
    `--${boundary}`,
    `Content-Type: text/plain; charset=utf-8`,
    `Content-Transfer-Encoding: 7bit`,
    "",
    args.text,
    "",
    `--${boundary}`,
    `Content-Type: text/html; charset=utf-8`,
    `Content-Transfer-Encoding: 7bit`,
    "",
    args.html,
    "",
    `--${boundary}--`,
    "",
  ];
  return [...headers, ...body].join("\r\n");
}


function extractAddr(headerValue: string): string {
  const m = headerValue.match(/<([^>]+)>/);
  return m ? m[1] : headerValue.trim();
}


function hostnameFromEmail(email: string): string {
  const at = email.indexOf("@");
  return at >= 0 ? email.slice(at + 1) : "localhost";
}

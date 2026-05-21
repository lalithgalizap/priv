"use client";

/**
 * Password reset finaliser. Reads the Supabase recovery tokens from the URL
 * fragment (so they never appear in CDN / nginx access logs) and lets the
 * user choose a new password.
 *
 * Supabase's recovery link format:
 *   /reset-password#access_token=...&refresh_token=...&type=recovery&expires_in=...
 */

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Key, Loader2, ShieldCheck, AlertTriangle } from "lucide-react";
import { resetPassword } from "@/lib/auth";

function readFragmentParams(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  const out: Record<string, string> = {};
  for (const part of hash.split("&")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = decodeURIComponent(part.slice(0, eq));
    const v = decodeURIComponent(part.slice(eq + 1));
    out[k] = v;
  }
  return out;
}

function ResetPasswordInner() {
  const router = useRouter();
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [type, setType] = useState<string | null>(null);
  const [tokenLoaded, setTokenLoaded] = useState(false);

  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const params = readFragmentParams();
    setAccessToken(params.access_token || null);
    setType(params.type || null);
    setTokenLoaded(true);
    // Strip the fragment so a casual back-button or screenshot doesn't
    // expose the recovery token.
    if (window.location.hash) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  function validate(): string | null {
    if (pw.length < 8) return "Password must be at least 8 characters.";
    if (!/[0-9]/.test(pw)) return "Password must contain at least one number.";
    if (pw !== pw2) return "Passwords do not match.";
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    if (!accessToken) {
      setError("Reset link is missing or has expired. Request a new one.");
      return;
    }
    setSubmitting(true);
    try {
      await resetPassword(accessToken, pw);
      setSuccess(true);
      setTimeout(() => router.push("/login"), 2200);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Reset failed.";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  if (!tokenLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#0b0e14" }}>
        <Loader2 className="w-8 h-8 text-[#b8c3ff] animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex relative overflow-hidden"
      style={{ background: "#0b0e14", backgroundImage: "radial-gradient(circle at 30% 50%, #2a3f95 0%, transparent 40%)" }}>
      <div className="hidden lg:flex flex-1 items-center justify-center relative">
        <div className="absolute inset-0 bg-primary/5 blur-[120px] rounded-full pointer-events-none" />
        <div className="relative z-10 flex flex-col items-center">
          <img src="/logo.png" alt="Quintal AI" className="w-64 h-64 object-contain drop-shadow-[0_0_40px_rgba(42,63,149,0.5)]" />
          <p className="mt-8 text-white text-center text-2xl font-sans font-semibold tracking-tight">
            Reset password. <span className="text-[#b8c3ff]">Stay private.</span>
          </p>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center px-6 lg:px-16">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <img src="/logo.png" alt="Quintal AI" className="w-10 h-10 object-contain" />
            <span className="font-sans text-xl font-bold text-white">Quintal AI</span>
          </div>

          {!accessToken && (
            <div className="rounded-xl border border-[#ffb4ab]/30 bg-[#ffb4ab]/10 p-5 text-[#ffb4ab] flex flex-col items-start gap-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5" />
                <h2 className="font-sans text-lg font-semibold">Link expired or invalid</h2>
              </div>
              <p className="text-sm">
                This password-reset link can't be used. Request a new one from
                the sign-in page.
              </p>
              <Link
                href="/login"
                className="text-sm font-mono text-[#b8c3ff] hover:underline"
              >
                Back to sign in →
              </Link>
            </div>
          )}

          {accessToken && success && (
            <div className="rounded-xl border border-[#4edea3]/30 bg-[#4edea3]/10 p-5 text-[#4edea3] flex flex-col items-start gap-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5" />
                <h2 className="font-sans text-lg font-semibold">Password updated</h2>
              </div>
              <p className="text-sm">Redirecting to sign in…</p>
            </div>
          )}

          {accessToken && !success && (
            <>
              <h2 className="font-sans text-2xl font-bold text-white mb-1">Choose a new password</h2>
              <p className="text-[#c4c5d7] text-sm mb-8">
                {type === "recovery"
                  ? "Pick a strong password you'll remember."
                  : "Set a new password for your account."}
              </p>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label className="font-mono text-xs text-[#8e90a0] uppercase tracking-wider block mb-2">
                    New password
                  </label>
                  <div className="relative">
                    <Key className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8e90a0]" />
                    <input
                      type="password"
                      value={pw}
                      onChange={(e) => setPw(e.target.value)}
                      placeholder="At least 8 characters"
                      autoComplete="new-password"
                      required
                      minLength={8}
                      className="w-full pl-11 pr-4 py-3 rounded-xl text-sm text-white placeholder:text-[#8e90a0]/50 focus:outline-none focus:ring-2 focus:ring-[#b8c3ff]/50 transition-all"
                      style={{ background: "rgba(16,19,26,0.9)", border: "1px solid rgba(184,195,255,0.25)" }}
                    />
                  </div>
                </div>

                <div>
                  <label className="font-mono text-xs text-[#8e90a0] uppercase tracking-wider block mb-2">
                    Confirm password
                  </label>
                  <div className="relative">
                    <Key className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8e90a0]" />
                    <input
                      type="password"
                      value={pw2}
                      onChange={(e) => setPw2(e.target.value)}
                      placeholder="Repeat new password"
                      autoComplete="new-password"
                      required
                      minLength={8}
                      className="w-full pl-11 pr-4 py-3 rounded-xl text-sm text-white placeholder:text-[#8e90a0]/50 focus:outline-none focus:ring-2 focus:ring-[#b8c3ff]/50 transition-all"
                      style={{ background: "rgba(16,19,26,0.9)", border: "1px solid rgba(184,195,255,0.25)" }}
                    />
                  </div>
                </div>

                {error && <p className="text-[#ffb4ab] text-sm">{error}</p>}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-3.5 rounded-xl font-sans font-bold text-sm text-[#002388] bg-[#b8c3ff] hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 shadow-[0_0_20px_rgba(184,195,255,0.3)]"
                >
                  {submitting ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : "Set new password"}
                </button>
              </form>

              <div className="mt-6 text-center">
                <Link href="/login" className="text-xs font-mono text-[#8e90a0] hover:text-[#b8c3ff]">
                  Back to sign in
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center" style={{ background: "#0b0e14" }}>
          <Loader2 className="w-8 h-8 text-[#b8c3ff] animate-spin" />
        </div>
      }
    >
      <ResetPasswordInner />
    </Suspense>
  );
}

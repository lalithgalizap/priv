"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { login, forgotPassword } from "@/lib/auth";
import { Mail, Key, Loader2, ArrowLeft, ShieldCheck } from "lucide-react";

type Mode = "login" | "forgot";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Forgot-password state
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSubmitting, setForgotSubmitting] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotError, setForgotError] = useState("");

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await login(email, password);
      const pendingToken = localStorage.getItem("pending_invite_token");
      router.push(pendingToken ? "/join" : "/console");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Login failed.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setForgotError("");
    if (!forgotEmail.trim()) {
      setForgotError("Enter your email.");
      return;
    }
    setForgotSubmitting(true);
    try {
      await forgotPassword(forgotEmail.trim().toLowerCase());
      setForgotSent(true);
    } catch (err) {
      // We don't want to surface "no such user" to avoid leaking which
      // emails exist; but a network failure should be visible.
      setForgotError(err instanceof Error ? err.message : "Couldn't send the reset email.");
    } finally {
      setForgotSubmitting(false);
    }
  }

  function switchToForgot() {
    setMode("forgot");
    setForgotEmail(email);
    setForgotSent(false);
    setForgotError("");
  }

  function switchToLogin() {
    setMode("login");
    setForgotError("");
  }

  return (
    <div
      className="min-h-screen flex relative overflow-hidden"
      style={{ background: "#0b0e14", backgroundImage: "radial-gradient(circle at 30% 50%, #2a3f95 0%, transparent 40%)" }}
    >
      <div className="hidden lg:flex flex-1 items-center justify-center relative">
        <div className="absolute inset-0 bg-primary/5 blur-[120px] rounded-full pointer-events-none" />
        <div className="relative z-10 flex flex-col items-center">
          <img src="/logo.png" alt="Quintal AI" className="w-64 h-64 object-contain drop-shadow-[0_0_40px_rgba(42,63,149,0.5)]" />
          <p className="mt-8 text-white text-center text-2xl font-sans font-semibold tracking-tight animate-[fadeInUp_1s_ease-out_0.5s_both]">
            Intelligence Delivered. <span className="text-[#b8c3ff]">Privately.</span>
          </p>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center px-6 lg:px-16">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <img src="/logo.png" alt="Quintal AI" className="w-10 h-10 object-contain" />
            <span className="font-sans text-xl font-bold text-white">Quintal AI</span>
          </div>

          {mode === "login" && (
            <>
              <h2 className="font-sans text-2xl font-bold text-white mb-1">Sign in</h2>
              <p className="text-[#c4c5d7] text-sm mb-8">Access your AI workspace</p>

              <form onSubmit={handleLogin} className="space-y-5">
                <div>
                  <label className="font-mono text-xs text-[#8e90a0] uppercase tracking-wider block mb-2">Email</label>
                  <div className="relative">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8e90a0]" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@company.com"
                      autoComplete="email"
                      required
                      className="w-full pl-11 pr-4 py-3 rounded-xl text-sm text-white placeholder:text-[#8e90a0]/50 focus:outline-none focus:ring-2 focus:ring-[#b8c3ff]/50 transition-all"
                      style={{ background: "rgba(16,19,26,0.9)", border: "1px solid rgba(184,195,255,0.25)" }}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="font-mono text-xs text-[#8e90a0] uppercase tracking-wider">Password</label>
                    <button
                      type="button"
                      onClick={switchToForgot}
                      className="font-mono text-[10px] uppercase tracking-wider text-[#8e90a0] hover:text-[#b8c3ff] transition-colors"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <Key className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8e90a0]" />
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••••••"
                      autoComplete="current-password"
                      required
                      className="w-full pl-11 pr-4 py-3 rounded-xl text-sm text-white placeholder:text-[#8e90a0]/50 focus:outline-none focus:ring-2 focus:ring-[#b8c3ff]/50 transition-all"
                      style={{ background: "rgba(16,19,26,0.9)", border: "1px solid rgba(184,195,255,0.25)" }}
                    />
                  </div>
                </div>

                {error && <p className="text-[#ffb4ab] text-sm">{error}</p>}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3.5 rounded-xl font-sans font-bold text-sm text-[#002388] bg-[#b8c3ff] hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 shadow-[0_0_20px_rgba(184,195,255,0.3)]"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : "Sign In"}
                </button>
              </form>
            </>
          )}

          {mode === "forgot" && (
            <>
              <button
                type="button"
                onClick={switchToLogin}
                className="flex items-center gap-1.5 text-xs font-mono text-[#8e90a0] hover:text-[#b8c3ff] mb-6 transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back to sign in
              </button>

              <h2 className="font-sans text-2xl font-bold text-white mb-1">Forgot your password?</h2>
              <p className="text-[#c4c5d7] text-sm mb-8">
                Enter the email tied to your account. If we recognise it, we'll send a reset link.
              </p>

              {forgotSent ? (
                <div className="rounded-xl border border-[#4edea3]/30 bg-[#4edea3]/10 p-5 text-[#4edea3] flex flex-col items-start gap-3">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5" />
                    <h3 className="font-sans text-base font-semibold">Check your inbox</h3>
                  </div>
                  <p className="text-sm">
                    If an account exists for <strong>{forgotEmail}</strong>, a reset link is on its way. The link expires in 60 minutes.
                  </p>
                  <button
                    type="button"
                    onClick={switchToLogin}
                    className="mt-1 text-xs font-mono text-[#b8c3ff] hover:underline"
                  >
                    Back to sign in →
                  </button>
                </div>
              ) : (
                <form onSubmit={handleForgot} className="space-y-5">
                  <div>
                    <label className="font-mono text-xs text-[#8e90a0] uppercase tracking-wider block mb-2">Email</label>
                    <div className="relative">
                      <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8e90a0]" />
                      <input
                        type="email"
                        value={forgotEmail}
                        onChange={(e) => setForgotEmail(e.target.value)}
                        placeholder="you@company.com"
                        autoComplete="email"
                        required
                        className="w-full pl-11 pr-4 py-3 rounded-xl text-sm text-white placeholder:text-[#8e90a0]/50 focus:outline-none focus:ring-2 focus:ring-[#b8c3ff]/50 transition-all"
                        style={{ background: "rgba(16,19,26,0.9)", border: "1px solid rgba(184,195,255,0.25)" }}
                      />
                    </div>
                  </div>

                  {forgotError && <p className="text-[#ffb4ab] text-sm">{forgotError}</p>}

                  <button
                    type="submit"
                    disabled={forgotSubmitting}
                    className="w-full py-3.5 rounded-xl font-sans font-bold text-sm text-[#002388] bg-[#b8c3ff] hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 shadow-[0_0_20px_rgba(184,195,255,0.3)]"
                  >
                    {forgotSubmitting ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : "Send reset link"}
                  </button>
                </form>
              )}
            </>
          )}

          <p className="mt-8 text-center text-xs text-[#8e90a0]">&copy; 2025 Quintal AI</p>
        </div>
      </div>
    </div>
  );
}

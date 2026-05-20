"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Mail, Key, UserPlus, Terminal, ShieldCheck, Lock, Loader2 } from "lucide-react";
import { motion } from "framer-motion";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [checkingInvite, setCheckingInvite] = useState(true);
  const [inviteValid, setInviteValid] = useState(false);
  const [inviteEmail, setInviteEmail] = useState<string | null>(null);

  // Gate signup behind a valid invite token
  useEffect(() => {
    async function validateToken() {
      const token = localStorage.getItem("pending_invite_token");
      if (!token) {
        setCheckingInvite(false);
        return;
      }
      setInviteToken(token);
      try {
        const res = await fetch(`/api/invite/validate?token=${encodeURIComponent(token)}`);
        if (res.ok) {
          const data = await res.json();
          setInviteValid(true);
          // Lock email to the one specified in the invite
          if (data.email) {
            setInviteEmail(data.email);
            setEmail(data.email);
          }
        } else {
          localStorage.removeItem("pending_invite_token");
          setInviteToken(null);
        }
      } catch {
        localStorage.removeItem("pending_invite_token");
        setInviteToken(null);
      } finally {
        setCheckingInvite(false);
      }
    }
    validateToken();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    if (!inviteValid || !inviteToken) {
      setError("Access is by invitation only.");
      setLoading(false);
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      setLoading(false);
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      setLoading(false);
      return;
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/login`,
      },
    });

    if (error) {
      setError(error.message);
    } else if (data.session) {
      // Auto-login when email confirmation is disabled
      document.cookie = `sb-access-token=${data.session.access_token}; path=/; max-age=604800`;
      // Auto-accept the invite immediately after signup
      try {
        const acceptRes = await fetch("/api/invite/accept", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
          body: JSON.stringify({ token: inviteToken }),
        });
        if (acceptRes.ok) {
          localStorage.removeItem("pending_invite_token");
          router.push("/console");
        } else {
          // Fallback: redirect to /join to accept manually
          router.push("/join");
        }
      } catch {
        router.push("/join");
      }
    } else if (data.user) {
      // Email confirmation required — show success message
      setSuccess(true);
    }

    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-background text-on-surface flex flex-col relative overflow-x-hidden">
      <div className="fixed inset-0 z-0 pointer-events-none bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-background/80 to-background" />
      <div className="fixed inset-0 z-0 pointer-events-none bg-gradient-to-b from-transparent to-surface-container-lowest" />

      <header className="relative z-20 w-full flex justify-between items-center h-16 px-8 max-w-[1440px] mx-auto border-b border-outline-variant/10">
        <div className="flex items-center gap-2 text-primary">
          <img src="/logo.png" alt="Quintal AI" className="w-8 h-8 object-contain" />
          <span className="font-sans text-base font-semibold">Quintal AI</span>
        </div>
      </header>

      <main className="relative z-10 flex-grow flex items-center justify-center px-4 md:px-8 max-w-[1440px] mx-auto py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 lg:gap-24 items-center w-full">
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7 }}
            className="flex flex-col max-w-xl mx-auto md:mx-0 text-center md:text-left"
          >
            <div className="inline-flex items-center justify-center md:justify-start gap-2 mb-6">
              <span className="w-2 h-2 rounded-full bg-secondary status-glow animate-pulse" />
              <span className="font-mono text-sm text-secondary">New Operator Registration</span>
            </div>
            <h1 className="text-4xl md:text-5xl font-bold text-on-surface mb-6 tracking-tight leading-tight">
              Join the<br />
              <span className="text-primary drop-shadow-[0_0_16px_rgba(192,193,255,0.3)]">Secure Network.</span>
            </h1>
            <p className="text-base text-on-surface-variant mb-8 max-w-md mx-auto md:mx-0">
              Create your encrypted operator account. All credentials are handled via zero-knowledge authentication.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="w-full max-w-md mx-auto relative group"
          >
            <div className="absolute -inset-1 bg-gradient-to-r from-primary/20 to-secondary/10 rounded-xl blur-lg opacity-50 transition duration-1000 group-hover:opacity-100" />
            <div className="relative bg-surface/60 backdrop-blur-xl border border-outline-variant/20 rounded-xl p-8 shadow-2xl flex flex-col">
              <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-white/[0.04] to-transparent pointer-events-none rounded-xl" />
              <div className="flex flex-col mb-8 relative z-10">
                <h2 className="text-2xl md:text-3xl font-semibold text-on-surface mb-2">Initialize Access</h2>
                <p className="font-mono text-sm text-outline-variant">
                  {inviteValid ? "Register to join the encrypted vault." : "Access is restricted."}
                </p>
              </div>

              {checkingInvite ? (
                <div className="flex items-center justify-center py-12 relative z-10">
                  <Loader2 className="w-8 h-8 text-primary animate-spin" />
                </div>
              ) : !inviteValid ? (
                <div className="flex flex-col items-center gap-5 py-8 relative z-10">
                  <div className="w-16 h-16 rounded-full bg-error/10 flex items-center justify-center">
                    <Lock className="w-8 h-8 text-error" />
                  </div>
                  <h3 className="text-lg font-semibold text-on-surface">Invite Only</h3>
                  <p className="text-sm text-on-surface-variant text-center max-w-sm">
                    Self-registration is disabled. You must have a valid invitation link to create an account.
                  </p>
                  <Link
                    href="/login"
                    className="bg-surface-variant/20 border border-outline-variant/30 backdrop-blur-sm text-on-surface font-mono text-xs font-semibold tracking-[0.1em] uppercase py-3 px-6 rounded-lg hover:bg-surface-variant/40 active:scale-[0.98] transition-all flex items-center justify-center gap-2 text-center"
                  >
                    Go to Sign In
                  </Link>
                </div>
              ) : success ? (
                <div className="flex flex-col items-center gap-4 py-8 relative z-10">
                  <div className="w-16 h-16 rounded-full bg-secondary/20 flex items-center justify-center">
                    <ShieldCheck className="w-8 h-8 text-secondary" />
                  </div>
                  <h3 className="text-lg font-semibold text-on-surface">Account Created</h3>
                  <p className="text-sm text-on-surface-variant text-center max-w-sm">
                    Redirecting to accept your invitation...
                  </p>
                  <Link href="/login" className="text-primary hover:underline font-mono text-sm">
                    Go to Sign In
                  </Link>
                </div>
              ) : (
                <form onSubmit={handleSignup} className="flex flex-col gap-6 relative z-10">
                  <div className="flex flex-col gap-2 group/input">
                    <label className="font-mono text-xs font-semibold tracking-[0.1em] text-outline uppercase group-focus-within/input:text-primary transition-colors">
                      Work Email
                    </label>
                    <div className="relative">
                      <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-outline-variant group-focus-within/input:text-primary transition-colors" />
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => !inviteEmail && setEmail(e.target.value)}
                        placeholder="operator@enterprise.com"
                        className={`bg-surface-dim border border-outline-variant/30 rounded-lg pl-11 pr-4 py-3 font-mono text-sm text-on-surface placeholder:text-outline-variant/50 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all w-full shadow-inner ${inviteEmail ? "opacity-70 cursor-not-allowed" : ""}`}
                        required
                        readOnly={!!inviteEmail}
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 group/input">
                    <label className="font-mono text-xs font-semibold tracking-[0.1em] text-outline uppercase group-focus-within/input:text-primary transition-colors">
                      Password
                    </label>
                    <div className="relative">
                      <Key className="absolute left-4 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-outline-variant group-focus-within/input:text-primary transition-colors" />
                      <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••••••"
                        className="bg-surface-dim border border-outline-variant/30 rounded-lg pl-11 pr-4 py-3 font-mono text-sm text-on-surface placeholder:text-outline-variant/50 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all w-full shadow-inner"
                        required
                        minLength={6}
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 group/input">
                    <label className="font-mono text-xs font-semibold tracking-[0.1em] text-outline uppercase group-focus-within/input:text-primary transition-colors">
                      Confirm Password
                    </label>
                    <div className="relative">
                      <Key className="absolute left-4 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-outline-variant group-focus-within/input:text-primary transition-colors" />
                      <input
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="••••••••••••"
                        className="bg-surface-dim border border-outline-variant/30 rounded-lg pl-11 pr-4 py-3 font-mono text-sm text-on-surface placeholder:text-outline-variant/50 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all w-full shadow-inner"
                        required
                        minLength={6}
                      />
                    </div>
                  </div>

                  {error && (
                    <div className="text-error text-sm font-mono">{error}</div>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="mt-2 bg-primary text-on-primary font-mono text-xs font-semibold tracking-[0.1em] uppercase py-4 rounded-lg hover:bg-primary-fixed active:scale-[0.98] transition-all flex items-center justify-center gap-2 primary-glow disabled:opacity-50"
                  >
                    {loading ? "Creating Account..." : "Create Account"}
                    <UserPlus className="w-[18px] h-[18px]" />
                  </button>

                  <div className="relative flex items-center py-2">
                    <div className="flex-grow border-t border-outline-variant/20" />
                    <span className="flex-shrink-0 mx-4 font-mono text-sm text-outline-variant">or</span>
                    <div className="flex-grow border-t border-outline-variant/20" />
                  </div>

                  <Link
                    href="/login"
                    className="bg-surface-variant/20 border border-outline-variant/30 backdrop-blur-sm text-on-surface font-mono text-xs font-semibold tracking-[0.1em] uppercase py-4 rounded-lg hover:bg-surface-variant/40 active:scale-[0.98] transition-all flex items-center justify-center gap-2 text-center"
                  >
                    Already have access? Sign In
                  </Link>
                </form>
              )}

              <div className="mt-8 pt-6 border-t border-outline-variant/10 flex items-center justify-center gap-2 text-outline-variant font-mono text-sm relative z-10">
                <ShieldCheck className="w-4 h-4 text-secondary" />
                Secured by Supabase Auth
              </div>
            </div>
          </motion.div>
        </div>
      </main>

      <footer className="relative z-20 bg-surface-container-lowest w-full py-8 mt-auto border-t border-outline-variant/10">
        <div className="flex flex-col md:flex-row justify-between items-center px-8 max-w-[1440px] mx-auto gap-4">
          <div className="font-mono text-xs font-semibold tracking-[0.1em] text-outline uppercase">
            &copy; 2024 Quintal AI. Enterprise AI Platform.
          </div>
        </div>
      </footer>
    </div>
  );
}

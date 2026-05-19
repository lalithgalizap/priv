"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Mail, Key, LogIn, Terminal, ShieldCheck } from "lucide-react";
import { motion } from "framer-motion";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
    } else if (data.session) {
      document.cookie = `sb-access-token=${data.session.access_token}; path=/; max-age=604800`;
      const pendingToken = localStorage.getItem("pending_invite_token");
      if (pendingToken) {
        router.push("/join");
      } else {
        router.push("/console");
      }
    }

    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-background text-on-surface flex flex-col relative overflow-x-hidden">
      {/* Ambient Background */}
      <div className="fixed inset-0 z-0 pointer-events-none bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-background/80 to-background" />
      <div className="fixed inset-0 z-0 pointer-events-none bg-gradient-to-b from-transparent to-surface-container-lowest" />

      {/* Header */}
      <header className="relative z-20 w-full flex justify-between items-center h-16 px-8 max-w-[1440px] mx-auto border-b border-outline-variant/10">
        <div className="font-mono text-xs font-semibold tracking-[0.1em] text-primary uppercase flex items-center gap-2">
          <Terminal className="w-[18px] h-[18px]" />
          Anonymizer Core
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 flex-grow flex items-center justify-center px-4 md:px-8 max-w-[1440px] mx-auto py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 lg:gap-24 items-center w-full">
          {/* Left Column */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7 }}
            className="flex flex-col max-w-xl mx-auto md:mx-0 text-center md:text-left"
          >
            <div className="inline-flex items-center justify-center md:justify-start gap-2 mb-6">
              <span className="w-2 h-2 rounded-full bg-secondary status-glow animate-pulse" />
              <span className="font-mono text-sm text-secondary">System Online // Sector 7G</span>
            </div>
            <h1 className="text-4xl md:text-5xl font-bold text-on-surface mb-6 tracking-tight leading-tight">
              Enterprise AI,<br />
              <span className="text-primary drop-shadow-[0_0_16px_rgba(192,193,255,0.3)]">Without the Trace.</span>
            </h1>
            <p className="text-base text-on-surface-variant mb-8 max-w-md mx-auto md:mx-0">
              Deploy intelligent models within a zero-knowledge architecture. Total telemetry encryption. Absolute data opacity.
            </p>

            {/* Terminal feature list */}
            <div className="flex flex-col gap-3 font-mono text-sm text-outline p-4 rounded-lg bg-surface/30 backdrop-blur-md border border-outline-variant/10 w-full max-w-sm mx-auto md:mx-0">
              <div className="flex items-start gap-3">
                <span className="text-primary opacity-50 mt-1">&gt;</span>
                <span className="text-on-surface-variant">INIT secure_handshake()... <span className="text-secondary ml-2">OK</span></span>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-primary opacity-50 mt-1">&gt;</span>
                <span className="text-on-surface-variant">VERIFY protocol_encryption... <span className="text-secondary ml-2">OK</span></span>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-primary opacity-50 mt-1 animate-pulse">_</span>
                <span className="text-on-surface-variant opacity-50">AWAITING_AUTHORIZATION</span>
              </div>
            </div>
          </motion.div>

          {/* Right Column: Login Card */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="w-full max-w-md mx-auto relative group"
          >
            {/* Outer glow */}
            <div className="absolute -inset-1 bg-gradient-to-r from-primary/20 to-secondary/10 rounded-xl blur-lg opacity-50 transition duration-1000 group-hover:opacity-100" />
            <div className="relative bg-surface/60 backdrop-blur-xl border border-outline-variant/20 rounded-xl p-8 shadow-2xl flex flex-col">
              <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-white/[0.04] to-transparent pointer-events-none rounded-xl" />
              <div className="flex flex-col mb-8 relative z-10">
                <h2 className="text-2xl md:text-3xl font-semibold text-on-surface mb-2">Terminal Access</h2>
                <p className="font-mono text-sm text-outline-variant">Authenticate to enter the encrypted vault.</p>
              </div>

              <form onSubmit={handleLogin} className="flex flex-col gap-6 relative z-10">
                {/* Email */}
                <div className="flex flex-col gap-2 group/input">
                  <label className="font-mono text-xs font-semibold tracking-[0.1em] text-outline uppercase group-focus-within/input:text-primary transition-colors">
                    Work Email
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-outline-variant group-focus-within/input:text-primary transition-colors" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="operator@enterprise.com"
                      className="bg-surface-dim border border-outline-variant/30 rounded-lg pl-11 pr-4 py-3 font-mono text-sm text-on-surface placeholder:text-outline-variant/50 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all w-full shadow-inner"
                      required
                    />
                  </div>
                </div>

                {/* Password */}
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
                  {loading ? "Initializing..." : "Initialize Session"}
                  <LogIn className="w-[18px] h-[18px]" />
                </button>

                <div className="mt-4 text-center">
                  <p className="font-mono text-xs text-outline-variant">
                    Access is by invitation only.
                  </p>
                </div>
              </form>

              {/* Trust Badge */}
              <div className="mt-8 pt-6 border-t border-outline-variant/10 flex items-center justify-center gap-2 text-outline-variant font-mono text-sm relative z-10">
                <ShieldCheck className="w-4 h-4 text-secondary" />
                Secured by Supabase Auth
              </div>
            </div>
          </motion.div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-20 bg-surface-container-lowest w-full py-8 mt-auto border-t border-outline-variant/10">
        <div className="flex flex-col md:flex-row justify-between items-center px-8 max-w-[1440px] mx-auto gap-4">
          <div className="font-mono text-xs font-semibold tracking-[0.1em] text-outline uppercase">
            &copy; 2024 Anonymizer Core. Encrypted by Default.
          </div>
          <div className="flex gap-6">
            <a href="#" className="font-mono text-sm text-on-surface-variant hover:text-primary transition-colors opacity-80 hover:opacity-100">Privacy Protocol</a>
            <a href="#" className="font-mono text-sm text-on-surface-variant hover:text-primary transition-colors opacity-80 hover:opacity-100">Service Terms</a>
            <a href="#" className="font-mono text-sm text-on-surface-variant hover:text-primary transition-colors opacity-80 hover:opacity-100">API Docs</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

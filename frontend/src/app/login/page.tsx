"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Mail, Key, Loader2 } from "lucide-react";

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
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
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
    <div className="min-h-screen flex relative overflow-hidden" style={{ background: "#0b0e14", backgroundImage: "radial-gradient(circle at 30% 50%, #2a3f95 0%, transparent 40%)" }}>
      {/* Left side — Logo + Brand */}
      <div className="hidden lg:flex flex-1 items-center justify-center relative">
        <div className="absolute inset-0 bg-primary/5 blur-[120px] rounded-full pointer-events-none" />
        <div className="relative z-10 flex flex-col items-center">
          <img src="/logo.png" alt="Quintal AI" className="w-64 h-64 object-contain drop-shadow-[0_0_40px_rgba(42,63,149,0.5)]" />
          <p className="mt-8 text-white text-center text-2xl font-sans font-semibold tracking-tight animate-[fadeInUp_1s_ease-out_0.5s_both]">
            Intelligence Delivered. <span className="text-[#b8c3ff]">Privately.</span>
          </p>
        </div>
      </div>

      {/* Right side — Login form */}
      <div className="flex-1 flex items-center justify-center px-6 lg:px-16">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <img src="/logo.png" alt="Quintal AI" className="w-10 h-10 object-contain" />
            <span className="font-sans text-xl font-bold text-on-surface">Quintal AI</span>
          </div>

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
                  required
                  className="w-full pl-11 pr-4 py-3 rounded-xl text-sm text-white placeholder:text-[#8e90a0]/50 focus:outline-none focus:ring-2 focus:ring-[#b8c3ff]/50 transition-all"
                  style={{ background: "rgba(16,19,26,0.9)", border: "1px solid rgba(184,195,255,0.25)" }}
                />
              </div>
            </div>

            <div>
              <label className="font-mono text-xs text-[#8e90a0] uppercase tracking-wider block mb-2">Password</label>
              <div className="relative">
                <Key className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8e90a0]" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
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

          <p className="mt-8 text-center text-xs text-[#8e90a0]">&copy; 2025 Quintal AI</p>
        </div>
      </div>
    </div>
  );
}

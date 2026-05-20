"use client";

import { useState, useEffect } from "react";
import { User, Key, Cpu, Save, Check, Loader2 } from "lucide-react";
import AppShell from "@/components/AppShell";
import { supabase } from "@/lib/supabase";
import { useCurrentUser } from "@/hooks/useCurrentUser";

export default function SettingsPage() {
  const { user, token, loading: userLoading } = useCurrentUser();

  // AI Preferences (from DB)
  const [preferredModel, setPreferredModel] = useState("moonshotai.kimi-k2.5");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [maxTokens, setMaxTokens] = useState(1024);
  const [prefsLoading, setPrefsLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  // Password reset
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwLoading, setPwLoading] = useState(false);
  const [pwError, setPwError] = useState("");
  const [pwSuccess, setPwSuccess] = useState(false);

  const [email, setEmail] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user?.email) setEmail(data.session.user.email);
    });
  }, []);

  // Load preferences from DB
  useEffect(() => {
    if (!token) return;
    async function load() {
      try {
        const res = await fetch("/api/me/preferences", { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) {
          const data = await res.json();
          setPreferredModel(data.preferred_model || "moonshotai.kimi-k2.5");
          setSystemPrompt(data.system_prompt || "");
          setMaxTokens(data.max_tokens || 1024);
        }
      } catch { /* ignore */ }
      finally { setPrefsLoading(false); }
    }
    load();
  }, [token]);

  async function handleSavePreferences() {
    if (!token) return;
    try {
      const res = await fetch("/api/me/preferences", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ preferred_model: preferredModel, system_prompt: systemPrompt, max_tokens: maxTokens }),
      });
      if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 2000); }
    } catch { /* ignore */ }
  }

  async function handlePasswordReset(e: React.FormEvent) {
    e.preventDefault();
    setPwError(""); setPwSuccess(false);
    if (newPassword.length < 6) { setPwError("Password must be at least 6 characters."); return; }
    if (newPassword !== confirmPassword) { setPwError("Passwords do not match."); return; }
    setPwLoading(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password: currentPassword });
      if (signInError) { setPwError("Current password is incorrect."); setPwLoading(false); return; }
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) { setPwError(error.message); }
      else { setPwSuccess(true); setCurrentPassword(""); setNewPassword(""); setConfirmPassword(""); }
    } catch { setPwError("Failed to update password."); }
    finally { setPwLoading(false); }
  }

  const roleName = user?.is_platform_admin ? "Platform Admin" : user?.role === "leader" ? "Organization Leader" : "Member";

  if (userLoading || prefsLoading) {
    return <AppShell><div className="flex justify-center items-center h-[400px]"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div></AppShell>;
  }

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto space-y-8">
        <div>
          <h2 className="text-2xl font-bold text-on-surface mb-1">Settings</h2>
          <p className="text-sm text-on-surface-variant">Manage your profile, security, and AI preferences.</p>
        </div>

        {/* Profile Info */}
        <div className="bg-surface-container/40 border border-outline-variant/20 rounded-xl p-6">
          <h3 className="text-sm font-semibold text-on-surface mb-4 flex items-center gap-2">
            <User className="w-4 h-4 text-primary" /> Profile
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-outline-variant block mb-1">Email</label>
              <p className="text-sm text-on-surface font-mono bg-surface-container-low/50 border border-outline-variant/10 rounded-lg px-3 py-2.5">{email || "—"}</p>
            </div>
            <div>
              <label className="text-xs text-outline-variant block mb-1">Role</label>
              <p className="text-sm text-on-surface font-medium bg-surface-container-low/50 border border-outline-variant/10 rounded-lg px-3 py-2.5">{roleName}</p>
            </div>
          </div>
        </div>

        {/* Password Reset */}
        <div className="bg-surface-container/40 border border-outline-variant/20 rounded-xl p-6">
          <h3 className="text-sm font-semibold text-on-surface mb-4 flex items-center gap-2">
            <Key className="w-4 h-4 text-primary" /> Change Password
          </h3>
          <form onSubmit={handlePasswordReset} className="space-y-4 max-w-sm">
            <div>
              <label className="text-xs text-outline-variant block mb-1.5">Current Password</label>
              <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required
                className="w-full bg-surface-container-low/50 border border-outline-variant/20 rounded-lg px-3 py-2.5 text-sm text-on-surface focus:outline-none focus:border-primary" />
            </div>
            <div>
              <label className="text-xs text-outline-variant block mb-1.5">New Password</label>
              <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={6}
                className="w-full bg-surface-container-low/50 border border-outline-variant/20 rounded-lg px-3 py-2.5 text-sm text-on-surface focus:outline-none focus:border-primary" />
            </div>
            <div>
              <label className="text-xs text-outline-variant block mb-1.5">Confirm New Password</label>
              <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={6}
                className="w-full bg-surface-container-low/50 border border-outline-variant/20 rounded-lg px-3 py-2.5 text-sm text-on-surface focus:outline-none focus:border-primary" />
            </div>
            {pwError && <p className="text-xs text-error">{pwError}</p>}
            {pwSuccess && <p className="text-xs text-secondary">Password updated successfully.</p>}
            <button type="submit" disabled={pwLoading}
              className="px-4 py-2.5 rounded-lg text-sm font-medium bg-primary text-on-primary hover:bg-primary/90 disabled:opacity-50 transition-all">
              {pwLoading ? "Updating..." : "Update Password"}
            </button>
          </form>
        </div>

        {/* AI Preferences */}
        <div className="bg-surface-container/40 border border-outline-variant/20 rounded-xl p-6">
          <h3 className="text-sm font-semibold text-on-surface mb-4 flex items-center gap-2">
            <Cpu className="w-4 h-4 text-primary" /> AI Preferences
          </h3>
          <div className="space-y-5">
            <div>
              <label className="text-xs text-outline-variant block mb-1.5">Default Model</label>
              <select value={preferredModel} onChange={(e) => setPreferredModel(e.target.value)}
                className="w-full bg-surface-container-low/50 border border-outline-variant/20 rounded-lg px-3 py-2.5 text-sm text-on-surface focus:outline-none focus:border-primary">
                <option value="moonshotai.kimi-k2.5">Kimi K2.5</option>
                <option value="anthropic.claude-3-sonnet-20240229-v1:0">Claude 3 Sonnet</option>
                <option value="anthropic.claude-3-haiku-20240307-v1:0">Claude 3 Haiku</option>
                <option value="meta.llama3-70b-instruct-v1:0">Llama 3 70B</option>
                <option value="mistral.mistral-large-2402-v1:0">Mistral Large</option>
                <option value="amazon.titan-text-premier-v1:0">Titan Text Premier</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-outline-variant block mb-1.5">System Prompt</label>
              <textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="Custom instructions for the AI (e.g., 'Always respond in bullet points')" rows={3}
                className="w-full bg-surface-container-low/50 border border-outline-variant/20 rounded-lg px-3 py-2.5 text-sm text-on-surface placeholder:text-outline-variant/40 focus:outline-none focus:border-primary resize-none" />
              <p className="text-[10px] text-outline-variant mt-1">Leave empty to use the default system prompt.</p>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs text-outline-variant">Max Output Tokens</label>
                <span className="text-xs font-mono text-on-surface">{maxTokens}</span>
              </div>
              <input type="range" min={256} max={4096} step={256} value={maxTokens}
                onChange={(e) => setMaxTokens(parseInt(e.target.value))} className="w-full accent-primary" />
              <div className="flex justify-between text-[10px] text-outline-variant mt-1">
                <span>256</span><span>1024</span><span>2048</span><span>4096</span>
              </div>
            </div>
            <button onClick={handleSavePreferences}
              className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${saved ? "bg-secondary/10 text-secondary border border-secondary/30" : "bg-primary text-on-primary hover:bg-primary/90"}`}>
              {saved ? <><Check className="w-4 h-4" /> Saved</> : <><Save className="w-4 h-4" /> Save Preferences</>}
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

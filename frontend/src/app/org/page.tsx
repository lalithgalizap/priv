"use client";

import { useEffect, useState } from "react";
import {
  Users,
  TrendingUp,
  Wallet,
  Activity,
  Mail,
  Shield,
  UserPlus,
  Trash2,
  Loader2,
  AlertTriangle,
  Copy,
  Check,
  Link,
  Edit3,
  Save,
  CreditCard,
  Receipt,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import AppShell from "@/components/AppShell";
import { useCurrentUser } from "@/hooks/useCurrentUser";

interface OrgMember {
  id: string;
  supabase_auth_id: string;
  display_name: string | null;
  role: string;
  created_at: string;
}

interface OrgInvite {
  id: string;
  email: string;
  role: string;
  expires_at: string;
  created_at: string;
  invited_by_name: string | null;
}

interface OrgUsage {
  total_tokens: number;
  active_users: number;
  total_calls: number;
  compute_cost: number;
  model_breakdown: { model_identifier: string; tokens: number; calls: number }[];
}

export default function OrgPage() {
  const { user, loading: userLoading } = useCurrentUser();
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [invites, setInvites] = useState<OrgInvite[]>([]);
  const [usage, setUsage] = useState<OrgUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [mounted, setMounted] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [generatedLink, setGeneratedLink] = useState("");
  const [copied, setCopied] = useState(false);

  const [memberQuotas, setMemberQuotas] = useState<Record<string, { daily_budget: number; daily_used: number; daily_remaining: number; extra_allocated: number; extra_used: number; extra_remaining: number; total_available: number }>>({});
  const [orgExtraPool, setOrgExtraPool] = useState<number>(0);
  const [allocatingMember, setAllocatingMember] = useState<string | null>(null);
  const [allocateInput, setAllocateInput] = useState("");
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [topUpSubmitting, setTopUpSubmitting] = useState(false);
  const [topUpForm, setTopUpForm] = useState({
    amount: "",
    note: "",
    name: "",
    number: "0000000000000000",
    expMonth: "01",
    expYear: "2026",
    cvc: "000",
  });
  const role = user?.role ?? null;
  const isLeader = role === "leader";

  async function refreshQuotas(t: string) {
    const quotaRes = await fetch("/api/org/quota", { headers: { Authorization: `Bearer ${t}` } });
    if (quotaRes.ok) {
      const q = await quotaRes.json();
      setOrgExtraPool(q.org?.extra_pool || 0);
      const qmap: Record<string, { daily_budget: number; daily_used: number; daily_remaining: number; extra_allocated: number; extra_used: number; extra_remaining: number; total_available: number }> = {};
      for (const m of q.members || []) {
        qmap[m.supabase_auth_id] = m.quota;
      }
      setMemberQuotas(qmap);
    }
  }

  async function fetchOrgData(role: string | null) {
    setError("");
    try {
      const { data: sesh } = await supabase.auth.getSession();
      const t = sesh.session?.access_token;
      if (!t) {
        setError("Not authenticated.");
        setLoading(false);
        return;
      }

      const [membersRes, usageRes] = await Promise.all([
        fetch("/api/org", { headers: { Authorization: `Bearer ${t}` } }),
        fetch("/api/org/usage", { headers: { Authorization: `Bearer ${t}` } }),
      ]);

      if (membersRes.ok) {
        const m = await membersRes.json();
        setMembers(m.members || []);
      }

      if (usageRes.ok) {
        const u = await usageRes.json();
        setUsage(u);
      }

      // Fetch quotas
      await refreshQuotas(t);

      // Fetch invites only if leader
      if (role === "leader") {
        const invitesRes = await fetch("/api/org/invites", { headers: { Authorization: `Bearer ${t}` } });
        if (invitesRes.ok) {
          const inv = await invitesRes.json();
          setInvites(inv.invites || []);
        }
      }
    } catch {
      setError("Failed to load org data.");
    } finally {
      setLoading(false);
    }
  }

  async function handleLeaderTopUp() {
    const amount = parseInt(topUpForm.amount, 10);
    if (!amount || amount <= 0) { setError("Enter a valid amount."); return; }
    setTopUpSubmitting(true);
    try {
      const { data: sesh } = await supabase.auth.getSession();
      const t = sesh.session?.access_token;
      if (!t) return;
      const payload = {
        amount,
        note: topUpForm.note || undefined,
        card: {
          name: topUpForm.name || "Leader",
          number: topUpForm.number || "0000000000000000",
          exp_month: topUpForm.expMonth || "01",
          exp_year: topUpForm.expYear || "2026",
          cvc: topUpForm.cvc || "000",
        },
      };
      const res = await fetch(`/api/org/topup`, {
        method: "POST",
        headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.detail || data.error || "Failed to complete top-up");
      } else {
        setTopUpOpen(false);
        setTopUpForm({ ...topUpForm, amount: "", note: "" });
        refreshQuotas(t);
      }
    } finally {
      setTopUpSubmitting(false);
    }
  }

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    if (userLoading) return;
    if (!user) {
      setError("Not authenticated.");
      setLoading(false);
      return;
    }
    fetchOrgData(user.role);
  }, [mounted, userLoading, user?.id]);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim() || !isLeader) return;
    setInviteLoading(true);
    setInviteError("");
    try {
      const { data: sesh } = await supabase.auth.getSession();
      const t = sesh.session?.access_token;
      if (!t) return;
      const res = await fetch("/api/org/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      if (!res.ok) {
        const err = await res.json();
        setInviteError(err.error || "Failed to send invite.");
        return;
      }
      const data = await res.json();
      const link = `${window.location.origin}/join?token=${data.token}`;
      setGeneratedLink(link);
      setInviteEmail("");
      setInviteRole("member");
      // Refresh invites
      const invRes = await fetch("/api/org/invites", { headers: { Authorization: `Bearer ${t}` } });
      if (invRes.ok) {
        const inv = await invRes.json();
        setInvites(inv.invites || []);
      }
    } catch {
      setInviteError("Network error.");
    } finally {
      setInviteLoading(false);
    }
  }

  async function handleRemoveMember(profileId: string) {
    if (!isLeader) return;
    if (!confirm("Remove this member from the organization?")) return;
    try {
      const { data: sesh } = await supabase.auth.getSession();
      const t = sesh.session?.access_token;
      if (!t) return;
      const res = await fetch(`/api/org?id=${encodeURIComponent(profileId)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${t}` },
      });
      if (res.ok) {
        setMembers((prev) => prev.filter((m) => m.id !== profileId));
      }
    } catch {
      /* ignore */
    }
  }

  async function handleRevokeInvite(inviteId: string) {
    if (!isLeader) return;
    try {
      const { data: sesh } = await supabase.auth.getSession();
      const t = sesh.session?.access_token;
      if (!t) return;
      const res = await fetch(`/api/org/invites?id=${encodeURIComponent(inviteId)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${t}` },
      });
      if (res.ok) {
        setInvites((prev) => prev.filter((i) => i.id !== inviteId));
      }
    } catch {
      /* ignore */
    }
  }

  const roleBadge = (role: string) => {
    const colors: Record<string, string> = {
      leader: "bg-primary/10 text-primary border-primary/30",
      member: "bg-surface-container-high/50 text-on-surface-variant border-outline-variant/20",
    };
    return (
      <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded border ${colors[role] || colors.member}`}>
        {role}
      </span>
    );
  };

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-on-surface">Organization</h1>
            <p className="text-sm text-outline font-mono mt-1">Manage members, invites, and usage.</p>
          </div>
          {role && (
            <span className="text-xs font-mono text-outline-variant uppercase border border-outline-variant/20 px-3 py-1 rounded">
              Role: {role}
            </span>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 bg-error/5 border border-error/20 rounded-lg text-error text-sm font-mono">
            <AlertTriangle className="w-4 h-4" />
            {error}
          </div>
        )}

        {/* Usage Summary */}
        {usage && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[
              { icon: Activity, label: "Total Tokens", value: usage.total_tokens.toLocaleString() },
              { icon: Users, label: "Active Users (30d)", value: usage.active_users.toString() },
              { icon: TrendingUp, label: "Total Calls", value: usage.total_calls.toLocaleString() },
              { icon: Wallet, label: "Est. Cost", value: `$${usage.compute_cost.toFixed(2)}` },
            ].map((card) => (
              <div key={card.label} className="glass-panel rounded-xl p-5">
                <div className="flex items-center gap-2 mb-2">
                  <card.icon className="w-4 h-4 text-primary" />
                  <span className="text-xs font-mono text-outline-variant uppercase">{card.label}</span>
                </div>
                <p className="text-xl font-semibold text-on-surface">{card.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Org Extra Pool */}
        {isLeader && (
          <div className="glass-panel rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-primary" />
                <span className="text-xs font-mono text-outline-variant uppercase">Organization Extra Credit Pool</span>
              </div>
              <span className="text-xs font-mono text-on-surface">
                {orgExtraPool.toLocaleString()} credits available to distribute
              </span>
            </div>
            <p className="text-xs font-mono text-outline-variant">
              Admin adds extra credits here. Leader distributes them to members.
            </p>
          </div>
        )}

        {/* Leader Buy Credits */}
        {isLeader && (
          <div className="glass-panel rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-primary" />
                <div>
                  <p className="text-xs font-mono text-outline uppercase">Extra Credits</p>
                  <p className="text-sm text-on-surface-variant">
                    Buy credits with dummy card and distribute to members.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setTopUpOpen(true)}
                className="px-4 py-2 rounded bg-primary text-on-primary text-xs font-mono"
              >
                Buy Credits
              </button>
            </div>
          </div>
        )}

        {/* Model Breakdown */}
        {usage && usage.model_breakdown.length > 0 && (
          <div className="glass-panel rounded-xl p-6">
            <h3 className="font-mono text-xs font-semibold tracking-[0.1em] text-on-surface uppercase mb-4">
              Model Usage
            </h3>
            <div className="space-y-3">
              {usage.model_breakdown.map((m, i) => {
                const maxTokens = Math.max(...usage.model_breakdown.map((x) => x.tokens), 1);
                const pct = (m.tokens / maxTokens) * 100;
                return (
                  <div key={i} className="space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-on-surface font-medium truncate max-w-[60%]">
                        {m.model_identifier.split(".")[1] || m.model_identifier}
                      </span>
                      <span className="text-xs font-mono text-outline">{m.calls} calls</span>
                    </div>
                    <div className="h-1.5 w-full bg-surface-container rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary/60 transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className="text-[10px] font-mono text-outline/60">{m.tokens.toLocaleString()} tokens</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Members Table */}
        <div className="glass-panel rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-outline-variant/20 flex items-center justify-between">
            <h3 className="font-mono text-xs font-semibold tracking-[0.1em] text-on-surface uppercase">
              Members
            </h3>
            <span className="text-xs text-outline font-mono">{members.length} total</span>
          </div>

          {loading ? (
            <div className="p-8 flex justify-center">
              <Loader2 className="w-6 h-6 text-primary animate-spin" />
            </div>
          ) : (
            <div className="divide-y divide-outline-variant/10">
              {members.map((m) => (
                <div
                  key={m.id}
                  className="px-6 py-3 flex items-center justify-between hover:bg-surface-container-high/20 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Shield className="w-4 h-4 text-outline-variant flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-on-surface truncate">
                        {m.display_name || "Unnamed"}
                      </p>
                      <p className="text-[10px] font-mono text-outline-variant">
                        {m.role === "owner" ? "Owner" : m.role}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    {/* Credit display for all */}
                    {(() => {
                      const q = memberQuotas[m.supabase_auth_id];
                      if (!q) return null;
                      return (
                        <div className="flex flex-col items-end gap-1">
                          <span className="text-[10px] font-mono text-outline">
                            Daily: {q.daily_used.toLocaleString()}/{q.daily_budget.toLocaleString()}
                            {q.extra_allocated > 0 && ` | Extra: ${q.extra_remaining.toLocaleString()}/${q.extra_allocated.toLocaleString()}`}
                          </span>
                          <span className={`text-[10px] font-mono ${q.daily_used / q.daily_budget >= 0.9 ? "text-error" : "text-outline"}`}>
                            {Math.round((q.daily_used / q.daily_budget) * 100)}% of daily cap used
                          </span>
                          <span className="text-xs font-mono text-on-surface">
                            Total: {q.total_available.toLocaleString()}
                          </span>
                        </div>
                      );
                    })()}
                    {isLeader && (
                      <div className="flex items-center gap-2">
                        {allocatingMember === m.supabase_auth_id ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              value={allocateInput}
                              onChange={(e) => setAllocateInput(e.target.value)}
                              placeholder="Amount"
                              className="w-16 bg-surface-container-low/50 border border-outline-variant/20 rounded px-1.5 py-0.5 text-[10px] font-mono text-on-surface focus:outline-none focus:border-primary"
                              min={1}
                            />
                            <button
                              onClick={async () => {
                                const amount = parseInt(allocateInput, 10);
                                if (!amount || amount <= 0) { setAllocatingMember(null); return; }
                                const { data: sesh } = await supabase.auth.getSession();
                                const tok = sesh.session?.access_token;
                                if (!tok) return;
                                const res = await fetch(`/api/org/members/${m.supabase_auth_id}/extra-tokens`, {
                                  method: "POST",
                                  headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
                                  body: JSON.stringify({ amount }),
                                });
                                if (res.ok) {
                                  await refreshQuotas(tok);
                                } else {
                                  const errData = await res.json().catch(() => ({}));
                                  setError(errData.detail || "Failed to allocate extra credits.");
                                }
                                setAllocatingMember(null);
                                setAllocateInput("");
                              }}
                              className="text-primary hover:text-secondary transition-colors p-1"
                              title="Allocate"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => { setAllocatingMember(m.supabase_auth_id); setAllocateInput(""); }}
                            className="text-[10px] font-mono text-secondary hover:text-secondary/80 border border-secondary/30 px-1.5 py-0.5 rounded transition-colors"
                            title="Allocate extra credits"
                          >
                            +Extra
                          </button>
                        )}
                        {m.role !== "leader" && (
                          <button
                            onClick={() => handleRemoveMember(m.id)}
                            className="text-outline-variant hover:text-error transition-colors p-1 rounded hover:bg-error/10"
                            title="Remove member"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    )}
                    {!isLeader && roleBadge(m.role)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Invite Form (leader only) */}
        {isLeader && (
          <div className="glass-panel rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-outline-variant/20">
              <h3 className="font-mono text-xs font-semibold tracking-[0.1em] text-on-surface uppercase">
                Invite Member
              </h3>
            </div>
            <form onSubmit={handleInvite} className="px-6 py-4 flex gap-2">
              <div className="flex-1 relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-outline-variant" />
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="colleague@company.com"
                  required
                  className="w-full bg-surface-container-low/50 border border-outline-variant/20 rounded-lg pl-10 pr-4 py-2 text-sm text-on-surface placeholder:text-outline-variant/40 focus:outline-none focus:border-primary transition-all"
                />
              </div>
              <span className="bg-surface-container-low/50 border border-outline-variant/20 rounded-lg px-3 py-2 text-sm font-mono text-outline-variant">
                Member
              </span>
              <button
                type="submit"
                disabled={inviteLoading || !inviteEmail.trim()}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-mono bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 disabled:opacity-40 transition-all"
              >
                {inviteLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
                Invite
              </button>
            </form>
            {inviteError && (
              <div className="px-6 pb-4">
                <p className="text-xs text-error font-mono">{inviteError}</p>
              </div>
            )}
            {generatedLink && (
              <div className="px-6 pb-4">
                <div className="flex items-center gap-2 p-3 bg-secondary/5 border border-secondary/20 rounded-lg">
                  <Link className="w-4 h-4 text-secondary flex-shrink-0" />
                  <input
                    readOnly
                    value={generatedLink}
                    className="flex-1 bg-transparent text-xs font-mono text-on-surface focus:outline-none"
                  />
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(generatedLink);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                    className="flex items-center gap-1 text-[10px] font-mono text-secondary border border-secondary/30 px-2 py-1 rounded hover:bg-secondary/10 transition-colors"
                  >
                    {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Pending Invites (leader only) */}
        {isLeader && invites.length > 0 && (
          <div className="glass-panel rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-outline-variant/20">
              <h3 className="font-mono text-xs font-semibold tracking-[0.1em] text-on-surface uppercase">
                Pending Invites
              </h3>
            </div>
            <div className="divide-y divide-outline-variant/10">
              {invites.map((inv) => (
                <div
                  key={inv.id}
                  className="px-6 py-3 flex items-center justify-between hover:bg-surface-container-high/20 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Mail className="w-4 h-4 text-secondary flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm text-on-surface truncate">{inv.email}</p>
                      <p className="text-[10px] font-mono text-outline-variant">
                        Role: {inv.role}
                        {mounted && inv.expires_at ? ` · Expires ${new Date(inv.expires_at).toLocaleDateString()}` : ""}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRevokeInvite(inv.id)}
                    className="text-outline-variant hover:text-error transition-colors p-1 rounded hover:bg-error/10 text-xs font-mono"
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Top-up Modal */}
      {topUpOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="glass-panel rounded-xl p-6 w-full max-w-md space-y-4">
            <h3 className="font-mono text-sm font-semibold text-on-surface">Buy Extra Credits</h3>
            <div className="space-y-3">
              <label className="text-xs font-mono text-outline flex flex-col gap-1">
                Amount
                <input
                  type="number"
                  value={topUpForm.amount}
                  onChange={(e) => setTopUpForm({ ...topUpForm, amount: e.target.value })}
                  placeholder="e.g. 1000"
                  className="bg-surface-container-low border border-outline-variant/30 rounded px-3 py-2 text-on-surface"
                />
              </label>
              <label className="text-xs font-mono text-outline flex flex-col gap-1">
                Note
                <input
                  value={topUpForm.note}
                  onChange={(e) => setTopUpForm({ ...topUpForm, note: e.target.value })}
                  placeholder="Optional note"
                  className="bg-surface-container-low border border-outline-variant/30 rounded px-3 py-2 text-on-surface"
                />
              </label>
              <div className="grid grid-cols-3 gap-2">
                <label className="text-xs font-mono text-outline flex flex-col gap-1">
                  Card Number
                  <input
                    value={topUpForm.number}
                    onChange={(e) => setTopUpForm({ ...topUpForm, number: e.target.value })}
                    className="bg-surface-container-low border border-outline-variant/30 rounded px-3 py-2 text-on-surface"
                  />
                </label>
                <label className="text-xs font-mono text-outline flex flex-col gap-1">
                  Exp Month
                  <input
                    value={topUpForm.expMonth}
                    onChange={(e) => setTopUpForm({ ...topUpForm, expMonth: e.target.value })}
                    className="bg-surface-container-low border border-outline-variant/30 rounded px-3 py-2 text-on-surface"
                  />
                </label>
                <label className="text-xs font-mono text-outline flex flex-col gap-1">
                  Exp Year
                  <input
                    value={topUpForm.expYear}
                    onChange={(e) => setTopUpForm({ ...topUpForm, expYear: e.target.value })}
                    className="bg-surface-container-low border border-outline-variant/30 rounded px-3 py-2 text-on-surface"
                  />
                </label>
              </div>
              <label className="text-xs font-mono text-outline flex flex-col gap-1">
                CVC
                <input
                  value={topUpForm.cvc}
                  onChange={(e) => setTopUpForm({ ...topUpForm, cvc: e.target.value })}
                  className="bg-surface-container-low border border-outline-variant/30 rounded px-3 py-2 text-on-surface w-24"
                />
              </label>
            </div>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setTopUpOpen(false)}
                className="px-4 py-2 rounded text-xs font-mono text-outline hover:text-on-surface transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleLeaderTopUp}
                disabled={topUpSubmitting}
                className="px-4 py-2 rounded bg-primary text-on-primary text-xs font-mono disabled:opacity-50"
              >
                {topUpSubmitting ? "Processing…" : "Confirm Purchase"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

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
import { authedFetch } from "@/lib/auth";
import { toast } from "@/lib/toast";
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
  const [memberTotal, setMemberTotal] = useState(0);
  const [memberPage, setMemberPage] = useState(0);
  const [memberSearch, setMemberSearch] = useState("");
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
  const [autoPoolDraw, setAutoPoolDraw] = useState(false);
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

  async function refreshQuotas() {
    try {
      const q = await authedFetch<{ org?: { extra_pool: number; auto_pool_draw: boolean }; members?: { supabase_auth_id: string; quota: { daily_budget: number; daily_used: number; daily_remaining: number; extra_allocated: number; extra_used: number; extra_remaining: number; total_available: number } }[] }>("/api/org/quota");
      setOrgExtraPool(q.org?.extra_pool || 0);
      setAutoPoolDraw(q.org?.auto_pool_draw || false);
      const qmap: Record<string, { daily_budget: number; daily_used: number; daily_remaining: number; extra_allocated: number; extra_used: number; extra_remaining: number; total_available: number }> = {};
      for (const m of q.members || []) {
        qmap[m.supabase_auth_id] = m.quota;
      }
      setMemberQuotas(qmap);
    } catch (err) {
      console.warn("Failed to refresh quotas:", err);
    }
  }

  async function fetchOrgData(role: string | null) {
    setError("");
    try {
      const memberParams = new URLSearchParams({ limit: "25", offset: String(memberPage * 25) });
      if (memberSearch) memberParams.set("search", memberSearch);

      const [m, u] = await Promise.all([
        authedFetch<{ members?: OrgMember[]; total?: number }>(`/api/org?${memberParams}`).catch(() => ({} as { members?: OrgMember[]; total?: number })),
        authedFetch<OrgUsage>("/api/org/usage").catch(() => null),
      ]);

      setMembers(m.members || []);
      setMemberTotal(m.total || 0);
      if (u) setUsage(u);

      await refreshQuotas();

      if (role === "leader") {
        try {
          const inv = await authedFetch<{ invites?: OrgInvite[] }>("/api/org/invites");
          setInvites(inv.invites || []);
        } catch (err) {
          console.warn("Failed to load invites:", err);
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
      await authedFetch(`/api/org/topup`, { method: "POST", body: payload });
      setTopUpOpen(false);
      setTopUpForm({ ...topUpForm, amount: "", note: "" });
      refreshQuotas();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to complete top-up");
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

  // Re-fetch members when page or search changes
  useEffect(() => {
    if (!mounted || userLoading || !user) return;
    async function refetchMembers() {
      const params = new URLSearchParams({ limit: "25", offset: String(memberPage * 25) });
      if (memberSearch) params.set("search", memberSearch);
      try {
        const m = await authedFetch<{ members?: OrgMember[]; total?: number }>(`/api/org?${params}`);
        setMembers(m.members || []);
        setMemberTotal(m.total || 0);
      } catch (err) {
        console.warn("Failed to refetch members:", err);
      }
    }
    refetchMembers();
  }, [memberPage, memberSearch, mounted, userLoading, user?.id]);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim() || !isLeader) return;
    setInviteLoading(true);
    setInviteError("");
    try {
      const data = await authedFetch<{ token: string }>("/api/org/invite", {
        method: "POST",
        body: { email: inviteEmail.trim(), role: inviteRole },
      });
      const link = `${window.location.origin}/join?token=${data.token}`;
      setGeneratedLink(link);
      setInviteEmail("");
      setInviteRole("member");
      try {
        const inv = await authedFetch<{ invites?: OrgInvite[] }>("/api/org/invites");
        setInvites(inv.invites || []);
      } catch (err) {
        console.warn("Failed to refresh invites:", err);
      }
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Failed to send invite.");
    } finally {
      setInviteLoading(false);
    }
  }

  async function handleRemoveMember(profileId: string) {
    if (!isLeader) return;
    if (!confirm("Remove this member from the organization?")) return;
    try {
      await authedFetch(`/api/org?id=${encodeURIComponent(profileId)}`, { method: "DELETE" });
      setMembers((prev) => prev.filter((m) => m.id !== profileId));
    } catch (err) {
      toast.error("Couldn't remove member", err);
    }
  }

  async function handleRevokeInvite(inviteId: string) {
    if (!isLeader) return;
    try {
      await authedFetch(`/api/org/invites?id=${encodeURIComponent(inviteId)}`, { method: "DELETE" });
      setInvites((prev) => prev.filter((i) => i.id !== inviteId));
    } catch (err) {
      toast.error("Couldn't revoke invite", err);
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
      <div className="w-full space-y-4">
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { icon: Activity, label: "Total Tokens", value: usage.total_tokens.toLocaleString() },
              { icon: Users, label: "Active Users (30d)", value: usage.active_users.toString() },
              { icon: TrendingUp, label: "Total Calls", value: usage.total_calls.toLocaleString() },
              { icon: Wallet, label: "Est. Cost", value: `$${usage.compute_cost.toFixed(2)}` },
            ].map((card) => (
              <div key={card.label} className="glass-panel rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <card.icon className="w-4 h-4 text-primary" />
                  <span className="text-xs font-mono text-outline-variant uppercase">{card.label}</span>
                </div>
                <p className="text-xl font-semibold text-on-surface">{card.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Org Extra Pool + Auto-Draw Toggle */}
        {isLeader && (
          <div className="glass-panel rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-primary" />
                <span className="text-xs font-mono text-outline-variant uppercase">Organization Credit Pool</span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-sm font-mono text-on-surface font-semibold">
                  {orgExtraPool.toLocaleString()} credits
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-outline-variant">Auto-distribute</span>
                  <button
                    onClick={async () => {
                      const newVal = !autoPoolDraw;
                      try {
                        await authedFetch("/api/org/settings", {
                          method: "PATCH",
                          body: { auto_pool_draw: newVal },
                        });
                        setAutoPoolDraw(newVal);
                      } catch (err) {
                        toast.error("Couldn't update setting", err);
                      }
                    }}
                    className={`w-10 h-5 rounded-full transition-all relative ${autoPoolDraw ? "bg-secondary" : "bg-outline-variant/40"}`}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-on-primary shadow-sm transition-all ${autoPoolDraw ? "left-5.5" : "left-0.5"}`} style={{ left: autoPoolDraw ? "22px" : "2px" }} />
                  </button>
                </div>
              </div>
            </div>
            <p className="text-xs text-outline-variant">
              {autoPoolDraw
                ? "Members who exhaust daily credits will automatically draw from this pool."
                : "Members must be manually allocated credits. Enable auto-distribute to let them draw from the pool automatically."}
            </p>
          </div>
        )}

        {/* Leader Buy Credits */}
        {isLeader && (
          <div className="glass-panel rounded-xl p-4 space-y-3">
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
          <div className="px-6 py-4 border-b border-outline-variant/20 flex flex-col md:flex-row md:items-center gap-3 justify-between">
            <h3 className="font-mono text-xs font-semibold tracking-[0.1em] text-on-surface uppercase">
              Team Members
            </h3>
            <div className="flex items-center gap-3">
              <div className="relative">
                <input
                  type="text"
                  value={memberSearch}
                  onChange={(e) => { setMemberSearch(e.target.value); setMemberPage(0); }}
                  placeholder="Search members..."
                  className="pl-3 pr-3 py-1.5 text-sm rounded-lg border border-outline-variant/20 bg-surface-container-low/50 text-on-surface placeholder:text-outline-variant/40 focus:outline-none focus:border-primary w-48"
                />
              </div>
              <span className="text-xs text-outline font-mono">{memberTotal} total</span>
            </div>
          </div>

          {loading ? (
            <div className="p-8 flex justify-center">
              <Loader2 className="w-6 h-6 text-primary animate-spin" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead className="bg-surface-container-high/30">
                  <tr>
                    <th className="px-6 py-3 text-left text-[11px] font-mono text-outline uppercase">Member</th>
                    <th className="px-4 py-3 text-left text-[11px] font-mono text-outline uppercase">Role</th>
                    <th className="px-4 py-3 text-center text-[11px] font-mono text-outline uppercase">Daily Usage</th>
                    <th className="px-4 py-3 text-center text-[11px] font-mono text-outline uppercase">Extra Credits</th>
                    <th className="px-4 py-3 text-right text-[11px] font-mono text-outline uppercase">Available</th>
                    {isLeader && <th className="px-4 py-3 text-right text-[11px] font-mono text-outline uppercase">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/10">
                  {members.map((m) => {
                    const q = memberQuotas[m.supabase_auth_id];
                    const dailyPct = q ? Math.min((q.daily_used / q.daily_budget) * 100, 100) : 0;
                    const barColor = dailyPct >= 90 ? "bg-error" : dailyPct >= 70 ? "bg-tertiary" : "bg-secondary";
                    const status = !q ? "ok" : q.total_available <= 0 ? "exhausted" : dailyPct >= 90 ? "low" : "ok";
                    return (
                      <tr key={m.id} className={`hover:bg-surface-container-high/10 transition-colors ${status === "exhausted" ? "bg-error/5" : status === "low" ? "bg-tertiary/5" : ""}`}>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-on-surface">{m.display_name || "Unnamed"}</p>
                            {status === "exhausted" && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-error/10 text-error border border-error/20">EXHAUSTED</span>}
                            {status === "low" && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-tertiary/10 text-tertiary border border-tertiary/20">LOW</span>}
                          </div>
                          <p className="text-[10px] font-mono text-outline-variant mt-0.5">Joined {new Date(m.created_at).toLocaleDateString()}</p>
                        </td>
                        <td className="px-4 py-4">
                          {roleBadge(m.role)}
                        </td>
                        <td className="px-4 py-4">
                          {q ? (
                            <div className="flex flex-col items-center gap-1.5 min-w-[140px]">
                              <div className="w-full h-2 bg-surface-container rounded-full overflow-hidden">
                                <div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: `${dailyPct}%` }} />
                              </div>
                              <span className="text-[11px] font-mono text-outline">{q.daily_used} / {q.daily_budget} credits</span>
                            </div>
                          ) : <span className="text-xs text-outline">—</span>}
                        </td>
                        <td className="px-4 py-4 text-center">
                          {q && q.extra_allocated > 0 ? (
                            <div className="flex flex-col items-center gap-0.5">
                              <span className="text-sm font-mono text-primary font-medium">{q.extra_remaining.toLocaleString()}</span>
                              <span className="text-[10px] font-mono text-outline">of {q.extra_allocated.toLocaleString()}</span>
                            </div>
                          ) : <span className="text-xs text-outline-variant">None</span>}
                        </td>
                        <td className="px-4 py-4 text-right">
                          <span className="text-sm font-mono font-semibold text-on-surface">{q ? q.total_available.toLocaleString() : "—"}</span>
                        </td>
                        {isLeader && (
                          <td className="px-4 py-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              {allocatingMember === m.supabase_auth_id ? (
                                <div className="flex items-center gap-1">
                                  <input
                                    type="number"
                                    value={allocateInput}
                                    onChange={(e) => setAllocateInput(e.target.value)}
                                    placeholder="0"
                                    className="w-16 bg-surface-container-low/50 border border-outline-variant/20 rounded px-2 py-1 text-xs font-mono text-on-surface focus:outline-none focus:border-primary"
                                    min={1}
                                  />
                                  <button
                                    onClick={async () => {
                                      const amount = parseInt(allocateInput, 10);
                                      if (!amount || amount <= 0) { setAllocatingMember(null); return; }
                                      try {
                                        await authedFetch(`/api/org/members/${m.supabase_auth_id}/extra-tokens`, {
                                          method: "POST",
                                          body: { amount },
                                        });
                                        await refreshQuotas();
                                      } catch (err) {
                                        setError(err instanceof Error ? err.message : "Failed to allocate.");
                                      }
                                      setAllocatingMember(null);
                                      setAllocateInput("");
                                    }}
                                    className="p-1 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                                    title="Confirm"
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => { setAllocatingMember(m.supabase_auth_id); setAllocateInput(""); }}
                                  className="text-[10px] font-mono text-primary border border-primary/30 px-2.5 py-1 rounded hover:bg-primary/10 transition-colors"
                                >
                                  Allocate
                                </button>
                              )}
                              {m.role !== "leader" && (
                                <button
                                  onClick={() => handleRemoveMember(m.id)}
                                  className="text-outline-variant hover:text-error transition-colors p-1.5 rounded hover:bg-error/10"
                                  title="Remove member"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {/* Pagination */}
          {memberTotal > 25 && (
            <div className="px-6 py-3 border-t border-outline-variant/20 flex items-center justify-between">
              <span className="text-xs font-mono text-outline">Page {memberPage + 1} of {Math.ceil(memberTotal / 25)}</span>
              <div className="flex items-center gap-2">
                <button disabled={memberPage === 0} onClick={() => setMemberPage(memberPage - 1)}
                  className="px-3 py-1 text-xs rounded border border-outline-variant/20 disabled:opacity-30 hover:border-primary/40 transition-colors">Prev</button>
                <button disabled={memberPage >= Math.ceil(memberTotal / 25) - 1} onClick={() => setMemberPage(memberPage + 1)}
                  className="px-3 py-1 text-xs rounded border border-outline-variant/20 disabled:opacity-30 hover:border-primary/40 transition-colors">Next</button>
              </div>
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
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                    className="flex-1 bg-transparent text-xs font-mono text-on-surface focus:outline-none"
                  />
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

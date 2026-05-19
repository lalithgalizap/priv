"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Building2, Users, Activity, Loader2, Crown, BarChart3, Filter, Search, TrendingUp } from "lucide-react";
import { supabase } from "@/lib/supabase";
import AppShell from "@/components/AppShell";
import { useCurrentUser } from "@/hooks/useCurrentUser";

interface LedgerEntry {
  id: string;
  entry_type: string;
  credits: number;
  unit_cost_cents: number;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

interface CompanyDetail {
  tenant: {
    id: string;
    company_name: string;
    tier: string;
    is_active: boolean;
    created_at: string;
    extra_token_pool: number;
  };
  members: {
    id: string;
    supabase_auth_id: string;
    display_name: string | null;
    role: string;
    created_at: string;
  }[];
  usage: {
    total_tokens: number;
    active_users: number;
    total_calls: number;
    compute_cost: number;
    model_breakdown: { model_identifier: string; tokens: number; calls: number }[];
  };
  usage_detail: {
    daily: { day: string; credits: number; tokens: number }[];
    members: {
      supabase_auth_id: string;
      display_name: string | null;
      role: string;
      created_at: string | null;
      total_credits: number;
      total_tokens: number;
      last_activity: string | null;
    }[];
    member_daily: { supabase_auth_id: string; day: string; credits: number }[];
  };
}

export default function CompanyDetailPage() {
  const router = useRouter();
  const { id } = useParams() as { id: string };
  const { user, loading: userLoading } = useCurrentUser();
  const [company, setCompany] = useState<CompanyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [addingExtra, setAddingExtra] = useState(false);
  const [extraInput, setExtraInput] = useState("");
  const [daysFilter, setDaysFilter] = useState(7);
  const [memberSearch, setMemberSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "leader" | "member">("all");
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
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

  const dailyUsage = useMemo(() => company?.usage_detail?.daily ?? [], [company]);
  const memberUsage = useMemo(() => company?.usage_detail?.members ?? [], [company]);

  const filteredDaily = useMemo(() => {
    if (!dailyUsage.length) return [];
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - (daysFilter - 1));
    return dailyUsage.filter((entry) => new Date(entry.day) >= since);
  }, [dailyUsage, daysFilter]);

  const totalCreditsWindow = useMemo(
    () => filteredDaily.reduce((sum, entry) => sum + entry.credits, 0),
    [filteredDaily],
  );

  const avgDailyCredits = useMemo(
    () => (filteredDaily.length ? Math.round(totalCreditsWindow / filteredDaily.length) : 0),
    [filteredDaily, totalCreditsWindow],
  );

  const filteredMembers = useMemo(() => {
    const query = memberSearch.trim().toLowerCase();
    return memberUsage
      .filter((member) => {
        const matchesRole = roleFilter === "all" || member.role === roleFilter;
        const name = (member.display_name || "Unnamed").toLowerCase();
        const matchesQuery = !query || name.includes(query);
        return matchesRole && matchesQuery;
      })
      .sort((a, b) => b.total_credits - a.total_credits);
  }, [memberUsage, memberSearch, roleFilter]);

  const activeMembers = useMemo(() => filteredMembers.filter((m) => m.total_credits > 0).length, [filteredMembers]);

  async function fetchCompany() {
    setError("");
    try {
      const { data: sesh } = await supabase.auth.getSession();
      const t = sesh.session?.access_token;
      if (!t) {
        router.push("/login");
        return;
      }

      // Fetch company detail
      const res = await fetch(`/api/admin/companies/${id}`, { headers: { Authorization: `Bearer ${t}` } });
      if (!res.ok) throw new Error("Failed to load company data.");
      const data = await res.json();
      setCompany(data);
      fetchLedger(t, data.tenant.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load company.");
    } finally {
      setLoading(false);
    }
  }

  async function fetchLedger(token: string, tenantId: string) {
    setLedgerLoading(true);
    try {
      const res = await fetch(`/api/admin/companies/${tenantId}/ledger`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setLedgerEntries(data.entries || []);
      }
    } finally {
      setLedgerLoading(false);
    }
  }

  async function handleAddExtra() {
    const amount = parseInt(extraInput, 10);
    if (!amount || amount <= 0) { setAddingExtra(false); return; }
    const { data: sesh } = await supabase.auth.getSession();
    const t = sesh.session?.access_token;
    if (!t) return;
    const res = await fetch(`/api/admin/companies/${id}/add-tokens`, {
      method: "POST",
      headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
      body: JSON.stringify({ amount }),
    });
    if (res.ok && company) {
      const data = await res.json();
      setCompany({ ...company, tenant: { ...company.tenant, extra_token_pool: data.extra_token_pool } });
    }
    setAddingExtra(false);
    setExtraInput("");
  }

  async function handleTopUpSubmit() {
    if (!company) return;
    const amount = parseInt(topUpForm.amount, 10);
    if (!amount || amount <= 0) return;
    setTopUpSubmitting(true);
    try {
      const { data: sesh } = await supabase.auth.getSession();
      const t = sesh.session?.access_token;
      if (!t) return;
      const payload = {
        amount,
        note: topUpForm.note || undefined,
        card: {
          number: topUpForm.number,
          exp_month: Number(topUpForm.expMonth),
          exp_year: Number(topUpForm.expYear),
          cvc: topUpForm.cvc,
          name: topUpForm.name || undefined,
        },
      };
      const res = await fetch(`/api/admin/companies/${company.tenant.id}/topup`, {
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
        fetchLedger(t, company.tenant.id);
        fetchCompany();
      }
    } finally {
      setTopUpSubmitting(false);
    }
  }

  const isSuperadmin = Boolean(user?.is_platform_admin || user?.role === "superadmin");

  useEffect(() => {
    if (!id) return;
    if (userLoading) return;
    if (!user) {
      router.push("/login");
      setLoading(false);
      return;
    }
    if (!isSuperadmin) {
      router.push("/dashboard");
      setLoading(false);
      return;
    }
    fetchCompany();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, userLoading, user?.id, isSuperadmin]);

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-[400px]">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      </AppShell>
    );
  }

  if (error || !company) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-[400px]">
          <p className="text-error font-mono text-sm">{error || "Company not found."}</p>
        </div>
      </AppShell>
    );
  }

  const tenant = company.tenant;
  const usage = company.usage;
  const extraPool = tenant.extra_token_pool || 0;

  return (
    <AppShell>
      <div className="mb-6">
        <button
          onClick={() => router.push("/dashboard")}
          className="flex items-center gap-2 text-sm font-mono text-outline hover:text-primary transition-colors mb-4"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Dashboard
        </button>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold text-on-surface mb-1 tracking-tight flex items-center gap-3">
              <Building2 className="w-7 h-7 text-primary" />
              {tenant.company_name}
            </h2>
            <p className="text-on-surface-variant font-mono text-sm flex items-center gap-2">
              <Crown className="w-3.5 h-3.5 text-secondary" />
              {tenant.tier} · {tenant.is_active ? "Active" : "Suspended"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {addingExtra ? (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={extraInput}
                  onChange={(e) => setExtraInput(e.target.value)}
                  placeholder="Amount"
                  className="w-32 bg-surface-container-low/50 border border-outline-variant/20 rounded px-3 py-1.5 text-xs font-mono text-on-surface focus:outline-none focus:border-primary"
                />
                <button
                  onClick={handleAddExtra}
                  className="px-3 py-1.5 rounded text-xs font-mono bg-primary text-on-primary hover:bg-primary/90 transition-all"
                >
                  Add
                </button>
                <button
                  onClick={() => setAddingExtra(false)}
                  className="px-3 py-1.5 rounded text-xs font-mono text-outline hover:text-on-surface transition-all"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => {
                  setAddingExtra(true);
                  setExtraInput("");
                }}
                className="flex items-center gap-1 text-xs font-mono text-secondary border border-secondary/30 px-3 py-1.5 rounded hover:border-secondary/60 hover:text-secondary transition-colors"
              >
                <Activity className="w-3 h-3" />
                Add extra credits
              </button>
            )}
            <button
              onClick={() => setTopUpOpen(true)}
              className="flex items-center gap-1 text-xs font-mono text-primary border border-primary/40 px-3 py-1.5 rounded hover:bg-primary/10 transition-colors"
            >
              <Activity className="w-3 h-3" />
              Dummy card top-up
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="px-3 py-1.5 rounded-lg bg-error/10 border border-error/30 text-error text-xs font-mono max-w-md mb-6">
          {error}
        </div>
      )}

      {/* Extra Pool */}
      <div className="glass-panel rounded-xl p-6 mb-6">
        <h3 className="font-mono text-xs font-semibold tracking-[0.1em] text-on-surface uppercase mb-4 pb-4 border-b border-outline-variant/20 flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" /> Extra Credit Pool
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-6 gap-6 mb-4">
          <div>
            <p className="font-mono text-xs text-outline uppercase mb-1">Extra Pool</p>
            <p className="text-2xl font-semibold text-on-surface">{tenant.extra_token_pool?.toLocaleString() || 0}</p>
          </div>
          <div>
            <p className="font-mono text-xs text-outline uppercase mb-1">Total Tokens Used</p>
            <p className="text-2xl font-semibold text-on-surface">{usage.total_tokens.toLocaleString()}</p>
          </div>
          <div>
            <p className="font-mono text-xs text-outline uppercase mb-1">Total Calls</p>
            <p className="text-2xl font-semibold text-on-surface">{usage.total_calls.toLocaleString()}</p>
          </div>
          <div>
            <p className="font-mono text-xs text-outline uppercase mb-1">Active Users</p>
            <p className="text-2xl font-semibold text-on-surface">{usage.active_users.toLocaleString()}</p>
          </div>
        </div>
        <p className="text-xs font-mono text-outline/60">
          Each member gets 50 credits/day automatically. Admin adds extra credits to the pool; leader distributes them.
        </p>
      </div>

      {/* Usage Insights */}
      <div className="glass-panel rounded-xl p-6 mb-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between border-b border-outline-variant/20 pb-4 mb-4">
          <h3 className="font-mono text-xs font-semibold tracking-[0.1em] text-on-surface uppercase flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-primary" /> Usage Insights
          </h3>
          <label className="text-xs font-mono text-outline flex items-center gap-2">
            <span className="flex items-center gap-1">
              <TrendingUp className="w-3 h-3" /> Range
            </span>
            <select
              value={daysFilter}
              onChange={(e) => setDaysFilter(Number(e.target.value))}
              className="bg-surface-container-low border border-outline-variant/30 rounded px-2 py-1 text-xs text-on-surface focus:outline-none focus:border-primary"
            >
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
            </select>
          </label>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div className="rounded-lg border border-outline-variant/20 p-4 bg-surface-container-low/40">
            <p className="text-xs font-mono text-outline uppercase mb-1">Credits (last {daysFilter}d)</p>
            <p className="text-2xl font-semibold text-on-surface">{totalCreditsWindow.toLocaleString()}</p>
          </div>
          <div className="rounded-lg border border-outline-variant/20 p-4 bg-surface-container-low/40">
            <p className="text-xs font-mono text-outline uppercase mb-1">Avg Credits / day</p>
            <p className="text-2xl font-semibold text-on-surface">{avgDailyCredits.toLocaleString()}</p>
          </div>
          <div className="rounded-lg border border-outline-variant/20 p-4 bg-surface-container-low/40">
            <p className="text-xs font-mono text-outline uppercase mb-1">Active Members</p>
            <p className="text-2xl font-semibold text-on-surface">{activeMembers}</p>
          </div>
        </div>
        <div className="overflow-x-auto border border-outline-variant/20 rounded-lg">
          {filteredDaily.length > 0 ? (
            <table className="min-w-full text-left">
              <thead className="bg-surface-container-high/40">
                <tr>
                  <th className="px-4 py-3 text-[11px] font-mono text-outline uppercase">Date</th>
                  <th className="px-4 py-3 text-[11px] font-mono text-outline uppercase">Credits</th>
                  <th className="px-4 py-3 text-[11px] font-mono text-outline uppercase">Tokens</th>
                </tr>
              </thead>
              <tbody>
                {filteredDaily.map((day) => (
                  <tr key={day.day} className="border-t border-outline-variant/10">
                    <td className="px-4 py-3 text-sm text-on-surface">{new Date(day.day).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-sm font-mono text-primary">{day.credits.toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm font-mono text-outline">{day.tokens.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="px-4 py-6 text-center text-sm text-outline font-mono">No usage for this window yet.</div>
          )}
        </div>
      </div>

      {/* Ledger */}
      <div className="glass-panel rounded-xl p-6 mb-6">
        <div className="flex items-center justify-between border-b border-outline-variant/20 pb-4 mb-4">
          <h3 className="font-mono text-xs font-semibold tracking-[0.1em] text-on-surface uppercase flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" /> Credit Ledger
          </h3>
          {ledgerLoading && <span className="text-xs font-mono text-outline">Refreshing…</span>}
        </div>
        <div className="overflow-x-auto">
          {ledgerEntries.length > 0 ? (
            <table className="min-w-full text-left">
              <thead className="bg-surface-container-high/40">
                <tr>
                  <th className="px-4 py-2 text-[11px] font-mono text-outline uppercase">Time</th>
                  <th className="px-4 py-2 text-[11px] font-mono text-outline uppercase">Type</th>
                  <th className="px-4 py-2 text-[11px] font-mono text-outline uppercase">Credits</th>
                  <th className="px-4 py-2 text-[11px] font-mono text-outline uppercase">Note</th>
                </tr>
              </thead>
              <tbody>
                {ledgerEntries.map((entry) => (
                  <tr key={entry.id} className="border-t border-outline-variant/10">
                    <td className="px-4 py-2 text-sm font-mono text-outline">
                      {new Date(entry.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-sm font-mono text-on-surface capitalize">{entry.entry_type}</td>
                    <td className="px-4 py-2 text-sm font-mono text-primary">{entry.credits.toLocaleString()}</td>
                    <td className="px-4 py-2 text-sm text-on-surface-variant">{entry.note || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="px-4 py-6 text-center text-sm text-outline font-mono">No ledger entries yet.</div>
          )}
        </div>
      </div>

      {/* Members */}
      <div className="glass-panel rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-outline-variant/20 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="font-mono text-xs font-semibold tracking-[0.1em] text-on-surface uppercase flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" /> Members
            </h3>
            <span className="text-xs text-outline font-mono">{company.members.length} total profiles</span>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-outline absolute left-2 top-2" />
              <input
                type="text"
                placeholder="Search member"
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                className="pl-7 pr-3 py-1.5 text-sm rounded border border-outline-variant/30 bg-surface-container-low text-on-surface focus:outline-none focus:border-primary"
              />
            </div>
            <div className="relative">
              <Filter className="w-3.5 h-3.5 text-outline absolute left-2 top-2" />
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value as "all" | "leader" | "member")}
                className="pl-7 pr-3 py-1.5 text-sm rounded border border-outline-variant/30 bg-surface-container-low text-on-surface focus:outline-none focus:border-primary"
              >
                <option value="all">All roles</option>
                <option value="leader">Leaders</option>
                <option value="member">Members</option>
              </select>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          {filteredMembers.length > 0 ? (
            <table className="min-w-full text-left">
              <thead className="bg-surface-container-high/40">
                <tr>
                  <th className="px-6 py-3 text-[11px] font-mono text-outline uppercase">Member</th>
                  <th className="px-6 py-3 text-[11px] font-mono text-outline uppercase">Role</th>
                  <th className="px-6 py-3 text-[11px] font-mono text-outline uppercase">Credits (lifetime)</th>
                  <th className="px-6 py-3 text-[11px] font-mono text-outline uppercase">Tokens</th>
                  <th className="px-6 py-3 text-[11px] font-mono text-outline uppercase">Last activity</th>
                </tr>
              </thead>
              <tbody>
                {filteredMembers.map((member) => (
                  <tr key={member.supabase_auth_id} className="border-t border-outline-variant/10">
                    <td className="px-6 py-3">
                      <p className="text-sm font-medium text-on-surface">{member.display_name || "Unnamed"}</p>
                      <p className="text-[10px] font-mono text-outline-variant">Joined {member.created_at ? new Date(member.created_at).toLocaleDateString() : "—"}</p>
                    </td>
                    <td className="px-6 py-3 text-sm font-mono text-outline">{member.role}</td>
                    <td className="px-6 py-3 text-sm font-mono text-primary">{member.total_credits.toLocaleString()}</td>
                    <td className="px-6 py-3 text-sm font-mono text-outline">{member.total_tokens.toLocaleString()}</td>
                    <td className="px-6 py-3 text-sm font-mono text-outline">
                      {member.last_activity ? new Date(member.last_activity).toLocaleString() : "No usage"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="px-6 py-8 text-center text-sm text-outline font-mono">No member usage recorded for this window.</div>
          )}
        </div>
      </div>

      {topUpOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-surface w-full max-w-lg rounded-xl p-6 border border-outline-variant/30">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-mono text-xs tracking-[0.1em] uppercase text-on-surface">Dummy Card Top-up</h3>
              <button onClick={() => setTopUpOpen(false)} className="text-outline text-sm">Close</button>
            </div>
            <div className="grid grid-cols-1 gap-4">
              <label className="text-xs font-mono text-outline flex flex-col gap-1">
                Amount (credits)
                <input
                  type="number"
                  value={topUpForm.amount}
                  onChange={(e) => setTopUpForm({ ...topUpForm, amount: e.target.value })}
                  className="bg-surface-container-low border border-outline-variant/30 rounded px-3 py-2 text-on-surface"
                />
              </label>
              <label className="text-xs font-mono text-outline flex flex-col gap-1">
                Note (optional)
                <input
                  value={topUpForm.note}
                  onChange={(e) => setTopUpForm({ ...topUpForm, note: e.target.value })}
                  className="bg-surface-container-low border border-outline-variant/30 rounded px-3 py-2 text-on-surface"
                />
              </label>
              <div className="grid grid-cols-2 gap-4">
                <label className="text-xs font-mono text-outline flex flex-col gap-1">
                  Name on card
                  <input
                    value={topUpForm.name}
                    onChange={(e) => setTopUpForm({ ...topUpForm, name: e.target.value })}
                    className="bg-surface-container-low border border-outline-variant/30 rounded px-3 py-2 text-on-surface"
                  />
                </label>
                <label className="text-xs font-mono text-outline flex flex-col gap-1">
                  Card number
                  <input
                    value={topUpForm.number}
                    onChange={(e) => setTopUpForm({ ...topUpForm, number: e.target.value })}
                    className="bg-surface-container-low border border-outline-variant/30 rounded px-3 py-2 text-on-surface"
                    maxLength={16}
                  />
                </label>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <label className="text-xs font-mono text-outline flex flex-col gap-1">
                  Exp month
                  <input
                    value={topUpForm.expMonth}
                    onChange={(e) => setTopUpForm({ ...topUpForm, expMonth: e.target.value })}
                    className="bg-surface-container-low border border-outline-variant/30 rounded px-3 py-2 text-on-surface"
                  />
                </label>
                <label className="text-xs font-mono text-outline flex flex-col gap-1">
                  Exp year
                  <input
                    value={topUpForm.expYear}
                    onChange={(e) => setTopUpForm({ ...topUpForm, expYear: e.target.value })}
                    className="bg-surface-container-low border border-outline-variant/30 rounded px-3 py-2 text-on-surface"
                  />
                </label>
                <label className="text-xs font-mono text-outline flex flex-col gap-1">
                  CVC
                  <input
                    value={topUpForm.cvc}
                    onChange={(e) => setTopUpForm({ ...topUpForm, cvc: e.target.value })}
                    className="bg-surface-container-low border border-outline-variant/30 rounded px-3 py-2 text-on-surface"
                    maxLength={4}
                  />
                </label>
              </div>
              <button
                onClick={handleTopUpSubmit}
                disabled={topUpSubmitting}
                className="w-full py-2 rounded bg-primary text-on-primary font-mono text-sm"
              >
                {topUpSubmitting ? "Processing…" : "Submit top-up"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

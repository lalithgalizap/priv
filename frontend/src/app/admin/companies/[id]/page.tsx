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
  note: string | null;
  created_by: string | null;
  created_at: string;
}

interface CompanyDetail {
  tenant: { id: string; company_name: string; tier: string; is_active: boolean; created_at: string; extra_token_pool: number };
  members: { id: string; supabase_auth_id: string; display_name: string | null; role: string; created_at: string }[];
  usage: { total_tokens: number; active_users: number; total_calls: number; compute_cost: number; model_breakdown: { model_identifier: string; tokens: number; calls: number }[] };
  usage_detail: {
    daily: { day: string; credits: number; tokens: number }[];
    members: { supabase_auth_id: string; display_name: string | null; role: string; created_at: string | null; total_credits: number; total_tokens: number; last_activity: string | null }[];
  };
}

export default function CompanyDetailPage() {
  const router = useRouter();
  const { id } = useParams() as { id: string };
  const { user, loading: userLoading } = useCurrentUser();
  const [company, setCompany] = useState<CompanyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [daysFilter, setDaysFilter] = useState(7);
  const [memberSearch, setMemberSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "leader" | "member">("all");
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);

  const dailyUsage = useMemo(() => company?.usage_detail?.daily ?? [], [company]);
  const memberUsage = useMemo(() => company?.usage_detail?.members ?? [], [company]);

  const filteredDaily = useMemo(() => {
    if (!dailyUsage.length) return [];
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - (daysFilter - 1));
    return dailyUsage.filter((entry) => new Date(entry.day) >= since);
  }, [dailyUsage, daysFilter]);

  const totalCreditsWindow = useMemo(() => filteredDaily.reduce((s, e) => s + e.credits, 0), [filteredDaily]);
  const avgDailyCredits = useMemo(() => (filteredDaily.length ? Math.round(totalCreditsWindow / filteredDaily.length) : 0), [filteredDaily, totalCreditsWindow]);

  const filteredMembers = useMemo(() => {
    const query = memberSearch.trim().toLowerCase();
    return memberUsage
      .filter((m) => {
        const matchesRole = roleFilter === "all" || m.role === roleFilter;
        const matchesQuery = !query || (m.display_name || "").toLowerCase().includes(query);
        return matchesRole && matchesQuery;
      })
      .sort((a, b) => b.total_credits - a.total_credits);
  }, [memberUsage, memberSearch, roleFilter]);

  const isSuperadmin = Boolean(user?.is_platform_admin || user?.role === "superadmin");

  async function fetchCompany() {
    setError("");
    try {
      const { data: sesh } = await supabase.auth.getSession();
      const t = sesh.session?.access_token;
      if (!t) { router.push("/login"); return; }
      const res = await fetch(`/api/admin/companies/${id}`, { headers: { Authorization: `Bearer ${t}` } });
      if (!res.ok) throw new Error("Failed to load company data.");
      const data = await res.json();
      setCompany(data);
      // Fetch ledger
      setLedgerLoading(true);
      const ledgerRes = await fetch(`/api/admin/companies/${data.tenant.id}/ledger`, { headers: { Authorization: `Bearer ${t}` } });
      if (ledgerRes.ok) { const ld = await ledgerRes.json(); setLedgerEntries(ld.entries || []); }
      setLedgerLoading(false);
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to load."); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    if (!id || userLoading) return;
    if (!user) { router.push("/login"); return; }
    if (!isSuperadmin) { router.push("/dashboard"); return; }
    fetchCompany();
  }, [id, userLoading, user?.id, isSuperadmin]);

  if (loading) return <AppShell><div className="flex items-center justify-center h-[400px]"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div></AppShell>;
  if (error || !company) return <AppShell><div className="flex items-center justify-center h-[400px]"><p className="text-error font-mono text-sm">{error || "Company not found."}</p></div></AppShell>;

  const tenant = company.tenant;
  const usage = company.usage;

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* Header */}
        <div>
          <button onClick={() => router.push("/admin")} className="flex items-center gap-2 text-sm font-mono text-outline hover:text-primary transition-colors mb-4">
            <ArrowLeft className="w-4 h-4" /> Back to Admin
          </button>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-3xl font-bold text-on-surface mb-1 flex items-center gap-3">
                <Building2 className="w-7 h-7 text-primary" />{tenant.company_name}
              </h2>
              <p className="text-on-surface-variant font-mono text-sm flex items-center gap-2">
                <Crown className="w-3.5 h-3.5 text-secondary" />{tenant.tier} · {tenant.is_active ? "Active" : "Suspended"}
              </p>
            </div>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[
            { label: "Credit Pool", value: (tenant.extra_token_pool || 0).toLocaleString() },
            { label: "Total Tokens", value: usage.total_tokens.toLocaleString() },
            { label: "Total Calls", value: usage.total_calls.toLocaleString() },
            { label: "Active Users", value: usage.active_users.toLocaleString() },
            { label: "Members", value: company.members.length.toString() },
          ].map((kpi) => (
            <div key={kpi.label} className="glass-panel rounded-xl p-4">
              <p className="text-[10px] font-mono text-outline uppercase mb-1">{kpi.label}</p>
              <p className="text-2xl font-bold text-on-surface">{kpi.value}</p>
            </div>
          ))}
        </div>

        {/* Usage Insights */}
        <div className="glass-panel rounded-xl p-6">
          <div className="flex items-center justify-between border-b border-outline-variant/20 pb-4 mb-4">
            <h3 className="font-mono text-xs font-semibold tracking-[0.1em] text-on-surface uppercase flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary" /> Usage Insights
            </h3>
            <div className="flex items-center gap-2">
              <TrendingUp className="w-3 h-3 text-outline" />
              <select value={daysFilter} onChange={(e) => setDaysFilter(Number(e.target.value))}
                className="bg-surface-container-low border border-outline-variant/30 rounded px-2 py-1 text-xs text-on-surface focus:outline-none focus:border-primary">
                <option value={7}>Last 7 days</option>
                <option value={30}>Last 30 days</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div className="rounded-lg border border-outline-variant/20 p-4 bg-surface-container-low/40">
              <p className="text-xs font-mono text-outline uppercase mb-1">Credits ({daysFilter}d)</p>
              <p className="text-2xl font-semibold text-on-surface">{totalCreditsWindow.toLocaleString()}</p>
            </div>
            <div className="rounded-lg border border-outline-variant/20 p-4 bg-surface-container-low/40">
              <p className="text-xs font-mono text-outline uppercase mb-1">Avg / day</p>
              <p className="text-2xl font-semibold text-on-surface">{avgDailyCredits.toLocaleString()}</p>
            </div>
            <div className="rounded-lg border border-outline-variant/20 p-4 bg-surface-container-low/40">
              <p className="text-xs font-mono text-outline uppercase mb-1">Active Members</p>
              <p className="text-2xl font-semibold text-on-surface">{filteredMembers.filter((m) => m.total_credits > 0).length}</p>
            </div>
          </div>
          {filteredDaily.length > 0 && (
            <div className="overflow-x-auto border border-outline-variant/20 rounded-lg">
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
            </div>
          )}
        </div>

        {/* Credit Ledger */}
        <div className="glass-panel rounded-xl p-6">
          <div className="flex items-center justify-between border-b border-outline-variant/20 pb-4 mb-4">
            <h3 className="font-mono text-xs font-semibold tracking-[0.1em] text-on-surface uppercase flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" /> Credit Ledger (Purchases)
            </h3>
            {ledgerLoading && <span className="text-xs font-mono text-outline">Loading…</span>}
          </div>
          {ledgerEntries.length > 0 ? (
            <div className="overflow-x-auto border border-outline-variant/20 rounded-lg">
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
                      <td className="px-4 py-2 text-sm font-mono text-outline">{new Date(entry.created_at).toLocaleString()}</td>
                      <td className="px-4 py-2 text-sm font-mono text-on-surface capitalize">{entry.entry_type}</td>
                      <td className="px-4 py-2 text-sm font-mono text-primary">{entry.credits.toLocaleString()}</td>
                      <td className="px-4 py-2 text-sm text-on-surface-variant">{entry.note || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-outline font-mono text-center py-6">No purchases recorded yet.</p>
          )}
        </div>

        {/* Members */}
        <div className="glass-panel rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-outline-variant/20 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <h3 className="font-mono text-xs font-semibold tracking-[0.1em] text-on-surface uppercase flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" /> Members ({company.members.length})
            </h3>
            <div className="flex gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-outline absolute left-2 top-2" />
                <input type="text" placeholder="Search" value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)}
                  className="pl-7 pr-3 py-1.5 text-sm rounded border border-outline-variant/30 bg-surface-container-low text-on-surface focus:outline-none focus:border-primary" />
              </div>
              <div className="relative">
                <Filter className="w-3.5 h-3.5 text-outline absolute left-2 top-2" />
                <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as "all" | "leader" | "member")}
                  className="pl-7 pr-3 py-1.5 text-sm rounded border border-outline-variant/30 bg-surface-container-low text-on-surface focus:outline-none focus:border-primary">
                  <option value="all">All</option>
                  <option value="leader">Leaders</option>
                  <option value="member">Members</option>
                </select>
              </div>
            </div>
          </div>
          {filteredMembers.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left">
                <thead className="bg-surface-container-high/40">
                  <tr>
                    <th className="px-6 py-3 text-[11px] font-mono text-outline uppercase">Member</th>
                    <th className="px-6 py-3 text-[11px] font-mono text-outline uppercase">Role</th>
                    <th className="px-6 py-3 text-[11px] font-mono text-outline uppercase">Credits Used</th>
                    <th className="px-6 py-3 text-[11px] font-mono text-outline uppercase">Tokens</th>
                    <th className="px-6 py-3 text-[11px] font-mono text-outline uppercase">Last Active</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMembers.map((m) => (
                    <tr key={m.supabase_auth_id} className="border-t border-outline-variant/10">
                      <td className="px-6 py-3 text-sm font-medium text-on-surface">{m.display_name || "Unnamed"}</td>
                      <td className="px-6 py-3 text-sm font-mono text-outline">{m.role}</td>
                      <td className="px-6 py-3 text-sm font-mono text-primary">{m.total_credits.toLocaleString()}</td>
                      <td className="px-6 py-3 text-sm font-mono text-outline">{m.total_tokens.toLocaleString()}</td>
                      <td className="px-6 py-3 text-sm font-mono text-outline">{m.last_activity ? new Date(m.last_activity).toLocaleDateString() : "Never"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-6 py-8 text-center text-sm text-outline font-mono">No members match your filter.</p>
          )}
        </div>
      </div>
    </AppShell>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Users, Wallet, Activity, Loader2, Crown, Building2, User } from "lucide-react";
import { supabase } from "@/lib/supabase";
import AppShell from "@/components/AppShell";
import { useCurrentUser } from "@/hooks/useCurrentUser";

interface ModelBreakdown {
  model_identifier: string;
  tokens: number;
  calls: number;
}

interface RecentEntry {
  tenant_id: string;
  model_identifier: string;
  tokens: number;
  duration_ms: number;
  timestamp: string;
}

interface PersonalUsage {
  total_tokens: number;
  total_calls: number;
  compute_cost: number;
  model_breakdown: ModelBreakdown[];
  recent: RecentEntry[];
}

interface OrgUsage {
  total_tokens: number;
  active_users: number;
  total_calls: number;
  compute_cost: number;
  model_breakdown: ModelBreakdown[];
}

interface GlobalUsage {
  total_tokens: number;
  total_calls: number;
  active_tenants: number;
  total_users: number;
  compute_cost: number;
  tenant_breakdown: { company_name: string; tokens: number; calls: number }[];
  model_breakdown: ModelBreakdown[];
}

export default function DashboardPage() {
  const { user, loading: userLoading } = useCurrentUser();
  const [personal, setPersonal] = useState<PersonalUsage | null>(null);
  const [org, setOrg] = useState<OrgUsage | null>(null);
  const [globalData, setGlobalData] = useState<GlobalUsage | null>(null);
  const [myQuota, setMyQuota] = useState<{ user: { daily_budget: number; daily_used: number; daily_remaining: number; extra_allocated: number; extra_used: number; extra_remaining: number; total_available: number }; org: { extra_pool: number; extra_allocated: number } } | null>(null);
  const [orgQuota, setOrgQuota] = useState<{ org: { extra_pool: number; extra_allocated: number }; members: { supabase_auth_id: string; name: string; email: string; role: string; quota: { daily_budget: number; daily_used: number; daily_remaining: number; extra_allocated: number; extra_used: number; extra_remaining: number; total_available: number } }[] } | null>(null);
  const [companies, setCompanies] = useState<{ id: string; company_name: string; member_count: number; total_tokens: number; token_baseline: number; extra_token_pool: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function fetchDashboard() {
    setError("");
    setLoading(true);
    try {
      const { data: sesh } = await supabase.auth.getSession();
      const t = sesh.session?.access_token;
      if (!t) {
        throw new Error("Not authenticated.");
      }

      const res = await fetch("/api/dashboard/summary", {
        headers: { Authorization: `Bearer ${t}` },
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to load dashboard.");
      }

      const data = await res.json();

      setPersonal(data.personal ?? null);
      setMyQuota(data.my_quota ?? null);
      setOrg(data.org ?? null);
      setOrgQuota(data.org_quota ?? null);
      setCompanies(data.companies ?? []);
      setGlobalData(data.global_usage ?? null);
    } catch (err) {
      setPersonal(null);
      setMyQuota(null);
      setOrg(null);
      setOrgQuota(null);
      setCompanies([]);
      setGlobalData(null);
      setError(err instanceof Error ? err.message : "Failed to load dashboard.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (userLoading) return;
    if (!user) {
      setError("Not authenticated.");
      setLoading(false);
      return;
    }
    fetchDashboard();
  }, [userLoading, user?.id]);

  const role = user?.role ?? null;
  const isSuperadmin = Boolean(user?.is_platform_admin || role === "superadmin");
  const isLeader = role === "leader";
  const isMember = role === "member";

  function QuotaBar({ used, limit, label }: { used: number; limit: number | null; label: string }) {
    if (limit === null) return null;
    const pct = Math.min((used / limit) * 100, 100);
    const color = pct >= 90 ? "bg-error" : pct >= 70 ? "bg-tertiary" : "bg-secondary";
    return (
      <div className="glass-panel rounded-xl p-4">
        <div className="flex justify-between items-center mb-2">
          <span className="font-mono text-xs text-outline uppercase">{label}</span>
          <span className="font-mono text-xs text-on-surface">
            {used.toLocaleString()} / {limit.toLocaleString()}
          </span>
        </div>
        <div className="h-2 w-full bg-surface-container rounded-full overflow-hidden">
          <div className={`h-full ${color} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1 font-mono text-[10px] text-outline/60 text-right">{pct.toFixed(1)}%</p>
      </div>
    );
  }

  function StatCard({ icon: Icon, label, value, sub, color = "primary" }: { icon: React.ComponentType<{className?: string}>; label: string; value: React.ReactNode; sub?: string; color?: string }) {
    const colorMap: Record<string, string> = {
      primary: "text-primary",
      secondary: "text-secondary",
      tertiary: "text-tertiary",
      error: "text-error",
    };
    return (
      <div className="glass-panel rounded-xl p-6 relative overflow-hidden group">
        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
          <Icon className={`w-16 h-16 ${colorMap[color] || "text-primary"}`} />
        </div>
        <p className="font-mono text-xs font-semibold tracking-[0.1em] text-outline uppercase mb-4 relative z-10">
          {label}
        </p>
        <div className="flex items-baseline gap-3 relative z-10">
          <h3 className="text-2xl md:text-3xl font-semibold text-on-surface">{value}</h3>
        </div>
        {sub && <p className="mt-4 font-mono text-sm text-outline border-t border-outline-variant/30 pt-2">{sub}</p>}
      </div>
    );
  }

  function ModelBreakdownCard({ title, data, icon: Icon }: { title: string; data: ModelBreakdown[]; icon: React.ComponentType<{className?: string}> }) {
    return (
      <div className="glass-panel rounded-xl p-6 flex flex-col h-[320px]">
        <h3 className="font-mono text-xs font-semibold tracking-[0.1em] text-on-surface uppercase mb-4 pb-4 border-b border-outline-variant/20 flex items-center gap-2">
          <Icon className="w-4 h-4 text-primary" /> {title}
        </h3>
        <div className="flex-1 overflow-y-auto space-y-3 pr-1">
          {data.length === 0 ? (
            <p className="text-sm text-outline font-mono text-center mt-12">No data yet</p>
          ) : (
            data.map((m, i) => {
              const maxTokens = Math.max(...data.map((x) => x.tokens), 1);
              const pct = (m.tokens / maxTokens) * 100;
              return (
                <div key={i} className="space-y-1">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-on-surface font-medium truncate max-w-[70%]">
                      {m.model_identifier.split(".")[1] || m.model_identifier}
                    </span>
                    <span className="text-xs font-mono text-outline">{m.calls} calls</span>
                  </div>
                  <div className="h-1.5 w-full bg-surface-container rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: i === 0 ? "#c0c1ff" : i === 1 ? "#4edea3" : "#ddb7ff",
                      }}
                    />
                  </div>
                  <p className="text-[10px] font-mono text-outline/60">{m.tokens.toLocaleString()} tokens</p>
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  }

  return (
    <AppShell>
      <div className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h2 className="text-4xl md:text-5xl font-bold text-on-surface mb-2 tracking-tight">
            Telemetry Overview
          </h2>
          <p className="text-on-surface-variant font-mono text-sm flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-secondary status-glow animate-pulse" />
            {isSuperadmin ? "Global superadmin view." : isLeader ? "Company leader view." : "Personal usage view."}
          </p>
        </div>
        {error && (
          <div className="px-3 py-1.5 rounded-lg bg-error/10 border border-error/30 text-error text-xs font-mono max-w-md">
            {error}
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-[400px]">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* ── ADMIN COMPANY LIST (superadmin only) ── */}
          {isSuperadmin && (
            <section>
              <h3 className="font-mono text-xs font-semibold tracking-[0.1em] text-outline uppercase mb-4 flex items-center gap-2">
                <Building2 className="w-4 h-4 text-primary" /> All Companies
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {companies.length === 0 ? (
                  <p className="text-sm text-outline font-mono col-span-full text-center py-12">No companies yet</p>
                ) : (
                  companies.map((comp) => {
                    return (
                      <a
                        key={comp.id}
                        href={`/admin/companies/${comp.id}`}
                        className="glass-panel rounded-xl p-5 hover:bg-surface-container-high/30 transition-colors block"
                      >
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <Building2 className="w-5 h-5 text-primary/60" />
                            <span className="text-sm font-medium text-on-surface truncate">{comp.company_name}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 text-xs font-mono text-outline-variant mb-3">
                          <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {comp.member_count} members</span>
                          <span className="flex items-center gap-1"><Activity className="w-3 h-3" /> {comp.total_tokens?.toLocaleString() || 0} tokens used</span>
                        </div>
                        <p className="text-[10px] font-mono text-secondary">
                          Extra pool: {comp.extra_token_pool?.toLocaleString() || 0} credits
                        </p>
                      </a>
                    );
                  })
                )}
              </div>
            </section>
          )}

          {/* ── PERSONAL SECTION (member + leader only) ── */}
          {!isSuperadmin && personal && (
            <section>
              <h3 className="font-mono text-xs font-semibold tracking-[0.1em] text-outline uppercase mb-4 flex items-center gap-2">
                <User className="w-4 h-4 text-primary" /> My Usage
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                <StatCard icon={Activity} label="My Tokens" value={personal.total_tokens.toLocaleString()} color="primary" />
                <StatCard icon={Activity} label="My Calls" value={personal.total_calls.toLocaleString()} color="secondary" />
                <StatCard icon={Wallet} label="My Cost" value={`$${personal.compute_cost.toFixed(2)}`} color="error" />
              </div>
              {myQuota && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                  <div className="glass-panel rounded-xl p-4">
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-mono text-xs text-outline uppercase">My Daily Budget</span>
                      <span className="font-mono text-xs text-on-surface">{myQuota.user.daily_used.toLocaleString()} / {myQuota.user.daily_budget.toLocaleString()}</span>
                    </div>
                    <div className="h-2 w-full bg-surface-container rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${myQuota.user.daily_used / myQuota.user.daily_budget >= 0.9 ? "bg-error" : myQuota.user.daily_used / myQuota.user.daily_budget >= 0.7 ? "bg-tertiary" : "bg-secondary"}`} style={{ width: `${Math.min((myQuota.user.daily_used / myQuota.user.daily_budget) * 100, 100)}%` }} />
                    </div>
                    {myQuota.user.extra_allocated > 0 && (
                      <p className="mt-2 font-mono text-[10px] text-outline/60">Extra: {myQuota.user.extra_remaining.toLocaleString()} / {myQuota.user.extra_allocated.toLocaleString()} remaining</p>
                    )}
                    <p className="mt-1 font-mono text-[10px] text-outline/60 text-right">Total available: {myQuota.user.total_available.toLocaleString()}</p>
                  </div>
                  <div className="glass-panel rounded-xl p-4">
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-mono text-xs text-outline uppercase">Org Extra Pool</span>
                      <span className="font-mono text-xs text-on-surface">{myQuota.org.extra_pool.toLocaleString()} available</span>
                    </div>
                    <p className="font-mono text-[10px] text-outline/60">Allocated to members: {myQuota.org.extra_allocated.toLocaleString()}</p>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <ModelBreakdownCard title="My Models" data={personal.model_breakdown} icon={Activity} />
                <div className="glass-panel rounded-xl p-6 flex flex-col h-[320px]">
                  <h3 className="font-mono text-xs font-semibold tracking-[0.1em] text-on-surface uppercase mb-4 pb-4 border-b border-outline-variant/20 flex items-center gap-2">
                    <Activity className="w-4 h-4 text-primary" /> Recent Activity
                  </h3>
                  <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                    {personal.recent.length === 0 ? (
                      <p className="text-sm text-outline font-mono text-center mt-12">No recent activity</p>
                    ) : (
                      personal.recent.map((r, i) => (
                        <div key={i} className="flex justify-between items-center text-sm py-2 border-b border-outline-variant/10">
                          <span className="text-on-surface truncate max-w-[50%]">{r.model_identifier.split(".")[1] || r.model_identifier}</span>
                          <span className="font-mono text-xs text-outline">{r.tokens.toLocaleString()} tok</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* ── COMPANY SECTION (leader only) ── */}
          {isLeader && org && (
            <section>
              <h3 className="font-mono text-xs font-semibold tracking-[0.1em] text-outline uppercase mb-4 flex items-center gap-2">
                <Building2 className="w-4 h-4 text-tertiary" /> Company Usage
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
                <StatCard icon={Activity} label="Company Tokens" value={org.total_tokens.toLocaleString()} color="primary" />
                <StatCard icon={Users} label="Active Users" value={org.active_users.toLocaleString()} color="tertiary" />
                <StatCard icon={Activity} label="Company Calls" value={org.total_calls.toLocaleString()} color="secondary" />
                <StatCard icon={Wallet} label="Company Cost" value={`$${org.compute_cost.toFixed(2)}`} color="error" />
              </div>
              <ModelBreakdownCard title="Company Models" data={org.model_breakdown} icon={Building2} />
              {orgQuota && orgQuota.members.length > 0 && (
                <div className="mt-6 glass-panel rounded-xl p-6">
                  <h3 className="font-mono text-xs font-semibold tracking-[0.1em] text-on-surface uppercase mb-4 pb-4 border-b border-outline-variant/20 flex items-center gap-2">
                    <Users className="w-4 h-4 text-primary" /> Member Credits
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {orgQuota.members.map((m, i) => (
                      <div key={i} className="glass-panel rounded-xl p-4">
                        <div className="flex justify-between items-center mb-2">
                          <span className="font-mono text-xs text-outline uppercase">{m.name || m.email} ({m.role})</span>
                        </div>
                        <div className="flex justify-between items-center mb-1">
                          <span className="font-mono text-[10px] text-outline">Daily</span>
                          <span className="font-mono text-[10px] text-on-surface">{m.quota.daily_used} / {m.quota.daily_budget}</span>
                        </div>
                        {m.quota.extra_allocated > 0 && (
                          <div className="flex justify-between items-center">
                            <span className="font-mono text-[10px] text-outline">Extra</span>
                            <span className="font-mono text-[10px] text-on-surface">{m.quota.extra_remaining} / {m.quota.extra_allocated}</span>
                          </div>
                        )}
                        <p className="mt-1 font-mono text-[10px] text-outline/60 text-right">Total: {m.quota.total_available}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* ── GLOBAL SECTION (superadmin only) ── */}
          {isSuperadmin && globalData && (
            <section>
              <h3 className="font-mono text-xs font-semibold tracking-[0.1em] text-outline uppercase mb-4 flex items-center gap-2">
                <Crown className="w-4 h-4 text-secondary" /> Global Platform Usage
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-6 mb-6">
                <StatCard icon={Activity} label="Global Tokens" value={globalData.total_tokens.toLocaleString()} color="primary" />
                <StatCard icon={Activity} label="Global Calls" value={globalData.total_calls.toLocaleString()} color="secondary" />
                <StatCard icon={Users} label="Active Tenants" value={globalData.active_tenants.toLocaleString()} color="tertiary" />
                <StatCard icon={Users} label="Total Users" value={globalData.total_users.toLocaleString()} color="tertiary" />
                <StatCard icon={Wallet} label="Global Cost" value={`$${globalData.compute_cost.toFixed(2)}`} color="error" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <ModelBreakdownCard title="Global Models" data={globalData.model_breakdown} icon={Crown} />
                <div className="glass-panel rounded-xl p-6 flex flex-col h-[320px]">
                  <h3 className="font-mono text-xs font-semibold tracking-[0.1em] text-on-surface uppercase mb-4 pb-4 border-b border-outline-variant/20 flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-primary" /> Tenant Breakdown
                  </h3>
                  <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                    {globalData.tenant_breakdown.length === 0 ? (
                      <p className="text-sm text-outline font-mono text-center mt-12">No tenant data</p>
                    ) : (
                      globalData.tenant_breakdown.map((t, i) => (
                        <div key={i} className="flex justify-between items-center text-sm py-2 border-b border-outline-variant/10">
                          <span className="text-on-surface truncate max-w-[60%]">{t.company_name}</span>
                          <div className="flex gap-4 font-mono text-xs text-outline">
                            <span>{t.tokens.toLocaleString()} tok</span>
                            <span>{t.calls} calls</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </section>
          )}
        </div>
      )}
    </AppShell>
  );
}

"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Building2, Users, Plus, Trash2, Shield, Activity, Loader2,
  AlertTriangle, Mail, Crown, Wallet, X, Copy, Check, Link,
  Search, ChevronLeft, ChevronRight, ArrowUpDown,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import AppShell from "@/components/AppShell";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "@/hooks/useCurrentUser";

interface Company {
  id: string;
  company_name: string;
  tier: string;
  is_active: boolean;
  created_at: string;
  member_count: number;
  total_tokens: number;
  extra_token_pool: number;
}

interface AdminUser {
  id: string;
  display_name: string | null;
  role: string;
  is_platform_admin: boolean;
  tenant_name: string | null;
  tenant_id: string | null;
  created_at: string;
}

const PAGE_SIZE = 25;

export default function AdminPage() {
  const router = useRouter();
  const { user, loading: userLoading } = useCurrentUser();
  const [activeTab, setActiveTab] = useState<"companies" | "users">("companies");

  // Companies state
  const [companies, setCompanies] = useState<Company[]>([]);
  const [compTotal, setCompTotal] = useState(0);
  const [compPage, setCompPage] = useState(0);
  const [compSearch, setCompSearch] = useState("");
  const [compSort, setCompSort] = useState("created_at");
  const [compSortDir, setCompSortDir] = useState("desc");
  const [compLoading, setCompLoading] = useState(true);

  // Users state
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [userTotal, setUserTotal] = useState(0);
  const [userPage, setUserPage] = useState(0);
  const [userSearch, setUserSearch] = useState("");
  const [userRoleFilter, setUserRoleFilter] = useState("");
  const [usersLoading, setUsersLoading] = useState(true);

  // Modals
  const [showCreate, setShowCreate] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState("");
  const [newCompanyTier, setNewCompanyTier] = useState("standard");
  const [createLoading, setCreateLoading] = useState(false);
  const [assignCompanyId, setAssignCompanyId] = useState<string | null>(null);
  const [assignEmail, setAssignEmail] = useState("");
  const [assignLoading, setAssignLoading] = useState(false);
  const [generatedLink, setGeneratedLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  // Global stats
  const [globalStats, setGlobalStats] = useState({ totalCompanies: 0, totalUsers: 0, totalTokens: 0, totalCredits: 0 });

  const isSuperadmin = Boolean(user?.is_platform_admin || user?.role === "superadmin");

  const getToken = useCallback(async () => {
    const { data: sesh } = await supabase.auth.getSession();
    return sesh.session?.access_token || null;
  }, []);

  const fetchCompanies = useCallback(async () => {
    setCompLoading(true);
    try {
      const t = await getToken();
      if (!t) return;
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(compPage * PAGE_SIZE),
        sort_by: compSort,
        sort_dir: compSortDir,
      });
      if (compSearch) params.set("search", compSearch);
      const res = await fetch(`/api/admin/companies?${params}`, { headers: { Authorization: `Bearer ${t}` } });
      if (res.ok) {
        const data = await res.json();
        setCompanies(data.companies || []);
        setCompTotal(data.total || 0);
      }
    } catch { setError("Failed to load companies."); }
    finally { setCompLoading(false); }
  }, [compPage, compSearch, compSort, compSortDir, getToken]);

  const fetchUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const t = await getToken();
      if (!t) return;
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(userPage * PAGE_SIZE),
      });
      if (userSearch) params.set("search", userSearch);
      if (userRoleFilter) params.set("role", userRoleFilter);
      const res = await fetch(`/api/admin/users?${params}`, { headers: { Authorization: `Bearer ${t}` } });
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
        setUserTotal(data.total || 0);
      }
    } catch { setError("Failed to load users."); }
    finally { setUsersLoading(false); }
  }, [userPage, userSearch, userRoleFilter, getToken]);

  useEffect(() => {
    if (userLoading) return;
    if (!user) { router.push("/login"); return; }
    if (!isSuperadmin) { router.push("/dashboard"); return; }
  }, [userLoading, user, isSuperadmin, router]);

  useEffect(() => { if (isSuperadmin) fetchCompanies(); }, [fetchCompanies, isSuperadmin]);
  useEffect(() => { if (isSuperadmin && activeTab === "users") fetchUsers(); }, [fetchUsers, isSuperadmin, activeTab]);

  // Derive global stats from companies
  useEffect(() => {
    setGlobalStats({
      totalCompanies: compTotal,
      totalUsers: userTotal,
      totalTokens: companies.reduce((s, c) => s + (c.total_tokens || 0), 0),
      totalCredits: companies.reduce((s, c) => s + (c.extra_token_pool || 0), 0),
    });
  }, [companies, compTotal, userTotal]);

  async function handleCreateCompany(e: React.FormEvent) {
    e.preventDefault();
    if (!newCompanyName.trim()) return;
    setCreateLoading(true);
    try {
      const t = await getToken();
      if (!t) return;
      const res = await fetch("/api/admin/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({ company_name: newCompanyName.trim(), tier: newCompanyTier }),
      });
      if (res.ok) { setShowCreate(false); setNewCompanyName(""); fetchCompanies(); }
    } finally { setCreateLoading(false); }
  }

  async function handleAssignLeader(e: React.FormEvent) {
    e.preventDefault();
    if (!assignEmail.trim() || !assignCompanyId) return;
    setAssignLoading(true);
    try {
      const t = await getToken();
      if (!t) return;
      const res = await fetch(`/api/admin/companies/leader?tenantId=${encodeURIComponent(assignCompanyId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({ email: assignEmail.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setGeneratedLink(`${window.location.origin}/join?token=${data.token}`);
        setAssignEmail("");
      }
    } finally { setAssignLoading(false); }
  }

  async function handleDeleteUser(userId: string) {
    if (!confirm("Permanently delete this user? This cannot be undone.")) return;
    const t = await getToken();
    if (!t) return;
    const res = await fetch(`/api/admin/users?id=${encodeURIComponent(userId)}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${t}` },
    });
    if (res.ok) fetchUsers();
  }

  async function handleUpdateUserRole(userId: string, newRole: string) {
    const t = await getToken();
    if (!t) return;
    await fetch(`/api/admin/users?id=${encodeURIComponent(userId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
      body: JSON.stringify({ role: newRole }),
    });
    fetchUsers();
  }

  function toggleSort(field: string) {
    if (compSort === field) { setCompSortDir(compSortDir === "asc" ? "desc" : "asc"); }
    else { setCompSort(field); setCompSortDir("desc"); }
    setCompPage(0);
  }

  if (userLoading || !isSuperadmin) {
    return <AppShell><div className="flex justify-center items-center h-screen"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div></AppShell>;
  }

  const compPages = Math.ceil(compTotal / PAGE_SIZE);
  const userPages = Math.ceil(userTotal / PAGE_SIZE);

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Crown className="w-6 h-6 text-primary" />
            <div>
              <h1 className="text-2xl font-bold text-on-surface">Platform Admin</h1>
              <p className="text-sm text-outline font-mono">Manage {compTotal} companies · {userTotal} users</p>
            </div>
          </div>
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-mono bg-primary text-on-primary hover:bg-primary/90 transition-all">
            <Plus className="w-3.5 h-3.5" /> New Company
          </button>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Companies", value: compTotal, icon: Building2, color: "text-primary" },
            { label: "Users", value: userTotal, icon: Users, color: "text-secondary" },
            { label: "Tokens Used", value: globalStats.totalTokens, icon: Activity, color: "text-tertiary" },
            { label: "Credits in Pools", value: globalStats.totalCredits, icon: Wallet, color: "text-primary" },
          ].map((kpi) => (
            <div key={kpi.label} className="glass-panel rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <kpi.icon className={`w-4 h-4 ${kpi.color}`} />
                <span className="text-[10px] font-mono text-outline uppercase">{kpi.label}</span>
              </div>
              <p className="text-2xl font-bold text-on-surface">{kpi.value.toLocaleString()}</p>
            </div>
          ))}
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 bg-error/5 border border-error/20 rounded-lg text-error text-sm font-mono">
            <AlertTriangle className="w-4 h-4" />{error}
            <button onClick={() => setError("")} className="ml-auto"><X className="w-3 h-3" /></button>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-surface-container-low/50 rounded-lg border border-outline-variant/20 w-fit">
          {([["companies", "Companies", Building2], ["users", "All Users", Users]] as const).map(([key, label, Icon]) => (
            <button key={key} onClick={() => setActiveTab(key)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-mono transition-all ${activeTab === key ? "bg-surface-container-high text-on-surface shadow-sm" : "text-outline hover:text-on-surface"}`}>
              <Icon className="w-3.5 h-3.5" />{label}
              <span className="ml-1 text-[10px] opacity-60">({key === "companies" ? compTotal : userTotal})</span>
            </button>
          ))}
        </div>

        {/* Companies Tab */}
        {activeTab === "companies" && (
          <div className="glass-panel rounded-xl overflow-hidden">
            {/* Search + Sort Bar */}
            <div className="px-6 py-4 border-b border-outline-variant/20 flex flex-col md:flex-row md:items-center gap-3">
              <div className="relative flex-1 max-w-sm">
                <Search className="w-4 h-4 text-outline absolute left-3 top-2.5" />
                <input value={compSearch} onChange={(e) => { setCompSearch(e.target.value); setCompPage(0); }}
                  placeholder="Search companies..." className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-outline-variant/20 bg-surface-container-low/50 text-on-surface placeholder:text-outline-variant/40 focus:outline-none focus:border-primary" />
              </div>
              <div className="flex items-center gap-2 text-[10px] font-mono text-outline">
                Sort:
                {["company_name", "member_count", "total_tokens", "created_at"].map((f) => (
                  <button key={f} onClick={() => toggleSort(f)}
                    className={`px-2 py-1 rounded border transition-all ${compSort === f ? "border-primary/50 text-primary bg-primary/5" : "border-outline-variant/20 hover:border-primary/30"}`}>
                    {f.replace("_", " ")} {compSort === f && (compSortDir === "asc" ? "↑" : "↓")}
                  </button>
                ))}
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead className="bg-surface-container-high/30">
                  <tr>
                    <th className="px-6 py-3 text-left text-[11px] font-mono text-outline uppercase">Company</th>
                    <th className="px-4 py-3 text-left text-[11px] font-mono text-outline uppercase">Tier</th>
                    <th className="px-4 py-3 text-right text-[11px] font-mono text-outline uppercase">Members</th>
                    <th className="px-4 py-3 text-right text-[11px] font-mono text-outline uppercase">Tokens Used</th>
                    <th className="px-4 py-3 text-right text-[11px] font-mono text-outline uppercase">Credit Pool</th>
                    <th className="px-4 py-3 text-left text-[11px] font-mono text-outline uppercase">Status</th>
                    <th className="px-4 py-3 text-right text-[11px] font-mono text-outline uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/10">
                  {compLoading ? (
                    <tr><td colSpan={7} className="px-6 py-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-primary" /></td></tr>
                  ) : companies.length === 0 ? (
                    <tr><td colSpan={7} className="px-6 py-8 text-center text-sm text-outline font-mono">No companies found.</td></tr>
                  ) : companies.map((comp) => (
                    <tr key={comp.id} className="hover:bg-surface-container-high/10 transition-colors cursor-pointer" onClick={() => router.push(`/admin/companies/${comp.id}`)}>
                      <td className="px-6 py-3">
                        <p className="text-sm font-medium text-on-surface">{comp.company_name}</p>
                        <p className="text-[10px] font-mono text-outline-variant">{new Date(comp.created_at).toLocaleDateString()}</p>
                      </td>
                      <td className="px-4 py-3"><span className="text-[10px] font-mono px-2 py-0.5 rounded border border-outline-variant/30 uppercase">{comp.tier}</span></td>
                      <td className="px-4 py-3 text-right text-sm font-mono text-on-surface">{comp.member_count}</td>
                      <td className="px-4 py-3 text-right text-sm font-mono text-on-surface">{(comp.total_tokens || 0).toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-sm font-mono text-primary">{(comp.extra_token_pool || 0).toLocaleString()}</td>
                      <td className="px-4 py-3"><span className={`text-[10px] font-mono px-2 py-0.5 rounded ${comp.is_active ? "bg-secondary/10 text-secondary" : "bg-error/10 text-error"}`}>{comp.is_active ? "Active" : "Suspended"}</span></td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={(e) => { e.stopPropagation(); setAssignCompanyId(comp.id); }}
                          className="text-[10px] font-mono text-primary border border-primary/30 px-2 py-1 rounded hover:bg-primary/10 transition-colors">
                          <Mail className="w-3 h-3 inline mr-1" />Invite
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {compPages > 1 && (
              <div className="px-6 py-3 border-t border-outline-variant/20 flex items-center justify-between">
                <span className="text-xs font-mono text-outline">Page {compPage + 1} of {compPages} ({compTotal} total)</span>
                <div className="flex items-center gap-2">
                  <button disabled={compPage === 0} onClick={() => setCompPage(compPage - 1)} className="p-1.5 rounded border border-outline-variant/20 disabled:opacity-30 hover:border-primary/40 transition-colors"><ChevronLeft className="w-4 h-4" /></button>
                  <button disabled={compPage >= compPages - 1} onClick={() => setCompPage(compPage + 1)} className="p-1.5 rounded border border-outline-variant/20 disabled:opacity-30 hover:border-primary/40 transition-colors"><ChevronRight className="w-4 h-4" /></button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Users Tab */}
        {activeTab === "users" && (
          <div className="glass-panel rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-outline-variant/20 flex flex-col md:flex-row md:items-center gap-3">
              <div className="relative flex-1 max-w-sm">
                <Search className="w-4 h-4 text-outline absolute left-3 top-2.5" />
                <input value={userSearch} onChange={(e) => { setUserSearch(e.target.value); setUserPage(0); }}
                  placeholder="Search by name or company..." className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-outline-variant/20 bg-surface-container-low/50 text-on-surface placeholder:text-outline-variant/40 focus:outline-none focus:border-primary" />
              </div>
              <select value={userRoleFilter} onChange={(e) => { setUserRoleFilter(e.target.value); setUserPage(0); }}
                className="px-3 py-2 text-xs font-mono rounded-lg border border-outline-variant/20 bg-surface-container-low/50 text-on-surface focus:outline-none focus:border-primary">
                <option value="">All roles</option>
                <option value="superadmin">Superadmin</option>
                <option value="leader">Leader</option>
                <option value="member">Member</option>
              </select>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead className="bg-surface-container-high/30">
                  <tr>
                    <th className="px-6 py-3 text-left text-[11px] font-mono text-outline uppercase">User</th>
                    <th className="px-4 py-3 text-left text-[11px] font-mono text-outline uppercase">Company</th>
                    <th className="px-4 py-3 text-left text-[11px] font-mono text-outline uppercase">Role</th>
                    <th className="px-4 py-3 text-left text-[11px] font-mono text-outline uppercase">Joined</th>
                    <th className="px-4 py-3 text-right text-[11px] font-mono text-outline uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/10">
                  {usersLoading ? (
                    <tr><td colSpan={5} className="px-6 py-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-primary" /></td></tr>
                  ) : users.length === 0 ? (
                    <tr><td colSpan={5} className="px-6 py-8 text-center text-sm text-outline font-mono">No users found.</td></tr>
                  ) : users.map((u) => (
                    <tr key={u.id} className="hover:bg-surface-container-high/10 transition-colors">
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-2">
                          <Shield className={`w-4 h-4 flex-shrink-0 ${u.is_platform_admin ? "text-primary" : "text-outline-variant/40"}`} />
                          <p className="text-sm text-on-surface">{u.display_name || "Unnamed"}</p>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm font-mono text-outline">{u.tenant_name || "—"}</td>
                      <td className="px-4 py-3">
                        <select value={u.is_platform_admin ? "superadmin" : u.role} onChange={(e) => handleUpdateUserRole(u.id, e.target.value)}
                          className="bg-surface-container-low/50 border border-outline-variant/20 rounded px-2 py-1 text-xs font-mono text-on-surface focus:outline-none focus:border-primary">
                          <option value="superadmin">Superadmin</option>
                          <option value="leader">Leader</option>
                          <option value="member">Member</option>
                        </select>
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-outline">{new Date(u.created_at).toLocaleDateString()}</td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => handleDeleteUser(u.id)} className="text-outline-variant hover:text-error transition-colors p-1 rounded hover:bg-error/10" title="Delete user">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {userPages > 1 && (
              <div className="px-6 py-3 border-t border-outline-variant/20 flex items-center justify-between">
                <span className="text-xs font-mono text-outline">Page {userPage + 1} of {userPages} ({userTotal} total)</span>
                <div className="flex items-center gap-2">
                  <button disabled={userPage === 0} onClick={() => setUserPage(userPage - 1)} className="p-1.5 rounded border border-outline-variant/20 disabled:opacity-30 hover:border-primary/40 transition-colors"><ChevronLeft className="w-4 h-4" /></button>
                  <button disabled={userPage >= userPages - 1} onClick={() => setUserPage(userPage + 1)} className="p-1.5 rounded border border-outline-variant/20 disabled:opacity-30 hover:border-primary/40 transition-colors"><ChevronRight className="w-4 h-4" /></button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Create Company Modal */}
        {showCreate && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="glass-panel rounded-xl w-full max-w-md p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-on-surface">Create Company</h3>
                <button onClick={() => setShowCreate(false)} className="text-outline-variant hover:text-on-surface"><X className="w-5 h-5" /></button>
              </div>
              <form onSubmit={handleCreateCompany} className="space-y-3">
                <div>
                  <label className="text-xs font-mono text-outline-variant uppercase">Company Name</label>
                  <input value={newCompanyName} onChange={(e) => setNewCompanyName(e.target.value)} placeholder="Acme Corp" required
                    className="w-full mt-1 bg-surface-container-low/50 border border-outline-variant/20 rounded-lg px-3 py-2 text-sm text-on-surface placeholder:text-outline-variant/40 focus:outline-none focus:border-primary" />
                </div>
                <div>
                  <label className="text-xs font-mono text-outline-variant uppercase">Tier</label>
                  <select value={newCompanyTier} onChange={(e) => setNewCompanyTier(e.target.value)}
                    className="w-full mt-1 bg-surface-container-low/50 border border-outline-variant/20 rounded-lg px-3 py-2 text-sm font-mono text-on-surface focus:outline-none focus:border-primary">
                    <option value="standard">Standard</option>
                    <option value="premium">Premium</option>
                    <option value="enterprise">Enterprise</option>
                  </select>
                </div>
                <button type="submit" disabled={createLoading}
                  className="w-full py-2.5 rounded-lg text-sm font-mono bg-primary text-on-primary hover:bg-primary/90 disabled:opacity-40 transition-all">
                  {createLoading ? "Creating..." : "Create Company"}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* Assign Leader Modal */}
        {assignCompanyId && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="glass-panel rounded-xl w-full max-w-md p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-on-surface">Invite Leader</h3>
                <button onClick={() => { setAssignCompanyId(null); setGeneratedLink(""); }} className="text-outline-variant hover:text-on-surface"><X className="w-5 h-5" /></button>
              </div>
              <form onSubmit={handleAssignLeader} className="space-y-3">
                <div>
                  <label className="text-xs font-mono text-outline-variant uppercase">Leader Email</label>
                  <input type="email" value={assignEmail} onChange={(e) => setAssignEmail(e.target.value)} placeholder="leader@company.com" required
                    className="w-full mt-1 bg-surface-container-low/50 border border-outline-variant/20 rounded-lg px-3 py-2 text-sm text-on-surface placeholder:text-outline-variant/40 focus:outline-none focus:border-primary" />
                </div>
                <p className="text-xs font-mono text-outline">An invite link will be generated. The user becomes org leader upon accepting.</p>
                <button type="submit" disabled={assignLoading}
                  className="w-full py-2.5 rounded-lg text-sm font-mono bg-primary text-on-primary hover:bg-primary/90 disabled:opacity-40 transition-all">
                  {assignLoading ? "Generating..." : "Generate Invite Link"}
                </button>
              </form>
              {generatedLink && (
                <div className="flex items-center gap-2 p-3 bg-secondary/5 border border-secondary/20 rounded-lg">
                  <Link className="w-4 h-4 text-secondary flex-shrink-0" />
                  <input readOnly value={generatedLink} className="flex-1 bg-transparent text-xs font-mono text-on-surface focus:outline-none truncate" />
                  <button onClick={() => { navigator.clipboard.writeText(generatedLink); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                    className="flex items-center gap-1 text-[10px] font-mono text-secondary border border-secondary/30 px-2 py-1 rounded hover:bg-secondary/10 transition-colors flex-shrink-0">
                    {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}{copied ? "Copied" : "Copy"}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

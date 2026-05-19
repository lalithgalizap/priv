"use client";

import { useEffect, useState } from "react";
import {
  Building2,
  Users,
  Plus,
  Trash2,
  Shield,
  Activity,
  Loader2,
  AlertTriangle,
  Mail,
  Crown,
  ChevronRight,
  Wallet,
  X,
  Copy,
  Check,
  Link,
  BarChart3,
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
  created_at: string;
}

export default function AdminPage() {
  const router = useRouter();
  const { user, loading: userLoading } = useCurrentUser();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [showCreate, setShowCreate] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState("");
  const [newCompanyTier, setNewCompanyTier] = useState("standard");
  const [createLoading, setCreateLoading] = useState(false);

  const [assignCompanyId, setAssignCompanyId] = useState<string | null>(null);
  const [assignEmail, setAssignEmail] = useState("");
  const [assignLoading, setAssignLoading] = useState(false);
  const [generatedLink, setGeneratedLink] = useState("");
  const [copied, setCopied] = useState(false);

  const [activeTab, setActiveTab] = useState<"companies" | "users">("companies");
  const [addingExtraTokens, setAddingExtraTokens] = useState<string | null>(null);
  const [extraTokensInput, setExtraTokensInput] = useState("");

  async function fetchAdminData() {
    setError("");
    try {
      const { data: sesh } = await supabase.auth.getSession();
      const t = sesh.session?.access_token;
      if (!t) {
        router.push("/login");
        return;
      }

      const [compRes, userRes] = await Promise.all([
        fetch("/api/admin/companies", { headers: { Authorization: `Bearer ${t}` } }),
        fetch("/api/admin/users", { headers: { Authorization: `Bearer ${t}` } }),
      ]);

      if (compRes.ok) {
        const c = await compRes.json();
        setCompanies(c.companies || []);
      }
      if (userRes.ok) {
        const u = await userRes.json();
        setUsers(u.users || []);
      }
    } catch {
      setError("Failed to load admin data.");
    } finally {
      setLoading(false);
    }
  }

  const isSuperadmin = Boolean(user?.is_platform_admin || user?.role === "superadmin");

  useEffect(() => {
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
    fetchAdminData();
  }, [userLoading, user?.id, isSuperadmin]);

  async function handleCreateCompany(e: React.FormEvent) {
    e.preventDefault();
    if (!newCompanyName.trim()) return;
    setCreateLoading(true);
    try {
      const { data: sesh } = await supabase.auth.getSession();
      const t = sesh.session?.access_token;
      if (!t) return;
      const res = await fetch("/api/admin/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({ company_name: newCompanyName.trim(), tier: newCompanyTier }),
      });
      if (res.ok) {
        const newComp = await res.json();
        setCompanies((prev) => [newComp, ...prev]);
        setNewCompanyName("");
        setShowCreate(false);
      }
    } catch {
      /* ignore */
    } finally {
      setCreateLoading(false);
    }
  }

  async function handleAssignLeader(e: React.FormEvent) {
    e.preventDefault();
    if (!assignEmail.trim() || !assignCompanyId) return;
    setAssignLoading(true);
    try {
      const { data: sesh } = await supabase.auth.getSession();
      const t = sesh.session?.access_token;
      if (!t) return;
      const res = await fetch(`/api/admin/companies/leader?tenantId=${encodeURIComponent(assignCompanyId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({ email: assignEmail.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        const link = `${window.location.origin}/join?token=${data.token}`;
        setGeneratedLink(link);
        setAssignEmail("");
      }
    } catch {
      /* ignore */
    } finally {
      setAssignLoading(false);
    }
  }

  async function handleDeleteUser(userId: string) {
    if (!confirm("Delete this user permanently?")) return;
    try {
      const { data: sesh } = await supabase.auth.getSession();
      const t = sesh.session?.access_token;
      if (!t) return;
      const res = await fetch(`/api/admin/users?id=${encodeURIComponent(userId)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${t}` },
      });
      if (res.ok) {
        setUsers((prev) => prev.filter((u) => u.id !== userId));
      }
    } catch {
      /* ignore */
    }
  }

  async function handleUpdateUserRole(userId: string, newRole: string) {
    try {
      const { data: sesh } = await supabase.auth.getSession();
      const t = sesh.session?.access_token;
      if (!t) return;
      const res = await fetch(`/api/admin/users?id=${encodeURIComponent(userId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({ role: newRole }),
      });
      if (res.ok) {
        setUsers((prev) =>
          prev.map((u) =>
            u.id === userId ? { ...u, role: newRole, is_platform_admin: newRole === "superadmin" } : u
          )
        );
      }
    } catch {
      /* ignore */
    }
  }

  if (loading) {
    return (
      <AppShell>
        <div className="flex justify-center items-center h-screen">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      </AppShell>
    );
  }

  if (!isSuperadmin) return null;

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Crown className="w-6 h-6 text-primary" />
            <div>
              <h1 className="text-2xl font-bold text-on-surface">Platform Admin</h1>
              <p className="text-sm text-outline font-mono">Manage companies and users globally.</p>
            </div>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-mono bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            New Company
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 bg-error/5 border border-error/20 rounded-lg text-error text-sm font-mono">
            <AlertTriangle className="w-4 h-4" />
            {error}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-surface-container-low/50 rounded-lg border border-outline-variant/20 w-fit">
          {[
            { key: "companies" as const, label: "Companies", icon: Building2 },
            { key: "users" as const, label: "All Users", icon: Users },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-mono transition-all ${
                activeTab === tab.key
                  ? "bg-surface-container-high text-on-surface shadow-sm"
                  : "text-outline hover:text-on-surface"
              }`}
            >
              <tab.icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Companies Tab */}
        {activeTab === "companies" && (
          <div className="glass-panel rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-outline-variant/20 flex items-center justify-between">
              <h3 className="font-mono text-xs font-semibold tracking-[0.1em] text-on-surface uppercase">
                Companies
              </h3>
              <span className="text-xs text-outline font-mono">{companies.length} total</span>
            </div>
            <div className="divide-y divide-outline-variant/10">
              {companies.map((comp) => (
                <a
                  key={comp.id}
                  href={`/admin/companies/${comp.id}`}
                  className="px-6 py-4 hover:bg-surface-container-high/20 transition-colors block"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <Building2 className="w-5 h-5 text-primary/60" />
                      <div>
                        <p className="text-sm font-medium text-on-surface">{comp.company_name}</p>
                        <p className="text-[10px] font-mono text-outline-variant uppercase">{comp.tier}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${comp.is_active ? "bg-secondary/10 text-secondary border-secondary/30" : "bg-error/10 text-error border-error/30"}`}>
                        {comp.is_active ? "Active" : "Suspended"}
                      </span>
                      <span className="text-[10px] font-mono text-outline-variant">
                        Pool: {comp.extra_token_pool?.toLocaleString() || 0} extra credits
                      </span>
                      {addingExtraTokens === comp.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            value={extraTokensInput}
                            onChange={(e) => setExtraTokensInput(e.target.value)}
                            placeholder="Amount"
                            className="w-20 bg-surface-container-low/50 border border-outline-variant/20 rounded px-2 py-1 text-[10px] font-mono text-on-surface focus:outline-none focus:border-primary"
                            min={1}
                          />
                          <button
                            onClick={async (e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              const amount = parseInt(extraTokensInput, 10);
                              if (!amount || amount <= 0) { setAddingExtraTokens(null); return; }
                              const { data: sesh } = await supabase.auth.getSession();
                              const tok = sesh.session?.access_token;
                              if (!tok) return;
                              const res = await fetch(`/api/admin/companies/${comp.id}/add-tokens`, {
                                method: "POST",
                                headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
                                body: JSON.stringify({ amount }),
                              });
                              if (res.ok) {
                                await fetchAdminData();
                              } else {
                                const errData = await res.json().catch(() => ({}));
                                setError(errData.detail || "Failed to add extra credits.");
                              }
                              setAddingExtraTokens(null);
                              setExtraTokensInput("");
                            }}
                            className="text-primary hover:text-secondary transition-colors p-1"
                          >
                            <Check className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setAddingExtraTokens(comp.id);
                            setExtraTokensInput("");
                          }}
                          className="flex items-center gap-1 text-[10px] font-mono text-secondary border border-secondary/30 px-2 py-1 rounded hover:border-secondary/60 hover:text-secondary transition-colors"
                        >
                          <Activity className="w-3 h-3" />
                          Add extra
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setAssignCompanyId(comp.id);
                        }}
                        className="flex items-center gap-1 text-[10px] font-mono text-primary border border-primary/30 px-2 py-1 rounded hover:bg-primary/10 transition-colors"
                      >
                        <Mail className="w-3 h-3" />
                        Assign Leader
                      </button>
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          router.push(`/admin/companies/${comp.id}`);
                        }}
                        className="flex items-center gap-1 text-[10px] font-mono text-outline border border-outline-variant/40 px-2 py-1 rounded hover:border-primary/60 hover:text-primary transition-colors"
                      >
                        <BarChart3 className="w-3 h-3" />
                        View details
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-6 text-xs font-mono text-outline-variant mb-2">
                    <span className="flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      {comp.member_count} members
                    </span>
                    <span className="flex items-center gap-1">
                      <Activity className="w-3 h-3" />
                      {comp.total_tokens?.toLocaleString() || 0} total tokens used
                    </span>
                    <span className="flex items-center gap-1 text-secondary">
                      <Shield className="w-3 h-3" />
                      {comp.extra_token_pool?.toLocaleString() || 0} extra credits
                    </span>
                    <span className="flex items-center gap-1">
                      <Wallet className="w-3 h-3" />
                      {comp.extra_token_pool?.toLocaleString() || 0} credits in org pool
                    </span>
                  </div>
                </a>
              ))}
              {companies.length === 0 && (
                <div className="px-6 py-8 text-center text-sm text-outline font-mono">
                  No companies yet. Create one to get started.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Users Tab */}
        {activeTab === "users" && (
          <div className="glass-panel rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-outline-variant/20 flex items-center justify-between">
              <h3 className="font-mono text-xs font-semibold tracking-[0.1em] text-on-surface uppercase">
                All Users
              </h3>
              <span className="text-xs text-outline font-mono">{users.length} total</span>
            </div>
            <div className="divide-y divide-outline-variant/10">
              {users.map((u) => (
                <div
                  key={u.id}
                  className="px-6 py-3 flex items-center justify-between hover:bg-surface-container-high/20 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Shield className={`w-4 h-4 flex-shrink-0 ${u.is_platform_admin ? "text-primary" : "text-outline-variant"}`} />
                    <div className="min-w-0">
                      <p className="text-sm text-on-surface truncate">{u.display_name || "Unnamed"}</p>
                      <p className="text-[10px] font-mono text-outline-variant">
                        {u.tenant_name || "No company"} · {u.is_platform_admin ? "superadmin" : u.role}
                        {u.is_platform_admin && " · PLATFORM ADMIN"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <select
                      value={u.is_platform_admin ? "superadmin" : u.role}
                      onChange={(e) => handleUpdateUserRole(u.id, e.target.value)}
                      className="bg-surface-container-low/50 border border-outline-variant/20 rounded px-2 py-1 text-xs font-mono text-on-surface focus:outline-none focus:border-primary"
                    >
                      <option value="superadmin">Superadmin</option>
                      <option value="leader">Leader</option>
                      <option value="member">Member</option>
                    </select>
                    <button
                      onClick={() => handleDeleteUser(u.id)}
                      className="text-outline-variant hover:text-error transition-colors p-1 rounded hover:bg-error/10"
                      title="Delete user"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
              {users.length === 0 && (
                <div className="px-6 py-8 text-center text-sm text-outline font-mono">
                  No users found.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Create Company Modal */}
        {showCreate && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="glass-panel rounded-xl w-full max-w-md p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-on-surface">Create Company</h3>
                <button onClick={() => setShowCreate(false)} className="text-outline-variant hover:text-on-surface">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <form onSubmit={handleCreateCompany} className="space-y-3">
                <div>
                  <label className="text-xs font-mono text-outline-variant uppercase">Company Name</label>
                  <input
                    value={newCompanyName}
                    onChange={(e) => setNewCompanyName(e.target.value)}
                    placeholder="Acme Corp"
                    required
                    className="w-full mt-1 bg-surface-container-low/50 border border-outline-variant/20 rounded-lg px-3 py-2 text-sm text-on-surface placeholder:text-outline-variant/40 focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="text-xs font-mono text-outline-variant uppercase">Tier</label>
                  <select
                    value={newCompanyTier}
                    onChange={(e) => setNewCompanyTier(e.target.value)}
                    className="w-full mt-1 bg-surface-container-low/50 border border-outline-variant/20 rounded-lg px-3 py-2 text-sm font-mono text-on-surface focus:outline-none focus:border-primary"
                  >
                    <option value="standard">Standard</option>
                    <option value="premium">Premium</option>
                    <option value="enterprise">Enterprise</option>
                  </select>
                </div>
                <button
                  type="submit"
                  disabled={createLoading}
                  className="w-full py-2 rounded-lg text-xs font-mono bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 disabled:opacity-40 transition-all"
                >
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
                <h3 className="text-lg font-semibold text-on-surface">Assign Leader</h3>
                <button onClick={() => { setAssignCompanyId(null); setGeneratedLink(""); }} className="text-outline-variant hover:text-on-surface">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <form onSubmit={handleAssignLeader} className="space-y-3">
                <div>
                  <label className="text-xs font-mono text-outline-variant uppercase">Leader Email</label>
                  <input
                    type="email"
                    value={assignEmail}
                    onChange={(e) => setAssignEmail(e.target.value)}
                    placeholder="leader@company.com"
                    required
                    className="w-full mt-1 bg-surface-container-low/50 border border-outline-variant/20 rounded-lg px-3 py-2 text-sm text-on-surface placeholder:text-outline-variant/40 focus:outline-none focus:border-primary"
                  />
                </div>
                <p className="text-xs font-mono text-outline">
                  An invite link will be sent. They will become the org leader upon signup.
                </p>
                <button
                  type="submit"
                  disabled={assignLoading}
                  className="w-full py-2 rounded-lg text-xs font-mono bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 disabled:opacity-40 transition-all"
                >
                  {assignLoading ? "Generating..." : "Generate Invite Link"}
                </button>
              </form>
              {generatedLink && (
                <div className="mt-3 flex items-center gap-2 p-3 bg-secondary/5 border border-secondary/20 rounded-lg">
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
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

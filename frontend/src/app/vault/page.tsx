"use client";

import { useState, useEffect } from "react";
import { Shield, Check, AlertTriangle, Save, RotateCcw, Lock, Eye, EyeOff, KeyRound, Cpu, Key, Copy, Trash2, User, X } from "lucide-react";
import AppShell from "@/components/AppShell";
import { supabase } from "@/lib/supabase";
import { useCurrentUser } from "@/hooks/useCurrentUser";

const AVAILABLE_MODELS = [
  { id: "moonshotai.kimi-k2.5", label: "Kimi K2.5", provider: "AWS Bedrock" },
  { id: "anthropic.claude-3-sonnet-20240229-v1:0", label: "Claude 3 Sonnet", provider: "AWS Bedrock" },
  { id: "anthropic.claude-3-haiku-20240307-v1:0", label: "Claude 3 Haiku", provider: "AWS Bedrock" },
  { id: "meta.llama3-70b-instruct-v1:0", label: "Llama 3 70B", provider: "AWS Bedrock" },
  { id: "mistral.mistral-large-2402-v1:0", label: "Mistral Large", provider: "AWS Bedrock" },
  { id: "amazon.titan-text-premier-v1:0", label: "Titan Text Premier", provider: "AWS Bedrock" },
];

const SELECTED_MODEL_KEY = "anonymizer_selected_model";

interface PiiRule {
  id: string;
  label: string;
  enabled: boolean;
  description: string;
}

const DEFAULT_PII_RULES: PiiRule[] = [
  { id: "email", label: "Email Addresses", enabled: true, description: "user@example.com" },
  { id: "phone", label: "Phone Numbers", enabled: true, description: "+1 (555) 123-4567" },
  { id: "ssn", label: "Social Security / National IDs", enabled: true, description: "123-45-6789" },
  { id: "credit_card", label: "Credit Card Numbers", enabled: true, description: "4532-****-****-1234" },
  { id: "name", label: "Person Names", enabled: true, description: "John Doe, Jane Smith" },
  { id: "address", label: "Street Addresses", enabled: true, description: "123 Main St, Anytown" },
  { id: "ip", label: "IP Addresses", enabled: true, description: "192.168.1.1" },
  { id: "url", label: "URLs with Credentials", enabled: true, description: "https://user:pass@host.com" },
];

const VAULT_KEY = "anonymizer_vault_config";

interface VaultConfig {
  piiRules: PiiRule[];
  systemPrompt: string;
  maxTokens: number;
}

function loadConfig(): VaultConfig {
  try {
    const raw = localStorage.getItem(VAULT_KEY);
    if (!raw) return { piiRules: DEFAULT_PII_RULES, systemPrompt: "", maxTokens: 1024 };
    return JSON.parse(raw);
  } catch {
    return { piiRules: DEFAULT_PII_RULES, systemPrompt: "", maxTokens: 1024 };
  }
}

function saveConfig(config: VaultConfig) {
  localStorage.setItem(VAULT_KEY, JSON.stringify(config));
}

interface ApiKey {
  id: string;
  name: string;
  key_preview: string;
  scopes: string[];
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
}

export default function VaultPage() {
  const [config, setConfig] = useState<VaultConfig>(loadConfig());
  const [saved, setSaved] = useState(false);
  const [apiStatus, setApiStatus] = useState<"checking" | "online" | "offline">("checking");
  const [activeModel, setActiveModel] = useState(() => {
    try {
      const saved = localStorage.getItem(SELECTED_MODEL_KEY);
      return saved && AVAILABLE_MODELS.some((m) => m.id === saved) ? saved : AVAILABLE_MODELS[0].id;
    } catch {
      return AVAILABLE_MODELS[0].id;
    }
  });

  const { user, loading: userLoading } = useCurrentUser();
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [keyError, setKeyError] = useState("");
  const [mounted, setMounted] = useState(false);
  const userRole = user?.role ?? null;
  const isAdmin = userRole === "owner" || userRole === "admin" || Boolean(user?.is_platform_admin);

  const activeModelLabel = AVAILABLE_MODELS.find((m) => m.id === activeModel)?.label || activeModel;

  useEffect(() => {
    setMounted(true);
  }, []);

  // Fetch user role and API keys
  useEffect(() => {
    if (!mounted) return;
    if (userLoading) return;
    if (!user) return;
    const getKeys = async () => {
      try {
        const { data: sesh } = await supabase.auth.getSession();
        const t = sesh.session?.access_token;
        if (!t) return;
        const keysRes = await fetch("/api/keys", { headers: { Authorization: `Bearer ${t}` } });
        if (keysRes.ok) {
          const keysData = await keysRes.json();
          setApiKeys(keysData.keys || []);
        }
      } catch {
        /* ignore */
      }
    };
    getKeys();
  }, [mounted, userLoading, user?.id]);

  async function handleCreateKey() {
    if (!newKeyName.trim() || !isAdmin) return;
    setKeyError("");
    try {
      const { data: sesh } = await supabase.auth.getSession();
      const t = sesh.session?.access_token;
      if (!t) return;
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({ name: newKeyName.trim() }),
      });
      if (!res.ok) {
        const err = await res.json();
        setKeyError(err.error || "Failed to create key.");
        return;
      }
      const data = await res.json();
      setCreatedKey(data.key);
      setNewKeyName("");
      // Refresh list
      const listRes = await fetch("/api/keys", { headers: { Authorization: `Bearer ${t}` } });
      if (listRes.ok) {
        const listData = await listRes.json();
        setApiKeys(listData.keys || []);
      }
    } catch {
      setKeyError("Network error.");
    }
  }

  async function handleRevokeKey(id: string) {
    if (!isAdmin) return;
    try {
      const { data: sesh } = await supabase.auth.getSession();
      const t = sesh.session?.access_token;
      if (!t) return;
      const res = await fetch(`/api/keys?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${t}` },
      });
      if (res.ok) {
        setApiKeys((prev) => prev.filter((k) => k.id !== id));
      }
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    // Check backend health
    fetch("http://127.0.0.1:8000/health", { method: "GET" })
      .then((r) => r.ok ? setApiStatus("online") : setApiStatus("offline"))
      .catch(() => setApiStatus("offline"));
  }, []);

  const toggleRule = (id: string) => {
    setConfig((prev) => ({
      ...prev,
      piiRules: prev.piiRules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)),
    }));
    setSaved(false);
  };

  const handleSave = () => {
    saveConfig(config);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleReset = () => {
    const fresh = { piiRules: DEFAULT_PII_RULES, systemPrompt: "", maxTokens: 1024 };
    setConfig(fresh);
    saveConfig(fresh);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const enabledCount = config.piiRules.filter((r) => r.enabled).length;

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Header */}
        <div>
          <h2 className="text-3xl font-bold text-on-surface mb-2 tracking-tight flex items-center gap-3">
            <Shield className="w-7 h-7 text-primary" />
            Security Vault
          </h2>
          <p className="text-on-surface-variant font-mono text-sm">
            Configure anonymization rules, model behavior, and system settings.
          </p>
        </div>

        {/* Status Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-surface-container/40 border border-outline-variant/20 rounded-xl p-4 flex items-center gap-4">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
              apiStatus === "online" ? "bg-secondary/10 text-secondary" : apiStatus === "offline" ? "bg-error/10 text-error" : "bg-primary/10 text-primary"
            }`}>
              {apiStatus === "online" ? <Check className="w-5 h-5" /> : apiStatus === "offline" ? <AlertTriangle className="w-5 h-5" /> : <RotateCcw className="w-5 h-5 animate-spin" />}
            </div>
            <div>
              <p className="text-xs font-mono text-outline-variant uppercase">Backend</p>
              <p className="text-sm font-semibold text-on-surface capitalize">{apiStatus}</p>
            </div>
          </div>

          <div className="bg-surface-container/40 border border-outline-variant/20 rounded-xl p-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-mono text-outline-variant uppercase">PII Rules Active</p>
              <p className="text-sm font-semibold text-on-surface">{enabledCount} / {config.piiRules.length}</p>
            </div>
          </div>

          <div className="bg-surface-container/40 border border-outline-variant/20 rounded-xl p-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-mono text-outline-variant uppercase">Model</p>
              <p className="text-sm font-semibold text-on-surface">{activeModelLabel}</p>
            </div>
          </div>
        </div>

        {/* Model Selector */}
        <div className="bg-surface-container/40 border border-outline-variant/20 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-outline-variant/20">
            <h3 className="text-lg font-semibold text-on-surface">Available Models</h3>
            <p className="text-xs text-on-surface-variant font-mono mt-1">Select the active AI model for mediation. All models route through AWS Bedrock.</p>
          </div>
          <div className="divide-y divide-outline-variant/10">
            {AVAILABLE_MODELS.map((m) => (
              <button
                key={m.id}
                onClick={() => {
                  setActiveModel(m.id);
                  localStorage.setItem(SELECTED_MODEL_KEY, m.id);
                }}
                className={`w-full px-6 py-3 flex items-center justify-between transition-colors text-left ${
                  m.id === activeModel ? "bg-primary/5" : "hover:bg-surface-container-high/20"
                }`}
              >
                <div className="flex items-center gap-3">
                  <Cpu className={`w-4 h-4 ${m.id === activeModel ? "text-primary" : "text-outline-variant"}`} />
                  <div>
                    <p className={`text-sm font-medium ${m.id === activeModel ? "text-primary" : "text-on-surface"}`}>
                      {m.label}
                    </p>
                    <p className="text-xs text-outline-variant font-mono">{m.provider}</p>
                  </div>
                </div>
                {m.id === activeModel && (
                  <span className="text-[10px] font-mono text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded">
                    ACTIVE
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* PII Rules Section */}
        <div className="bg-surface-container/40 border border-outline-variant/20 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-outline-variant/20 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-on-surface">PII Redaction Rules</h3>
              <p className="text-xs text-on-surface-variant font-mono mt-1">Toggle which data types are anonymized before reaching the AI model.</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleReset}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono text-outline-variant hover:text-on-surface hover:bg-surface-variant/30 transition-all"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset
              </button>
              <button
                onClick={handleSave}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono transition-all ${
                  saved
                    ? "bg-secondary/10 text-secondary border border-secondary/30"
                    : "bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20"
                }`}
              >
                {saved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
                {saved ? "Saved" : "Save"}
              </button>
            </div>
          </div>
          <div className="divide-y divide-outline-variant/10">
            {config.piiRules.map((rule) => (
              <div
                key={rule.id}
                className="px-6 py-3 flex items-center justify-between hover:bg-surface-container-high/20 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => toggleRule(rule.id)}
                    className={`w-9 h-5 rounded-full transition-all relative ${
                      rule.enabled ? "bg-primary" : "bg-outline-variant/40"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-on-primary shadow-sm transition-all ${
                        rule.enabled ? "left-4.5" : "left-0.5"
                      }`}
                      style={{ left: rule.enabled ? "18px" : "2px" }}
                    />
                  </button>
                  <div>
                    <p className={`text-sm font-medium ${rule.enabled ? "text-on-surface" : "text-outline"}`}>
                      {rule.label}
                    </p>
                    <p className="text-xs text-outline-variant font-mono">Example: {rule.description}</p>
                  </div>
                </div>
                {rule.enabled ? (
                  <Eye className="w-4 h-4 text-primary opacity-60" />
                ) : (
                  <EyeOff className="w-4 h-4 text-outline-variant opacity-40" />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Model Settings */}
        <div className="bg-surface-container/40 border border-outline-variant/20 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-outline-variant/20">
            <h3 className="text-lg font-semibold text-on-surface">Model Settings</h3>
            <p className="text-xs text-on-surface-variant font-mono mt-1">Configure AI model behavior and response parameters.</p>
          </div>
          <div className="px-6 py-4 space-y-4">
            <div>
              <label className="block text-xs font-mono text-outline-variant uppercase mb-2">System Prompt</label>
              <textarea
                value={config.systemPrompt}
                onChange={(e) => { setConfig((p) => ({ ...p, systemPrompt: e.target.value })); setSaved(false); }}
                placeholder="You must respond in English only. Be concise and helpful."
                rows={3}
                className="w-full bg-surface-container-low/50 border border-outline-variant/20 rounded-lg px-4 py-3 text-sm text-on-surface placeholder:text-outline-variant/40 focus:outline-none focus:border-primary transition-all resize-none"
              />
              <p className="text-[10px] text-outline-variant font-mono mt-1">
                Overrides the default system instruction sent to the AI model. Leave empty to use default.
              </p>
            </div>
            <div>
              <label className="block text-xs font-mono text-outline-variant uppercase mb-2">
                Max Tokens: {config.maxTokens}
              </label>
              <input
                type="range"
                min={256}
                max={4096}
                step={256}
                value={config.maxTokens}
                onChange={(e) => { setConfig((p) => ({ ...p, maxTokens: parseInt(e.target.value) })); setSaved(false); }}
                className="w-full accent-primary"
              />
              <div className="flex justify-between text-[10px] font-mono text-outline-variant mt-1">
                <span>256</span>
                <span>1024</span>
                <span>2048</span>
                <span>4096</span>
              </div>
            </div>
            <div className="flex justify-end">
              <button
                onClick={handleSave}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-mono transition-all ${
                  saved
                    ? "bg-secondary/10 text-secondary border border-secondary/30"
                    : "bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20"
                }`}
              >
                {saved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
                {saved ? "Saved" : "Save Settings"}
              </button>
            </div>
          </div>
        </div>

        {/* API Key Management */}
        <div className="bg-surface-container/40 border border-outline-variant/20 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-outline-variant/20 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-on-surface">API Keys</h3>
              <p className="text-xs text-on-surface-variant font-mono mt-1">
                Manage programmatic access tokens for external integrations.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <User className="w-4 h-4 text-outline-variant" />
              <span className="text-xs font-mono text-outline-variant uppercase">
                Role: {userRole ?? "loading..."}
              </span>
            </div>
          </div>

          {/* Created key reveal */}
          {createdKey && (
            <div className="mx-6 mt-4 p-4 bg-secondary/5 border border-secondary/20 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-mono text-secondary uppercase">New API Key (copy now — shown once)</span>
                <button onClick={() => setCreatedKey(null)} className="text-outline-variant hover:text-on-surface">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-surface-container-low/70 rounded px-3 py-2 text-sm font-mono text-on-surface break-all">
                  {createdKey}
                </code>
                <button
                  onClick={() => navigator.clipboard.writeText(createdKey)}
                  className="p-2 rounded-lg bg-secondary/10 text-secondary hover:bg-secondary/20 transition-all"
                  title="Copy to clipboard"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Create form (admin only) */}
          {isAdmin && (
            <div className="px-6 py-4 border-b border-outline-variant/10">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  placeholder="Key name (e.g., Production CI/CD)"
                  className="flex-1 bg-surface-container-low/50 border border-outline-variant/20 rounded-lg px-4 py-2 text-sm text-on-surface placeholder:text-outline-variant/40 focus:outline-none focus:border-primary transition-all"
                  onKeyDown={(e) => e.key === "Enter" && handleCreateKey()}
                />
                <button
                  onClick={handleCreateKey}
                  disabled={!newKeyName.trim()}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-mono bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  <Key className="w-3.5 h-3.5" />
                  Create Key
                </button>
              </div>
              {keyError && (
                <p className="text-xs text-error font-mono mt-2">{keyError}</p>
              )}
            </div>
          )}
          {!isAdmin && userRole && (
            <div className="px-6 py-3 border-b border-outline-variant/10">
              <p className="text-xs font-mono text-outline">Only admins and owners can create or revoke API keys.</p>
            </div>
          )}

          {/* Key list */}
          <div className="divide-y divide-outline-variant/10">
            {apiKeys.length === 0 ? (
              <div className="px-6 py-8 text-center">
                <Key className="w-8 h-8 text-outline-variant mx-auto mb-2 opacity-40" />
                <p className="text-sm text-outline font-mono">No API keys yet</p>
              </div>
            ) : (
              apiKeys.map((k) => (
                <div
                  key={k.id}
                  className="px-6 py-3 flex items-center justify-between hover:bg-surface-container-high/20 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Key className="w-4 h-4 text-primary flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-on-surface truncate">{k.name}</p>
                      <p className="text-xs text-outline-variant font-mono">{k.key_preview}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 flex-shrink-0">
                    <div className="hidden md:flex gap-1">
                      {(k.scopes || ["mediate", "analytics"]).map((s) => (
                        <span
                          key={s}
                          className="text-[10px] font-mono text-outline-variant bg-surface-container-high/50 px-1.5 py-0.5 rounded"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                    <span className="text-[10px] font-mono text-outline-variant hidden md:block">
                      {mounted && k.last_used_at
                        ? `Last used ${new Date(k.last_used_at).toLocaleDateString()}`
                        : "Never used"}
                    </span>
                    {isAdmin && (
                      <button
                        onClick={() => handleRevokeKey(k.id)}
                        className="text-outline-variant hover:text-error transition-colors p-1 rounded hover:bg-error/10"
                        title="Revoke key"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

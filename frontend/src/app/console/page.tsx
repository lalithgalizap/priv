"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, User, Bot, Loader2, Paperclip, X, Plus, Trash2, MessageSquare, PanelLeftClose, PanelLeft, AlertTriangle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/lib/supabase";
import AppShell from "@/components/AppShell";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

interface ApiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

interface ApiSession {
  id: string;
  title: string;
  model_id: string;
  created_at: string;
  updated_at: string;
  messages?: ApiMessage[];
}

interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

const MODELS = [
  { id: "moonshotai.kimi-k2.5", label: "Kimi K2.5", provider: "AWS Bedrock" },
  { id: "anthropic.claude-3-sonnet-20240229-v1:0", label: "Claude 3 Sonnet", provider: "AWS Bedrock" },
  { id: "anthropic.claude-3-haiku-20240307-v1:0", label: "Claude 3 Haiku", provider: "AWS Bedrock" },
  { id: "meta.llama3-70b-instruct-v1:0", label: "Llama 3 70B", provider: "AWS Bedrock" },
  { id: "mistral.mistral-large-2402-v1:0", label: "Mistral Large", provider: "AWS Bedrock" },
  { id: "amazon.titan-text-premier-v1:0", label: "Titan Text Premier", provider: "AWS Bedrock" },
];

const SELECTED_MODEL_KEY = "anonymizer_selected_model";

function createNewSession(title = "New Session", id?: string): ChatSession {
  const now = new Date().toISOString();
  return {
    id: id || crypto.randomUUID(),
    title,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

async function getAuthToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || null;
}

export default function ConsolePage() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedModel, setSelectedModel] = useState(() => {
    try {
      const saved = localStorage.getItem(SELECTED_MODEL_KEY);
      return saved && MODELS.some((m) => m.id === saved) ? saved : MODELS[0].id;
    } catch {
      return MODELS[0].id;
    }
  });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [costEstimate, setCostEstimate] = useState<{ estimated_credits: number; total_available: number; sufficient: boolean; warning_level?: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [apiLoading, setApiLoading] = useState(true);
  const [apiError, setApiError] = useState("");

  // Load sessions from API on mount
  useEffect(() => {
    async function loadFromApi() {
      try {
        const token = await getAuthToken();
        if (!token) {
          setApiLoading(false);
          return;
        }
        const res = await fetch("/api/sessions", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error("Failed to load sessions");
        const data = await res.json();
        const apiSessions: ApiSession[] = data.sessions || [];
        if (apiSessions.length === 0) {
          // Create first session via API
          const createRes = await fetch("/api/sessions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ title: "Session 1", model_id: selectedModel }),
          });
          if (!createRes.ok) throw new Error("Failed to create session");
          const createData = await createRes.json();
          const s = createData.session as ApiSession;
          const first = createNewSession(s.title, s.id);
          setSessions([first]);
          setActiveSessionId(first.id);
        } else {
          // Fetch messages for each session
          const fullSessions: ChatSession[] = [];
          for (const s of apiSessions) {
            const detailRes = await fetch(`/api/sessions/${s.id}`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (!detailRes.ok) continue;
            const detail = await detailRes.json();
            const apiS = detail.session as ApiSession;
            fullSessions.push({
              id: apiS.id,
              title: apiS.title,
              messages: (apiS.messages || []).map((m) => ({
                role: m.role,
                content: m.content,
                timestamp: m.created_at,
              })),
              createdAt: apiS.created_at,
              updatedAt: apiS.updated_at,
            });
          }
          setSessions(fullSessions);
          if (fullSessions.length > 0) {
            setActiveSessionId(fullSessions[0].id);
          }
        }
      } catch (err) {
        setApiError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setApiLoading(false);
      }
    }
    loadFromApi();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist selected model
  useEffect(() => {
    localStorage.setItem(SELECTED_MODEL_KEY, selectedModel);
  }, [selectedModel]);

  const activeSession = sessions.find((s) => s.id === activeSessionId) || null;
  const messages = activeSession?.messages || [];

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
    }
  }, [input]);

  // Debounced cost estimation
  useEffect(() => {
    const trimmed = input.trim();
    if (!trimmed || trimmed.length < 3) {
      setCostEstimate(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const token = await getAuthToken();
        if (!token) return;
        let vaultMaxTokens = 1024;
        try {
          const raw = localStorage.getItem("anonymizer_vault_config");
          if (raw) {
            const vault = JSON.parse(raw);
            if (vault.maxTokens) vaultMaxTokens = vault.maxTokens;
          }
        } catch { /* ignore */ }
        const res = await fetch("/api/me/estimate-cost", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: trimmed, model: selectedModel, max_tokens: vaultMaxTokens }),
        });
        if (res.ok) {
          const data = await res.json();
          setCostEstimate({
            estimated_credits: data.estimated_credits,
            total_available: data.total_available,
            sufficient: data.sufficient,
            warning_level: data.warning_level,
          });
        }
      } catch {
        setCostEstimate(null);
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [input, selectedModel]);

  const updateSessionMessages = useCallback(
    (sessionId: string, updater: (msgs: ChatMessage[]) => ChatMessage[]) => {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? { ...s, messages: updater(s.messages), updatedAt: new Date().toISOString() }
            : s
        )
      );
    },
    []
  );

  const handleNewSession = async () => {
    try {
      const token = await getAuthToken();
      if (!token) return;
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ title: `Session ${sessions.length + 1}`, model_id: selectedModel }),
      });
      if (!res.ok) return;
      const data = await res.json();
      const s = data.session as ApiSession;
      const newSession = createNewSession(s.title, s.id);
      setSessions((prev) => [newSession, ...prev]);
      setActiveSessionId(newSession.id);
    } catch {
      /* ignore */
    }
  };

  const handleDeleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const token = await getAuthToken();
      if (token) {
        await fetch(`/api/sessions/${id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
      }
    } catch {
      /* ignore */
    }
    const filtered = sessions.filter((s) => s.id !== id);
    if (filtered.length === 0) {
      // Create new session via API immediately
      handleNewSession();
      return;
    }
    setSessions(filtered);
    if (activeSessionId === id) {
      setActiveSessionId(filtered[0].id);
    }
  };

  async function saveMessageToApi(sessionId: string, role: "user" | "assistant", content: string) {
    try {
      const token = await getAuthToken();
      if (!token) return;
      await fetch(`/api/sessions/${sessionId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ role, content }),
      });
    } catch {
      /* ignore save failures */
    }
  }

  async function dispatchPayload(e: React.FormEvent) {
    e.preventDefault();
    if (!activeSessionId || (!input.trim() && !selectedFile) || isProcessing) return;

    const trimmed = input.trim();
    if (trimmed.length > 10000) {
      updateSessionMessages(activeSessionId, (prev) => [
        ...prev,
        { role: "assistant", content: "Error: Prompt exceeds 10,000 character limit.", timestamp: new Date().toISOString() },
      ]);
      return;
    }

    const displayContent = selectedFile ? `[📎 ${selectedFile.name}] ${trimmed}` : trimmed;
    const userMsg: ChatMessage = { role: "user", content: displayContent, timestamp: new Date().toISOString() };

    // Build history before adding current message
    const history = messages.map((m) => ({ role: m.role, content: m.content }));

    // Read Vault settings from localStorage (set in /vault page)
    let vaultSystemPrompt = "";
    let vaultMaxTokens = 1024;
    let vaultPiiRules: string[] = [];
    try {
      const raw = localStorage.getItem("anonymizer_vault_config");
      if (raw) {
        const vault = JSON.parse(raw);
        if (vault.systemPrompt) vaultSystemPrompt = vault.systemPrompt;
        if (vault.maxTokens) vaultMaxTokens = vault.maxTokens;
        if (vault.piiRules && Array.isArray(vault.piiRules)) {
          vaultPiiRules = vault.piiRules.filter((r: { enabled: boolean; id: string }) => r.enabled).map((r: { id: string }) => r.id);
        }
      }
    } catch {
      /* ignore corrupt vault config */
    }

    // Add user message to UI and persist to API
    updateSessionMessages(activeSessionId, (prev) => [...prev, userMsg]);
    await saveMessageToApi(activeSessionId, "user", displayContent);
    setInput("");
    setIsProcessing(true);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      let res: Response;

      if (selectedFile) {
        const formData = new FormData();
        formData.append("prompt", trimmed);
        formData.append("model", selectedModel);
        formData.append("history", JSON.stringify(history));
        if (vaultSystemPrompt) formData.append("system_prompt", vaultSystemPrompt);
        formData.append("max_tokens", String(vaultMaxTokens));
        if (vaultPiiRules.length > 0) formData.append("pii_rules", JSON.stringify(vaultPiiRules));
        formData.append("file", selectedFile);

        res = await fetch("/api/mediate", {
          method: "POST",
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: formData,
        });
        setSelectedFile(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
      } else {
        const body: Record<string, unknown> = {
          prompt: trimmed,
          model: selectedModel,
          history,
          max_tokens: vaultMaxTokens,
        };
        if (vaultSystemPrompt) body.system_prompt = vaultSystemPrompt;
        if (vaultPiiRules.length > 0) body.pii_rules = vaultPiiRules;

        res = await fetch("/api/mediate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(body),
        });
      }

      if (!res.ok) {
        let detail = `Broker pipeline error (${res.status})`;
        try {
          const errJson = await res.json();
          detail = errJson.detail || errJson.error || detail;
        } catch {
          /* backend returned non-JSON error */
        }
        throw new Error(detail);
      }

      const data = await res.json();

      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: data.ai_response || "No response received.",
        timestamp: new Date().toISOString(),
      };

      updateSessionMessages(activeSessionId, (prev) => [...prev, assistantMsg]);
      await saveMessageToApi(activeSessionId, "assistant", assistantMsg.content);
    } catch (err) {
      const errorMsg: ChatMessage = {
        role: "assistant",
        content: "Error: " + (err instanceof Error ? err.message : "Unknown error"),
        timestamp: new Date().toISOString(),
      };
      updateSessionMessages(activeSessionId, (prev) => [...prev, errorMsg]);
      await saveMessageToApi(activeSessionId, "assistant", errorMsg.content);
    } finally {
      setIsProcessing(false);
    }
  }

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  if (apiLoading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-[calc(100vh-8rem)]">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      </AppShell>
    );
  }

  if (apiError) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-[calc(100vh-8rem)]">
          <div className="text-center space-y-4">
            <AlertTriangle className="w-10 h-10 text-error mx-auto" />
            <p className="text-sm text-outline font-mono">{apiError}</p>
            <button
              onClick={() => window.location.reload()}
              className="text-xs font-mono text-primary hover:text-secondary transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="flex h-[calc(100vh-8rem)] -mx-6 md:-mx-8 -mt-6 md:-mt-6">
        {/* Sidebar */}
        <AnimatePresence initial={false}>
          {sidebarOpen && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 260, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="border-r border-outline-variant/20 bg-surface-container/20 overflow-hidden flex flex-col shrink-0"
            >
              <div className="p-4 border-b border-outline-variant/20 flex items-center justify-between">
                <span className="font-mono text-xs text-outline-variant uppercase tracking-wider">Sessions</span>
                <button
                  onClick={handleNewSession}
                  className="w-7 h-7 flex items-center justify-center rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                  title="New session"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {sessions.map((session) => (
                  <button
                    key={session.id}
                    onClick={() => setActiveSessionId(session.id)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-all group flex items-center gap-2 ${
                      session.id === activeSessionId
                        ? "bg-primary/10 border border-primary/20 text-on-surface"
                        : "border border-transparent text-on-surface-variant hover:bg-surface-container/40 hover:text-on-surface"
                    }`}
                  >
                    <MessageSquare className="w-4 h-4 shrink-0 opacity-60" />
                    <span className="truncate flex-1">{session.title}</span>
                    <span className="text-[10px] font-mono opacity-40">{formatTime(session.updatedAt)}</span>
                    {sessions.length > 1 && (
                      <Trash2
                        className="w-3.5 h-3.5 text-outline-variant opacity-0 group-hover:opacity-60 hover:text-error hover:opacity-100 transition-all shrink-0 cursor-pointer"
                        onClick={(e) => handleDeleteSession(session.id, e)}
                      />
                    )}
                  </button>
                ))}
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Main Chat Area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Toggle sidebar + model selector bar */}
          <div className="shrink-0 px-4 py-2 border-b border-outline-variant/20 flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen((v) => !v)}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface-container/40 text-outline-variant transition-colors"
              title={sidebarOpen ? "Close sidebar" : "Open sidebar"}
            >
              {sidebarOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeft className="w-4 h-4" />}
            </button>
            <span className="font-mono text-xs text-outline-variant uppercase tracking-wider">Model:</span>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              disabled={isProcessing}
              className="bg-surface-container/40 border border-outline-variant/20 rounded-lg px-3 py-1 text-xs text-on-surface focus:outline-none focus:border-primary transition-all cursor-pointer font-mono"
            >
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} ({m.provider})
                </option>
              ))}
            </select>
            {!sidebarOpen && (
              <button
                onClick={handleNewSession}
                className="ml-auto w-7 h-7 flex items-center justify-center rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                title="New session"
              >
                <Plus className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
            <AnimatePresence>
              {messages.length === 0 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex flex-col items-center justify-center h-full text-center space-y-4"
                >
                  <div className="w-16 h-16 rounded-2xl bg-surface-container/40 border border-outline-variant/20 flex items-center justify-center">
                    <Bot className="w-8 h-8 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-on-surface mb-1">Secure Channel Open</h3>
                    <p className="text-sm text-on-surface-variant max-w-md">
                      All prompts are sanitized before transmission. Your identity is decoupled from the payload.
                    </p>
                  </div>
                  <div className="font-mono text-xs text-outline mt-4 p-3 rounded-lg bg-surface-container/20 border border-outline-variant/10">
                    <span className="text-primary">&gt;</span> AWAITING_PROMPT_INPUT
                  </div>
                </motion.div>
              )}

              {messages.map((msg, idx) => (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                  className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  {msg.role === "assistant" && (
                    <div className="w-8 h-8 rounded-lg bg-surface-container/40 border border-outline-variant/20 flex items-center justify-center shrink-0 mt-1">
                      <Bot className="w-4 h-4 text-primary" />
                    </div>
                  )}
                  <div
                    className={`max-w-3xl px-4 py-3 rounded-xl text-sm leading-relaxed overflow-x-auto ${
                      msg.role === "user"
                        ? "bg-primary/10 border border-primary/20 text-on-surface"
                        : "bg-surface-container/40 border border-outline-variant/20 text-on-surface"
                    }`}
                  >
                    {msg.role === "assistant" ? (
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {msg.content}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <span className="whitespace-pre-wrap">{msg.content}</span>
                    )}
                  </div>
                  {msg.role === "user" && (
                    <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 mt-1">
                      <User className="w-4 h-4 text-primary" />
                    </div>
                  )}
                </motion.div>
              ))}

              {isProcessing && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex gap-3 items-center"
                >
                  <div className="w-8 h-8 rounded-lg bg-surface-container/40 border border-outline-variant/20 flex items-center justify-center">
                    <Bot className="w-4 h-4 text-primary animate-pulse" />
                  </div>
                  <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-surface-container/40 border border-outline-variant/20">
                    <Loader2 className="w-4 h-4 text-primary animate-spin" />
                    <span className="text-sm text-outline-variant font-mono">Processing through mediation layer...</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Input Area */}
          <div className="shrink-0 border-t border-outline-variant/20 px-4 md:px-6 py-3 pb-6 backdrop-blur-md">
            <form onSubmit={dispatchPayload} className="flex items-end gap-3 max-w-4xl mx-auto">
              <input
                type="file"
                ref={fileInputRef}
                onChange={(e) => {
                  const file = e.target.files?.[0] || null;
                  setSelectedFile(file);
                }}
                accept=".txt,.md,.pdf,.docx,.csv"
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isProcessing}
                className={`w-10 h-10 flex items-center justify-center rounded-xl border transition-all disabled:opacity-40 shrink-0 mb-0.5 ${
                  selectedFile
                    ? "bg-primary/10 border-primary/30 text-primary"
                    : "bg-surface-container/40 border-outline-variant/20 text-outline hover:text-primary hover:border-primary/30"
                }`}
                title="Attach document"
              >
                <Paperclip className="w-5 h-5" />
              </button>
              <div className="flex-1 relative">
                {selectedFile && (
                  <div className="absolute -top-6 left-0 flex items-center gap-1.5 text-xs text-primary font-mono">
                    <span className="truncate max-w-[200px]">{selectedFile.name}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedFile(null);
                        if (fileInputRef.current) fileInputRef.current.value = "";
                      }}
                      className="hover:text-error transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      dispatchPayload(e as unknown as React.FormEvent);
                    }
                  }}
                  placeholder={selectedFile ? "Ask about the document..." : "Enter sanitized prompt... (Shift+Enter for new line)"}
                  maxLength={10000}
                  rows={1}
                  className="w-full bg-surface-container/40 border border-outline-variant/20 rounded-xl pl-4 pr-12 py-3 text-sm text-on-surface placeholder:text-outline-variant/50 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all resize-none overflow-hidden"
                  disabled={isProcessing}
                  style={{ minHeight: "44px" }}
                />
                {costEstimate && (
                  <div className={`absolute -bottom-5 left-0 text-[10px] font-mono flex items-center gap-1.5 ${costEstimate.sufficient ? "text-outline-variant" : "text-error"}`}>
                    {costEstimate.warning_level && costEstimate.warning_level !== "none" && (
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        costEstimate.warning_level === "caution" ? "bg-yellow-400" :
                        costEstimate.warning_level === "warning" ? "bg-orange-400" :
                        costEstimate.warning_level === "critical" ? "bg-red-500 animate-pulse" :
                        "bg-red-500"
                      }`} />
                    )}
                    Est. cost: {costEstimate.estimated_credits.toLocaleString()} credits
                    {costEstimate.sufficient
                      ? ` · ${costEstimate.total_available.toLocaleString()} available`
                      : " · Insufficient credits"}
                    {costEstimate.warning_level === "caution" && " · Daily usage rising"}
                    {costEstimate.warning_level === "warning" && " · Daily budget low"}
                    {costEstimate.warning_level === "critical" && " · Daily overdraft"}
                    {costEstimate.warning_level === "exhausted" && " · Daily exhausted"}
                  </div>
                )}
              </div>
              <button
                type="submit"
                disabled={isProcessing || (!input.trim() && !selectedFile)}
                className="w-10 h-10 flex items-center justify-center rounded-xl bg-primary text-on-primary hover:bg-primary-fixed active:scale-[0.95] transition-all disabled:opacity-40 primary-glow shrink-0 mb-0.5"
              >
                <Send className="w-5 h-5" />
              </button>
            </form>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

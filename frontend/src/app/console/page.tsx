"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, User, Bot, Loader2, Paperclip, X, Plus, Trash2, MessageSquare, PanelLeftClose, PanelLeft, AlertTriangle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { authedFetch } from "@/lib/auth";
import { toast } from "@/lib/toast";
import AppShell from "@/components/AppShell";
import LazyMarkdown from "@/components/LazyMarkdown";

// Pricing (credits per 1k tokens) — superadmin can update via /api/admin/pricing.
// Used for client-side cost estimation so we don't ping the backend on every keystroke.
const LOCAL_PRICING_FALLBACK: Record<string, { input: number; output: number }> = {
  "moonshotai.kimi-k2.5": { input: 8, output: 24 },
  "amazon.nova-pro-v1:0": { input: 8, output: 32 },
  "amazon.nova-lite-v1:0": { input: 1, output: 4 },
  "cohere.command-r-plus-v1:0": { input: 30, output: 150 },
  "meta.llama3-70b-instruct-v1:0": { input: 10, output: 30 },
  "mistral.mistral-large-2402-v1:0": { input: 20, output: 60 },
  "amazon.titan-text-premier-v1:0": { input: 4, output: 12 },
};
const DEFAULT_RATE = { input: 25, output: 100 };

function estimateCreditsLocal(promptChars: number, model: string, maxOutputTokens: number): number {
  const rate = LOCAL_PRICING_FALLBACK[model] || DEFAULT_RATE;
  const inputTokens = Math.ceil(promptChars / 4);
  const inCredits = (inputTokens / 1000) * rate.input;
  const outCredits = (maxOutputTokens / 1000) * rate.output;
  return Math.max(1, Math.round(inCredits + outCredits));
}

const PREFS_BROADCAST_CHANNEL = "quintal:prefs";
type PrefsBroadcast = {
  type: "preferences-updated";
  preferred_model?: string;
  system_prompt?: string;
  max_tokens?: number;
};

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
  { id: "moonshotai.kimi-k2.5", label: "Kimi K2.5" },
  { id: "amazon.nova-pro-v1:0", label: "Nova Pro" },
  { id: "amazon.nova-lite-v1:0", label: "Nova Lite" },
  { id: "cohere.command-r-plus-v1:0", label: "Command R+" },
  { id: "meta.llama3-70b-instruct-v1:0", label: "Llama 3 70B" },
  { id: "mistral.mistral-large-2402-v1:0", label: "Mistral Large" },
  { id: "amazon.titan-text-premier-v1:0", label: "Titan Text Premier" },
];

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

export default function ConsolePage() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedModel, setSelectedModel] = useState(MODELS[0].id);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [costEstimate, setCostEstimate] = useState<{ estimated_credits: number; total_available: number; sufficient: boolean; warning_level?: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [apiLoading, setApiLoading] = useState(true);
  const [apiError, setApiError] = useState("");
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [userSystemPrompt, setUserSystemPrompt] = useState("");
  const [userMaxTokens, setUserMaxTokens] = useState(1024);

  // Listen for preference updates broadcast from the Settings page (no polling).
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(PREFS_BROADCAST_CHANNEL);
    ch.onmessage = (event: MessageEvent<PrefsBroadcast>) => {
      const data = event.data;
      if (!data || data.type !== "preferences-updated") return;
      if (data.preferred_model && MODELS.some((m) => m.id === data.preferred_model)) {
        setSelectedModel(data.preferred_model);
      }
      if (typeof data.system_prompt === "string") setUserSystemPrompt(data.system_prompt);
      if (typeof data.max_tokens === "number") setUserMaxTokens(data.max_tokens);
    };
    return () => ch.close();
  }, []);

  // Load preferences + sessions on mount
  useEffect(() => {
    let cancelled = false;
    async function loadFromApi() {
      try {
        const [prefs, sessionsResp] = await Promise.all([
          authedFetch<{ preferred_model?: string; system_prompt?: string; max_tokens?: number }>("/api/me/preferences").catch(() => ({} as { preferred_model?: string; system_prompt?: string; max_tokens?: number })),
          authedFetch<{ sessions?: ApiSession[] }>("/api/sessions"),
        ]);
        if (cancelled) return;

        if (prefs.preferred_model && MODELS.some((m) => m.id === prefs.preferred_model)) {
          setSelectedModel(prefs.preferred_model);
        }
        if (prefs.system_prompt) setUserSystemPrompt(prefs.system_prompt);
        if (prefs.max_tokens) setUserMaxTokens(prefs.max_tokens);

        const apiSessions: ApiSession[] = sessionsResp.sessions || [];

        if (apiSessions.length === 0) {
          const created = await authedFetch<{ session: ApiSession }>("/api/sessions", {
            method: "POST",
            body: { title: "Session 1", model_id: selectedModel },
          });
          if (cancelled) return;
          const s = created.session;
          const first = createNewSession(s.title, s.id);
          setSessions([first]);
          setActiveSessionId(first.id);
        } else {
          const fullSessions: ChatSession[] = apiSessions.map((s) => ({
            id: s.id, title: s.title, messages: [], createdAt: s.created_at, updatedAt: s.updated_at,
          }));
          setSessions(fullSessions);
          const activeId = fullSessions[0].id;
          setActiveSessionId(activeId);
          try {
            const detail = await authedFetch<{ session: ApiSession }>(`/api/sessions/${activeId}`);
            if (cancelled) return;
            const apiS = detail.session;
            setSessions((prev) =>
              prev.map((s) =>
                s.id === activeId
                  ? { ...s, messages: (apiS.messages || []).map((m) => ({ role: m.role, content: m.content, timestamp: m.created_at })) }
                  : s
              )
            );
          } catch (err) {
            console.warn("Failed to preload active session messages:", err);
          }
        }
      } catch (err) {
        if (!cancelled) setApiError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        if (!cancelled) setApiLoading(false);
      }
    }
    loadFromApi();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save model preference to DB when changed (debounced, skip initial)
  const modelInitRef = useRef(true);
  useEffect(() => {
    if (modelInitRef.current) { modelInitRef.current = false; return; }
    const timer = setTimeout(() => {
      authedFetch("/api/me/preferences", {
        method: "PATCH",
        body: { preferred_model: selectedModel },
      }).catch((err) => {
        console.warn("Failed to persist model preference:", err);
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [selectedModel]);

  const handleSwitchSession = useCallback(async (sessionId: string) => {
    setActiveSessionId(sessionId);
    const session = sessions.find((s) => s.id === sessionId);
    if (session && session.messages.length === 0) {
      try {
        const detail = await authedFetch<{ session: ApiSession }>(`/api/sessions/${sessionId}`);
        const apiS = detail.session;
        setSessions((prev) =>
          prev.map((s) =>
            s.id === sessionId
              ? { ...s, messages: (apiS.messages || []).map((m: ApiMessage) => ({ role: m.role, content: m.content, timestamp: m.created_at })) }
              : s
          )
        );
      } catch (err) {
        toast.error("Couldn't load session messages", err);
      }
    }
  }, [sessions]);

  const activeSession = sessions.find((s) => s.id === activeSessionId) || null;
  const messages = activeSession?.messages || [];

  useEffect(() => {
    setTimeout(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }, 100);
  }, [messages.length, activeSessionId]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
    }
  }, [input]);

  // Local cost estimation — no backend ping per keystroke. Live quota check
  // is loaded once on mount via /api/me/quota in the future; for now we just
  // surface the estimated credits and rely on backend's authoritative
  // reservation at submission time.
  useEffect(() => {
    const trimmed = input.trim();
    if (!trimmed || trimmed.length < 3) {
      setCostEstimate(null);
      return;
    }
    const credits = estimateCreditsLocal(trimmed.length, selectedModel, userMaxTokens);
    setCostEstimate({
      estimated_credits: credits,
      // total_available is unknown locally; backend enforces at submit time.
      total_available: Number.POSITIVE_INFINITY,
      sufficient: true,
    });
  }, [input, selectedModel, userMaxTokens]);

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
      const data = await authedFetch<{ session: ApiSession }>("/api/sessions", {
        method: "POST",
        body: { title: `Session ${sessions.length + 1}`, model_id: selectedModel },
      });
      const s = data.session;
      const newSession = createNewSession(s.title, s.id);
      setSessions((prev) => [newSession, ...prev]);
      setActiveSessionId(newSession.id);
    } catch (err) {
      toast.error("Couldn't create session", err);
    }
  };

  const handleDeleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await authedFetch(`/api/sessions/${id}`, { method: "DELETE" });
    } catch (err) {
      toast.error("Couldn't delete session", err);
      return;
    }
    const filtered = sessions.filter((s) => s.id !== id);
    if (filtered.length === 0) {
      handleNewSession();
      return;
    }
    setSessions(filtered);
    if (activeSessionId === id) {
      setActiveSessionId(filtered[0].id);
    }
  };

  const handleRenameSession = async (id: string) => {
    const newTitle = editingTitle.trim();
    if (!newTitle) { setEditingSessionId(null); return; }
    try {
      await authedFetch(`/api/sessions/${id}`, {
        method: "PATCH",
        body: { title: newTitle },
      });
    } catch (err) {
      toast.error("Couldn't rename session", err);
      setEditingSessionId(null);
      return;
    }
    setSessions((prev) => prev.map((s) => s.id === id ? { ...s, title: newTitle } : s));
    setEditingSessionId(null);
  };

  async function saveMessageToApi(sessionId: string, role: "user" | "assistant", content: string) {
    try {
      await authedFetch(`/api/sessions/${sessionId}/messages`, {
        method: "POST",
        body: { role, content },
      });
    } catch (err) {
      // Persistence failure is non-fatal for the UI but we want to know.
      console.warn("Failed to persist message:", err);
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

    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    const systemPrompt = userSystemPrompt;
    const maxTokens = userMaxTokens;

    setInput("");
    setIsProcessing(true);
    updateSessionMessages(activeSessionId, (prev) => [...prev, userMsg]);
    setTimeout(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }, 50);

    saveMessageToApi(activeSessionId, "user", displayContent);

    try {
      let data: { ai_response?: string };

      if (selectedFile) {
        const fd = new FormData();
        fd.append("prompt", trimmed);
        fd.append("model", selectedModel);
        fd.append("history", JSON.stringify(history));
        if (systemPrompt) fd.append("system_prompt", systemPrompt);
        fd.append("max_tokens", String(maxTokens));
        fd.append("file", selectedFile);

        data = await authedFetch<{ ai_response?: string }>("/api/mediate", { method: "POST", formData: fd });
        setSelectedFile(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
      } else {
        data = await authedFetch<{ ai_response?: string }>("/api/mediate", {
          method: "POST",
          body: {
            prompt: trimmed,
            model: selectedModel,
            history,
            max_tokens: maxTokens,
            ...(systemPrompt ? { system_prompt: systemPrompt } : {}),
          },
        });
      }

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
      <div className="flex h-[calc(100vh-3rem)] -mx-6 md:-mx-8 -mt-6 -mb-8">
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
                  <div
                    key={session.id}
                    onClick={() => handleSwitchSession(session.id)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-all group flex items-center gap-2 cursor-pointer ${
                      session.id === activeSessionId
                        ? "bg-primary/10 border border-primary/20 text-on-surface"
                        : "border border-transparent text-on-surface-variant hover:bg-surface-container/40 hover:text-on-surface"
                    }`}
                  >
                    <MessageSquare className="w-4 h-4 shrink-0 opacity-60" />
                    {editingSessionId === session.id ? (
                      <input
                        autoFocus
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onBlur={() => handleRenameSession(session.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleRenameSession(session.id);
                          if (e.key === "Escape") setEditingSessionId(null);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="flex-1 bg-surface-container-low/50 border border-primary/30 rounded px-1.5 py-0.5 text-xs text-on-surface focus:outline-none"
                      />
                    ) : (
                      <span
                        className="truncate flex-1"
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          setEditingSessionId(session.id);
                          setEditingTitle(session.title);
                        }}
                      >
                        {session.title}
                      </span>
                    )}
                    {editingSessionId !== session.id && (
                      <>
                        <span className="text-[10px] font-mono opacity-40">{formatTime(session.updatedAt)}</span>
                        {sessions.length > 1 && (
                          <Trash2
                            className="w-3.5 h-3.5 text-outline-variant opacity-0 group-hover:opacity-60 hover:text-error hover:opacity-100 transition-all shrink-0 cursor-pointer"
                            onClick={(e) => handleDeleteSession(session.id, e)}
                          />
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        <div className="flex-1 flex flex-col min-w-0">
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
                  {m.label}
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
                    <h3 className="text-lg font-semibold text-on-surface mb-1">Ready to assist</h3>
                    <p className="text-sm text-on-surface-variant max-w-md">
                      Ask anything. You can also attach documents (PDF, DOCX, TXT) for context-aware responses.
                    </p>
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
                      <div className="prose prose-sm max-w-none prose-p:text-on-surface prose-li:text-on-surface prose-strong:text-on-surface prose-headings:text-on-surface prose-code:text-primary prose-a:text-primary [&_*]:text-on-surface">
                        <LazyMarkdown>{msg.content}</LazyMarkdown>
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
                  className="flex gap-3 items-start"
                >
                  <div className="w-8 h-8 rounded-lg bg-surface-container/40 border border-outline-variant/20 flex items-center justify-center">
                    <Bot className="w-4 h-4 text-primary animate-pulse" />
                  </div>
                  <div className="px-4 py-3 rounded-xl bg-surface-container/40 border border-outline-variant/20 space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="flex gap-1">
                        <span className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "0ms" }} />
                        <span className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "150ms" }} />
                        <span className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "300ms" }} />
                      </div>
                      <span className="text-sm text-on-surface-variant">Analyzing and generating response...</span>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

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
                  <div className="mb-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary/5 border border-primary/20">
                    <Paperclip className="w-3.5 h-3.5 text-primary" />
                    <span className="text-xs font-medium text-on-surface truncate max-w-[200px]">{selectedFile.name}</span>
                    <span className="text-[10px] text-outline font-mono">({(selectedFile.size / 1024).toFixed(0)} KB)</span>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedFile(null);
                        if (fileInputRef.current) fileInputRef.current.value = "";
                      }}
                      className="ml-1 p-0.5 rounded hover:bg-error/10 text-outline-variant hover:text-error transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
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
                  placeholder={selectedFile ? "Ask about the attached document..." : "Type your message... (Shift+Enter for new line)"}
                  maxLength={10000}
                  rows={1}
                  className="w-full bg-surface-container/40 border border-outline-variant/20 rounded-xl pl-4 pr-12 py-3 text-sm text-on-surface placeholder:text-outline-variant/50 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all resize-none overflow-hidden"
                  disabled={isProcessing}
                  style={{ minHeight: "44px" }}
                />
                {costEstimate && Number.isFinite(costEstimate.total_available) && !costEstimate.sufficient && (
                  <div className="absolute -bottom-5 left-0 text-[10px] font-mono text-error flex items-center gap-1.5">
                    Insufficient credits ({costEstimate.total_available} available, need ~{costEstimate.estimated_credits})
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

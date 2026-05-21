"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, CheckCircle2, Info, AlertTriangle, X } from "lucide-react";
import { toast, useToasts, type Toast, type ToastLevel } from "@/lib/toast";

const ICONS: Record<ToastLevel, React.ComponentType<{ className?: string }>> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: AlertCircle,
};

const COLORS: Record<ToastLevel, string> = {
  info: "border-primary/30 bg-primary/10 text-primary",
  success: "border-secondary/30 bg-secondary/10 text-secondary",
  warning: "border-tertiary/30 bg-tertiary/10 text-tertiary",
  error: "border-error/30 bg-error/10 text-error",
};

function ToastCard({ t }: { t: Toast }) {
  const Icon = ICONS[t.level];
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 24, scale: 0.96 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 24, scale: 0.96 }}
      transition={{ duration: 0.18 }}
      className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border bg-surface-container/90 backdrop-blur p-3 shadow-lg ${COLORS[t.level]}`}
    >
      <Icon className="w-4 h-4 mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-on-surface">{t.title}</p>
        {t.description ? (
          <p className="mt-0.5 text-xs text-on-surface-variant break-words">{t.description}</p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => toast.dismiss(t.id)}
        className="flex-shrink-0 text-outline-variant hover:text-on-surface transition-colors"
        aria-label="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </motion.div>
  );
}

export default function ToastViewport() {
  const toasts = useToasts();
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[1000] flex flex-col gap-2 max-w-sm">
      <AnimatePresence>
        {toasts.map((t) => (
          <ToastCard key={t.id} t={t} />
        ))}
      </AnimatePresence>
    </div>
  );
}

/**
 * Tiny pub/sub toast system. No external dependencies.
 *
 * Usage:
 *   import { toast } from "@/lib/toast";
 *   toast.error("Failed to save preferences", err);
 *
 * Render:
 *   <ToastViewport /> mounted once in the app root reads from this store.
 */

"use client";

import { useEffect, useState } from "react";

export type ToastLevel = "info" | "success" | "warning" | "error";

export interface Toast {
  id: string;
  level: ToastLevel;
  title: string;
  description?: string;
  createdAt: number;
}

const _toasts: Toast[] = [];
const _listeners = new Set<(toasts: Toast[]) => void>();
let _seq = 0;

const DEFAULT_TTL_MS: Record<ToastLevel, number> = {
  info: 4000,
  success: 4000,
  warning: 6000,
  error: 8000,
};

function emit() {
  const snapshot = [..._toasts];
  _listeners.forEach((fn) => {
    try {
      fn(snapshot);
    } catch {
      /* ignore subscriber errors */
    }
  });
}

function dismiss(id: string) {
  const idx = _toasts.findIndex((t) => t.id === id);
  if (idx >= 0) {
    _toasts.splice(idx, 1);
    emit();
  }
}

function push(level: ToastLevel, title: string, description?: string): string {
  const id = `t${++_seq}`;
  _toasts.push({ id, level, title, description, createdAt: Date.now() });
  emit();
  const ttl = DEFAULT_TTL_MS[level];
  setTimeout(() => dismiss(id), ttl);
  return id;
}

function humanize(err: unknown): string | undefined {
  if (!err) return undefined;
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return undefined;
  }
}

export const toast = {
  info(title: string, err?: unknown) {
    return push("info", title, humanize(err));
  },
  success(title: string, err?: unknown) {
    return push("success", title, humanize(err));
  },
  warning(title: string, err?: unknown) {
    return push("warning", title, humanize(err));
  },
  error(title: string, err?: unknown) {
    return push("error", title, humanize(err));
  },
  dismiss,
};

export function useToasts(): Toast[] {
  const [items, setItems] = useState<Toast[]>([..._toasts]);
  useEffect(() => {
    const handler = (next: Toast[]) => setItems(next);
    _listeners.add(handler);
    return () => {
      _listeners.delete(handler);
    };
  }, []);
  return items;
}

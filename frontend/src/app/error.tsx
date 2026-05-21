"use client";

/**
 * Top-level error boundary. Catches any render-time exception that bubbles
 * out of a route segment without its own boundary, and renders a recoverable
 * UI instead of the empty white page Next.js shows by default.
 *
 * In production, ``digest`` is the only thing safe to surface to the user;
 * the full error message can leak implementation details.
 */

import { useEffect } from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    // Forward to the structured logger / Sentry once wired. For now, log to
    // the browser console with enough context for support.
    console.error("[GlobalError]", {
      message: error.message,
      digest: error.digest,
      stack: error.stack,
    });
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="max-w-md w-full glass-panel rounded-xl p-8 text-center space-y-5">
        <div className="w-14 h-14 rounded-full bg-error/10 flex items-center justify-center mx-auto">
          <AlertTriangle className="w-7 h-7 text-error" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-on-surface mb-1">
            Something went wrong
          </h2>
          <p className="text-sm text-on-surface-variant">
            The page failed to render. The error has been logged.
          </p>
          {error.digest ? (
            <p className="mt-3 text-[10px] font-mono text-outline-variant break-all">
              ref: {error.digest}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          <button
            onClick={reset}
            className="flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium bg-primary text-on-primary hover:bg-primary/90 transition-all"
          >
            <RefreshCw className="w-4 h-4" /> Try again
          </button>
          <a
            href="/"
            className="flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium border border-outline-variant/30 hover:bg-surface-container/40 transition-all"
          >
            <Home className="w-4 h-4" /> Go home
          </a>
        </div>
      </div>
    </div>
  );
}

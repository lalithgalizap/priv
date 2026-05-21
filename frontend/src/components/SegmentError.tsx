"use client";

/**
 * Per-segment error boundary used by the in-app routes (console, dashboard,
 * etc.). Rendered inside the AppShell so the navigation stays usable when
 * the route content fails.
 */

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface SegmentErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
  title?: string;
  description?: string;
}

export default function SegmentError({
  error,
  reset,
  title = "Couldn't load this page",
  description = "An unexpected error occurred while rendering this view.",
}: SegmentErrorProps) {
  useEffect(() => {
    console.error("[SegmentError]", {
      message: error.message,
      digest: error.digest,
      stack: error.stack,
    });
  }, [error]);

  return (
    <div className="flex items-center justify-center py-16 px-6">
      <div className="max-w-md w-full text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-error/10 flex items-center justify-center mx-auto">
          <AlertTriangle className="w-6 h-6 text-error" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-on-surface mb-1">{title}</h2>
          <p className="text-sm text-on-surface-variant">{description}</p>
          {error.digest ? (
            <p className="mt-2 text-[10px] font-mono text-outline-variant break-all">
              ref: {error.digest}
            </p>
          ) : null}
        </div>
        <button
          onClick={reset}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-primary text-on-primary hover:bg-primary/90 transition-all"
        >
          <RefreshCw className="w-4 h-4" /> Retry
        </button>
      </div>
    </div>
  );
}

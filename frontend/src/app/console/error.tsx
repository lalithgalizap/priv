"use client";

import SegmentError from "@/components/SegmentError";

export default function ConsoleError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <SegmentError
      {...props}
      title="Workspace failed to load"
      description="The chat workspace ran into an error. Try refreshing — your sessions are safe."
    />
  );
}

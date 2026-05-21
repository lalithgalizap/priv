"use client";

import SegmentError from "@/components/SegmentError";

export default function AdminError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <SegmentError {...props} title="Admin panel failed to load" />;
}

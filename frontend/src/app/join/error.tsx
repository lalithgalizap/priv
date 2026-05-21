"use client";

import SegmentError from "@/components/SegmentError";

export default function JoinError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <SegmentError {...props} title="Couldn't load the invitation" />;
}

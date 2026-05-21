"use client";

import SegmentError from "@/components/SegmentError";

export default function SettingsError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <SegmentError {...props} title="Settings failed to load" />;
}

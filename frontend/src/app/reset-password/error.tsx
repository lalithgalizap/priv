"use client";

import SegmentError from "@/components/SegmentError";

export default function ResetPasswordError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <SegmentError {...props} title="Password reset is unavailable" />;
}

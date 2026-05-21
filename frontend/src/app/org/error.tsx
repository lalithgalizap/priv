"use client";

import SegmentError from "@/components/SegmentError";

export default function OrgError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <SegmentError {...props} title="Organization page failed to load" />;
}

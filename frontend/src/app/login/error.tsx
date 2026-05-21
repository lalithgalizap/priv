"use client";

import SegmentError from "@/components/SegmentError";

export default function LoginError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <SegmentError
      {...props}
      title="Sign-in is unavailable"
      description="We couldn't load the sign-in page. Try again in a moment."
    />
  );
}

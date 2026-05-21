"use client";

import SegmentError from "@/components/SegmentError";

export default function SignupError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <SegmentError
      {...props}
      title="Sign-up is unavailable"
      description="We couldn't load the sign-up page. Try again in a moment."
    />
  );
}

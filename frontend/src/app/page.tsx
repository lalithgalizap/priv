import { Loader2 } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen bg-background text-on-surface flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
        <span className="font-mono text-sm text-outline-variant">Initializing secure session...</span>
      </div>
    </div>
  );
}

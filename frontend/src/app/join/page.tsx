"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { authedFetch, getAccessToken, getCachedUser } from "@/lib/auth";
import {
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Building2,
  Users,
  ArrowRight,
  UserPlus,
  Crown,
} from "lucide-react";

interface InviteDetails {
  valid: boolean;
  tenant_id: string;
  tenant_name: string;
  email: string;
  role: string;
}

function JoinContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [invite, setInvite] = useState<InviteDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [userEmail, setUserEmail] = useState("");

  useEffect(() => {
    if (token) localStorage.setItem("pending_invite_token", token);
  }, [token]);

  useEffect(() => {
    async function init() {
      const sessionToken = await getAccessToken();
      const loggedIn = !!sessionToken;
      setIsLoggedIn(loggedIn);
      if (loggedIn) {
        const cached = getCachedUser();
        if (cached?.email) setUserEmail(cached.email);
      }

      const effectiveToken = token || localStorage.getItem("pending_invite_token") || "";
      if (!effectiveToken) {
        setError("No invite token found. Please use the link from your invite email.");
        setLoading(false);
        return;
      }

      try {
        const data = await apiFetch<InviteDetails>("/api/invite/validate", {
          method: "POST",
          body: { token: effectiveToken },
        });
        setInvite(data);

        if (loggedIn && sessionToken) {
          setAccepting(true);
          try {
            await authedFetch("/api/invite/accept", {
              method: "POST",
              body: { token: effectiveToken },
            });
            setAccepted(true);
            localStorage.removeItem("pending_invite_token");
            setTimeout(() => router.push("/console"), 1500);
          } catch {
            setAccepting(false);
          }
        }
      } catch {
        localStorage.removeItem("pending_invite_token");
        router.push("/console");
        return;
      } finally {
        setLoading(false);
      }
    }
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function handleAccept() {
    const effectiveToken = token || localStorage.getItem("pending_invite_token") || "";
    if (!effectiveToken) return;
    setAccepting(true);
    try {
      await authedFetch("/api/invite/accept", {
        method: "POST",
        body: { token: effectiveToken },
      });
      setAccepted(true);
      localStorage.removeItem("pending_invite_token");
      setTimeout(() => router.push("/console"), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to accept invite.");
    } finally {
      setAccepting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="max-w-md w-full glass-panel rounded-xl p-8 text-center space-y-4">
          <AlertTriangle className="w-12 h-12 text-error mx-auto" />
          <h2 className="text-xl font-bold text-on-surface">Invite Error</h2>
          <p className="text-sm text-outline font-mono">{error}</p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm font-mono text-primary hover:text-secondary transition-colors"
          >
            Go to Home <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    );
  }

  if (accepted) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="max-w-md w-full glass-panel rounded-xl p-8 text-center space-y-4">
          <CheckCircle2 className="w-12 h-12 text-secondary mx-auto" />
          <h2 className="text-xl font-bold text-on-surface">Invite Accepted!</h2>
          <p className="text-sm text-outline font-mono">
            You have joined <strong className="text-on-surface">{invite?.tenant_name}</strong> as a{" "}
            <strong className="text-on-surface">{invite?.role}</strong>.
          </p>
          <p className="text-xs text-outline-variant font-mono">Redirecting to dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="max-w-md w-full glass-panel rounded-xl p-8 space-y-6">
        <div className="text-center space-y-2">
          <Building2 className="w-10 h-10 text-primary mx-auto" />
          <h2 className="text-xl font-bold text-on-surface">You are invited</h2>
          <p className="text-sm text-outline font-mono">
            Join <strong className="text-on-surface">{invite?.tenant_name}</strong>
          </p>
        </div>

        <div className="bg-surface-container-low/50 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-outline font-mono">Role</span>
            <span className="flex items-center gap-1.5 text-on-surface font-medium">
              {invite?.role === "leader" && <Crown className="w-3.5 h-3.5 text-primary" />}
              {invite?.role === "member" && <Users className="w-3.5 h-3.5 text-outline-variant" />}
              <span className="text-xs font-mono uppercase">{invite?.role}</span>
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-outline font-mono">Company</span>
            <span className="text-on-surface font-medium">{invite?.tenant_name}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-outline font-mono">Email</span>
            <span className="text-on-surface font-medium">{invite?.email}</span>
          </div>
        </div>

        {isLoggedIn ? (
          accepting ? (
            <div className="space-y-3 text-center">
              <Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" />
              <p className="text-xs text-outline font-mono">
                Accepting invite as <span className="text-on-surface">{userEmail}</span>...
              </p>
            </div>
          ) : (
            <button
              onClick={handleAccept}
              className="w-full py-3 rounded-lg text-xs font-mono bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 transition-all flex items-center justify-center gap-2"
            >
              Accept Invite
            </button>
          )
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-center text-outline font-mono">
              Create an account to join this organization.
            </p>
            <Link
              href="/signup"
              className="w-full py-3 rounded-lg text-xs font-mono bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 transition-all flex items-center justify-center gap-2"
            >
              <UserPlus className="w-4 h-4" />
              Sign Up
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

export default function JoinPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      }
    >
      <JoinContent />
    </Suspense>
  );
}

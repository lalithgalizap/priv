"use client";

import { useCallback, useEffect, useState } from "react";
import { authedFetch, getAccessToken, getCachedToken, onAuthChange } from "@/lib/auth";

interface CurrentUserResponse {
  id?: string;
  user_id?: string;
  email: string;
  tenant_id: string;
  role: string;
  is_platform_admin?: boolean;
  [key: string]: unknown;
}

interface CurrentUserData {
  user: CurrentUserResponse;
  token: string;
}

let cachedUser: CurrentUserResponse | null = null;
let cachedToken: string | null = null;
let inflight: Promise<CurrentUserData> | null = null;

let _unsub: (() => void) | null = null;
function ensureSubscribed() {
  if (_unsub) return;
  _unsub = onAuthChange(() => {
    const newToken = getCachedToken();
    if (newToken !== cachedToken) {
      cachedUser = null;
      cachedToken = null;
      inflight = null;
    }
  });
}

async function loadCurrentUser(): Promise<CurrentUserData> {
  const token = await getAccessToken();
  if (!token) throw new Error("Not authenticated");
  const user = await authedFetch<CurrentUserResponse>("/api/me", { method: "GET" });
  return { user, token };
}

export function useCurrentUser() {
  ensureSubscribed();
  const [user, setUser] = useState<CurrentUserResponse | null>(cachedUser);
  const [token, setToken] = useState<string | null>(cachedToken);
  const [loading, setLoading] = useState(!cachedUser);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (cachedUser && cachedToken) {
      setUser(cachedUser);
      setToken(cachedToken);
      setLoading(false);
      return;
    }
    let mounted = true;
    setLoading(true);
    if (!inflight) {
      inflight = loadCurrentUser().finally(() => {
        inflight = null;
      });
    }
    inflight
      ?.then((data) => {
        if (!mounted) return;
        cachedUser = data.user;
        cachedToken = data.token;
        setUser(data.user);
        setToken(data.token);
        setError(null);
      })
      .catch((err: Error) => {
        if (!mounted) return;
        setError(err);
        setUser(null);
        setToken(null);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    cachedUser = null;
    cachedToken = null;
    inflight = null;
    try {
      const data = await loadCurrentUser();
      cachedUser = data.user;
      cachedToken = data.token;
      setUser(data.user);
      setToken(data.token);
    } catch (err) {
      setError(err as Error);
      setUser(null);
      setToken(null);
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    user,
    token,
    loading,
    error,
    refresh,
  };
}

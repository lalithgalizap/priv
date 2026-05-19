"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

interface CurrentUserResponse {
  id: string;
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

async function loadCurrentUser(): Promise<CurrentUserData> {
  const { data: sesh } = await supabase.auth.getSession();
  const token = sesh.session?.access_token;
  if (!token) {
    throw new Error("Not authenticated");
  }
  const res = await fetch("/api/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const message = await res.text().catch(() => "Failed to load user");
    throw new Error(message);
  }
  const user = await res.json();
  return { user, token };
}

export function useCurrentUser() {
  const [user, setUser] = useState<CurrentUserResponse | null>(cachedUser);
  const [token, setToken] = useState<string | null>(cachedToken);
  const [loading, setLoading] = useState(!cachedUser);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (cachedUser && cachedToken) {
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

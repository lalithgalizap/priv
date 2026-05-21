"use client";

/**
 * Single React Query client mounted at the root layout. Reuses one client
 * instance per browser tab so cached data survives route navigation.
 *
 * Defaults are tuned for an authenticated SaaS dashboard:
 *  - staleTime 30s: data is fresh enough to skip a refetch when the user
 *    flips between tabs but recent enough for live dashboards.
 *  - gcTime 5min: keep recently-unmounted queries in memory for instant
 *    back-navigation.
 *  - retry 1: a single retry covers JWKS refreshes and transient blips.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

interface QueryProviderProps {
  children: React.ReactNode;
}

export default function QueryProvider({ children }: QueryProviderProps) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
          mutations: {
            retry: 0,
          },
        },
      })
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

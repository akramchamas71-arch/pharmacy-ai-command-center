"use client";

import { useEffect, useState, useCallback } from "react";
import type { CurrentUser } from "@/lib/permissionKeys";

interface MeResponse {
  user: CurrentUser | null;
}

/**
 * Client-side mirror of GET /api/auth/me. The dashboard layout (a Server Component) already
 * fetches the session once per navigation via src/lib/authServer.ts and passes it down as
 * `initialUser` through DashboardShell's props — this hook exists for client components that
 * need to react to a session change without a full page reload (e.g. right after `login`, or
 * after enabling 2FA) and for the standalone /login page, which renders before any
 * authenticated layout exists.
 */
export function useSession(initialUser?: CurrentUser | null) {
  const [user, setUser] = useState<CurrentUser | null | undefined>(initialUser);
  const [loading, setLoading] = useState(initialUser === undefined);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      const data: MeResponse = await res.json();
      setUser(data.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialUser === undefined) {
      refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { user: user ?? null, loading, refresh };
}

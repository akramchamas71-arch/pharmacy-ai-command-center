"use client";

import { createContext, useContext } from "react";
import type { CurrentUser, PermissionKey } from "@/lib/permissionKeys";

const UserContext = createContext<CurrentUser | null>(null);

export function UserProvider({ user, children }: { user: CurrentUser; children: React.ReactNode }) {
  return <UserContext.Provider value={user}>{children}</UserContext.Provider>;
}

/** Throws if used outside the dashboard layout on purpose — every dashboard page is guaranteed
 * an authenticated user by the server-side redirect in src/app/dashboard/layout.tsx, so a
 * missing context here means a page was rendered outside that layout by mistake. */
export function useCurrentUser(): CurrentUser {
  const user = useContext(UserContext);
  if (!user) {
    throw new Error("useCurrentUser() used outside <UserProvider> — render this page under /dashboard.");
  }
  return user;
}

export function useHasPermission(permission: PermissionKey): boolean {
  const user = useCurrentUser();
  return user.permissions.includes(permission);
}

export function useHasAnyPermission(permissions: PermissionKey[]): boolean {
  const user = useCurrentUser();
  return permissions.some((p) => user.permissions.includes(p));
}

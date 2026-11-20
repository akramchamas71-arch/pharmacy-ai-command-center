import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE_NAME } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { CurrentUser } from "@/lib/permissionKeys";

/**
 * Server-component equivalent of GET /api/auth/me — reads the same cookie, same JWT
 * verification, same Prisma query, but called directly from a Server Component (the
 * dashboard layout) instead of over HTTP, so every dashboard page load doesn't pay for an
 * extra round trip just to know who's logged in. Returns null for "not logged in / session
 * invalid / account disabled" — callers (the dashboard layout) redirect to /login on null,
 * same behavior GET /api/auth/me's client-side callers already implement.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const session = verifySession(token);
  if (!session) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: {
      role: { include: { permissions: { include: { permission: true } } } },
      branch: true,
    },
  });
  if (!user || !user.active) return null;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role.name,
    branch: user.branch ? { id: user.branch.id, name: user.branch.name } : null,
    permissions: user.role.permissions.map(
      (rp: { permission: { key: string } }) => rp.permission.key
    ) as CurrentUser["permissions"],
    twoFactorEnabled: user.twoFactorEnabled,
  };
}

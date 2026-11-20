import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { hasPermission, PermissionKey } from "@/lib/rbac";
import { SessionPayload } from "@/lib/auth";

/**
 * The one entry point every Phase 2+ route uses to answer "is this caller allowed to do
 * this?" before touching any data. `proxy.ts` already rejected requests with no session
 * cookie at all; this is the real check — a real, unexpired session AND the specific
 * permission the action needs (the same hasPermission() choke point the plan doc requires
 * the future AI Tool Calling layer to reuse).
 *
 * Returns the session on success, or a ready-to-return NextResponse on failure — callers
 * do `const g = await requirePermission(...); if (g instanceof NextResponse) return g;`.
 */
export async function requirePermission(
  req: NextRequest,
  permission: PermissionKey
): Promise<SessionPayload | NextResponse> {
  const session = getSession(req);
  if (!session) {
    return NextResponse.json({ error: "غير مصرح — الرجاء تسجيل الدخول" }, { status: 401 });
  }

  const allowed = await hasPermission(session.roleId, permission);
  if (!allowed) {
    return NextResponse.json({ error: "ليست لديك الصلاحية الكافية لهذا الإجراء" }, { status: 403 });
  }

  return session;
}

/**
 * Phase 9: some report endpoints must require TWO permissions at once (AND logic), not one.
 * Example: inventory-valuation report requires REPORTS_READ **and** INVENTORY_READ — this is
 * what structurally keeps ACCOUNTING (who holds REPORTS_READ + AUDIT_READ only, per the plan
 * doc's role table: "التقارير المالية فقط، بلا وصول للمخزون أو الطلبات التشغيلية") out of the
 * inventory/orders/delivery reports while still letting them reach the sales report under
 * requirePermission(REPORTS_READ) alone. requirePermission() itself is unchanged and still the
 * right choice for every single-permission route.
 */
export async function requirePermissions(
  req: NextRequest,
  permissions: PermissionKey[]
): Promise<SessionPayload | NextResponse> {
  const session = getSession(req);
  if (!session) {
    return NextResponse.json({ error: "غير مصرح — الرجاء تسجيل الدخول" }, { status: 401 });
  }

  for (const permission of permissions) {
    const allowed = await hasPermission(session.roleId, permission);
    if (!allowed) {
      return NextResponse.json({ error: "ليست لديك الصلاحية الكافية لهذا الإجراء" }, { status: 403 });
    }
  }

  return session;
}

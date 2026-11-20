import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/apiGuard";
import { PERMISSIONS } from "@/lib/rbac";
import { listAuditLog } from "@/lib/reports";

/**
 * GET /api/audit — the first route ever exposing audit_logs (written since Phase 1, never
 * read back until now). AUDIT_READ on its own, deliberately NOT REPORTS_READ — matches the
 * plan doc's seed grant (SUPER_ADMIN, ADMIN, ACCOUNTING hold AUDIT_READ) — and NOT
 * branch-scoped, since AuditLog has no branchId column (it logs actions, not branch data).
 */
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, PERMISSIONS.AUDIT_READ);
  if (guard instanceof NextResponse) return guard;

  const sp = req.nextUrl.searchParams;

  const fromParam = sp.get("from");
  const toParam = sp.get("to");
  const from = fromParam ? new Date(fromParam) : undefined;
  const to = toParam ? new Date(toParam) : undefined;
  if ((from && isNaN(from.getTime())) || (to && isNaN(to.getTime()))) {
    return NextResponse.json({ error: "تنسيق التاريخ غير صالح (from/to)" }, { status: 400 });
  }

  const logs = await listAuditLog({
    userId: sp.get("userId") ?? undefined,
    action: sp.get("action") ?? undefined,
    entity: sp.get("entity") ?? undefined,
    from,
    to,
    limit: sp.get("limit") ? Number(sp.get("limit")) : undefined,
  });

  return NextResponse.json({ logs });
}

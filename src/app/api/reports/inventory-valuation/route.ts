import { NextRequest, NextResponse } from "next/server";
import { requirePermissions } from "@/lib/apiGuard";
import { PERMISSIONS, canAccessBranch } from "@/lib/rbac";
import { getInventoryValuationReport } from "@/lib/reports";

/**
 * GET /api/reports/inventory-valuation — current stock value per branch + alert counts.
 * REPORTS_READ + INVENTORY_READ: ACCOUNTING holds REPORTS_READ but not INVENTORY_READ, so this
 * extra check is what structurally keeps them out, per the plan doc's role table.
 */
export async function GET(req: NextRequest) {
  const guard = await requirePermissions(req, [PERMISSIONS.REPORTS_READ, PERMISSIONS.INVENTORY_READ]);
  if (guard instanceof NextResponse) return guard;
  const session = guard;

  const sp = req.nextUrl.searchParams;
  let branchId = sp.get("branchId") ?? undefined;

  if (session.branchId !== null) {
    if (branchId && !canAccessBranch(session.branchId, branchId)) {
      return NextResponse.json({ error: "لا يمكنك الاطلاع على تقرير فرع آخر" }, { status: 403 });
    }
    branchId = session.branchId;
  }

  const report = await getInventoryValuationReport({ branchId });
  return NextResponse.json({ report });
}

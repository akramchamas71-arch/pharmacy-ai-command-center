import { NextRequest, NextResponse } from "next/server";
import { requirePermissions } from "@/lib/apiGuard";
import { PERMISSIONS, canAccessBranch } from "@/lib/rbac";
import { getOrdersOperationsReport } from "@/lib/reports";

/**
 * GET /api/reports/orders — order status breakdown, cancellation rate, approximate
 * fulfillment time. REPORTS_READ + ORDERS_READ — same ACCOUNTING-exclusion rationale as the
 * inventory-valuation report.
 */
export async function GET(req: NextRequest) {
  const guard = await requirePermissions(req, [PERMISSIONS.REPORTS_READ, PERMISSIONS.ORDERS_READ]);
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

  const fromParam = sp.get("from");
  const toParam = sp.get("to");
  const from = fromParam ? new Date(fromParam) : undefined;
  const to = toParam ? new Date(toParam) : undefined;
  if ((from && isNaN(from.getTime())) || (to && isNaN(to.getTime()))) {
    return NextResponse.json({ error: "تنسيق التاريخ غير صالح (from/to)" }, { status: 400 });
  }

  const report = await getOrdersOperationsReport({ branchId, from, to });
  return NextResponse.json({ report });
}

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/apiGuard";
import { PERMISSIONS, canAccessBranch } from "@/lib/rbac";
import { getSalesReport } from "@/lib/reports";

/**
 * GET /api/reports/sales — revenue, order volume, revenue-by-day and top products.
 * REPORTS_READ alone: the one report ACCOUNTING can reach without an extra domain permission,
 * per the plan doc's role table ("التقارير المالية فقط، بلا وصول للمخزون أو الطلبات التشغيلية").
 */
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, PERMISSIONS.REPORTS_READ);
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

  const report = await getSalesReport({ branchId, from, to });
  return NextResponse.json({ report });
}

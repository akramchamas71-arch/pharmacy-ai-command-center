import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/apiGuard";
import { PERMISSIONS, canAccessBranch } from "@/lib/rbac";
import { getInventoryAlerts } from "@/lib/inventory";

// Backs the Admin Dashboard's "today's overview" stock alerts (§13) and the Global
// Inventory screen (§14) — same query, reused.
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, PERMISSIONS.INVENTORY_READ);
  if (guard instanceof NextResponse) return guard;
  const session = guard;

  const sp = req.nextUrl.searchParams;
  let branchId = sp.get("branchId") ?? undefined;

  if (session.branchId !== null) {
    if (branchId && !canAccessBranch(session.branchId, branchId)) {
      return NextResponse.json({ error: "لا يمكنك الاطلاع على تنبيهات فرع آخر" }, { status: 403 });
    }
    branchId = session.branchId;
  }

  const nearExpiryDaysParam = sp.get("nearExpiryDays");
  const alerts = await getInventoryAlerts({
    branchId,
    nearExpiryDays: nearExpiryDaysParam ? Number(nearExpiryDaysParam) : undefined,
  });
  return NextResponse.json(alerts);
}

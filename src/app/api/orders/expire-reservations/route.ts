import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/apiGuard";
import { PERMISSIONS } from "@/lib/rbac";
import { releaseExpiredReservations } from "@/lib/orders";

// Manual trigger for the reservation-expiry sweep (see releaseExpiredReservations() for
// why this isn't a real cron yet — Phase 10's Background Jobs/Queue layer). Network-wide,
// not branch-scoped, since an expired hold anywhere ties up stock everywhere it's seen.
export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, PERMISSIONS.ORDERS_WRITE);
  if (guard instanceof NextResponse) return guard;

  const result = await releaseExpiredReservations();
  return NextResponse.json(result);
}

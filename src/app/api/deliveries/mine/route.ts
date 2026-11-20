import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/apiGuard";
import { PERMISSIONS } from "@/lib/rbac";
import { listMyDeliveries } from "@/lib/delivery";
import { NotFoundError } from "@/lib/errors";

// The "driver app" view: a driver's own active (not yet DELIVERED/FAILED) work queue.
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, PERMISSIONS.DELIVERY_MANAGE);
  if (guard instanceof NextResponse) return guard;
  const session = guard;

  try {
    const deliveries = await listMyDeliveries(session.userId);
    return NextResponse.json({ deliveries });
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    throw e;
  }
}

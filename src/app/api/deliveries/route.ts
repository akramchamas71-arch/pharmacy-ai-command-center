import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/apiGuard";
import { PERMISSIONS, canAccessBranch } from "@/lib/rbac";
import { createDelivery, listDeliveries } from "@/lib/delivery";
import { getOrder } from "@/lib/orders";
import { BusinessRuleError, NotFoundError } from "@/lib/errors";
import { DeliveryStatus } from "@prisma/client";

const createDeliverySchema = z.object({
  orderId: z.string().min(1),
  driverId: z.string().min(1),
});

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, PERMISSIONS.DELIVERY_MANAGE);
  if (guard instanceof NextResponse) return guard;
  const session = guard;

  const sp = req.nextUrl.searchParams;
  let branchId = sp.get("branchId") ?? undefined;

  if (session.branchId !== null) {
    if (branchId && !canAccessBranch(session.branchId, branchId)) {
      return NextResponse.json({ error: "لا يمكنك الاطلاع على توصيلات فرع آخر" }, { status: 403 });
    }
    branchId = session.branchId;
  }

  const statusParam = sp.get("status");
  const status = statusParam && statusParam in DeliveryStatus ? (statusParam as DeliveryStatus) : undefined;

  const deliveries = await listDeliveries({
    branchId,
    status,
    driverId: sp.get("driverId") ?? undefined,
    limit: sp.get("limit") ? Number(sp.get("limit")) : undefined,
  });
  return NextResponse.json({ deliveries });
}

// Assigns a driver to an order that's READY_FOR_DELIVERY — see src/lib/delivery.ts
// createDelivery() for the stock/order-status preconditions.
export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, PERMISSIONS.DELIVERY_MANAGE);
  if (guard instanceof NextResponse) return guard;
  const session = guard;

  const body = await req.json().catch(() => null);
  const parsed = createDeliverySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "البيانات المُدخلة غير صالحة", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const order = await getOrder(parsed.data.orderId);
    if (!canAccessBranch(session.branchId, order.branchId)) {
      return NextResponse.json({ error: "لا يمكنك تعيين توصيل لطلب فرع آخر" }, { status: 403 });
    }

    const delivery = await createDelivery({ ...parsed.data, userId: session.userId });
    return NextResponse.json({ delivery }, { status: 201 });
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    if (e instanceof BusinessRuleError) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
}

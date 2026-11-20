import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/apiGuard";
import { PERMISSIONS, canAccessBranch } from "@/lib/rbac";
import { getOrder, advanceOrderStatus } from "@/lib/orders";
import { BusinessRuleError, NotFoundError } from "@/lib/errors";
import { OrderStatus } from "@prisma/client";

type Params = { params: Promise<{ id: string }> };

const advanceSchema = z.object({
  status: z.enum(["PREPARING", "READY_FOR_DELIVERY", "OUT_FOR_DELIVERY", "DELIVERED"]),
});

// Moves an order through its post-confirmation fulfillment states. CONFIRMED and
// CANCELLED are deliberately not reachable here — use /confirm and /cancel, which carry
// the stock side effects those two transitions need.
export async function POST(req: NextRequest, { params }: Params) {
  const guard = await requirePermission(req, PERMISSIONS.ORDERS_WRITE);
  if (guard instanceof NextResponse) return guard;
  const session = guard;
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = advanceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "البيانات المُدخلة غير صالحة", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const existing = await getOrder(id);
    if (!canAccessBranch(session.branchId, existing.branchId)) {
      return NextResponse.json({ error: "لا يمكنك تعديل طلب فرع آخر" }, { status: 403 });
    }

    const order = await advanceOrderStatus(id, parsed.data.status as OrderStatus, session.userId);
    return NextResponse.json({ order });
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    if (e instanceof BusinessRuleError) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/apiGuard";
import { PERMISSIONS, canAccessBranch } from "@/lib/rbac";
import { getOrder, confirmOrder } from "@/lib/orders";
import { BusinessRuleError, NotFoundError } from "@/lib/errors";

type Params = { params: Promise<{ id: string }> };

// PENDING_CONFIRMATION -> CONFIRMED: commits the held stock (see confirmOrder() for the
// qtyOnHand/qtyReserved side effects). No separate approval permission — any role with
// ORDERS_WRITE for this branch may confirm; cancelling a CONFIRMED order is what needs
// ORDERS_CANCEL (see /cancel).
export async function POST(req: NextRequest, { params }: Params) {
  const guard = await requirePermission(req, PERMISSIONS.ORDERS_WRITE);
  if (guard instanceof NextResponse) return guard;
  const session = guard;
  const { id } = await params;

  try {
    const existing = await getOrder(id);
    if (!canAccessBranch(session.branchId, existing.branchId)) {
      return NextResponse.json({ error: "لا يمكنك تأكيد طلب فرع آخر" }, { status: 403 });
    }

    const order = await confirmOrder(id, session.userId);
    return NextResponse.json({ order });
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    if (e instanceof BusinessRuleError) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
}

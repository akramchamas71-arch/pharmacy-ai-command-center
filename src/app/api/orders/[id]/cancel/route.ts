import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/apiGuard";
import { PERMISSIONS, canAccessBranch, hasPermission } from "@/lib/rbac";
import { getOrder, cancelOrder } from "@/lib/orders";
import { BusinessRuleError, NotFoundError } from "@/lib/errors";
import { OrderStatus } from "@prisma/client";

type Params = { params: Promise<{ id: string }> };

const cancelSchema = z.object({ reason: z.string().optional() });

// Cancelling an order that was never confirmed just drops its reservation hold — any
// ORDERS_WRITE caller may do that. Cancelling one that already left PENDING_CONFIRMATION
// unwinds real stock movement, so the plan doc's §25 human-approval list requires
// ORDERS_CANCEL in addition — checked here (not inside cancelOrder()) because only the
// route knows the caller's role; the lib function just takes the already-decided
// `hasApproval` flag.
export async function POST(req: NextRequest, { params }: Params) {
  const guard = await requirePermission(req, PERMISSIONS.ORDERS_WRITE);
  if (guard instanceof NextResponse) return guard;
  const session = guard;
  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  const parsed = cancelSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "البيانات المُدخلة غير صالحة", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const existing = await getOrder(id);
    if (!canAccessBranch(session.branchId, existing.branchId)) {
      return NextResponse.json({ error: "لا يمكنك إلغاء طلب فرع آخر" }, { status: 403 });
    }

    const wasConfirmed = existing.status !== OrderStatus.PENDING_CONFIRMATION;
    const hasApproval = wasConfirmed ? await hasPermission(session.roleId, PERMISSIONS.ORDERS_CANCEL) : true;
    if (wasConfirmed && !hasApproval) {
      return NextResponse.json(
        { error: "إلغاء طلب تم تأكيده يتطلب صلاحية ORDERS_CANCEL" },
        { status: 403 }
      );
    }

    const order = await cancelOrder({ orderId: id, userId: session.userId, reason: parsed.data.reason, hasApproval });
    return NextResponse.json({ order });
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    if (e instanceof BusinessRuleError) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
}

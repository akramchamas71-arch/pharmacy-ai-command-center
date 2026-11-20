import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/apiGuard";
import { PERMISSIONS, canAccessBranch } from "@/lib/rbac";
import { getOrder } from "@/lib/orders";
import { NotFoundError } from "@/lib/errors";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const guard = await requirePermission(req, PERMISSIONS.ORDERS_READ);
  if (guard instanceof NextResponse) return guard;
  const session = guard;
  const { id } = await params;

  try {
    const order = await getOrder(id);
    if (!canAccessBranch(session.branchId, order.branchId)) {
      return NextResponse.json({ error: "لا يمكنك الاطلاع على طلب فرع آخر" }, { status: 403 });
    }
    return NextResponse.json({ order });
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    throw e;
  }
}

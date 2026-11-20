import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/apiGuard";
import { PERMISSIONS, canAccessBranch } from "@/lib/rbac";
import { getDelivery } from "@/lib/delivery";
import { NotFoundError } from "@/lib/errors";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const guard = await requirePermission(req, PERMISSIONS.DELIVERY_MANAGE);
  if (guard instanceof NextResponse) return guard;
  const session = guard;
  const { id } = await params;

  try {
    const delivery = await getDelivery(id);
    // Drivers aren't branch-scoped (branchId is null on a DELIVERY_DRIVER user — see
    // src/lib/users.ts), so this only actually restricts PHARMACY_MANAGER/PHARMACIST callers.
    if (!canAccessBranch(session.branchId, delivery.order.branchId)) {
      return NextResponse.json({ error: "لا يمكنك الاطلاع على توصيل فرع آخر" }, { status: 403 });
    }
    return NextResponse.json({ delivery });
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    throw e;
  }
}

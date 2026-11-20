import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/apiGuard";
import { PERMISSIONS } from "@/lib/rbac";
import { reassignDriver } from "@/lib/delivery";
import { BusinessRuleError, NotFoundError } from "@/lib/errors";

const schema = z.object({ driverId: z.string().min(1) });

type Params = { params: Promise<{ id: string }> };

// Also how a FAILED delivery is retried — see src/lib/delivery.ts reassignDriver()'s comment
// on why that's folded into this same endpoint instead of a separate "retry" action.
export async function POST(req: NextRequest, { params }: Params) {
  const guard = await requirePermission(req, PERMISSIONS.DELIVERY_MANAGE);
  if (guard instanceof NextResponse) return guard;
  const session = guard;
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "البيانات المُدخلة غير صالحة", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const delivery = await reassignDriver({
      deliveryId: id,
      driverId: parsed.data.driverId,
      caller: { userId: session.userId, roleName: session.roleName },
    });
    return NextResponse.json({ delivery });
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    if (e instanceof BusinessRuleError) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
}

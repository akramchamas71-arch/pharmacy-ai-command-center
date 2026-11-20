import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/apiGuard";
import { PERMISSIONS } from "@/lib/rbac";
import { advanceDeliveryStatus } from "@/lib/delivery";
import { BusinessRuleError, NotFoundError } from "@/lib/errors";
import { DeliveryStatus } from "@prisma/client";

const schema = z.object({
  status: z.nativeEnum(DeliveryStatus),
  reason: z.string().optional(),
});

type Params = { params: Promise<{ id: string }> };

// A driver advancing their OWN delivery, or a dispatcher/manager overriding any delivery —
// src/lib/delivery.ts's advanceDeliveryStatus() enforces which one the caller may do. On
// ON_THE_WAY/DELIVERED this also syncs the linked Order and sends a best-effort WhatsApp
// notification (see that function's comment on why those run as separate sequential steps).
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
    const delivery = await advanceDeliveryStatus({
      deliveryId: id,
      targetStatus: parsed.data.status,
      reason: parsed.data.reason,
      caller: { userId: session.userId, roleName: session.roleName },
    });
    return NextResponse.json({ delivery });
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    if (e instanceof BusinessRuleError) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
}

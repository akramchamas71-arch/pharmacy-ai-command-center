import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/apiGuard";
import { PERMISSIONS } from "@/lib/rbac";
import { setAvailability } from "@/lib/drivers";
import { NotFoundError } from "@/lib/errors";
import { DriverAvailability } from "@prisma/client";

const schema = z.object({ availability: z.nativeEnum(DriverAvailability) });

// Self-service only — always acts on the caller's own Driver row (see setAvailability()'s
// comment in src/lib/drivers.ts for why a dispatcher never sets this for someone else). A
// non-driver DELIVERY_MANAGE holder calling this 404s, since they have no linked Driver row.
export async function PATCH(req: NextRequest) {
  const guard = await requirePermission(req, PERMISSIONS.DELIVERY_MANAGE);
  if (guard instanceof NextResponse) return guard;
  const session = guard;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "البيانات المُدخلة غير صالحة", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const driver = await setAvailability(session.userId, parsed.data.availability);
    return NextResponse.json({ driver });
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    throw e;
  }
}

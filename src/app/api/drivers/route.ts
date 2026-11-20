import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/apiGuard";
import { PERMISSIONS } from "@/lib/rbac";
import { createDriverAccount, listDrivers } from "@/lib/drivers";
import { BusinessRuleError } from "@/lib/errors";
import { DriverAvailability } from "@prisma/client";

const createDriverSchema = z
  .object({
    name: z.string().min(1),
    email: z.string().email().optional(),
    phone: z.string().min(3).optional(),
    password: z.string().min(8),
    vehicle: z.string().optional(),
  })
  .refine((data) => data.email || data.phone, { message: "يجب إدخال بريد إلكتروني أو رقم هاتف" });

// Gated by USERS_MANAGE (SUPER_ADMIN only — see prisma/seed.ts), not DELIVERY_MANAGE: creating
// a *login account* is a user-management action, distinct from dispatching deliveries to one
// once it exists. See src/lib/users.ts's comment on why this minimal endpoint exists at all.
export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, PERMISSIONS.USERS_MANAGE);
  if (guard instanceof NextResponse) return guard;
  const session = guard;

  const body = await req.json().catch(() => null);
  const parsed = createDriverSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "البيانات المُدخلة غير صالحة", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const { user, driver } = await createDriverAccount({ ...parsed.data, createdByUserId: session.userId });
    return NextResponse.json({ user: { id: user.id, name: user.name, email: user.email, phone: user.phone }, driver }, { status: 201 });
  } catch (e) {
    if (e instanceof BusinessRuleError) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
}

// DELIVERY_MANAGE (not USERS_MANAGE) — a dispatcher needs the driver roster to assign
// deliveries, but doesn't need account-management rights to read it.
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, PERMISSIONS.DELIVERY_MANAGE);
  if (guard instanceof NextResponse) return guard;

  const sp = req.nextUrl.searchParams;
  const availabilityParam = sp.get("availability");
  const availability =
    availabilityParam && availabilityParam in DriverAvailability ? (availabilityParam as DriverAvailability) : undefined;

  const drivers = await listDrivers({ availability });
  return NextResponse.json({ drivers });
}

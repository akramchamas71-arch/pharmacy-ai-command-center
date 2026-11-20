import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/apiGuard";
import { PERMISSIONS } from "@/lib/rbac";
import { updateSupplier } from "@/lib/suppliers";
import { NotFoundError } from "@/lib/errors";

const supplierUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  whatsappNumber: z.string().min(6).optional(),
  specialty: z.string().optional().nullable(),
  deliveryContactWhatsapp: z.string().optional().nullable(),
  deliveryContactLabel: z.string().optional().nullable(),
  paymentTerms: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await requirePermission(req, PERMISSIONS.BRANCHES_MANAGE);
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = supplierUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "البيانات المُدخلة غير صالحة", details: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const supplier = await updateSupplier(id, parsed.data, guard.userId);
    return NextResponse.json({ supplier });
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    return NextResponse.json({ error: "تعذّر حفظ التعديلات" }, { status: 409 });
  }
}

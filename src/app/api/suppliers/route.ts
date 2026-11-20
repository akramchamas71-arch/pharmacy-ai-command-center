import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/apiGuard";
import { PERMISSIONS } from "@/lib/rbac";
import { listSuppliers, createSupplier } from "@/lib/suppliers";

const supplierInputSchema = z.object({
  name: z.string().min(1),
  whatsappNumber: z.string().min(6),
  specialty: z.string().optional().nullable(),
  deliveryContactWhatsapp: z.string().optional().nullable(),
  deliveryContactLabel: z.string().optional().nullable(),
  paymentTerms: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, PERMISSIONS.BRANCHES_MANAGE);
  if (guard instanceof NextResponse) return guard;
  const suppliers = await listSuppliers(true);
  return NextResponse.json({ suppliers });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, PERMISSIONS.BRANCHES_MANAGE);
  if (guard instanceof NextResponse) return guard;

  const body = await req.json().catch(() => null);
  const parsed = supplierInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "البيانات المُدخلة غير صالحة", details: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const supplier = await createSupplier(parsed.data, guard.userId);
    return NextResponse.json({ supplier }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "تعذّر إضافة الشركة — ربما رقم واتساب مسجّل مسبقاً" }, { status: 409 });
  }
}

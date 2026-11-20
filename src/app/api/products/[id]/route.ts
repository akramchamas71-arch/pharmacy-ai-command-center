import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { requirePermission } from "@/lib/apiGuard";
import { PERMISSIONS } from "@/lib/rbac";
import { getProduct, updateProduct, deleteProduct } from "@/lib/products";
import { BusinessRuleError, NotFoundError } from "@/lib/errors";
import { ProductType } from "@prisma/client";

const productUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  brand: z.string().optional().nullable(),
  barcode: z.string().optional().nullable(),
  genericName: z.string().optional().nullable(),
  activeIngredient: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  type: z.nativeEnum(ProductType).optional(),
  imageUrl: z.string().optional().nullable(),
});

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const session = getSession(req);
  if (!session) {
    return NextResponse.json({ error: "غير مصرح — الرجاء تسجيل الدخول" }, { status: 401 });
  }
  const { id } = await params;

  try {
    const product = await getProduct(id);
    return NextResponse.json({ product });
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    throw e;
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await requirePermission(req, PERMISSIONS.PRODUCTS_MANAGE);
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = productUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "البيانات المُدخلة غير صالحة", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const product = await updateProduct(id, parsed.data);
    return NextResponse.json({ product });
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    throw e;
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const guard = await requirePermission(req, PERMISSIONS.PRODUCTS_MANAGE);
  if (guard instanceof NextResponse) return guard;
  const session = guard;
  const { id } = await params;

  try {
    await deleteProduct(id, session.userId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    if (e instanceof BusinessRuleError) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
}

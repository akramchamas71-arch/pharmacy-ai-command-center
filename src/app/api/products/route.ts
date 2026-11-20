import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { requirePermission } from "@/lib/apiGuard";
import { PERMISSIONS } from "@/lib/rbac";
import { searchProducts, createProduct } from "@/lib/products";
import { ProductType } from "@prisma/client";

const productInputSchema = z.object({
  name: z.string().min(1),
  brand: z.string().optional().nullable(),
  barcode: z.string().optional().nullable(),
  genericName: z.string().optional().nullable(),
  activeIngredient: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  type: z.nativeEnum(ProductType).optional(),
  imageUrl: z.string().optional().nullable(),
});

// GET is read-only catalog search — every logged-in role may use it (it's exactly what
// the Phase 5 AI search tool will call under the hood). Only PRODUCTS_MANAGE may create.
export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session) {
    return NextResponse.json({ error: "غير مصرح — الرجاء تسجيل الدخول" }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const typeParam = sp.get("type");
  const type = typeParam && typeParam in ProductType ? (typeParam as ProductType) : undefined;

  const products = await searchProducts({
    query: sp.get("q") ?? undefined,
    type,
    category: sp.get("category") ?? undefined,
    limit: sp.get("limit") ? Number(sp.get("limit")) : undefined,
  });
  return NextResponse.json({ products });
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, PERMISSIONS.PRODUCTS_MANAGE);
  if (guard instanceof NextResponse) return guard;

  const body = await req.json().catch(() => null);
  const parsed = productInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "البيانات المُدخلة غير صالحة", details: parsed.error.flatten() }, { status: 400 });
  }

  const product = await createProduct(parsed.data);
  return NextResponse.json({ product }, { status: 201 });
}

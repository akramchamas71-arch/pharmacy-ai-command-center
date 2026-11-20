import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/apiGuard";
import { PERMISSIONS, canAccessBranch } from "@/lib/rbac";
import { listInventory, upsertInventoryMeta } from "@/lib/inventory";
import { prisma } from "@/lib/prisma";

const upsertSchema = z.object({
  productId: z.string().min(1),
  branchId: z.string().min(1),
  price: z.number().nonnegative(),
  lowStockThreshold: z.number().int().nonnegative().optional(),
  expiryDate: z.string().datetime().optional().nullable(),
});

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, PERMISSIONS.INVENTORY_READ);
  if (guard instanceof NextResponse) return guard;
  const session = guard;

  const sp = req.nextUrl.searchParams;
  let branchId = sp.get("branchId") ?? undefined;

  // Branch-scoped roles (PHARMACY_MANAGER/PHARMACIST/PHARMACY_EMPLOYEE) never see another
  // branch's inventory: a mismatched branchId is rejected rather than silently ignored,
  // and no branchId at all defaults to their own branch instead of the whole network.
  if (session.branchId !== null) {
    if (branchId && !canAccessBranch(session.branchId, branchId)) {
      return NextResponse.json({ error: "لا يمكنك الاطلاع على مخزون فرع آخر" }, { status: 403 });
    }
    branchId = session.branchId;
  }

  const inventory = await listInventory({ branchId, productId: sp.get("productId") ?? undefined });
  return NextResponse.json({ inventory });
}

// Creates the product-at-branch row (first stocking) or edits its price / low-stock
// threshold / expiry. Quantity itself is never set here — see POST /api/inventory/adjust,
// which is the only path that changes qtyOnHand so every change is logged.
export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, PERMISSIONS.INVENTORY_WRITE);
  if (guard instanceof NextResponse) return guard;
  const session = guard;

  const body = await req.json().catch(() => null);
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "البيانات المُدخلة غير صالحة", details: parsed.error.flatten() }, { status: 400 });
  }
  const { productId, branchId, price, lowStockThreshold, expiryDate } = parsed.data;

  if (!canAccessBranch(session.branchId, branchId)) {
    return NextResponse.json({ error: "لا يمكنك تعديل مخزون فرع آخر" }, { status: 403 });
  }

  // Price changes on an EXISTING row are a sensitive operation per the plan doc's
  // human-approval list (§25) — require PRICING_WRITE in addition to INVENTORY_WRITE
  // whenever the price actually moves. Setting the initial price while first stocking a
  // product is not a "change" in that sense, so it only needs INVENTORY_WRITE.
  const existing = await prisma.inventory.findUnique({
    where: { productId_branchId: { productId, branchId } },
  });
  if (existing && Number(existing.price) !== price) {
    const priceGuard = await requirePermission(req, PERMISSIONS.PRICING_WRITE);
    if (priceGuard instanceof NextResponse) return priceGuard;
  }

  const record = await upsertInventoryMeta({
    productId,
    branchId,
    price,
    lowStockThreshold,
    expiryDate: expiryDate ? new Date(expiryDate) : expiryDate === null ? null : undefined,
    userId: session.userId,
  });
  return NextResponse.json({ inventory: record }, { status: 201 });
}

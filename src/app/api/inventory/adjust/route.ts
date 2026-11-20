import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/apiGuard";
import { PERMISSIONS, canAccessBranch } from "@/lib/rbac";
import { adjustInventory, getInventoryRecord } from "@/lib/inventory";
import { BusinessRuleError, NotFoundError } from "@/lib/errors";
import { InventoryTxType } from "@prisma/client";

const adjustSchema = z.object({
  inventoryId: z.string().min(1),
  type: z.nativeEnum(InventoryTxType),
  deltaQty: z.number().int().refine((n) => n !== 0, "deltaQty لا يمكن أن يساوي صفر"),
  note: z.string().optional(),
  refOrderId: z.string().optional(),
});

// The only route that ever changes qtyOnHand directly (outside the Phase 3 reservation
// flow) — every call is one row in inventory_transactions, per the plan doc's audit
// requirement. Stock receipts, breakage/loss write-offs, and manual counts all go through
// this one endpoint with a different `type`, never a raw PATCH on the inventory row.
export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, PERMISSIONS.INVENTORY_WRITE);
  if (guard instanceof NextResponse) return guard;
  const session = guard;

  const body = await req.json().catch(() => null);
  const parsed = adjustSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "البيانات المُدخلة غير صالحة", details: parsed.error.flatten() }, { status: 400 });
  }
  const { inventoryId, type, deltaQty, note, refOrderId } = parsed.data;

  try {
    const record = await getInventoryRecord(inventoryId);
    if (!canAccessBranch(session.branchId, record.branchId)) {
      return NextResponse.json({ error: "لا يمكنك تعديل مخزون فرع آخر" }, { status: 403 });
    }

    const updated = await adjustInventory({
      inventoryId,
      type,
      deltaQty,
      userId: session.userId,
      note,
      refOrderId,
    });
    return NextResponse.json({ inventory: updated });
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    if (e instanceof BusinessRuleError) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
}

import { prisma } from "@/lib/prisma";
import { BusinessRuleError, NotFoundError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { InventoryTxType, Prisma } from "@prisma/client";

export interface InventoryListOptions {
  branchId?: string;
  productId?: string;
}

// The shape every query below returns (inventory row + its product and branch) — named
// once via Prisma's own generated payload type so a schema change updates every caller
// through the type checker instead of a runtime surprise.
type InventoryWithRelations = Prisma.InventoryGetPayload<{ include: { product: true; branch: true } }>;

export async function listInventory(opts: InventoryListOptions = {}) {
  return prisma.inventory.findMany({
    where: {
      branchId: opts.branchId,
      productId: opts.productId,
    },
    include: { product: true, branch: true },
    orderBy: [{ branchId: "asc" }, { product: { name: "asc" } }],
  });
}

export async function getInventoryRecord(id: string) {
  const record = await prisma.inventory.findUnique({
    where: { id },
    include: { product: true, branch: true },
  });
  if (!record) throw new NotFoundError(`لا يوجد سجل مخزون بهذا المعرّف: ${id}`);
  return record;
}

/**
 * Creates (or updates, if one already exists) the inventory row linking a product to a
 * branch — the entry point for "start stocking this product at this branch" and for
 * editing its price / low-stock threshold / expiry without touching the on-hand quantity.
 * Quantity changes always go through adjustInventory() below so every change to qtyOnHand
 * is logged in inventory_transactions; this function never touches qtyOnHand directly.
 */
export async function upsertInventoryMeta(input: {
  productId: string;
  branchId: string;
  price: number;
  lowStockThreshold?: number;
  expiryDate?: Date | null;
  userId?: string | null;
}) {
  const { productId, branchId, price, lowStockThreshold, expiryDate, userId = null } = input;

  // Phase 10 hardening: this is one of the plan doc's §25 human-approval-adjacent actions
  // (a price CHANGE on an existing row additionally requires PRICING_WRITE, checked by the
  // calling route) — it never wrote an audit_logs row despite that, a real gap found during
  // the same review that caught branches.ts/products.ts missing the same thing. Wrapped in a
  // transaction so the before-state read, the write, and the audit row are all consistent.
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const before = await tx.inventory.findUnique({ where: { productId_branchId: { productId, branchId } } });

    const updated = await tx.inventory.upsert({
      where: { productId_branchId: { productId, branchId } },
      update: {
        price,
        ...(lowStockThreshold !== undefined ? { lowStockThreshold } : {}),
        ...(expiryDate !== undefined ? { expiryDate } : {}),
      },
      create: {
        productId,
        branchId,
        price,
        lowStockThreshold: lowStockThreshold ?? 10,
        expiryDate: expiryDate ?? null,
        qtyOnHand: 0,
        qtyReserved: 0,
      },
    });

    await logAudit(
      {
        userId,
        action: before ? "inventory.upsertMeta" : "inventory.firstStock",
        entity: `Inventory:${updated.id}`,
        oldValue: before ? { price: before.price.toString(), lowStockThreshold: before.lowStockThreshold } : undefined,
        newValue: { price: updated.price.toString(), lowStockThreshold: updated.lowStockThreshold },
      },
      tx
    );

    return updated;
  });
}

export interface AdjustInventoryInput {
  inventoryId: string;
  type: InventoryTxType;
  /** Positive to add stock (STOCK_IN), negative to remove it (STOCK_OUT/ADJUSTMENT down). */
  deltaQty: number;
  userId: string | null;
  note?: string;
  refOrderId?: string;
}

/**
 * The single place qtyOnHand is ever changed outside the (Phase 3) reservation flow.
 * Atomic: the quantity update and its audit-trail row are written in one transaction, so
 * inventory_transactions always reconciles with the current qtyOnHand — never used
 * directly by an API route without a permission check having already happened.
 */
export async function adjustInventory(input: AdjustInventoryInput) {
  const { inventoryId, type, deltaQty, userId, note, refOrderId } = input;

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const current = await tx.inventory.findUnique({ where: { id: inventoryId } });
    if (!current) throw new NotFoundError(`لا يوجد سجل مخزون بهذا المعرّف: ${inventoryId}`);

    const newQty = current.qtyOnHand + deltaQty;
    if (newQty < 0) {
      throw new BusinessRuleError(
        `الكمية غير كافية: المتوفر حاليًا ${current.qtyOnHand}، والعملية تطلب إنقاص ${Math.abs(deltaQty)}.`
      );
    }
    if (newQty < current.qtyReserved) {
      throw new BusinessRuleError(
        `لا يمكن أن تقل الكمية المتوفرة عن الكمية المحجوزة حاليًا (${current.qtyReserved}).`
      );
    }

    const updated = await tx.inventory.update({
      where: { id: inventoryId },
      data: { qtyOnHand: newQty },
    });

    await tx.inventoryTransaction.create({
      data: {
        inventoryId,
        type,
        qty: deltaQty,
        userId: userId ?? undefined,
        note,
        refOrderId,
      },
    });

    // Phase 10 hardening: inventory_transactions already recorded this (it's the
    // domain-specific stock ledger), but it never also reached audit_logs — the
    // cross-cutting trail every other sensitive mutation (orders, deliveries) writes to.
    await logAudit(
      {
        userId,
        action: "inventory.adjust",
        entity: `Inventory:${inventoryId}`,
        oldValue: { qtyOnHand: current.qtyOnHand },
        newValue: { qtyOnHand: newQty, type, deltaQty, note: note ?? null },
      },
      tx
    );

    return updated;
  });
}

export interface AlertOptions {
  branchId?: string;
  nearExpiryDays?: number;
}

/**
 * Backs the plan doc's "Global Inventory screen with stock alerts" (§14) and the Reports
 * module's low-stock / expiry reports (§18) — one query each, reused by both.
 */
export async function getInventoryAlerts(opts: AlertOptions = {}) {
  const { branchId, nearExpiryDays = 60 } = opts;
  const baseWhere: Prisma.InventoryWhereInput = branchId ? { branchId } : {};

  const all: InventoryWithRelations[] = await prisma.inventory.findMany({
    where: baseWhere,
    include: { product: true, branch: true },
  });

  const outOfStock = all.filter((i: InventoryWithRelations) => i.qtyOnHand - i.qtyReserved <= 0);
  const lowStock = all.filter(
    (i: InventoryWithRelations) =>
      i.qtyOnHand - i.qtyReserved > 0 && i.qtyOnHand - i.qtyReserved <= i.lowStockThreshold
  );

  const expiryHorizon = new Date();
  expiryHorizon.setDate(expiryHorizon.getDate() + nearExpiryDays);
  const nearExpiry = all.filter((i: InventoryWithRelations) => i.expiryDate && i.expiryDate <= expiryHorizon);

  return { outOfStock, lowStock, nearExpiry };
}

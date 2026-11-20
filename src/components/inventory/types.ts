/**
 * Plain string-literal mirror of `InventoryTxType` (prisma/schema.prisma) — never import
 * "@prisma/client" from frontend code (see the note at the top of page.tsx).
 *
 * RESERVATION_HOLD / RESERVATION_RELEASE are written automatically by the Phase 3 order
 * reservation flow, not something a human picks from a form, so the manual "تعديل الكمية"
 * modal only offers STOCK_IN / STOCK_OUT / ADJUSTMENT. This is an assumption flagged in the
 * final summary — the task text didn't say explicitly to exclude them, but nothing in the
 * API or schema comments suggests a human should ever select them by hand either.
 */
export type InventoryTxType = "STOCK_IN" | "STOCK_OUT" | "ADJUSTMENT" | "RESERVATION_HOLD" | "RESERVATION_RELEASE";

export type ManualInventoryTxType = "STOCK_IN" | "STOCK_OUT" | "ADJUSTMENT";

export const MANUAL_TX_TYPES: ManualInventoryTxType[] = ["STOCK_IN", "STOCK_OUT", "ADJUSTMENT"];

export const INVENTORY_TX_TYPE_LABELS_AR: Record<ManualInventoryTxType, string> = {
  STOCK_IN: "وارد (استلام بضاعة)",
  STOCK_OUT: "صادر (نقص / تالف / مرتجع)",
  ADJUSTMENT: "تصحيح جرد (عد يدوي)",
};

/** Branch reference shape used by the branch picker (GET /api/branches). */
export interface BranchRef {
  id: string;
  name: string;
}

/** Shape of an inventory row as returned by GET /api/inventory and /api/inventory/alerts
 * (src/lib/inventory.ts includes { product: true, branch: true }). `price` is a Prisma
 * Decimal field, which serializes to a JSON string — read it with Number(item.price). */
export interface InventoryItem {
  id: string;
  productId: string;
  branchId: string;
  qtyOnHand: number;
  qtyReserved: number;
  lowStockThreshold: number;
  price: string | number;
  expiryDate: string | null;
  updatedAt: string;
  product: { id: string; name: string };
  branch: { id: string; name: string };
}

export interface InventoryAlerts {
  outOfStock: InventoryItem[];
  lowStock: InventoryItem[];
  nearExpiry: InventoryItem[];
}

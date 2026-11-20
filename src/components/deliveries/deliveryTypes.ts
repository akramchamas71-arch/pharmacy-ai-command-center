/**
 * Plain string-literal mirror of DeliveryStatus from prisma/schema.prisma — see the
 * matching comment in src/components/orders/orderTypes.ts on why this is not imported
 * from "@prisma/client" in this sandbox.
 */
export type DeliveryStatus = "ASSIGNED" | "ACCEPTED" | "PICKED_UP" | "ON_THE_WAY" | "DELIVERED" | "FAILED";

export const DELIVERY_STATUSES: DeliveryStatus[] = [
  "ASSIGNED",
  "ACCEPTED",
  "PICKED_UP",
  "ON_THE_WAY",
  "DELIVERED",
  "FAILED",
];

export const DELIVERY_STATUS_LABELS_AR: Record<DeliveryStatus, string> = {
  ASSIGNED: "مُعيَّن لسائق",
  ACCEPTED: "قبِله السائق",
  PICKED_UP: "تم الاستلام من الفرع",
  ON_THE_WAY: "في الطريق",
  DELIVERED: "تم التسليم",
  FAILED: "فشل التوصيل",
};

export function deliveryStatusLabel(status: string): string {
  return DELIVERY_STATUS_LABELS_AR[status as DeliveryStatus] ?? status;
}

export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info" | "brand";

export const DELIVERY_STATUS_TONES: Record<DeliveryStatus, BadgeTone> = {
  ASSIGNED: "neutral",
  ACCEPTED: "info",
  PICKED_UP: "brand",
  ON_THE_WAY: "brand",
  DELIVERED: "success",
  FAILED: "danger",
};

/** Mirrors DELIVERY_TRANSITIONS in src/lib/delivery.ts. */
export const DELIVERY_ADVANCE_TRANSITIONS: Record<DeliveryStatus, DeliveryStatus[]> = {
  ASSIGNED: ["ACCEPTED", "FAILED"],
  ACCEPTED: ["PICKED_UP", "FAILED"],
  PICKED_UP: ["ON_THE_WAY", "FAILED"],
  ON_THE_WAY: ["DELIVERED", "FAILED"],
  DELIVERED: [],
  FAILED: [],
};

/**
 * Mirrors REASSIGNABLE_FROM in src/lib/delivery.ts — a delivery may get a (re)assigned
 * driver from ASSIGNED, ACCEPTED or FAILED. FAILED -> reassign IS the retry mechanism
 * (there's no separate "retry" endpoint), not after PICKED_UP where the original driver
 * already physically holds the order.
 */
export const DELIVERY_REASSIGNABLE_FROM: DeliveryStatus[] = ["ASSIGNED", "ACCEPTED", "FAILED"];

export interface DeliveryDriverUser {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
}

export type DriverAvailability = "AVAILABLE" | "BUSY" | "OFFLINE";

export interface DeliveryDriver {
  id: string;
  vehicle: string | null;
  availability: DriverAvailability;
  user: DeliveryDriverUser;
}

export interface DeliveryOrderCustomer {
  id: string;
  name: string | null;
  phone: string;
}

export interface DeliveryOrderBranch {
  id: string;
  name: string;
}

export interface DeliveryOrder {
  id: string;
  orderNumber: string;
  branchId: string;
  branch: DeliveryOrderBranch;
  customer: DeliveryOrderCustomer;
}

export interface Delivery {
  id: string;
  orderId: string;
  driverId: string | null;
  status: DeliveryStatus;
  /** A Prisma Decimal serializes to JSON as a string — accept either. */
  amountToCollect: string | number;
  notes: string | null;
  createdAt: string;
  order: DeliveryOrder;
  driver: DeliveryDriver | null;
}

export function toNumber(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
}

export function formatMoney(value: string | number): string {
  return `$${toNumber(value).toFixed(2)}`;
}

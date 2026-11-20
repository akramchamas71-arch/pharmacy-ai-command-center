/**
 * Plain string-literal types mirroring the real enums in prisma/schema.prisma
 * (OrderStatus, PaymentMethod, OrderSource). Deliberately NOT imported from
 * "@prisma/client" — see the sandbox note in this project: the local generated
 * Prisma client here is a known-broken stub, but these values match the real
 * schema and work correctly against the real backend.
 */
export type OrderStatus =
  | "PENDING_CONFIRMATION"
  | "CONFIRMED"
  | "PREPARING"
  | "READY_FOR_DELIVERY"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "CANCELLED";

export type PaymentMethod = "CASH_ON_DELIVERY" | "CARD_ON_DELIVERY" | "OTHER";

export type OrderSource = "DIRECT" | "CARELINK";

export const ORDER_STATUSES: OrderStatus[] = [
  "PENDING_CONFIRMATION",
  "CONFIRMED",
  "PREPARING",
  "READY_FOR_DELIVERY",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "CANCELLED",
];

export const ORDER_STATUS_LABELS_AR: Record<OrderStatus, string> = {
  PENDING_CONFIRMATION: "بانتظار التأكيد",
  CONFIRMED: "مؤكد",
  PREPARING: "قيد التحضير",
  READY_FOR_DELIVERY: "جاهز للتوصيل",
  OUT_FOR_DELIVERY: "خرج للتوصيل",
  DELIVERED: "تم التسليم",
  CANCELLED: "ملغي",
};

export function orderStatusLabel(status: string): string {
  return ORDER_STATUS_LABELS_AR[status as OrderStatus] ?? status;
}

export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info" | "brand";

export const ORDER_STATUS_TONES: Record<OrderStatus, BadgeTone> = {
  PENDING_CONFIRMATION: "warning",
  CONFIRMED: "info",
  PREPARING: "brand",
  READY_FOR_DELIVERY: "brand",
  OUT_FOR_DELIVERY: "brand",
  DELIVERED: "success",
  CANCELLED: "danger",
};

export const PAYMENT_METHOD_LABELS_AR: Record<PaymentMethod, string> = {
  CASH_ON_DELIVERY: "الدفع عند التسليم",
  CARD_ON_DELIVERY: "بطاقة عند التسليم",
  OTHER: "طريقة أخرى",
};

export function paymentMethodLabel(method: string): string {
  return PAYMENT_METHOD_LABELS_AR[method as PaymentMethod] ?? method;
}

export const ORDER_SOURCE_LABELS_AR: Record<OrderSource, string> = {
  DIRECT: "مباشر",
  CARELINK: "كير لينك",
};

export function orderSourceLabel(source: string): string {
  return ORDER_SOURCE_LABELS_AR[source as OrderSource] ?? source;
}

/**
 * Mirrors ADVANCE_TRANSITIONS in src/lib/orders.ts. CONFIRMED and CANCELLED are
 * deliberately unreachable here — they only happen through /confirm and /cancel,
 * which carry stock side effects the generic /advance endpoint must never have.
 */
export const ORDER_ADVANCE_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING_CONFIRMATION: [],
  CONFIRMED: ["PREPARING"],
  PREPARING: ["READY_FOR_DELIVERY"],
  READY_FOR_DELIVERY: ["OUT_FOR_DELIVERY"],
  OUT_FOR_DELIVERY: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: [],
};

/** Mirrors CANCELLABLE_FROM in src/lib/orders.ts. */
export const ORDER_CANCELLABLE_FROM: OrderStatus[] = [
  "PENDING_CONFIRMATION",
  "CONFIRMED",
  "PREPARING",
  "READY_FOR_DELIVERY",
];

export interface OrderCustomer {
  id: string;
  name: string | null;
  phone: string;
  address?: string | null;
}

export interface OrderBranch {
  id: string;
  name: string;
}

export interface OrderProduct {
  id: string;
  name: string;
}

export interface OrderItemRow {
  id: string;
  productId: string;
  qty: number;
  /** A Prisma Decimal serializes to JSON as a string — accept either. */
  price: string | number;
  product: OrderProduct;
}

export interface OrderDeliverySummary {
  id: string;
  status: string;
}

export interface OrderSummary {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  source: OrderSource;
  createdAt: string;
  customer: OrderCustomer | null;
  branch: OrderBranch;
}

export interface OrderDetail extends OrderSummary {
  deliveryAddress: string | null;
  notes: string | null;
  items: OrderItemRow[];
  delivery?: OrderDeliverySummary | null;
}

export function toNumber(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
}

export function formatMoney(value: string | number): string {
  return `$${toNumber(value).toFixed(2)}`;
}

export function orderTotal(order: OrderDetail): number {
  return order.items.reduce((sum, item) => sum + toNumber(item.price) * item.qty, 0);
}

export function formatDateTimeAr(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ar", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

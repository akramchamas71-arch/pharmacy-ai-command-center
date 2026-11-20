import { prisma } from "@/lib/prisma";
import { BusinessRuleError, NotFoundError } from "@/lib/errors";
import { findOrCreateCustomerByPhone } from "@/lib/customers";
import { generateOrderNumber } from "@/lib/orderNumber";
import { logAudit } from "@/lib/audit";
import { InventoryTxType, OrderSource, OrderStatus, PaymentMethod, Prisma, ReservationStatus } from "@prisma/client";

// Unconfirmed holds auto-release after this long — see the Inventory model's comment in
// schema.prisma and releaseExpiredReservations() below.
export const RESERVATION_TTL_MINUTES = 15;

// The order lifecycle from the plan doc: PENDING_CONFIRMATION -> CONFIRMED -> PREPARING ->
// READY_FOR_DELIVERY -> OUT_FOR_DELIVERY -> DELIVERED, or CANCELLED at any point up to
// READY_FOR_DELIVERY. CONFIRMED itself is reached only via confirmOrder() (it has stock
// side effects a plain status write must never have), never through this generic map.
const ADVANCE_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING_CONFIRMATION: [],
  CONFIRMED: [OrderStatus.PREPARING],
  PREPARING: [OrderStatus.READY_FOR_DELIVERY],
  READY_FOR_DELIVERY: [OrderStatus.OUT_FOR_DELIVERY],
  OUT_FOR_DELIVERY: [OrderStatus.DELIVERED],
  DELIVERED: [],
  CANCELLED: [],
};

const CANCELLABLE_FROM: OrderStatus[] = [
  OrderStatus.PENDING_CONFIRMATION,
  OrderStatus.CONFIRMED,
  OrderStatus.PREPARING,
  OrderStatus.READY_FOR_DELIVERY,
];

export interface CreateOrderItemInput {
  productId: string;
  qty: number;
}

export interface CreateOrderInput {
  branchId: string;
  customerPhone: string;
  customerName?: string;
  deliveryAddress?: string;
  paymentMethod?: PaymentMethod;
  notes?: string;
  items: CreateOrderItemInput[];
  userId: string | null;
  // Phase 7 (CareLink) plumbing — see the OrderSource enum's comment in schema.prisma. Optional,
  // defaults to DIRECT (schema default) when omitted — nothing in THIS function decides when an
  // order is CareLink-sourced; that's up to the caller. UPDATE: now that the real CareLink
  // intake flow is confirmed and built (see ConversationChannel in schema.prisma), the AI tool
  // wrapper (src/lib/aiTools.ts's create_order) DOES pass this — derived from the calling
  // conversation's trusted, server-recorded `channel`, never from anything the model typed
  // into its own tool-call input. A direct (non-CareLink) API caller that omits this still gets
  // the schema default, DIRECT, exactly as before.
  source?: OrderSource;
}

/**
 * Creates an order AND holds the stock for it in one atomic transaction — the plan doc's
 * reservation system. Every line is checked against availability (qtyOnHand - qtyReserved)
 * before anything is written, so one out-of-stock item fails the whole order instead of
 * leaving a half-reserved cart; the order starts PENDING_CONFIRMATION with its reservations
 * HELD and a `RESERVATION_TTL_MINUTES`-minute clock — see confirmOrder() and
 * releaseExpiredReservations() for what happens next.
 */
export async function createOrder(input: CreateOrderInput) {
  const { branchId, customerPhone, customerName, deliveryAddress, paymentMethod, notes, items, userId, source } = input;

  if (items.length === 0) {
    throw new BusinessRuleError("الطلب يجب أن يحتوي على صنف واحد على الأقل.");
  }

  // Merge duplicate product lines so "2x paracetamol" sent twice reserves 2, not 1+1
  // against two separate (and redundant) reservation rows.
  const qtyByProduct = new Map<string, number>();
  for (const item of items) {
    if (!Number.isInteger(item.qty) || item.qty <= 0) {
      throw new BusinessRuleError("كمية كل صنف يجب أن تكون عدداً صحيحاً أكبر من صفر.");
    }
    qtyByProduct.set(item.productId, (qtyByProduct.get(item.productId) ?? 0) + item.qty);
  }

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const customer = await findOrCreateCustomerByPhone(
      { phone: customerPhone, name: customerName, address: deliveryAddress },
      tx
    );

    // Resolve every line (and lock in its current price) before writing anything.
    const lines: { inventory: Prisma.InventoryGetPayload<{ include: { product: true } }>; qty: number }[] = [];
    for (const [productId, qty] of qtyByProduct) {
      const inventory = await tx.inventory.findUnique({
        where: { productId_branchId: { productId, branchId } },
        include: { product: true },
      });
      if (!inventory) {
        throw new BusinessRuleError(`المنتج غير متوفر في هذا الفرع (المعرّف: ${productId}).`);
      }
      const available = inventory.qtyOnHand - inventory.qtyReserved;
      if (available < qty) {
        throw new BusinessRuleError(
          `الكمية المتوفرة من "${inventory.product.name}" غير كافية (المتوفر: ${available}، المطلوب: ${qty}).`
        );
      }
      lines.push({ inventory, qty });
    }

    const orderNumber = await generateOrderNumber(tx);

    const order = await tx.order.create({
      data: {
        orderNumber,
        customerId: customer.id,
        branchId,
        status: OrderStatus.PENDING_CONFIRMATION,
        paymentMethod: paymentMethod ?? PaymentMethod.CASH_ON_DELIVERY,
        source: source ?? OrderSource.DIRECT,
        deliveryAddress: deliveryAddress ?? customer.address ?? null,
        notes,
      },
    });

    const expiresAt = new Date(Date.now() + RESERVATION_TTL_MINUTES * 60 * 1000);

    for (const { inventory, qty } of lines) {
      const orderItem = await tx.orderItem.create({
        data: { orderId: order.id, productId: inventory.productId, qty, price: inventory.price },
      });

      await tx.inventory.update({
        where: { id: inventory.id },
        data: { qtyReserved: { increment: qty } },
      });

      await tx.inventoryTransaction.create({
        data: {
          inventoryId: inventory.id,
          type: InventoryTxType.RESERVATION_HOLD,
          qty,
          refOrderId: order.id,
          userId: userId ?? undefined,
          note: `حجز للطلب ${orderNumber}`,
        },
      });

      await tx.reservation.create({
        data: { orderItemId: orderItem.id, inventoryId: inventory.id, status: ReservationStatus.HELD, expiresAt },
      });
    }

    await logAudit(
      {
        userId,
        action: "order.create",
        entity: `Order:${order.id}`,
        newValue: { orderNumber, branchId, customerId: customer.id, items: Array.from(qtyByProduct.entries()) },
      },
      tx
    );

    return tx.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { items: { include: { product: true } }, customer: true, branch: true },
    });
  });
}

/**
 * PENDING_CONFIRMATION -> CONFIRMED. This is the moment the held stock is actually
 * committed: qtyOnHand and qtyReserved both drop together (a STOCK_OUT transaction), and
 * every reservation moves HELD -> CONSUMED. Refuses a reservation that already expired —
 * the caller should create a fresh order instead of confirming stale stock.
 */
export async function confirmOrder(orderId: string, userId: string | null) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { reservation: true, product: true } } },
    });
    if (!order) throw new NotFoundError(`لا يوجد طلب بهذا المعرّف: ${orderId}`);
    if (order.status !== OrderStatus.PENDING_CONFIRMATION) {
      throw new BusinessRuleError(`لا يمكن تأكيد طلب في الحالة الحالية (${order.status}).`);
    }

    const now = new Date();
    for (const item of order.items) {
      const reservation = item.reservation;
      if (!reservation || reservation.status !== ReservationStatus.HELD) {
        throw new BusinessRuleError(`حجز غير صالح لأحد أصناف الطلب "${item.product.name}".`);
      }
      if (reservation.expiresAt < now) {
        throw new BusinessRuleError(
          `انتهت صلاحية حجز "${item.product.name}" — ألغِ هذا الطلب وأنشئ طلباً جديداً.`
        );
      }
    }

    for (const item of order.items) {
      const reservation = item.reservation!;
      const current = await tx.inventory.findUniqueOrThrow({ where: { id: reservation.inventoryId } });
      if (current.qtyOnHand < item.qty) {
        // Should be unreachable (the hold already reserved this qty), but never silently
        // let an inventory row go negative.
        throw new BusinessRuleError(`مخزون غير كافٍ لإتمام تأكيد الطلب — راجع المخزون يدوياً.`);
      }

      await tx.inventory.update({
        where: { id: reservation.inventoryId },
        data: { qtyOnHand: { decrement: item.qty }, qtyReserved: { decrement: item.qty } },
      });

      await tx.inventoryTransaction.create({
        data: {
          inventoryId: reservation.inventoryId,
          type: InventoryTxType.STOCK_OUT,
          qty: -item.qty,
          refOrderId: order.id,
          userId: userId ?? undefined,
          note: `تأكيد الطلب ${order.orderNumber}`,
        },
      });

      await tx.reservation.update({ where: { id: reservation.id }, data: { status: ReservationStatus.CONSUMED } });
    }

    const updated = await tx.order.update({ where: { id: orderId }, data: { status: OrderStatus.CONFIRMED } });

    await logAudit(
      { userId, action: "order.confirm", entity: `Order:${orderId}`, oldValue: { status: order.status }, newValue: { status: updated.status } },
      tx
    );

    return updated;
  });
}

export interface CancelOrderInput {
  orderId: string;
  userId: string | null;
  reason?: string;
  /** True once the caller's route has verified ORDERS_CANCEL — required only when the
   * order already left PENDING_CONFIRMATION, per the plan doc's human-approval list (§25). */
  hasApproval: boolean;
}

/**
 * Cancels an order and unwinds whatever happened to its stock: a still-HELD reservation
 * is just dropped (RESERVATION_RELEASE, qtyReserved only); a CONSUMED one means the stock
 * already left the branch at confirmation, so it's added back to qtyOnHand (logged as an
 * ADJUSTMENT referencing the order) before the reservation is marked RELEASED.
 */
export async function cancelOrder(input: CancelOrderInput) {
  const { orderId, userId, reason, hasApproval } = input;

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { reservation: true } } },
    });
    if (!order) throw new NotFoundError(`لا يوجد طلب بهذا المعرّف: ${orderId}`);
    if (!CANCELLABLE_FROM.includes(order.status)) {
      throw new BusinessRuleError(`لا يمكن إلغاء طلب في الحالة الحالية (${order.status}).`);
    }

    const wasConfirmed = order.status !== OrderStatus.PENDING_CONFIRMATION;
    if (wasConfirmed && !hasApproval) {
      throw new BusinessRuleError(
        "إلغاء طلب تم تأكيده يتطلب صلاحية ORDERS_CANCEL (موافقة بشرية) — راجع قسم الأمان في خطة المشروع."
      );
    }

    for (const item of order.items) {
      const reservation = item.reservation;
      if (!reservation || reservation.status === ReservationStatus.RELEASED) continue;

      if (reservation.status === ReservationStatus.HELD) {
        await tx.inventory.update({
          where: { id: reservation.inventoryId },
          data: { qtyReserved: { decrement: item.qty } },
        });
        await tx.inventoryTransaction.create({
          data: {
            inventoryId: reservation.inventoryId,
            type: InventoryTxType.RESERVATION_RELEASE,
            qty: item.qty,
            refOrderId: order.id,
            userId: userId ?? undefined,
            note: reason ?? `إلغاء الطلب ${order.orderNumber}`,
          },
        });
      } else {
        // CONSUMED — the stock already left qtyOnHand at confirmation; give it back.
        await tx.inventory.update({
          where: { id: reservation.inventoryId },
          data: { qtyOnHand: { increment: item.qty } },
        });
        await tx.inventoryTransaction.create({
          data: {
            inventoryId: reservation.inventoryId,
            type: InventoryTxType.ADJUSTMENT,
            qty: item.qty,
            refOrderId: order.id,
            userId: userId ?? undefined,
            note: reason ?? `عكس مخزون بسبب إلغاء الطلب ${order.orderNumber}`,
          },
        });
      }

      await tx.reservation.update({ where: { id: reservation.id }, data: { status: ReservationStatus.RELEASED } });
    }

    const updated = await tx.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.CANCELLED,
        notes: reason ? [order.notes, `[إلغاء] ${reason}`].filter(Boolean).join("\n") : order.notes,
      },
    });

    await logAudit(
      {
        userId,
        action: "order.cancel",
        entity: `Order:${orderId}`,
        oldValue: { status: order.status },
        newValue: { status: "CANCELLED", reason: reason ?? null },
      },
      tx
    );

    return updated;
  });
}

/**
 * Moves an order forward through the post-confirmation fulfillment states (PREPARING ->
 * READY_FOR_DELIVERY -> OUT_FOR_DELIVERY -> DELIVERED). No stock side effects — those all
 * happened at confirmOrder() — so this is a validated status write + audit row. Reaching
 * CONFIRMED or CANCELLED is deliberately NOT possible through this function; use
 * confirmOrder() / cancelOrder() instead, which carry the side effects those transitions need.
 */
export async function advanceOrderStatus(orderId: string, targetStatus: OrderStatus, userId: string | null) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundError(`لا يوجد طلب بهذا المعرّف: ${orderId}`);

    const currentStatus = order.status as OrderStatus;
    const allowed = ADVANCE_TRANSITIONS[currentStatus];
    if (!allowed.includes(targetStatus)) {
      throw new BusinessRuleError(`لا يمكن الانتقال من الحالة ${order.status} إلى ${targetStatus} مباشرة.`);
    }

    const updated = await tx.order.update({ where: { id: orderId }, data: { status: targetStatus } });

    await logAudit(
      { userId, action: "order.advance", entity: `Order:${orderId}`, oldValue: { status: order.status }, newValue: { status: targetStatus } },
      tx
    );

    return updated;
  });
}

/**
 * The sweep for reservations whose TTL ran out before anyone confirmed them. A real
 * schedule for this is Phase 10 territory (the plan doc's "Background Jobs/Queue" layer in
 * the architecture) — for now it's exposed as POST /api/orders/expire-reservations so it
 * can be called manually, or wired to any cron once one exists. Only ever touches orders
 * still PENDING_CONFIRMATION, because a reservation stays HELD exactly until confirmOrder()
 * (-> CONSUMED) or cancelOrder() (-> RELEASED) runs.
 */
export async function releaseExpiredReservations(): Promise<{ cancelledOrderIds: string[] }> {
  const expired = await prisma.reservation.findMany({
    where: { status: ReservationStatus.HELD, expiresAt: { lt: new Date() } },
    select: { orderItem: { select: { orderId: true } } },
  });

  const orderIds: string[] = Array.from(
    new Set(expired.map((r: { orderItem: { orderId: string } }) => r.orderItem.orderId))
  );
  const cancelledOrderIds: string[] = [];

  for (const orderId of orderIds) {
    try {
      await cancelOrder({
        orderId,
        userId: null,
        reason: "انتهت صلاحية حجز المخزون تلقائياً",
        hasApproval: true, // irrelevant here — these orders are always still PENDING_CONFIRMATION
      });
      cancelledOrderIds.push(orderId);
    } catch (e) {
      // Someone else (a confirm/cancel racing this sweep) already moved the order past
      // PENDING_CONFIRMATION between the read above and this call — leave it alone.
      if (e instanceof BusinessRuleError) continue;
      throw e;
    }
  }

  return { cancelledOrderIds };
}

export interface OrderListOptions {
  branchId?: string;
  status?: OrderStatus;
  customerId?: string;
  limit?: number;
}

export async function listOrders(opts: OrderListOptions = {}) {
  return prisma.order.findMany({
    where: { branchId: opts.branchId, status: opts.status, customerId: opts.customerId },
    include: { items: { include: { product: true } }, customer: true, branch: true },
    orderBy: { createdAt: "desc" },
    take: Math.min(opts.limit ?? 50, 200),
  });
}

export async function getOrder(id: string) {
  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      items: { include: { product: true, reservation: true } },
      customer: true,
      branch: true,
      delivery: true,
    },
  });
  if (!order) throw new NotFoundError(`لا يوجد طلب بهذا المعرّف: ${id}`);
  return order;
}


export interface CarelinkBrokerOrderInput {
  branchId: string;
  customerId: string;
  deliveryAddress?: string | null;
  notes?: string;
  items: { productId: string; qty: number; price: number }[];
  userId: string | null;
}

/**
 * CareLink broker order: the pharmacy has ALREADY confirmed availability and quoted a price over
 * WhatsApp (CarelinkInquiry ANSWERED) and the customer approved it. The stock lives in the
 * pharmacy's own system, so — unlike createOrder() — nothing is checked against or reserved from
 * this app's Inventory table (the pharmacy physically sets the item aside). The order starts
 * CONFIRMED, source CARELINK, with the pharmacy's quoted price on each line.
 */
export async function createCarelinkBrokerOrder(input: CarelinkBrokerOrderInput) {
  const { branchId, customerId, deliveryAddress, notes, items, userId } = input;
  if (items.length === 0) throw new BusinessRuleError("الطلب يجب أن يحتوي على صنف واحد على الأقل.");

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const customer = await tx.customer.findUniqueOrThrow({ where: { id: customerId } });
    if (deliveryAddress && deliveryAddress.trim() && deliveryAddress.trim() !== customer.address) {
      await tx.customer.update({ where: { id: customerId }, data: { address: deliveryAddress.trim() } });
    }
    const orderNumber = await generateOrderNumber(tx);
    const order = await tx.order.create({
      data: {
        orderNumber,
        customerId,
        branchId,
        status: OrderStatus.CONFIRMED,
        paymentMethod: PaymentMethod.CASH_ON_DELIVERY,
        source: OrderSource.CARELINK,
        deliveryAddress: deliveryAddress?.trim() || customer.address || null,
        notes,
      },
    });
    for (const it of items) {
      await tx.orderItem.create({ data: { orderId: order.id, productId: it.productId, qty: it.qty, price: it.price } });
    }
    await logAudit(
      {
        userId,
        action: "order.create.carelink",
        entity: `Order:${order.id}`,
        newValue: { orderNumber, branchId, customerId, items },
      },
      tx
    );
    return order;
  });
}

import { prisma } from "@/lib/prisma";
import { BusinessRuleError, NotFoundError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { advanceOrderStatus } from "@/lib/orders";
import { notifyCustomer } from "@/lib/conversations";
import { ROLES } from "@/lib/rbac";
import { DeliveryStatus, OrderStatus, Prisma } from "@prisma/client";

/** The caller's identity, as every route hands it down from requirePermission()'s session. */
export interface DeliveryCaller {
  userId: string;
  roleName: string;
}

// Driver-lifecycle advances only — ASSIGNED is reached at creation or via reassignDriver()'s
// FAILED -> ASSIGNED retry (see below), never through this map. DELIVERED and FAILED are
// terminal: a failed delivery can only move forward again via reassignDriver(), not advance().
const DELIVERY_TRANSITIONS: Record<DeliveryStatus, DeliveryStatus[]> = {
  ASSIGNED: [DeliveryStatus.ACCEPTED, DeliveryStatus.FAILED],
  ACCEPTED: [DeliveryStatus.PICKED_UP, DeliveryStatus.FAILED],
  PICKED_UP: [DeliveryStatus.ON_THE_WAY, DeliveryStatus.FAILED],
  ON_THE_WAY: [DeliveryStatus.DELIVERED, DeliveryStatus.FAILED],
  DELIVERED: [],
  FAILED: [],
};

// A delivery may be (re)assigned a driver from ASSIGNED, ACCEPTED, or FAILED — not after
// PICKED_UP, where the original driver already physically holds the order. FAILED is the
// "retry" case: Delivery.orderId is @unique (schema.prisma), so a failed delivery can never
// get a second row — reassignDriver() reuses this same row and resets it to ASSIGNED instead.
const REASSIGNABLE_FROM: DeliveryStatus[] = [DeliveryStatus.ASSIGNED, DeliveryStatus.ACCEPTED, DeliveryStatus.FAILED];

function assertOwnsDelivery(caller: DeliveryCaller, driverUserId: string | undefined | null) {
  if (caller.roleName === ROLES.DELIVERY_DRIVER && driverUserId !== caller.userId) {
    throw new BusinessRuleError("لا يمكنك تعديل توصيل مُعيّن لسائق آخر.");
  }
}

export interface CreateDeliveryInput {
  orderId: string;
  driverId: string;
  userId: string | null;
}

/**
 * Assigns a driver to an order that's ready to go out. Requires the order to already be
 * READY_FOR_DELIVERY (orders.ts's own lifecycle gate — this never advances the order itself,
 * confirmOrder()/advanceOrderStatus() already did that). amountToCollect is computed from the
 * order's own line items since Phase 3 orders don't carry a stored total.
 */
export async function createDelivery(input: CreateDeliveryInput) {
  const { orderId, driverId, userId } = input;

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: true, delivery: true },
    });
    if (!order) throw new NotFoundError(`لا يوجد طلب بهذا المعرّف: ${orderId}`);
    if (order.status !== OrderStatus.READY_FOR_DELIVERY) {
      throw new BusinessRuleError(
        `لا يمكن تعيين توصيل لطلب في الحالة الحالية (${order.status}) — يجب أن يكون جاهزاً للتوصيل أولاً.`
      );
    }
    if (order.delivery) {
      throw new BusinessRuleError("يوجد توصيل مرتبط بهذا الطلب مسبقاً — استخدم إعادة تعيين السائق بدلاً من ذلك.");
    }

    const driver = await tx.driver.findUnique({ where: { id: driverId } });
    if (!driver) throw new NotFoundError(`لا يوجد سائق بهذا المعرّف: ${driverId}`);

    let amountToCollect = new Prisma.Decimal(0);
    for (const item of order.items) {
      amountToCollect = amountToCollect.add(item.price.mul(item.qty));
    }

    const delivery = await tx.delivery.create({
      data: { orderId, driverId, amountToCollect, status: DeliveryStatus.ASSIGNED },
    });

    await logAudit(
      {
        userId,
        action: "delivery.create",
        entity: `Delivery:${delivery.id}`,
        newValue: { orderId, driverId, amountToCollect: amountToCollect.toString() },
      },
      tx
    );

    return delivery;
  });
}

export interface ReassignDriverInput {
  deliveryId: string;
  driverId: string;
  caller: DeliveryCaller;
}

/**
 * Changes who's carrying a delivery — the dispatcher's manual override, and also how a
 * FAILED delivery is retried (there's no separate "retry" function: resetting FAILED back to
 * ASSIGNED with a new driver IS the retry, forced by Delivery.orderId's @unique constraint).
 * Always resets status to ASSIGNED regardless of where it started, since the new driver
 * hasn't accepted/picked up anything yet.
 */
export async function reassignDriver(input: ReassignDriverInput) {
  const { deliveryId, driverId, caller } = input;

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const delivery = await tx.delivery.findUnique({ where: { id: deliveryId }, include: { driver: true } });
    if (!delivery) throw new NotFoundError(`لا يوجد توصيل بهذا المعرّف: ${deliveryId}`);

    assertOwnsDelivery(caller, delivery.driver?.userId);

    const currentStatus = delivery.status as DeliveryStatus;
    if (!REASSIGNABLE_FROM.includes(currentStatus)) {
      throw new BusinessRuleError(`لا يمكن إعادة تعيين سائق لتوصيل في الحالة الحالية (${delivery.status}).`);
    }

    const newDriver = await tx.driver.findUnique({ where: { id: driverId } });
    if (!newDriver) throw new NotFoundError(`لا يوجد سائق بهذا المعرّف: ${driverId}`);

    const updated = await tx.delivery.update({
      where: { id: deliveryId },
      data: { driverId, status: DeliveryStatus.ASSIGNED },
    });

    await logAudit(
      {
        userId: caller.userId,
        action: "delivery.reassignDriver",
        entity: `Delivery:${deliveryId}`,
        oldValue: { driverId: delivery.driverId, status: delivery.status },
        newValue: { driverId, status: updated.status },
      },
      tx
    );

    return updated;
  });
}

export interface AdvanceDeliveryInput {
  deliveryId: string;
  targetStatus: DeliveryStatus;
  caller: DeliveryCaller;
  reason?: string;
}

/**
 * Moves a delivery through its own driver-facing lifecycle. Ownership check: a DELIVERY_DRIVER
 * caller may only advance their own delivery; any other DELIVERY_MANAGE holder (dispatcher,
 * branch manager, admin) can act on any delivery — the plan doc's dispatcher-override case.
 *
 * On reaching ON_THE_WAY / DELIVERED, this also advances the linked Order (orders.ts's
 * advanceOrderStatus()) and sends a best-effort WhatsApp notification. Both run as separate
 * sequential calls AFTER the delivery's own transaction commits, not inside one shared
 * transaction — composing across orders.ts's and this module's transactions would mean
 * exposing orders.ts's transaction internals, which is more refactor than Phase 6's scope
 * calls for. Documented tradeoff (see README): if the Order-sync step fails after the
 * Delivery already advanced, it's recoverable with a manual POST to /api/orders/[id]/advance.
 */
export async function advanceDeliveryStatus(input: AdvanceDeliveryInput) {
  const { deliveryId, targetStatus, caller, reason } = input;

  const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const delivery = await tx.delivery.findUnique({
      where: { id: deliveryId },
      include: { driver: true, order: true },
    });
    if (!delivery) throw new NotFoundError(`لا يوجد توصيل بهذا المعرّف: ${deliveryId}`);

    assertOwnsDelivery(caller, delivery.driver?.userId);

    const currentStatus = delivery.status as DeliveryStatus;
    const allowed = DELIVERY_TRANSITIONS[currentStatus];
    if (!allowed.includes(targetStatus)) {
      throw new BusinessRuleError(`لا يمكن الانتقال من حالة التوصيل ${delivery.status} إلى ${targetStatus} مباشرة.`);
    }

    const updated = await tx.delivery.update({
      where: { id: deliveryId },
      data: {
        status: targetStatus,
        notes: reason ? [delivery.notes, `[${targetStatus}] ${reason}`].filter(Boolean).join("\n") : delivery.notes,
      },
    });

    await logAudit(
      {
        userId: caller.userId,
        action: "delivery.advance",
        entity: `Delivery:${deliveryId}`,
        oldValue: { status: delivery.status },
        newValue: { status: targetStatus, reason: reason ?? null },
      },
      tx
    );

    return {
      delivery: updated,
      orderId: delivery.orderId,
      orderNumber: delivery.order.orderNumber,
      customerId: delivery.order.customerId,
    };
  });

  if (targetStatus === DeliveryStatus.ON_THE_WAY) {
    await advanceOrderStatus(result.orderId, OrderStatus.OUT_FOR_DELIVERY, caller.userId);
    await notifyCustomer(
      result.customerId,
      `طلبك رقم ${result.orderNumber} في الطريق إليك الآن.`,
      caller.userId
    );
  } else if (targetStatus === DeliveryStatus.DELIVERED) {
    await advanceOrderStatus(result.orderId, OrderStatus.DELIVERED, caller.userId);
    await notifyCustomer(
      result.customerId,
      `تم تسليم طلبك رقم ${result.orderNumber} بنجاح. نشكرك على تعاملك معنا!`,
      caller.userId
    );
  }

  return result.delivery;
}

export async function getDelivery(id: string) {
  const delivery = await prisma.delivery.findUnique({
    where: { id },
    include: {
      order: { include: { items: { include: { product: true } }, customer: true, branch: true } },
      driver: { include: { user: true } },
    },
  });
  if (!delivery) throw new NotFoundError(`لا يوجد توصيل بهذا المعرّف: ${id}`);
  return delivery;
}

export interface DeliveryListOptions {
  branchId?: string;
  status?: DeliveryStatus;
  driverId?: string;
  limit?: number;
}

/** Branch-scoped via the related order's branchId, same convention as listOrders() in orders.ts. */
export async function listDeliveries(opts: DeliveryListOptions = {}) {
  return prisma.delivery.findMany({
    where: {
      status: opts.status,
      driverId: opts.driverId,
      order: opts.branchId ? { branchId: opts.branchId } : undefined,
    },
    include: {
      order: { include: { customer: true, branch: true } },
      driver: { include: { user: true } },
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(opts.limit ?? 50, 200),
  });
}

/** A driver's own active work queue — a "driver app" view, excludes finished deliveries. */
export async function listMyDeliveries(userId: string) {
  const driver = await prisma.driver.findUnique({ where: { userId } });
  if (!driver) throw new NotFoundError("لا يوجد سائق مرتبط بهذا الحساب.");

  return prisma.delivery.findMany({
    where: { driverId: driver.id, status: { notIn: [DeliveryStatus.DELIVERED, DeliveryStatus.FAILED] } },
    include: { order: { include: { items: { include: { product: true } }, customer: true, branch: true } } },
    orderBy: { createdAt: "asc" },
  });
}

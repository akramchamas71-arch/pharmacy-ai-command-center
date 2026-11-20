import { prisma } from "@/lib/prisma";
import { getInventoryAlerts } from "@/lib/inventory";
import { DeliveryStatus, OrderStatus, Prisma } from "@prisma/client";

// Statuses that count as "real" revenue — a PENDING_CONFIRMATION order hasn't committed any
// stock yet (see orders.ts confirmOrder()) and a CANCELLED one never will, so neither belongs
// in a sales figure. Every other status has passed through confirmOrder() at least once.
const REVENUE_STATUSES: OrderStatus[] = [
  OrderStatus.CONFIRMED,
  OrderStatus.PREPARING,
  OrderStatus.READY_FOR_DELIVERY,
  OrderStatus.OUT_FOR_DELIVERY,
  OrderStatus.DELIVERED,
];

export interface DateRangeOptions {
  branchId?: string;
  from?: Date;
  to?: Date;
}

function dateRangeWhere(from?: Date, to?: Date): Prisma.DateTimeFilter | undefined {
  if (!from && !to) return undefined;
  return { gte: from, lte: to };
}

// yyyy-mm-dd bucket key in UTC — good enough for a daily revenue chart; not timezone-aware
// (the plan doc hasn't named a branch timezone anywhere in the schema).
function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Revenue, order volume and a top-products breakdown for a branch (or all branches) within an
 * optional date range. REPORTS_READ alone — the one report ACCOUNTING is explicitly allowed
 * per the plan doc's role table ("التقارير المالية فقط").
 */
export async function getSalesReport(opts: DateRangeOptions = {}) {
  const { branchId, from, to } = opts;

  const orders = await prisma.order.findMany({
    where: {
      branchId,
      status: { in: REVENUE_STATUSES },
      createdAt: dateRangeWhere(from, to),
    },
    include: { items: { include: { product: true } } },
  });

  let revenue = new Prisma.Decimal(0);
  const revenueByDayMap = new Map<string, Prisma.Decimal>();
  const productAgg = new Map<string, { productId: string; name: string; qty: number; revenue: Prisma.Decimal }>();

  for (const order of orders) {
    let orderTotal = new Prisma.Decimal(0);
    for (const item of order.items) {
      const lineTotal = item.price.mul(item.qty);
      orderTotal = orderTotal.add(lineTotal);

      const existing = productAgg.get(item.productId);
      if (existing) {
        existing.qty += item.qty;
        existing.revenue = existing.revenue.add(lineTotal);
      } else {
        productAgg.set(item.productId, {
          productId: item.productId,
          name: item.product.name,
          qty: item.qty,
          revenue: lineTotal,
        });
      }
    }
    revenue = revenue.add(orderTotal);

    const key = dayKey(order.createdAt);
    revenueByDayMap.set(key, (revenueByDayMap.get(key) ?? new Prisma.Decimal(0)).add(orderTotal));
  }

  const orderCount = orders.length;
  const avgOrderValue = orderCount > 0 ? revenue.div(orderCount) : new Prisma.Decimal(0);

  const revenueByDay = Array.from(revenueByDayMap.entries())
    .map(([date, total]) => ({ date, revenue: total.toNumber() }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const topProducts = Array.from(productAgg.values())
    .map((p) => ({ productId: p.productId, name: p.name, qty: p.qty, revenue: p.revenue.toNumber() }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  return {
    branchId: branchId ?? null,
    from: from ?? null,
    to: to ?? null,
    orderCount,
    revenue: revenue.toNumber(),
    avgOrderValue: avgOrderValue.toNumber(),
    revenueByDay,
    topProducts,
  };
}

/**
 * Current stock value (qtyOnHand * price) per branch, plus the same alert counts the Global
 * Inventory screen shows (reuses getInventoryAlerts() rather than re-deriving the thresholds).
 * Requires REPORTS_READ + INVENTORY_READ — the extra permission is what structurally keeps
 * ACCOUNTING (REPORTS_READ only, no INVENTORY_READ) out of this one, per the plan doc.
 */
export async function getInventoryValuationReport(opts: { branchId?: string } = {}) {
  const { branchId } = opts;

  const rows = await prisma.inventory.findMany({
    where: { branchId },
    include: { product: true, branch: true },
  });

  const byBranch = new Map<
    string,
    { branchId: string; branchName: string; totalUnits: number; totalValue: Prisma.Decimal; productCount: number }
  >();

  for (const row of rows) {
    const value = row.price.mul(row.qtyOnHand);
    const existing = byBranch.get(row.branchId);
    if (existing) {
      existing.totalUnits += row.qtyOnHand;
      existing.totalValue = existing.totalValue.add(value);
      existing.productCount += 1;
    } else {
      byBranch.set(row.branchId, {
        branchId: row.branchId,
        branchName: row.branch.name,
        totalUnits: row.qtyOnHand,
        totalValue: value,
        productCount: 1,
      });
    }
  }

  const alerts = await getInventoryAlerts({ branchId });

  return {
    branchId: branchId ?? null,
    byBranch: Array.from(byBranch.values()).map((b) => ({ ...b, totalValue: b.totalValue.toNumber() })),
    totalValue: Array.from(byBranch.values())
      .reduce((sum, b) => sum.add(b.totalValue), new Prisma.Decimal(0))
      .toNumber(),
    alerts: {
      outOfStockCount: alerts.outOfStock.length,
      lowStockCount: alerts.lowStock.length,
      nearExpiryCount: alerts.nearExpiry.length,
    },
  };
}

/**
 * Order volume by status, cancellation rate, and an approximate fulfillment time for a branch
 * (or all branches) within an optional date range. Requires REPORTS_READ + ORDERS_READ.
 *
 * "Fulfillment time" here is (updatedAt - createdAt) for orders that reached DELIVERED — the
 * schema has no dedicated "delivered at" timestamp (see schema.prisma's Order model), so this
 * approximates using the last time the row was written, which in practice is the DELIVERED
 * status write itself (advanceOrderStatus() never touches a DELIVERED order again). Flagged
 * as an approximation in the API response, not presented as exact.
 */
export async function getOrdersOperationsReport(opts: DateRangeOptions = {}) {
  const { branchId, from, to } = opts;

  const orders = await prisma.order.findMany({
    where: { branchId, createdAt: dateRangeWhere(from, to) },
    select: { status: true, createdAt: true, updatedAt: true },
  });

  const statusCounts: Record<OrderStatus, number> = {
    PENDING_CONFIRMATION: 0,
    CONFIRMED: 0,
    PREPARING: 0,
    READY_FOR_DELIVERY: 0,
    OUT_FOR_DELIVERY: 0,
    DELIVERED: 0,
    CANCELLED: 0,
  };
  let fulfillmentHoursTotal = 0;
  let fulfillmentSampleCount = 0;

  for (const order of orders) {
    statusCounts[order.status as OrderStatus] += 1;
    if (order.status === OrderStatus.DELIVERED) {
      const hours = (order.updatedAt.getTime() - order.createdAt.getTime()) / 3_600_000;
      fulfillmentHoursTotal += hours;
      fulfillmentSampleCount += 1;
    }
  }

  const total = orders.length;
  const cancellationRate = total > 0 ? statusCounts.CANCELLED / total : 0;
  const avgFulfillmentTimeHours =
    fulfillmentSampleCount > 0 ? fulfillmentHoursTotal / fulfillmentSampleCount : null;

  return {
    branchId: branchId ?? null,
    from: from ?? null,
    to: to ?? null,
    totalOrders: total,
    statusCounts,
    cancellationRate,
    avgFulfillmentTimeHours,
    avgFulfillmentTimeIsApproximate: true,
  };
}

/**
 * Delivery outcomes and a per-driver breakdown for a branch (or all branches) within an
 * optional date range. Requires REPORTS_READ + DELIVERY_MANAGE.
 *
 * Same approximation as above: "delivery time" is (updatedAt - createdAt) for deliveries that
 * reached DELIVERED, since Delivery has no dedicated per-status timestamp columns either —
 * only one shared updatedAt (schema.prisma's Delivery model).
 */
export async function getDeliveryPerformanceReport(opts: DateRangeOptions = {}) {
  const { branchId, from, to } = opts;

  const deliveries = await prisma.delivery.findMany({
    where: {
      createdAt: dateRangeWhere(from, to),
      order: branchId ? { branchId } : undefined,
    },
    include: { driver: { include: { user: true } } },
  });

  const statusCounts: Record<DeliveryStatus, number> = {
    ASSIGNED: 0,
    ACCEPTED: 0,
    PICKED_UP: 0,
    ON_THE_WAY: 0,
    DELIVERED: 0,
    FAILED: 0,
  };

  interface DriverAgg {
    driverId: string;
    driverName: string;
    delivered: number;
    failed: number;
    hoursTotal: number;
    hoursSamples: number;
  }
  const byDriver = new Map<string, DriverAgg>();
  let hoursTotal = 0;
  let hoursSamples = 0;

  for (const d of deliveries) {
    statusCounts[d.status as DeliveryStatus] += 1;

    if (d.driverId) {
      const existing = byDriver.get(d.driverId) ?? {
        driverId: d.driverId,
        driverName: d.driver?.user.name ?? "غير معروف",
        delivered: 0,
        failed: 0,
        hoursTotal: 0,
        hoursSamples: 0,
      };
      if (d.status === DeliveryStatus.DELIVERED) existing.delivered += 1;
      if (d.status === DeliveryStatus.FAILED) existing.failed += 1;
      byDriver.set(d.driverId, existing);
    }

    if (d.status === DeliveryStatus.DELIVERED) {
      const hours = (d.updatedAt.getTime() - d.createdAt.getTime()) / 3_600_000;
      hoursTotal += hours;
      hoursSamples += 1;
      if (d.driverId) {
        const existing = byDriver.get(d.driverId)!;
        existing.hoursTotal += hours;
        existing.hoursSamples += 1;
      }
    }
  }

  const total = deliveries.length;
  const failureRate = total > 0 ? statusCounts.FAILED / total : 0;
  const avgDeliveryTimeHours = hoursSamples > 0 ? hoursTotal / hoursSamples : null;

  const driverBreakdown = Array.from(byDriver.values()).map((d) => ({
    driverId: d.driverId,
    driverName: d.driverName,
    delivered: d.delivered,
    failed: d.failed,
    avgDeliveryTimeHours: d.hoursSamples > 0 ? d.hoursTotal / d.hoursSamples : null,
  }));

  return {
    branchId: branchId ?? null,
    from: from ?? null,
    to: to ?? null,
    totalDeliveries: total,
    statusCounts,
    failureRate,
    avgDeliveryTimeHours,
    avgDeliveryTimeIsApproximate: true,
    driverBreakdown,
  };
}

export interface AuditLogListOptions {
  userId?: string;
  action?: string;
  entity?: string;
  from?: Date;
  to?: Date;
  limit?: number;
}

/**
 * The first route ever exposing audit_logs (the table has existed since Phase 1, written by
 * logAudit() throughout, never read back until now). Deliberately its OWN permission —
 * AUDIT_READ, not REPORTS_READ — matching the plan doc's seed grant (SUPER_ADMIN, ADMIN,
 * ACCOUNTING hold AUDIT_READ) and not branch-scoped, since AuditLog has no branchId column.
 */
export async function listAuditLog(opts: AuditLogListOptions = {}) {
  const { userId, action, entity, from, to, limit } = opts;

  return prisma.auditLog.findMany({
    where: {
      userId,
      action: action ? { contains: action } : undefined,
      entity: entity ? { contains: entity } : undefined,
      createdAt: dateRangeWhere(from, to),
    },
    include: { user: true },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit ?? 100, 500),
  });
}

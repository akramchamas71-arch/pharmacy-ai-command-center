import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export interface AuditEntry {
  userId: string | null;
  action: string; // e.g. "order.cancel", "order.confirm", "inventory.adjust"
  entity: string; // e.g. "Order:ord_123"
  oldValue?: unknown;
  newValue?: unknown;
}

/**
 * Writes one row to audit_logs. Per the plan doc's security model every sensitive state
 * change (order cancellation, status transitions, future price/prescription approvals)
 * must leave a trace of who did what and the before/after — this is the one place that
 * happens, called from inside the SAME transaction as the change it's recording so the
 * audit row and the change it describes commit or roll back together.
 */
export async function logAudit(
  entry: AuditEntry,
  tx: Prisma.TransactionClient | typeof prisma = prisma
): Promise<void> {
  await tx.auditLog.create({
    data: {
      userId: entry.userId ?? undefined,
      action: entry.action,
      entity: entry.entity,
      oldValue: entry.oldValue === undefined ? undefined : (entry.oldValue as Prisma.InputJsonValue),
      newValue: entry.newValue === undefined ? undefined : (entry.newValue as Prisma.InputJsonValue),
    },
  });
}

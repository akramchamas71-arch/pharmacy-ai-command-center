import { prisma } from "@/lib/prisma";
import { BusinessRuleError, NotFoundError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { BranchStatus, Prisma } from "@prisma/client";

export interface BranchInput {
  name: string;
  address?: string | null;
  phone?: string | null;
  whatsappNumber?: string | null;
  workingHours?: string | null;
}

/**
 * Plan doc §3 ("branch management without code changes"): branches are pure data, never
 * hardcoded into the app. Everything here is a thin, permission-checked wrapper over the
 * Branch table — the routes in app/api/branches/* are what enforce who may call it.
 */
export async function listBranches(includeDisabled: boolean) {
  return prisma.branch.findMany({
    where: includeDisabled ? {} : { status: BranchStatus.ACTIVE },
    orderBy: { name: "asc" },
  });
}

export async function getBranch(id: string) {
  const branch = await prisma.branch.findUnique({ where: { id } });
  if (!branch) throw new NotFoundError(`لا يوجد فرع بهذا المعرّف: ${id}`);
  return branch;
}

export async function createBranch(input: BranchInput) {
  return prisma.branch.create({ data: { ...input, status: BranchStatus.ACTIVE } });
}

export async function updateBranch(id: string, input: Partial<BranchInput>) {
  await getBranch(id); // 404s cleanly instead of letting Prisma throw P2025
  return prisma.branch.update({ where: { id }, data: input });
}

/**
 * "Remove" a branch without code changes, per the plan doc, means DISABLED — it stops
 * showing up for AI product search / new orders / new WhatsApp routing, but its history
 * (past orders, inventory, employees) stays intact and queryable for reports.
 *
 * Phase 10 hardening: this and enableBranch()/deleteBranch() now also write an audit_logs
 * row — a real gap found while reviewing the plan doc's §16 traceability requirement
 * against the code: orders.ts and delivery.ts always logged sensitive changes, but
 * branches.ts never did, even though disabling/deleting a branch is exactly the kind of
 * "who did this and when" action the audit log exists for.
 */
export async function disableBranch(id: string, userId: string | null = null) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const before = await tx.branch.findUnique({ where: { id } });
    if (!before) throw new NotFoundError(`لا يوجد فرع بهذا المعرّف: ${id}`);

    const updated = await tx.branch.update({ where: { id }, data: { status: BranchStatus.DISABLED } });
    await logAudit(
      { userId, action: "branch.disable", entity: `Branch:${id}`, oldValue: { status: before.status }, newValue: { status: updated.status } },
      tx
    );
    return updated;
  });
}

export async function enableBranch(id: string, userId: string | null = null) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const before = await tx.branch.findUnique({ where: { id } });
    if (!before) throw new NotFoundError(`لا يوجد فرع بهذا المعرّف: ${id}`);

    const updated = await tx.branch.update({ where: { id }, data: { status: BranchStatus.ACTIVE } });
    await logAudit(
      { userId, action: "branch.enable", entity: `Branch:${id}`, oldValue: { status: before.status }, newValue: { status: updated.status } },
      tx
    );
    return updated;
  });
}

/**
 * A real hard delete is only allowed for a branch that was created by mistake and never
 * used — any trace of real activity (employees, inventory rows, orders) means the safe
 * path is disableBranch() instead, so history never silently disappears.
 */
export async function deleteBranch(id: string, userId: string | null = null) {
  const branch = await getBranch(id);

  const [employeeCount, inventoryCount, orderCount] = await Promise.all([
    prisma.employee.count({ where: { branchId: id } }),
    prisma.inventory.count({ where: { branchId: id } }),
    prisma.order.count({ where: { branchId: id } }),
  ]);

  if (employeeCount > 0 || inventoryCount > 0 || orderCount > 0) {
    throw new BusinessRuleError(
      "لا يمكن حذف فرع لديه موظفون أو مخزون أو طلبات مرتبطة به — عطّل الفرع بدلاً من حذفه للحفاظ على السجل."
    );
  }

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.branch.delete({ where: { id } });
    await logAudit({ userId, action: "branch.delete", entity: `Branch:${id}`, oldValue: { name: branch.name } }, tx);
  });
}

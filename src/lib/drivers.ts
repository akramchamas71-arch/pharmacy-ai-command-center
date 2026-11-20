import { prisma } from "@/lib/prisma";
import { NotFoundError } from "@/lib/errors";
import { createUser } from "@/lib/users";
import { ROLES } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { DriverAvailability, Prisma } from "@prisma/client";

export interface CreateDriverAccountInput {
  name: string;
  email?: string | null;
  phone?: string | null;
  password: string;
  vehicle?: string | null;
  createdByUserId: string | null;
}

/**
 * Creates a User (role=DELIVERY_DRIVER) + its linked Driver row atomically. There is no
 * standalone "create a driver" without a login identity — a driver authenticates the same
 * way every other role does (src/lib/auth.ts) and then acts on their own deliveries through
 * that session, so onboarding one is always "create the account."
 */
export async function createDriverAccount(input: CreateDriverAccountInput) {
  const { name, email, phone, password, vehicle, createdByUserId } = input;

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const user = await createUser(
      { name, email, phone, password, roleName: ROLES.DELIVERY_DRIVER, branchId: null, createdByUserId },
      tx
    );

    const driver = await tx.driver.create({
      data: { userId: user.id, vehicle: vehicle ?? null, availability: DriverAvailability.OFFLINE },
    });

    await logAudit(
      {
        userId: createdByUserId,
        action: "driver.create",
        entity: `Driver:${driver.id}`,
        newValue: { userId: user.id, name, vehicle: vehicle ?? null },
      },
      tx
    );

    return { user, driver };
  });
}

/**
 * Self-service: a driver flips their own AVAILABLE/BUSY/OFFLINE flag. Dispatchers don't set
 * this on a driver's behalf — it reflects whether the person is actually on shift and free,
 * which only they know — so this is intentionally only ever called with the caller's own
 * userId (the route enforces that; see app/api/drivers/me/availability/route.ts).
 */
export async function setAvailability(userId: string, availability: DriverAvailability) {
  const driver = await prisma.driver.findUnique({ where: { userId } });
  if (!driver) throw new NotFoundError("لا يوجد سائق مرتبط بهذا الحساب.");

  const updated = await prisma.driver.update({ where: { userId }, data: { availability } });

  await logAudit({
    userId,
    action: "driver.setAvailability",
    entity: `Driver:${driver.id}`,
    oldValue: { availability: driver.availability },
    newValue: { availability: updated.availability },
  });

  return updated;
}

export async function getDriverByUserId(userId: string) {
  const driver = await prisma.driver.findUnique({ where: { userId }, include: { user: true } });
  if (!driver) throw new NotFoundError("لا يوجد سائق مرتبط بهذا الحساب.");
  return driver;
}

export interface DriverListOptions {
  availability?: DriverAvailability;
}

export async function listDrivers(opts: DriverListOptions = {}) {
  return prisma.driver.findMany({
    where: { availability: opts.availability },
    include: { user: true },
    orderBy: { createdAt: "desc" },
  });
}

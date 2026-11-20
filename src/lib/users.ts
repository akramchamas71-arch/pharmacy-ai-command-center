import { prisma } from "@/lib/prisma";
import { BusinessRuleError, NotFoundError } from "@/lib/errors";
import { hashPassword } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { Prisma } from "@prisma/client";

/**
 * Minimal user-account creation — there was previously NO way to create a `User` anywhere
 * in the project except the Phase 1 seed script's bootstrap SUPER_ADMIN. This is deliberately
 * narrow (gated by USERS_MANAGE, which only SUPER_ADMIN holds — see prisma/seed.ts's comment
 * on ROLES.ADMIN being excluded from it), not a full Admin Dashboard (that stays Phase 11
 * territory per the README). It exists in Phase 6 specifically so a DELIVERY_DRIVER account
 * can be onboarded at all; src/lib/drivers.ts's createDriverAccount() is its main caller.
 */
export interface CreateUserInput {
  name: string;
  email?: string | null;
  phone?: string | null;
  password: string;
  roleName: string; // one of ROLES in src/lib/rbac.ts
  branchId?: string | null;
  createdByUserId: string | null;
}

export async function createUser(input: CreateUserInput, client: Prisma.TransactionClient | typeof prisma = prisma) {
  const { name, email, phone, password, roleName, branchId, createdByUserId } = input;

  if (!email && !phone) {
    throw new BusinessRuleError("يجب إدخال بريد إلكتروني أو رقم هاتف للمستخدم الجديد.");
  }

  const role = await client.role.findUnique({ where: { name: roleName } });
  if (!role) throw new BusinessRuleError(`اسم دور غير معروف: ${roleName}`);

  const passwordHash = await hashPassword(password);

  let user;
  try {
    user = await client.user.create({
      data: {
        name,
        email: email ?? null,
        phone: phone ?? null,
        passwordHash,
        roleId: role.id,
        branchId: branchId ?? null,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new BusinessRuleError("البريد الإلكتروني أو رقم الهاتف مستخدم من قبل.");
    }
    throw e;
  }

  await logAudit(
    {
      userId: createdByUserId,
      action: "user.create",
      entity: `User:${user.id}`,
      newValue: { name, email: email ?? null, phone: phone ?? null, roleName, branchId: branchId ?? null },
    },
    client
  );

  return user;
}

export async function getUser(id: string) {
  const user = await prisma.user.findUnique({
    where: { id },
    include: { role: true, branch: true },
  });
  if (!user) throw new NotFoundError(`لا يوجد مستخدم بهذا المعرّف: ${id}`);
  return user;
}

import { randomUUID } from "crypto";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/auth";
import { ROLES, PERMISSIONS } from "../src/lib/rbac";
import { AI_SYSTEM_EMAIL } from "../src/lib/aiSystem";

const prisma = new PrismaClient();

// Role → permission map. This is the one place that defines what each role can do —
// see the plan doc's "الأدوار والصلاحيات" table for the human-readable version.
const ROLE_PERMISSIONS: Record<string, string[]> = {
  // SUPER_ADMIN and ADMIN both resolve via Object.values(PERMISSIONS), so Phase 2's new
  // BRANCHES_MANAGE / PRODUCTS_MANAGE keys (added in src/lib/rbac.ts) are picked up here
  // automatically — no seed change needed when a new global-admin-level permission is added.
  [ROLES.SUPER_ADMIN]: Object.values(PERMISSIONS), // everything, including USERS_MANAGE
  [ROLES.ADMIN]: Object.values(PERMISSIONS).filter((p) => p !== PERMISSIONS.USERS_MANAGE),
  [ROLES.PHARMACY_MANAGER]: [
    PERMISSIONS.INVENTORY_READ,
    PERMISSIONS.INVENTORY_WRITE,
    PERMISSIONS.ORDERS_READ,
    PERMISSIONS.ORDERS_WRITE,
    // The branch manager is the plan doc's natural local approver for cancelling an
    // already-confirmed order (§25's human-approval list) — SUPER_ADMIN/ADMIN also hold
    // this (via the "all permissions" grant) for network-wide oversight.
    PERMISSIONS.ORDERS_CANCEL,
    PERMISSIONS.CUSTOMERS_READ,
    PERMISSIONS.REPORTS_READ,
    // Phase 6: the branch manager is also the natural local dispatcher — assigning drivers,
    // reassigning a failed delivery, and overriding a driver's own status updates. Drivers
    // themselves hold DELIVERY_MANAGE too (see ROLES.DELIVERY_DRIVER below), scoped to their
    // own deliveries by the ownership check in src/lib/delivery.ts, not by this permission.
    PERMISSIONS.DELIVERY_MANAGE,
  ],
  [ROLES.PHARMACIST]: [
    PERMISSIONS.INVENTORY_READ,
    PERMISSIONS.ORDERS_READ,
    PERMISSIONS.ORDERS_WRITE,
    PERMISSIONS.CUSTOMERS_READ,
  ],
  [ROLES.PHARMACY_EMPLOYEE]: [
    PERMISSIONS.INVENTORY_READ,
    PERMISSIONS.ORDERS_READ,
    PERMISSIONS.ORDERS_WRITE,
  ],
  [ROLES.DELIVERY_DRIVER]: [PERMISSIONS.DELIVERY_MANAGE],
  [ROLES.CUSTOMER_SERVICE]: [
    PERMISSIONS.CUSTOMERS_READ,
    PERMISSIONS.CUSTOMERS_WRITE,
    PERMISSIONS.WHATSAPP_SEND,
    PERMISSIONS.WHATSAPP_TAKEOVER,
    PERMISSIONS.ORDERS_READ,
    PERMISSIONS.INVENTORY_READ,
  ],
  [ROLES.ACCOUNTING]: [PERMISSIONS.REPORTS_READ, PERMISSIONS.AUDIT_READ],
  // Phase 5 (preparatory): exactly what the 9 canonical AI Tools (src/lib/aiTools.ts) need —
  // deliberately excludes everything on the plan doc's Human Approval list (ORDERS_CANCEL,
  // PRICING_WRITE, INVENTORY_WRITE, DOCUMENTS_WRITE/DELETE, CARELINK_READ/ADMIN,
  // USERS_MANAGE, BRANCHES_MANAGE, PRODUCTS_MANAGE). The AI never dispenses, prices, edits
  // stock by hand, deletes files, cancels a confirmed order, or touches CareLink — those stay
  // human-only by construction, not by the LLM "choosing" not to.
  [ROLES.AI_AGENT]: [
    PERMISSIONS.INVENTORY_READ,
    PERMISSIONS.ORDERS_READ,
    PERMISSIONS.ORDERS_WRITE,
    PERMISSIONS.CUSTOMERS_READ,
    PERMISSIONS.CUSTOMERS_WRITE,
    PERMISSIONS.WHATSAPP_SEND,
    PERMISSIONS.DELIVERY_MANAGE,
    PERMISSIONS.DOCUMENTS_READ,
  ],
};

async function main() {
  console.log("Seeding permissions...");
  for (const key of Object.values(PERMISSIONS)) {
    await prisma.permission.upsert({
      where: { key },
      update: {},
      create: { key },
    });
  }

  console.log("Seeding roles + role-permission links...");
  for (const [roleName, permissionKeys] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName },
    });

    const permissions = await prisma.permission.findMany({
      where: { key: { in: permissionKeys } },
    });

    for (const permission of permissions) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }

  const email = process.env.SEED_SUPERADMIN_EMAIL;
  const password = process.env.SEED_SUPERADMIN_PASSWORD;
  if (!email || !password) {
    console.warn(
      "SEED_SUPERADMIN_EMAIL / SEED_SUPERADMIN_PASSWORD not set in .env — skipping the bootstrap admin user. " +
        "Set them and re-run `npm run seed` to create one."
    );
  } else {
    const superAdminRole = await prisma.role.findUniqueOrThrow({ where: { name: ROLES.SUPER_ADMIN } });
    const passwordHash = await hashPassword(password);
    await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        name: "Super Admin",
        passwordHash,
        roleId: superAdminRole.id,
      },
    });
    console.log(`Bootstrap SUPER_ADMIN ready: ${email} — change this password after first login.`);
  }

  // Phase 5 (preparatory): the AI Orchestrator's fixed identity (src/lib/aiSystem.ts) —
  // unconditional, unlike the SUPER_ADMIN above, because this is infrastructure every AI
  // Tool call needs to exist, not a human's own login. `active: false` blocks it from ever
  // authenticating via POST /api/auth/login (that route filters `active: true`); its password
  // is a random value this script never prints or stores anywhere else — there is no "login
  // as the AI" flow to protect, so there's nothing to tell anyone.
  const aiAgentRole = await prisma.role.findUniqueOrThrow({ where: { name: ROLES.AI_AGENT } });
  const aiPasswordHash = await hashPassword(randomUUID());
  await prisma.user.upsert({
    where: { email: AI_SYSTEM_EMAIL },
    update: {},
    create: {
      email: AI_SYSTEM_EMAIL,
      name: "AI Orchestrator (system)",
      passwordHash: aiPasswordHash,
      roleId: aiAgentRole.id,
      active: false,
    },
  });
  console.log(`AI system identity ready: ${AI_SYSTEM_EMAIL} (active: false — cannot log in).`);

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

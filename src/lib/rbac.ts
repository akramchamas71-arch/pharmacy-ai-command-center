import { prisma } from "./prisma";

// Canonical role names — matches the plan doc's role table. Kept as string constants
// (not a Prisma enum) because roles are seeded data the Admin dashboard may extend later
// (Phase 11), not a fixed type.
export const ROLES = {
  SUPER_ADMIN: "SUPER_ADMIN",
  ADMIN: "ADMIN",
  PHARMACY_MANAGER: "PHARMACY_MANAGER",
  PHARMACIST: "PHARMACIST",
  PHARMACY_EMPLOYEE: "PHARMACY_EMPLOYEE",
  DELIVERY_DRIVER: "DELIVERY_DRIVER",
  CUSTOMER_SERVICE: "CUSTOMER_SERVICE",
  ACCOUNTING: "ACCOUNTING",
  // Phase 5 (preparatory): the fixed internal identity every AI Tool call acts as — never a
  // real human login (its bootstrap user is seeded with active: false). Exists so the AI
  // Orchestrator's Tool calls go through the exact same hasPermission() choke point as a
  // human-driven API route, per the plan doc's "كل Tool يتحقق من authentication، permissions…"
  // rule and this file's own hasPermission() comment below. See src/lib/aiSystem.ts.
  AI_AGENT: "AI_AGENT",
} as const;

// Seed permission keys. Every Tool the AI Orchestrator can call (Phase 5) must check one
// of these before executing — see the plan doc's "AI tool-calling rules" section.
export const PERMISSIONS = {
  BRANCHES_MANAGE: "branches.manage", // create/edit/disable branches — Phase 2
  PRODUCTS_MANAGE: "products.manage", // create/edit the product catalog — Phase 2
  INVENTORY_READ: "inventory.read",
  INVENTORY_WRITE: "inventory.write",
  ORDERS_READ: "orders.read",
  ORDERS_WRITE: "orders.write",
  ORDERS_CANCEL: "orders.cancel", // cancelling a CONFIRMED order needs this + human approval
  DELIVERY_MANAGE: "delivery.manage",
  CUSTOMERS_READ: "customers.read",
  CUSTOMERS_WRITE: "customers.write",
  WHATSAPP_SEND: "whatsapp.send",
  WHATSAPP_TAKEOVER: "whatsapp.takeover",
  DOCUMENTS_READ: "documents.read",
  DOCUMENTS_WRITE: "documents.write",
  DOCUMENTS_DELETE: "documents.delete", // always paired with a human-approval step
  CARELINK_READ: "carelink.read",
  CARELINK_ADMIN: "carelink.admin",
  PRICING_WRITE: "pricing.write", // price changes — human approval required (plan doc §25)
  USERS_MANAGE: "users.manage",
  AUDIT_READ: "audit.read",
  REPORTS_READ: "reports.read",
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/**
 * Checks whether a user (by their role) holds a given permission.
 * This is the single choke point every API route and every AI Tool must call before
 * acting — per the plan doc, the LLM never touches the database directly, and every
 * Tool re-validates permissions here rather than trusting the caller's claims.
 */
export async function hasPermission(roleId: string, permissionKey: PermissionKey): Promise<boolean> {
  const match = await prisma.rolePermission.findFirst({
    where: {
      roleId,
      permission: { key: permissionKey },
    },
    select: { roleId: true },
  });
  return match !== null;
}

/**
 * Branch-scoping check: most roles (PHARMACY_MANAGER, PHARMACIST, PHARMACY_EMPLOYEE) may
 * only act on data belonging to their own branch. SUPER_ADMIN, ADMIN and ACCOUNTING are
 * not branch-scoped (branchId is null on their user record).
 */
export function canAccessBranch(userBranchId: string | null, targetBranchId: string): boolean {
  if (userBranchId === null) return true; // not branch-scoped
  return userBranchId === targetBranchId;
}

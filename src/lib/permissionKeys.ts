/**
 * Plain string duplicate of `PERMISSIONS` from `src/lib/rbac.ts`, with NO import of
 * `./prisma` (rbac.ts instantiates a real PrismaClient at module load, which is fine in a
 * server-only route handler but must never end up inside a client-component bundle).
 * Dashboard UI code (client components deciding what to render for the current role)
 * imports from here; API routes keep using `rbac.ts`'s `PERMISSIONS`/`hasPermission()` as
 * the real enforcement point — this file is display-logic only and never itself a security
 * boundary (the server re-checks every permission on every route regardless of what the UI
 * shows or hides).
 */
export const PERMISSION_KEYS = {
  BRANCHES_MANAGE: "branches.manage",
  PRODUCTS_MANAGE: "products.manage",
  INVENTORY_READ: "inventory.read",
  INVENTORY_WRITE: "inventory.write",
  ORDERS_READ: "orders.read",
  ORDERS_WRITE: "orders.write",
  ORDERS_CANCEL: "orders.cancel",
  DELIVERY_MANAGE: "delivery.manage",
  CUSTOMERS_READ: "customers.read",
  CUSTOMERS_WRITE: "customers.write",
  WHATSAPP_SEND: "whatsapp.send",
  WHATSAPP_TAKEOVER: "whatsapp.takeover",
  DOCUMENTS_READ: "documents.read",
  DOCUMENTS_WRITE: "documents.write",
  DOCUMENTS_DELETE: "documents.delete",
  CARELINK_READ: "carelink.read",
  CARELINK_ADMIN: "carelink.admin",
  PRICING_WRITE: "pricing.write",
  USERS_MANAGE: "users.manage",
  AUDIT_READ: "audit.read",
  REPORTS_READ: "reports.read",
} as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[keyof typeof PERMISSION_KEYS];

export interface CurrentUser {
  id: string;
  name: string;
  email: string | null;
  phone?: string | null;
  role: string;
  branch: { id: string; name: string } | null;
  permissions: PermissionKey[];
  twoFactorEnabled?: boolean;
}

export function can(user: CurrentUser | null | undefined, permission: PermissionKey): boolean {
  if (!user) return false;
  return user.permissions.includes(permission);
}

export function canAny(user: CurrentUser | null | undefined, permissions: PermissionKey[]): boolean {
  if (!user) return false;
  return permissions.some((p) => user.permissions.includes(p));
}

import { PERMISSION_KEYS, type PermissionKey } from "@/lib/permissionKeys";

export interface NavItem {
  href: string;
  label: string;
  icon: string; // a single emoji glyph — no icon-font dependency to keep the build simple
  /** Shown if the user holds ANY of these permissions. Omit (undefined) to always show. */
  anyOf?: PermissionKey[];
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "الرئيسية", icon: "🏠" },
  { href: "/dashboard/branches", label: "الفروع", icon: "🏬", anyOf: [PERMISSION_KEYS.BRANCHES_MANAGE] },
  { href: "/dashboard/suppliers", label: "الشركات الشريكة", icon: "🤝", anyOf: [PERMISSION_KEYS.BRANCHES_MANAGE] },
  { href: "/dashboard/products", label: "المنتجات", icon: "💊", anyOf: [PERMISSION_KEYS.PRODUCTS_MANAGE] },
  { href: "/dashboard/lattafa", label: "عطور لطافة", icon: "✨", anyOf: [PERMISSION_KEYS.ORDERS_READ, PERMISSION_KEYS.PRODUCTS_MANAGE] },
  { href: "/dashboard/cosmetics", label: "كوزماتيك", icon: "🧴", anyOf: [PERMISSION_KEYS.ORDERS_READ, PERMISSION_KEYS.PRODUCTS_MANAGE] },
  { href: "/dashboard/deborah", label: "Deborah", icon: "💄", anyOf: [PERMISSION_KEYS.ORDERS_READ, PERMISSION_KEYS.PRODUCTS_MANAGE] },
  { href: "/dashboard/consultations", label: "الاستشارات", icon: "🩺", anyOf: [PERMISSION_KEYS.WHATSAPP_SEND] },
  { href: "/dashboard/inventory", label: "المخزون", icon: "📦", anyOf: [PERMISSION_KEYS.INVENTORY_READ] },
  { href: "/dashboard/orders", label: "الطلبات", icon: "🧾", anyOf: [PERMISSION_KEYS.ORDERS_READ] },
  { href: "/dashboard/whatsapp", label: "محادثات واتساب", icon: "💬", anyOf: [PERMISSION_KEYS.WHATSAPP_SEND] },
  { href: "/dashboard/reservations", label: "طلبات الحجز", icon: "⏱️", anyOf: [PERMISSION_KEYS.ORDERS_READ] },
  { href: "/dashboard/deliveries", label: "التوصيل", icon: "🚴", anyOf: [PERMISSION_KEYS.DELIVERY_MANAGE] },
  {
    href: "/dashboard/drivers",
    label: "السائقون",
    icon: "🛵",
    anyOf: [PERMISSION_KEYS.DELIVERY_MANAGE, PERMISSION_KEYS.USERS_MANAGE],
  },
  { href: "/dashboard/documents", label: "المستندات", icon: "📄", anyOf: [PERMISSION_KEYS.DOCUMENTS_READ] },
  { href: "/dashboard/reports", label: "التقارير", icon: "📊", anyOf: [PERMISSION_KEYS.REPORTS_READ] },
  { href: "/dashboard/audit", label: "سجل التدقيق", icon: "🛡️", anyOf: [PERMISSION_KEYS.AUDIT_READ] },
  { href: "/dashboard/settings/security", label: "الأمان (2FA)", icon: "🔐" },
];

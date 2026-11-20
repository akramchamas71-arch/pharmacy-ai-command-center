export const ROLE_LABELS_AR: Record<string, string> = {
  SUPER_ADMIN: "مدير عام",
  ADMIN: "مدير",
  PHARMACY_MANAGER: "مدير صيدلية",
  PHARMACIST: "صيدلي",
  PHARMACY_EMPLOYEE: "موظف صيدلية",
  DELIVERY_DRIVER: "سائق توصيل",
  CUSTOMER_SERVICE: "خدمة عملاء",
  ACCOUNTING: "محاسبة",
  AI_AGENT: "وكيل الذكاء الاصطناعي",
};

export function roleLabel(role: string): string {
  return ROLE_LABELS_AR[role] ?? role;
}

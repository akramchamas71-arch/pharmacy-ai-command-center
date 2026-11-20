/**
 * Local, plain string-literal types for the Document admin UI.
 *
 * Deliberately NOT imported from src/lib/documents.ts / src/lib/documentAi.ts even though
 * those already export the right shapes (Document rows + DOCUMENT_CATEGORIES): both of
 * those are server-only modules (they import "@/lib/prisma", which instantiates a real
 * PrismaClient at module load, and documentAi.ts additionally imports "@/lib/anthropic").
 * Pulling either one into a "use client" bundle would drag server-only code (and the
 * known-broken local Prisma client stub) into the browser bundle. Keeping a small local
 * copy here is the same pattern the project already uses for permissionKeys.ts vs rbac.ts.
 */

export const DOCUMENT_CATEGORIES = [
  "PRESCRIPTION",
  "INVOICE",
  "ID_DOCUMENT",
  "INSURANCE",
  "LAB_RESULT",
  "OTHER",
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const CATEGORY_LABELS_AR: Record<DocumentCategory, string> = {
  PRESCRIPTION: "روشتة",
  INVOICE: "فاتورة",
  ID_DOCUMENT: "وثيقة هوية",
  INSURANCE: "تأمين",
  LAB_RESULT: "نتيجة تحليل",
  OTHER: "أخرى",
};

export function categoryLabel(tag: string): string | null {
  return (CATEGORY_LABELS_AR as Record<string, string>)[tag] ?? null;
}

// ownerType is a free-form string on the Document model (see schema.prisma's own comment:
// "order" | "customer" | "carelink_job" | "general"), not a Prisma enum — these are just the
// known values worth offering as filter/upload options; any other string still round-trips
// fine through the API, this list is display convenience only.
export const OWNER_TYPES = ["general", "order", "customer", "carelink_job"] as const;
export type OwnerType = (typeof OWNER_TYPES)[number];

export const OWNER_TYPE_LABELS_AR: Record<string, string> = {
  general: "عام",
  order: "طلب",
  customer: "عميل",
  carelink_job: "مهمة كيرلينك",
};

export function ownerTypeLabel(ownerType: string): string {
  return OWNER_TYPE_LABELS_AR[ownerType] ?? ownerType;
}

export interface DocumentRow {
  id: string;
  ownerType: string;
  ownerId: string | null;
  fileUrl: string;
  fileName: string;
  mimeType: string | null;
  tags: string[];
  metadata: Record<string, unknown> | null;
  uploadedBy: string | null;
  createdAt: string;
}

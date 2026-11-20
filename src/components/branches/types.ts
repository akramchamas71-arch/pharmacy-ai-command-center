/**
 * Plain string-literal mirror of `BranchStatus` (prisma/schema.prisma) — never import
 * "@prisma/client" from frontend code (see the note at the top of page.tsx).
 */
export type BranchStatus = "ACTIVE" | "DISABLED";

/** Shape of a branch row as returned by GET/POST/PATCH /api/branches (src/lib/branches.ts
 * returns the raw Prisma row as-is, so this mirrors the Branch model's own fields). */
export interface Branch {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  whatsappNumber: string | null;
  workingHours: string | null;
  status: BranchStatus;
  isBekaaExclusive: boolean;
  specialDeliveryContactWhatsapp: string | null;
  specialDeliveryContactLabel: string | null;
  createdAt: string;
  updatedAt: string;
}

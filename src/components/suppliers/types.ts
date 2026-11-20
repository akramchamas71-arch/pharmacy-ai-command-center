/** Mirrors the Supplier / SupplierInquiry models (prisma/schema.prisma) — plain strings, no @prisma/client import. */
export interface Supplier {
  id: string;
  name: string;
  whatsappNumber: string;
  specialty: string | null;
  deliveryContactWhatsapp: string | null;
  deliveryContactLabel: string | null;
  paymentTerms: string | null;
  notes: string | null;
  status: "ACTIVE" | "DISABLED";
  createdAt: string;
  updatedAt: string;
}

export interface SupplierInquiry {
  id: string;
  referenceCode: string;
  productText: string;
  qty: number;
  status: "PENDING" | "ANSWERED" | "NEEDS_REVIEW" | "CONFIRMED" | "CANCELLED";
  quotedPrice: string | number | null;
  rawReply: string | null;
  deliveryAddress: string | null;
  createdAt: string;
  answeredAt: string | null;
  deliveryNotifiedAt: string | null;
  supplier: { id: string; name: string };
}

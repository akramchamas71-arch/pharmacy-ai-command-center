/**
 * Plain string-literal mirror of `ProductType` (prisma/schema.prisma) — never import
 * "@prisma/client" from frontend code; this sandbox's local generated Prisma client is a
 * known-broken stub, but these are just plain strings over the wire regardless.
 */
export type ProductType = "COSMETIC" | "OTC" | "PRESCRIPTION" | "CONTROLLED";

export const PRODUCT_TYPE_LABELS_AR: Record<ProductType, string> = {
  OTC: "بدون وصفة",
  PRESCRIPTION: "يحتاج وصفة طبية",
  CONTROLLED: "مادة مراقبة",
  COSMETIC: "مستحضر تجميل",
};

export function productTypeLabel(type: ProductType | string): string {
  return PRODUCT_TYPE_LABELS_AR[type as ProductType] ?? type;
}

/** Shape of a product row as returned by GET/POST/PATCH /api/products (src/lib/products.ts
 * returns the raw Prisma row as-is, so this mirrors the Product model's own fields). */
export interface Product {
  id: string;
  name: string;
  brand: string | null;
  barcode: string | null;
  genericName: string | null;
  activeIngredient: string | null;
  category: string | null;
  type: ProductType;
  imageUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

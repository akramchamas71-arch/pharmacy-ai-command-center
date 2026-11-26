import catalog from "@/data/clarins-catalog.json";
import { prisma } from "@/lib/prisma";

/**
 * CLARINS PARIS make-up for the shop's «Clarins» tab (owner's photos, 26 Nov 2026). Stock is at
 * صيدلية فارماكير only, so orders go ONLY to that pharmacy. `raw` = the real Product.name in the DB.
 * `price` = customer price in whole USD = Pharmacare stock cost × 1.48 — the markup that matches the
 * shelf stickers the owner photographed (Lip Comfort Oil 22.97 → $34, Instant Concealer 33.10 → $49).
 * `cost` stays server-side and is never sent to customers.
 */
export interface ClarinsItem {
  id: string;
  raw: string;
  name: string;
  cat: string;
  price: number;
  cost: number;
  image: string | null;
  images: string[];
}

export const CLARINS_CATALOG = catalog as ClarinsItem[];
export const CLARINS_CATEGORIES = [
  { key: "face", label: "الوجه" },
  { key: "eyes", label: "العيون" },
  { key: "lips", label: "الشفاه" },
];
const byId = new Map(CLARINS_CATALOG.map((i) => [i.id, i]));
export const getClarinsItem = (id: string) => byId.get(id);

/** The only pharmacy that handles CLARINS orders (its stock). */
export async function getClarinsBranch() {
  return prisma.branch.findFirst({
    where: { OR: [{ name: { contains: "فارماكير" } }, { whatsappNumber: "+96176799764" }] },
    select: { id: true, name: true },
  });
}

/** Find (or create) the Product row for a CLARINS item. */
export async function ensureClarinsProduct(i: ClarinsItem): Promise<string> {
  const found = await prisma.product.findFirst({ where: { name: i.raw }, select: { id: true } });
  if (found) return found.id;
  const created = await prisma.product.create({
    data: { name: i.raw, brand: "CLARINS", type: "COSMETIC", category: "مكياج", imageUrl: i.image },
    select: { id: true },
  });
  return created.id;
}

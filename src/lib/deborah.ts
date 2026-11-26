import catalog from "@/data/deborah-catalog.json";
import { prisma } from "@/lib/prisma";

/**
 * DEBORAH MILANO make-up catalog for the shop's «Deborah» tab — photos + prices sent by the owner
 * on 2026-11-23. `price` is the customer price in whole USD (owner's rule: no decimals);
 * `listPrice` is the exact price from the owner's photo. Owner's rule: these items are handled ONLY
 * by صيدلية الجواد كير (whatever the customer's area).
 */
export interface DeborahItem {
  id: string;
  name: string;
  cat: string;
  price: number;
  listPrice: number;
  image: string;
  /** Shades/colours in stock at الجواد كير (from SoftPharm, 26 Nov 2026). */
  shades?: string;
  inStock?: boolean;
}

export const DEBORAH_CATALOG = catalog as DeborahItem[];
export const DEBORAH_CATEGORIES = [
  { key: "face", label: "الوجه" },
  { key: "eyes", label: "العيون" },
  { key: "lips", label: "الشفاه" },
  { key: "nails", label: "الأظافر" },
];
const byId = new Map(DEBORAH_CATALOG.map((i) => [i.id, i]));
export const getDeborahItem = (id: string) => byId.get(id);
export const deborahProductName = (i: DeborahItem) => `DEBORAH MILANO ${i.name}`;

/** The only pharmacy that handles DEBORAH orders (owner's rule). */
export async function getDeborahBranch() {
  return prisma.branch.findFirst({
    where: { OR: [{ name: { contains: "الجواد" } }, { whatsappNumber: "+96171595850" }] },
    select: { id: true, name: true },
  });
}

/** Find-or-create the Product row for a DEBORAH item so the normal branch-reservation flow can use it. */
export async function ensureDeborahProduct(i: DeborahItem): Promise<string> {
  const name = deborahProductName(i);
  const found = await prisma.product.findFirst({ where: { name }, select: { id: true } });
  if (found) return found.id;
  const created = await prisma.product.create({
    data: { name, brand: "DEBORAH MILANO", type: "COSMETIC", category: "مكياج", imageUrl: i.image },
    select: { id: true },
  });
  return created.id;
}

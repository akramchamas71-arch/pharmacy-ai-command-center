import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCustomerSession, unauthorized } from "@/lib/customerAuth";
import { COSMETICS, COSMETIC_CATEGORIES } from "@/lib/cosmetics";

const PAGE = 40;

interface Row {
  id: string; name: string; type: string; imageUrl: string | null;
  inventory: { qtyOnHand: number; qtyReserved: number }[];
}

// Browse the cosmetics catalog by category (or search inside it). Never says which pharmacy has an
// item; price is the lowest selling price across pharmacies when known, otherwise null.
export async function GET(req: NextRequest) {
  if (!getCustomerSession(req)) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const cat = sp.get("cat") ?? "skin";
  const q = (sp.get("q") ?? "").trim().toUpperCase();
  const offset = Math.max(0, Number(sp.get("offset")) || 0);

  const terms = q.split(/\s+/).filter(Boolean);
  const all = COSMETICS.filter((i) =>
    terms.length ? terms.every((t) => i.name.toUpperCase().includes(t)) : i.cat === cat
  ).sort((a, b) => Number(!!b.image) - Number(!!a.image));

  // Resolve a page against the live database: only products that still exist and are in stock.
  const out: object[] = [];
  let cursor = offset;
  while (out.length < PAGE && cursor < all.length) {
    const slice = all.slice(cursor, cursor + PAGE * 2);
    cursor += slice.length;
    const products: Row[] = await prisma.product.findMany({
      where: { name: { in: slice.map((i) => i.raw) } },
      select: {
        id: true, name: true, type: true, imageUrl: true,
        inventory: { where: { branch: { status: "ACTIVE" } }, select: { qtyOnHand: true, qtyReserved: true } },
      },
    });
    const byName = new Map<string, Row>(products.map((p: Row) => [p.name, p]));
    for (const i of slice) {
      const p = byName.get(i.raw);
      if (!p) continue;
      const stock = p.inventory.reduce((s: number, r: Row["inventory"][number]) => s + Math.max(0, r.qtyOnHand - r.qtyReserved), 0);
      if (stock <= 0) continue;
      out.push({ id: p.id, name: i.name, type: p.type, price: i.price, image: i.image ?? p.imageUrl, available: true });
      if (out.length >= PAGE) {
        cursor = cursor - slice.length + slice.indexOf(i) + 1;
        break;
      }
    }
  }

  return NextResponse.json({
    categories: COSMETIC_CATEGORIES,
    items: out,
    nextOffset: cursor < all.length ? cursor : null,
  });
}

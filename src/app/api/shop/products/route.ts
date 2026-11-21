import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { searchProducts } from "@/lib/products";
import { getCustomerSession, unauthorized } from "@/lib/customerAuth";
import { COSMETIC_RAW_NAMES } from "@/lib/cosmetics";

// Catalog search for the shop. Shows availability only (yes/no) — never which pharmacy has it,
// and no price: the price is confirmed by the pharmacy for each order (same rule as WhatsApp).
export async function GET(req: NextRequest) {
  if (!getCustomerSession(req)) return unauthorized();
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return browse(req);

  // The «أدوية» tab: cosmetics/para items live in their own tab, so they are left out here.
  const found = await searchProducts({ query: q, limit: 80 });
  const products = found
    .filter((p: { name: string }) => !COSMETIC_RAW_NAMES.has(p.name.replace(/\s+/g, " ").trim().toUpperCase()))
    .slice(0, 30);
  const ids = products.map((p: { id: string }) => p.id);
  const stock = ids.length
    ? await prisma.inventory.findMany({
        where: { productId: { in: ids }, branch: { status: "ACTIVE" } },
        select: { productId: true, qtyOnHand: true, qtyReserved: true },
      })
    : [];
  const available = new Set(
    stock
      .filter((s: { qtyOnHand: number; qtyReserved: number }) => s.qtyOnHand - s.qtyReserved > 0)
      .map((s: { productId: string }) => s.productId)
  );
  return NextResponse.json({
    products: products.map((p: { id: string; name: string; brand: string | null; type: string; imageUrl: string | null }) => ({
      id: p.id,
      name: p.name,
      brand: p.brand,
      type: p.type,
      imageUrl: p.imageUrl,
      available: available.has(p.id),
    })),
  });
}

const isCosmetic = (name: string) => COSMETIC_RAW_NAMES.has(name.replace(/\s+/g, " ").trim().toUpperCase());

// No search term: browse the in-stock drugs alphabetically (optionally by first letter), 40 at a time.
async function browse(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const letter = (sp.get("letter") ?? "").trim().toUpperCase().slice(0, 1);
  let offset = Math.max(0, Number(sp.get("offset")) || 0);
  const out: { id: string; name: string; brand: string | null; type: string; imageUrl: string | null; available: boolean }[] = [];
  let more = true;
  for (let round = 0; round < 4 && out.length < 40 && more; round++) {
    const rows: { id: string; name: string; brand: string | null; type: string; imageUrl: string | null }[] =
      await prisma.product.findMany({
        where: {
          ...(letter ? { name: { startsWith: letter, mode: "insensitive" as const } } : {}),
          inventory: { some: { qtyOnHand: { gt: 0 }, branch: { status: "ACTIVE" } } },
        },
        select: { id: true, name: true, brand: true, type: true, imageUrl: true },
        orderBy: { name: "asc" },
        skip: offset,
        take: 120,
      });
    more = rows.length === 120;
    for (const r of rows) {
      offset++;
      if (isCosmetic(r.name)) continue;
      out.push({ ...r, available: true });
      if (out.length >= 40) { more = true; break; }
    }
  }
  return NextResponse.json({ products: out, nextOffset: more ? offset : null });
}

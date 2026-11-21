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
  if (q.length < 2) return NextResponse.json({ products: [] });

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

import { NextRequest, NextResponse } from "next/server";
import { getCustomerSession, unauthorized } from "@/lib/customerAuth";
import { CLARINS_CATALOG, CLARINS_CATEGORIES } from "@/lib/clarins";

export async function GET(req: NextRequest) {
  if (!getCustomerSession(req)) return unauthorized();
  return NextResponse.json(
    {
      categories: CLARINS_CATEGORIES,
      items: CLARINS_CATALOG.map((i) => ({ id: i.id, name: i.name, cat: i.cat, price: i.price, image: i.image ?? "/icons/v2/icon-512.png", images: i.images })),
    },
    { headers: { "Cache-Control": "private, max-age=600" } }
  );
}

import { NextRequest, NextResponse } from "next/server";
import { getCustomerSession, unauthorized } from "@/lib/customerAuth";
import { DEBORAH_CATALOG, DEBORAH_CATEGORIES } from "@/lib/deborah";

export async function GET(req: NextRequest) {
  if (!getCustomerSession(req)) return unauthorized();
  return NextResponse.json(
    { categories: DEBORAH_CATEGORIES, items: DEBORAH_CATALOG.map(({ listPrice: _lp, ...i }) => i) },
    { headers: { "Cache-Control": "private, max-age=600" } }
  );
}

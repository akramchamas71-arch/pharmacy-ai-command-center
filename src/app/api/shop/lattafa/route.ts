import { NextRequest, NextResponse } from "next/server";
import { getCustomerSession, unauthorized } from "@/lib/customerAuth";
import { LATTAFA_CATALOG } from "@/lib/lattafa";

export async function GET(req: NextRequest) {
  if (!getCustomerSession(req)) return unauthorized();
  return NextResponse.json(
    { items: LATTAFA_CATALOG },
    { headers: { "Cache-Control": "private, max-age=600" } }
  );
}

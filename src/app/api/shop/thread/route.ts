import { NextRequest, NextResponse } from "next/server";
import { getCustomerSession, unauthorized } from "@/lib/customerAuth";
import { getShopThread } from "@/lib/shop";

export async function GET(req: NextRequest) {
  const s = getCustomerSession(req);
  if (!s) return unauthorized();
  return NextResponse.json({ messages: await getShopThread(s.customerId) });
}

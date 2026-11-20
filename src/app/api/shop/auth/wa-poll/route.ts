import { NextRequest, NextResponse } from "next/server";
import { LOGIN_TOKEN_COOKIE, pollWhatsAppLogin, setCustomerCookie, signCustomerSession } from "@/lib/customerAuth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const token = req.cookies.get(LOGIN_TOKEN_COOKIE)?.value;
  if (!token) return NextResponse.json({ done: false, expired: true });
  const customerId = await pollWhatsAppLogin(token);
  if (!customerId) return NextResponse.json({ done: false });
  const c = await prisma.customer.findUnique({ where: { id: customerId }, select: { phone: true } });
  const res = NextResponse.json({ done: true });
  setCustomerCookie(res, signCustomerSession({ customerId, phone: c?.phone ?? "" }));
  res.cookies.set(LOGIN_TOKEN_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}

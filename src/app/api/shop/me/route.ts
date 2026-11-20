import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCustomerSession, unauthorized } from "@/lib/customerAuth";

export async function GET(req: NextRequest) {
  const s = getCustomerSession(req);
  if (!s) return unauthorized();
  const c = await prisma.customer.findUnique({ where: { id: s.customerId }, select: { name: true, phone: true, address: true } });
  if (!c) return unauthorized();
  return NextResponse.json({ customer: c });
}

/** Lets the customer save their name / area-address. */
export async function PATCH(req: NextRequest) {
  const s = getCustomerSession(req);
  if (!s) return unauthorized();
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 80) : undefined;
  const address = typeof body?.address === "string" ? body.address.trim().slice(0, 300) : undefined;
  const c = await prisma.customer.update({
    where: { id: s.customerId },
    data: { ...(name ? { name } : {}), ...(address ? { address } : {}) },
    select: { name: true, phone: true, address: true },
  });
  return NextResponse.json({ customer: c });
}

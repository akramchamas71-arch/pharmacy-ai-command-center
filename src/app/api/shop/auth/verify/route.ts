import { NextRequest, NextResponse } from "next/server";
import { normalizeCustomerPhone, setCustomerCookie, signCustomerSession, verifyLoginCode } from "@/lib/customerAuth";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const phone = normalizeCustomerPhone(String(body?.phone ?? ""));
  const code = String(body?.code ?? "").replace(/\D/g, "");
  if (!phone) return NextResponse.json({ error: "رقم الهاتف غير صحيح" }, { status: 400 });
  try {
    const customerId = await verifyLoginCode(phone, code);
    const res = NextResponse.json({ ok: true });
    setCustomerCookie(res, signCustomerSession({ customerId, phone }));
    return res;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "تعذّر التحقق" }, { status: 400 });
  }
}

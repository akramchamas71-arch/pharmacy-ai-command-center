import { NextRequest, NextResponse } from "next/server";
import { normalizeCustomerPhone, requestLoginCode } from "@/lib/customerAuth";
import { checkRateLimit } from "@/lib/rateLimit";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const phone = normalizeCustomerPhone(String(body?.phone ?? ""));
  if (!phone) return NextResponse.json({ error: "رقم الهاتف غير صحيح. مثال: 70123456" }, { status: 400 });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "ip";
  if (!checkRateLimit(`shop-otp:${ip}`, { limit: 10, windowMs: 60 * 60 * 1000 }).allowed) {
    return NextResponse.json({ error: "محاولات كثيرة. حاول لاحقاً." }, { status: 429 });
  }
  try {
    await requestLoginCode(phone);
    return NextResponse.json({ ok: true, phone });
  } catch (e) {
    console.error("[shop] request-code failed", e);
    const msg = e instanceof Error && /كثيرة/.test(e.message) ? e.message : "تعذّر إرسال الرمز على واتساب. تأكد أن الرقم عليه واتساب.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

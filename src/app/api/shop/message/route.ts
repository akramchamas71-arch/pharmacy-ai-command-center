import { NextRequest, NextResponse, after } from "next/server";
import { getCustomerSession, unauthorized } from "@/lib/customerAuth";
import { checkRateLimit } from "@/lib/rateLimit";
import { addAppMessage, wakeAgent } from "@/lib/shop";

export async function POST(req: NextRequest) {
  const s = getCustomerSession(req);
  if (!s) return unauthorized();
  if (!checkRateLimit(`shop-msg:${s.customerId}`, { limit: 30, windowMs: 10 * 60 * 1000 }).allowed) {
    return NextResponse.json({ error: "رسائل كثيرة. انتظر قليلاً." }, { status: 429 });
  }
  const body = await req.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.slice(0, 1000) : "";
  const image = typeof body?.image === "string" ? body.image : null;
  if (!text.trim() && !image) return NextResponse.json({ error: "الرسالة فارغة" }, { status: 400 });
  try {
    const conversation = await addAppMessage(s.customerId, text, image);
    after(() => wakeAgent(conversation.id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "تعذّر الإرسال" }, { status: 400 });
  }
}

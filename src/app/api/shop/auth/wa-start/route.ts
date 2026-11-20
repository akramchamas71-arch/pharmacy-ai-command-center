import { NextRequest, NextResponse } from "next/server";
import { LOGIN_TOKEN_COOKIE, startWhatsAppLogin } from "@/lib/customerAuth";
import { checkRateLimit } from "@/lib/rateLimit";

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "ip";
  if (!checkRateLimit(`shop-wa-login:${ip}`, { limit: 20, windowMs: 60 * 60 * 1000 }).allowed) {
    return NextResponse.json({ error: "محاولات كثيرة. حاول لاحقاً." }, { status: 429 });
  }
  const { token, waLink } = await startWhatsAppLogin();
  if (!waLink) return NextResponse.json({ error: "رقم Carelink غير مضبوط على الخادم." }, { status: 500 });
  const res = NextResponse.json({ token, waLink });
  res.cookies.set(LOGIN_TOKEN_COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 15 * 60,
  });
  return res;
}

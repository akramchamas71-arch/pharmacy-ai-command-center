import crypto from "crypto";
import jwt from "jsonwebtoken";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { phoneKey, sendTemplateMessage } from "@/lib/whatsapp";

/**
 * Customer login for the CareLink shop app (/shop) — completely separate from staff login:
 * a different cookie, a different JWT audience, and customers never get a staff session.
 *
 * Login = phone number + 6-digit code sent over WhatsApp with an approved AUTHENTICATION template
 * (WHATSAPP_TPL_LOGIN, default "carelink_login_code"). No new table: the code's salted hash and
 * expiry are kept in the audit log (action "customer.otp"), the same place everything else is traced.
 */
export const CUSTOMER_COOKIE = "carelink_customer";
const AUDIENCE = "carelink-shop";
const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET is not set");
  return s;
}

export interface CustomerSession {
  customerId: string;
  phone: string;
}

/** Lebanese-friendly normalisation: "03 123 456", "70711952", "+961 70 711 952" -> "+96170711952". */
export function normalizeCustomerPhone(input: string): string | null {
  const key = phoneKey(input);
  if (!/^\d{7,8}$/.test(key)) return null;
  return `+961${key}`;
}

function hashCode(phone: string, code: string): string {
  return crypto.createHmac("sha256", secret()).update(`${phone}:${code}`).digest("hex");
}

export async function requestLoginCode(phone: string): Promise<void> {
  const recent = await prisma.auditLog.count({
    where: { action: "customer.otp", entity: `CustomerOtp:${phone}`, createdAt: { gt: new Date(Date.now() - CODE_TTL_MS) } },
  });
  if (recent >= 3) throw new Error("طلبت رموزاً كثيرة. حاول بعد 10 دقائق.");

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const templateName = process.env.WHATSAPP_TPL_LOGIN || "carelink_login_code";
  // Authentication templates: the code goes in the body AND in the copy-code button.
  await sendTemplateMessage(
    phone.replace(/^\+/, ""),
    templateName,
    process.env.WHATSAPP_TEMPLATE_LANG || "ar",
    [
      { type: "body", parameters: [{ type: "text", text: code }] },
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] },
    ],
    { fromPhoneNumberId: process.env.WHATSAPP_CARELINK_PHONE_NUMBER_ID }
  );

  await logAudit({
    userId: null,
    action: "customer.otp",
    entity: `CustomerOtp:${phone}`,
    newValue: { hash: hashCode(phone, code), exp: Date.now() + CODE_TTL_MS },
  });
}

/** Returns the customer id on success; throws an Arabic message otherwise. */
export async function verifyLoginCode(phone: string, code: string): Promise<string> {
  const row = await prisma.auditLog.findFirst({
    where: { action: "customer.otp", entity: `CustomerOtp:${phone}` },
    orderBy: { createdAt: "desc" },
  });
  const v = (row?.newValue ?? null) as { hash?: string; exp?: number } | null;
  if (!row || !v?.hash || !v.exp || v.exp < Date.now()) throw new Error("انتهت صلاحية الرمز. اطلب رمزاً جديداً.");

  const fails = await prisma.auditLog.count({
    where: { action: "customer.otp.fail", entity: `CustomerOtp:${phone}`, createdAt: { gt: row.createdAt } },
  });
  if (fails >= MAX_ATTEMPTS) throw new Error("محاولات كثيرة خاطئة. اطلب رمزاً جديداً.");

  const ok =
    /^\d{6}$/.test(code) &&
    crypto.timingSafeEqual(Buffer.from(hashCode(phone, code), "hex"), Buffer.from(v.hash, "hex"));
  if (!ok) {
    await logAudit({ userId: null, action: "customer.otp.fail", entity: `CustomerOtp:${phone}` });
    throw new Error("الرمز غير صحيح.");
  }

  // Reuse the customer WhatsApp already created (stored as "+<digits>"), whatever its exact format.
  const key = phoneKey(phone);
  const existing = await prisma.customer.findFirst({ where: { phone: { endsWith: key } }, orderBy: { createdAt: "asc" } });
  const customer = existing ?? (await prisma.customer.create({ data: { phone } }));
  await logAudit({ userId: null, action: "customer.login", entity: `Customer:${customer.id}` });
  // Expire the code so it cannot be reused.
  await prisma.auditLog.update({ where: { id: row.id }, data: { newValue: { ...v, exp: 0 } } });
  return customer.id;
}

export function signCustomerSession(s: CustomerSession): string {
  return jwt.sign(s, secret(), { expiresIn: "60d", audience: AUDIENCE });
}

export function getCustomerSession(req: NextRequest): CustomerSession | null {
  const token = req.cookies.get(CUSTOMER_COOKIE)?.value;
  if (!token) return null;
  try {
    const p = jwt.verify(token, secret(), { audience: AUDIENCE }) as CustomerSession;
    return p.customerId ? p : null;
  } catch {
    return null;
  }
}

export function setCustomerCookie(res: NextResponse, token: string) {
  res.cookies.set(CUSTOMER_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 24 * 3600,
  });
}

export function unauthorized() {
  return NextResponse.json({ error: "الرجاء تسجيل الدخول" }, { status: 401 });
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rateLimit";
import { logAudit } from "@/lib/audit";

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(10, "كلمة السر الجديدة يجب ألا تقل عن 10 أحرف").max(128),
});

// Any logged-in user may change THEIR OWN password (never someone else's) — the user id comes
// from the signed session cookie, not from the request body.
export async function POST(req: NextRequest) {
  const session = getSession(req);
  if (!session) {
    return NextResponse.json({ error: "غير مصرح — الرجاء تسجيل الدخول" }, { status: 401 });
  }

  const limited = checkRateLimit(`pwchange:${session.userId}`, { limit: 5, windowMs: 10 * 60 * 1000 });
  if (!limited.allowed) {
    return NextResponse.json({ error: "محاولات كثيرة — حاول مرة أخرى بعد قليل." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "البيانات المُدخلة غير صالحة";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  const { currentPassword, newPassword } = parsed.data;

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user || !user.active) {
    return NextResponse.json({ error: "المستخدم غير موجود" }, { status: 404 });
  }

  const ok = await verifyPassword(currentPassword, user.passwordHash);
  if (!ok) {
    return NextResponse.json({ error: "كلمة السر الحالية غير صحيحة" }, { status: 400 });
  }
  if (currentPassword === newPassword) {
    return NextResponse.json({ error: "كلمة السر الجديدة يجب أن تختلف عن الحالية" }, { status: 400 });
  }

  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(newPassword) } });
  // Never log the password itself — only the fact that it changed.
  await logAudit({ userId: user.id, action: "user.password.change", entity: `User:${user.id}` });

  return NextResponse.json({ ok: true });
}

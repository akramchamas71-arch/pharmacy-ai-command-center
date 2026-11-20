import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { verifyTwoFactorToken } from "@/lib/twoFactor";
import { logAudit } from "@/lib/audit";
import { Prisma } from "@prisma/client";

const schema = z.object({ token: z.string().min(6).max(8) });

/**
 * Self-service disable only — requires a currently-valid code, proving the caller still
 * holds the authenticator, not just the session cookie. There is deliberately NO
 * admin-forced "reset someone else's 2FA" endpoint here: a lost-device recovery flow is a
 * security-sensitive feature in its own right (how do you verify the requester's identity
 * without the very factor that's lost?) and building one hastily under this phase's scope
 * would be worse than flagging the gap — see README "What's deliberately NOT done yet."
 */
export async function POST(req: NextRequest) {
  const session = getSession(req);
  if (!session) {
    return NextResponse.json({ error: "غير مصرح — الرجاء تسجيل الدخول" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "البيانات المُدخلة غير صالحة" }, { status: 400 });
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
  if (!user.twoFactorEnabled || !user.twoFactorSecret) {
    return NextResponse.json({ error: "التحقق الثنائي غير مُفعّل على هذا الحساب أصلاً." }, { status: 409 });
  }
  if (!verifyTwoFactorToken(user.twoFactorSecret, parsed.data.token)) {
    return NextResponse.json({ error: "رمز التحقق الثنائي غير صحيح" }, { status: 401 });
  }

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.user.update({ where: { id: user.id }, data: { twoFactorEnabled: false, twoFactorSecret: null } });
    await logAudit({ userId: user.id, action: "user.2fa.disable", entity: `User:${user.id}` }, tx);
  });

  return NextResponse.json({ twoFactorEnabled: false });
}

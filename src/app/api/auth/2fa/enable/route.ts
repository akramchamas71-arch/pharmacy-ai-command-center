import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { ROLES } from "@/lib/rbac";
import { verifyTwoFactorToken } from "@/lib/twoFactor";
import { logAudit } from "@/lib/audit";
import { Prisma } from "@prisma/client";

const schema = z.object({ token: z.string().min(6).max(8) });

/**
 * Step 2 of enrollment: proves the admin can produce a valid code with the secret
 * POST /api/auth/2fa/setup just issued, then flips twoFactorEnabled — the moment login
 * actually starts requiring a token (see src/app/api/auth/login/route.ts).
 */
export async function POST(req: NextRequest) {
  const session = getSession(req);
  if (!session) {
    return NextResponse.json({ error: "غير مصرح — الرجاء تسجيل الدخول" }, { status: 401 });
  }
  if (session.roleName !== ROLES.ADMIN && session.roleName !== ROLES.SUPER_ADMIN) {
    return NextResponse.json(
      { error: "التحقق الثنائي متاح حالياً فقط لأدوار ADMIN/SUPER_ADMIN، حسب خطة المشروع." },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "البيانات المُدخلة غير صالحة" }, { status: 400 });
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
  if (!user.twoFactorSecret) {
    return NextResponse.json(
      { error: "لا يوجد مفتاح تحقق معلّق — ابدأ أولاً من POST /api/auth/2fa/setup" },
      { status: 409 }
    );
  }
  if (!verifyTwoFactorToken(user.twoFactorSecret, parsed.data.token)) {
    return NextResponse.json({ error: "رمز التحقق الثنائي غير صحيح" }, { status: 401 });
  }

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.user.update({ where: { id: user.id }, data: { twoFactorEnabled: true } });
    await logAudit({ userId: user.id, action: "user.2fa.enable", entity: `User:${user.id}` }, tx);
  });

  return NextResponse.json({ twoFactorEnabled: true });
}

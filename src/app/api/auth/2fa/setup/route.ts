import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { ROLES } from "@/lib/rbac";
import { generatePendingTwoFactorSecret } from "@/lib/twoFactor";

/**
 * Step 1 of self-service 2FA enrollment — ADMIN/SUPER_ADMIN only, per the plan doc's §16
 * security model. Generates a fresh secret and stores it as "pending" (twoFactorEnabled
 * stays false until POST /api/auth/2fa/enable proves the admin can actually produce a
 * valid code with it — never flip the enforced flag before that proof).
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

  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
  const pending = generatePendingTwoFactorSecret(user.email ?? user.phone ?? user.id);

  await prisma.user.update({
    where: { id: user.id },
    data: { twoFactorSecret: pending.base32Secret },
  });

  return NextResponse.json({
    base32Secret: pending.base32Secret,
    enrollmentUri: pending.enrollmentUri,
    note: "أضف هذا إلى تطبيق مصادقة (Google Authenticator، Authy، …) ثم أكّد بإرسال رمز حالي إلى POST /api/auth/2fa/enable لتفعيل التحقق الثنائي فعلياً.",
  });
}

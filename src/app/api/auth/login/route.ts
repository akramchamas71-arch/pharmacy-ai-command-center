import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyPassword, signSession, SESSION_COOKIE_NAME } from "@/lib/auth";
import { verifyTwoFactorToken } from "@/lib/twoFactor";
import { checkRateLimit } from "@/lib/rateLimit";

const loginSchema = z.object({
  identifier: z.string().min(3), // email or phone
  password: z.string().min(1),
  totpToken: z.string().optional(), // required only once the account has 2FA enabled
});

// Keyed by identifier (not IP alone) so one attacker can't lock out a known admin by
// hammering their email from many IPs, while still bounding a single IP's own flood —
// both the identifier and the IP are checked, whichever is tighter wins. Per-instance only
// (see src/lib/rateLimit.ts's own comment) — acceptable for brute-force slowdown today;
// a distributed limiter is Phase 10's hosting-decision territory.
const LOGIN_RATE_LIMIT = { limit: 10, windowMs: 10 * 60 * 1000 }; // 10 attempts / 10 minutes

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "البيانات المُدخلة غير صالحة" }, { status: 400 });
  }
  const { identifier, password, totpToken } = parsed.data;

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const byIdentifier = checkRateLimit(`login:id:${identifier}`, LOGIN_RATE_LIMIT);
  const byIp = checkRateLimit(`login:ip:${ip}`, LOGIN_RATE_LIMIT);
  if (!byIdentifier.allowed || !byIp.allowed) {
    return NextResponse.json(
      { error: "محاولات دخول كثيرة جداً — حاول مرة أخرى بعد قليل." },
      { status: 429 }
    );
  }

  const user = await prisma.user.findFirst({
    where: {
      OR: [{ email: identifier }, { phone: identifier }],
      active: true,
    },
    include: { role: true },
  });

  // Same generic error whether the identifier doesn't exist or the password is wrong —
  // never reveal which, that's a user-enumeration leak.
  if (!user) {
    return NextResponse.json({ error: "بيانات الدخول غير صحيحة" }, { status: 401 });
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    return NextResponse.json({ error: "بيانات الدخول غير صحيحة" }, { status: 401 });
  }

  // 2FA (plan doc §16, ADMIN/SUPER_ADMIN): enforced once the account has actually enrolled
  // (twoFactorEnabled=true via POST /api/auth/2fa/enable) — not mandatory at the role level
  // yet, since there's no dashboard UI to walk an admin through enrollment, only the API
  // below. See README "What's in Phase 10" for why this is a deliberate scope line, not an
  // oversight.
  if (user.twoFactorEnabled) {
    if (!totpToken) {
      return NextResponse.json({ error: "مطلوب رمز التحقق الثنائي (2FA)", requiresTwoFactor: true }, { status: 401 });
    }
    if (!user.twoFactorSecret || !verifyTwoFactorToken(user.twoFactorSecret, totpToken)) {
      return NextResponse.json({ error: "رمز التحقق الثنائي غير صحيح" }, { status: 401 });
    }
  }

  const token = signSession({
    userId: user.id,
    roleId: user.roleId,
    roleName: user.role.name,
    branchId: user.branchId,
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const res = NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role.name,
      branchId: user.branchId,
    },
  });

  res.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12, // 12h — keep in sync with JWT_EXPIRES_IN
  });

  return res;
}

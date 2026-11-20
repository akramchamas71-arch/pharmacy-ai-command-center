import { NextRequest, NextResponse } from "next/server";
import { verifySession, SESSION_COOKIE_NAME } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ user: null }, { status: 200 });

  const session = verifySession(token);
  if (!session) return NextResponse.json({ user: null }, { status: 200 });

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: {
      role: { include: { permissions: { include: { permission: true } } } },
      branch: true,
    },
  });
  if (!user || !user.active) return NextResponse.json({ user: null }, { status: 200 });

  return NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role.name,
      branch: user.branch ? { id: user.branch.id, name: user.branch.name } : null,
      // Dashboard UI reads this list to decide what to show/hide (display logic only —
      // every API route still re-checks hasPermission() itself, this never grants anything
      // on its own).
      permissions: user.role.permissions.map((rp: { permission: { key: string } }) => rp.permission.key),
      twoFactorEnabled: user.twoFactorEnabled,
    },
  });
}

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/apiGuard";
import { PERMISSIONS } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";

/** Medical consultations the AI referred to the command center (audit rows "consult.referred"). */
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, PERMISSIONS.WHATSAPP_SEND);
  if (guard instanceof NextResponse) return guard;
  const days = Math.min(90, Math.max(1, Number(req.nextUrl.searchParams.get("days")) || 30));
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);

  const [refs, resolved] = await Promise.all([
    prisma.auditLog.findMany({ where: { action: "consult.referred", createdAt: { gt: since } }, orderBy: { createdAt: "desc" }, take: 300 }),
    prisma.auditLog.findMany({ where: { action: "consult.resolved", createdAt: { gt: since } } }),
  ]);
  const resolvedMap = new Map<string, Date>();
  for (const r of resolved as { newValue: unknown; createdAt: Date }[]) {
    const id = (r.newValue as { referralId?: string } | null)?.referralId;
    if (id) resolvedMap.set(id, r.createdAt);
  }
  const convIds = [...new Set((refs as { entity: string }[]).map((r) => r.entity.split(":")[1]))];
  const convs = convIds.length
    ? await prisma.whatsappConversation.findMany({
        where: { id: { in: convIds } },
        select: { id: true, customer: { select: { name: true, phone: true, address: true } } },
      })
    : [];
  const convMap = new Map(convs.map((c: { id: string }) => [c.id, c]));

  const items = (refs as { id: string; entity: string; newValue: unknown; createdAt: Date }[]).map((r) => {
    const v = (r.newValue ?? {}) as { question?: string; summary?: string; specialist?: string; urgent?: boolean };
    const conversationId = r.entity.split(":")[1];
    const c = convMap.get(conversationId) as { customer: { name: string | null; phone: string; address: string | null } } | undefined;
    return {
      id: r.id,
      conversationId,
      customer: c?.customer ?? null,
      question: v.question ?? "",
      summary: v.summary ?? "",
      specialist: v.specialist ?? "pharmacist",
      urgent: !!v.urgent,
      createdAt: r.createdAt,
      resolvedAt: resolvedMap.get(r.id) ?? null,
    };
  });
  return NextResponse.json({ items });
}

/** Mark a referral as answered. Body: { id } */
export async function POST(req: NextRequest) {
  const guard = await requirePermission(req, PERMISSIONS.WHATSAPP_SEND);
  if (guard instanceof NextResponse) return guard;
  const body = await req.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  const ref = id ? await prisma.auditLog.findFirst({ where: { id, action: "consult.referred" } }) : null;
  if (!ref) return NextResponse.json({ error: "غير موجود" }, { status: 404 });
  await logAudit({ userId: guard.userId, action: "consult.resolved", entity: ref.entity, newValue: { referralId: id } });
  return NextResponse.json({ ok: true });
}

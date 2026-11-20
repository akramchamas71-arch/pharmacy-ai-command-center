import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/apiGuard";
import { PERMISSIONS } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

/**
 * Staff view of every reservation request sent to a pharmacy (CarelinkInquiry) or a partner company
 * (SupplierInquiry): who was asked, what, when, whether they answered and how fast — so the owner can
 * see which pharmacy does not reply. ?days=7 (default) limits the window.
 */
export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, PERMISSIONS.ORDERS_READ);
  if (guard instanceof NextResponse) return guard;

  const days = Math.min(90, Math.max(1, Number(req.nextUrl.searchParams.get("days")) || 7));
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);

  const [inqs, sups, reminders, undelivered] = await Promise.all([
    prisma.carelinkInquiry.findMany({
      where: { createdAt: { gt: since } },
      orderBy: { createdAt: "desc" },
      take: 500,
      include: { branch: { select: { name: true } }, product: { select: { name: true } }, conversation: { select: { customer: { select: { name: true, phone: true } } } } },
    }),
    prisma.supplierInquiry.findMany({
      where: { createdAt: { gt: since } },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { supplier: { select: { name: true } } },
    }),
    prisma.auditLog.findMany({
      where: { action: "carelink.inquiry.reminder", createdAt: { gt: since } },
      select: { entity: true, createdAt: true },
    }),
    prisma.auditLog.findMany({
      where: { action: "inquiry.undeliverable", createdAt: { gt: since } },
      select: { entity: true },
    }),
  ]);
  const remindedAt = new Map<string, Date>(reminders.map((r: { entity: string; createdAt: Date }) => [r.entity, r.createdAt] as [string, Date]));
  const undeliveredSet = new Set(undelivered.map((u: { entity: string }) => u.entity));

  type Row = {
    id: string; kind: "pharmacy" | "supplier"; code: string; place: string; item: string; qty: number;
    customer: string | null; status: "WAITING" | "ANSWERED" | "UNAVAILABLE" | "UNCLEAR" | "NO_REPLY" | "UNDELIVERED" | "CANCELLED";
    price: string | null; reply: string | null; sentAt: string; remindedAt: string | null; answeredAt: string | null; minutesToAnswer: number | null;
  };
  const unavailableRe = /(غير\s*متوفر|مش\s*متوفر|مافي|ما\s*في|خلص|مقطوع|نافد|not\s*available|out\s*of\s*stock)/i;

  const rows: Row[] = [];
  for (const q of inqs) {
    const entity = `CarelinkInquiry:${q.id}`;
    let status: Row["status"];
    if (undeliveredSet.has(entity)) status = "UNDELIVERED";
    else if (q.status === "PENDING") status = "WAITING";
    else if (q.status === "ANSWERED") status = "ANSWERED";
    else if (q.status === "CANCELLED") status = "CANCELLED";
    else if (!q.rawReply && !q.quotedPrice) status = "NO_REPLY";
    else status = unavailableRe.test(q.rawReply ?? "") ? "UNAVAILABLE" : "UNCLEAR";
    const answered = status === "ANSWERED" || status === "UNAVAILABLE" || status === "UNCLEAR";
    rows.push({
      id: q.id, kind: "pharmacy", code: q.referenceCode, place: q.branch.name, item: q.product.name, qty: q.qty,
      customer: q.conversation?.customer?.name ?? q.conversation?.customer?.phone ?? null,
      status, price: q.quotedPrice ? q.quotedPrice.toString() : null, reply: q.rawReply,
      sentAt: q.createdAt.toISOString(), remindedAt: remindedAt.get(entity)?.toISOString() ?? null,
      answeredAt: answered && q.answeredAt ? q.answeredAt.toISOString() : null,
      minutesToAnswer: answered && q.answeredAt ? Math.round((q.answeredAt.getTime() - q.createdAt.getTime()) / 60000) : null,
    });
  }
  for (const s of sups) {
    const st = s.status as string;
    const status: Row["status"] = undeliveredSet.has(`SupplierInquiry:${s.id}`)
      ? "UNDELIVERED"
      : st === "PENDING" ? "WAITING" : st === "CANCELLED" ? "CANCELLED" : st === "NEEDS_REVIEW" ? (s.rawReply ? "UNCLEAR" : "NO_REPLY") : "ANSWERED";
    const answered = status === "ANSWERED" || status === "UNCLEAR";
    rows.push({
      id: s.id, kind: "supplier", code: s.referenceCode, place: s.supplier.name, item: s.productText, qty: s.qty, customer: null,
      status, price: s.quotedPrice ? s.quotedPrice.toString() : null, reply: s.rawReply,
      sentAt: s.createdAt.toISOString(), remindedAt: null,
      answeredAt: answered && s.answeredAt ? s.answeredAt.toISOString() : null,
      minutesToAnswer: answered && s.answeredAt ? Math.round((s.answeredAt.getTime() - s.createdAt.getTime()) / 60000) : null,
    });
  }
  rows.sort((a, b) => b.sentAt.localeCompare(a.sentAt));

  // Per pharmacy / company: how many requests, how many answered, how many ignored, typical answer time.
  const byPlace = new Map<string, { place: string; sent: number; answered: number; noReply: number; waiting: number; undelivered: number; times: number[] }>();
  for (const r of rows) {
    const p = byPlace.get(r.place) ?? { place: r.place, sent: 0, answered: 0, noReply: 0, waiting: 0, undelivered: 0, times: [] };
    p.sent++;
    if (r.status === "NO_REPLY") p.noReply++;
    else if (r.status === "WAITING") p.waiting++;
    else if (r.status === "UNDELIVERED") p.undelivered++;
    else if (r.status !== "CANCELLED") p.answered++;
    if (r.minutesToAnswer !== null) p.times.push(r.minutesToAnswer);
    byPlace.set(r.place, p);
  }
  const stats = [...byPlace.values()]
    .map((p) => {
      const t = [...p.times].sort((a, b) => a - b);
      const closed = p.answered + p.noReply;
      return {
        place: p.place, sent: p.sent, answered: p.answered, noReply: p.noReply, waiting: p.waiting, undelivered: p.undelivered,
        replyRate: closed ? Math.round((p.answered / closed) * 100) : null,
        medianMinutes: t.length ? t[Math.floor(t.length / 2)] : null,
      };
    })
    .sort((a, b) => (a.replyRate ?? 101) - (b.replyRate ?? 101));

  return NextResponse.json({ days, stats, rows });
}

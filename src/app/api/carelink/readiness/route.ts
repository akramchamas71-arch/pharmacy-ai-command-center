import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/apiGuard";
import { PERMISSIONS } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { phoneDigits, phoneKey, WHATSAPP_TEMPLATES } from "@/lib/whatsapp";
import { resolveBranchDeliveryContact } from "@/lib/deliveryContacts";

// Self-check for the CareLink flow (customer -> AI -> pharmacy -> price -> delivery). Needs a
// logged-in dashboard user. Returns ONLY yes/no facts and masked numbers — never a secret value.
// Open it in the browser while logged in to the dashboard: /api/carelink/readiness
const mask = (v: string | null | undefined) => {
  const d = phoneDigits(v);
  return d ? `…${d.slice(-4)}` : null;
};

export async function GET(req: NextRequest) {
  const guard = await requirePermission(req, PERMISSIONS.WHATSAPP_SEND);
  if (guard instanceof NextResponse) return guard;

  const env = {
    token: Boolean(process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN),
    appSecret: Boolean(process.env.WHATSAPP_APP_SECRET),
    verifyToken: Boolean(process.env.WHATSAPP_VERIFY_TOKEN || process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN),
    phoneNumberId: Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID),
    carelinkPhoneNumberId: Boolean(process.env.WHATSAPP_CARELINK_PHONE_NUMBER_ID),
    carelinkContact: Boolean(process.env.CARELINK_CONTACT_WHATSAPP),
    anthropicKey: Boolean(process.env.ANTHROPIC_API_KEY),
  };

  const branches = await prisma.branch.findMany({
    orderBy: { name: "asc" },
    select: {
      name: true,
      status: true,
      whatsappNumber: true,
      specialDeliveryContactWhatsapp: true,
      specialDeliveryContactLabel: true,
    },
  });
  const branchRows = branches.map(
    (b: {
      name: string;
      status: string;
      whatsappNumber: string | null;
      specialDeliveryContactWhatsapp: string | null;
      specialDeliveryContactLabel: string | null;
    }) => {
      const delivery = resolveBranchDeliveryContact(b);
      return {
        branch: b.name,
        pharmacyWhatsapp: mask(b.whatsappNumber) ?? "MISSING",
        deliveryTo: delivery ? `${delivery.label ?? ""} ${mask(delivery.whatsapp)}`.trim() : "MISSING",
        deliverySource: delivery?.source ?? null,
        // Partner companies (e.g. شركة لطافة) can sit in this table without being pharmacies; they
        // are served through the suppliers table, so only real pharmacies are judged here.
        isPharmacy: b.name.includes("صيدلية"),
        ok: !b.name.includes("صيدلية") || Boolean(b.whatsappNumber && delivery),
      };
    }
  );

  // Template approval status straight from Meta (needs the whatsapp_business_management permission).
  const wabaId = process.env.WHATSAPP_WABA_ID || "1111794758260981";
  const token = process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN;
  const wanted = [WHATSAPP_TEMPLATES.reservation(), WHATSAPP_TEMPLATES.delivery()];
  const templates: Record<string, string> = {};
  let templatesNote: string | null = null;
  if (token) {
    try {
      const r = await fetch(
        `https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION || "v21.0"}/${wabaId}/message_templates?fields=name,status,language&limit=100`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await r.json().catch(() => null);
      if (!r.ok) {
        templatesNote = `تعذّر قراءة القوالب من ميتا: ${data?.error?.message ?? r.status}`;
      } else {
        for (const name of wanted) {
          const found = (data?.data ?? []).filter((t: { name: string }) => t.name === name);
          templates[name] = found.length
            ? found.map((t: { status: string; language: string }) => `${t.status} (${t.language})`).join(", ")
            : "NOT_FOUND";
        }
      }
    } catch (e) {
      templatesNote = `تعذّر الاتصال بميتا: ${e instanceof Error ? e.message : "خطأ"}`;
    }
  }

  const templatesReadable = templatesNote === null && Object.keys(templates).length > 0;
  // --- Live checks: is the WhatsApp token accepted by Meta, and the AI key accepted by Anthropic? ---
  // Both are read-only GETs; no secret is ever returned, only ok / HTTP status / Meta's error text.
  const checks: Record<string, { ok: boolean; status?: number; message?: string }> = {};
  try {
    const phoneId = process.env.WHATSAPP_CARELINK_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (token && phoneId) {
      const r = await fetch(
        `https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION || "v21.0"}/${phoneId}?fields=display_phone_number,verified_name,quality_rating`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const d = await r.json().catch(() => null);
      checks.whatsappToken = r.ok
        ? { ok: true, status: r.status, message: `${d?.verified_name ?? ""} ${d?.quality_rating ?? ""}`.trim() }
        : { ok: false, status: r.status, message: d?.error?.message ?? "rejected" };
    }
  } catch (e) {
    checks.whatsappToken = { ok: false, message: e instanceof Error ? e.message : "network" };
  }
  // What kind of token is stored, who it belongs to and which WhatsApp accounts it can reach
  // (Meta's debug_token, authorised with the app's own id|secret). Never returns the token itself.
  let tokenInfo: unknown = null;
  try {
    const appId = process.env.WHATSAPP_APP_ID || "2025254191473578";
    const appSecret = process.env.WHATSAPP_APP_SECRET;
    if (token && appSecret) {
      const r = await fetch(
        `https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION || "v21.0"}/debug_token?input_token=${encodeURIComponent(token)}`,
        { headers: { Authorization: `Bearer ${appId}|${appSecret}` } }
      );
      const d = await r.json().catch(() => null);
      const x = d?.data;
      tokenInfo = r.ok && x
        ? {
            type: x.type,
            valid: x.is_valid,
            expiresAt: x.expires_at === 0 ? "never" : x.expires_at,
            userId: x.user_id,
            appId: x.app_id,
            scopes: x.scopes,
            granular: (x.granular_scopes ?? []).map((g: { scope: string; target_ids?: string[] }) => ({
              scope: g.scope,
              targets: g.target_ids,
            })),
          }
        : { error: d?.error?.message ?? `HTTP ${r.status}` };
    }
  } catch (e) {
    tokenInfo = { error: e instanceof Error ? e.message : "network" };
  }
  try {
    if (process.env.ANTHROPIC_API_KEY) {
      const r = await fetch("https://api.anthropic.com/v1/models?limit=1", {
        headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      });
      const d = await r.json().catch(() => null);
      checks.anthropicKey = r.ok ? { ok: true, status: r.status } : { ok: false, status: r.status, message: d?.error?.message ?? "rejected" };
    }
  } catch (e) {
    checks.anthropicKey = { ok: false, message: e instanceof Error ? e.message : "network" };
  }

  // --- The latest conversations: did the AI answer, and is it still the one assigned? ---
  const convs = await prisma.whatsappConversation.findMany({
    orderBy: { updatedAt: "desc" },
    take: 4,
    select: {
      channel: true,
      assignedAgent: true,
      status: true,
      updatedAt: true,
      messages: { orderBy: { createdAt: "desc" }, take: 4, select: { direction: true, type: true, createdAt: true, content: true } },
    },
  });
  const recent = convs.map(
    (c: {
      channel: string;
      assignedAgent: string;
      status: string;
      updatedAt: Date;
      messages: { direction: string; type: string; createdAt: Date; content: string }[];
    }) => ({
      channel: c.channel,
      assignedAgent: c.assignedAgent,
      status: c.status,
      updatedAt: c.updatedAt,
      lastMessages: c.messages.map((m) => ({
        dir: m.direction,
        at: m.createdAt,
        text: m.content.slice(0, 40),
      })),
    })
  );

  const aiTurnRows = await prisma.auditLog.findMany({
    where: { action: "ai.turn" },
    orderBy: { createdAt: "desc" },
    take: 6,
    select: { createdAt: true, newValue: true },
  });
  const aiTurns = aiTurnRows.map((r: { createdAt: Date; newValue: unknown }) => ({ at: r.createdAt, ...(r.newValue as object) }));

  const allOk =
    env.token && env.appSecret && env.verifyToken && env.phoneNumberId && env.anthropicKey &&
    branchRows.length > 0 && branchRows.every((b: { ok: boolean }) => b.ok) &&
    (!templatesReadable || wanted.every((n) => /APPROVED/.test(templates[n] ?? "")));

  // Compact view by default (readable in one phone photo); add ?full=1 for the complete dump.
  const full = req.nextUrl.searchParams.get("full") === "1";
  const targets = new Set<string>();
  const ti = tokenInfo as { granular?: { targets?: string[] }[] } | null;
  for (const g of ti?.granular ?? []) for (const t of g.targets ?? []) targets.add(String(t));
  const tokenSummary =
    tokenInfo && !(tokenInfo as { error?: string }).error
      ? {
          ...(tokenInfo as object),
          granular: undefined,
          reachesWhatsAppAccount: targets.has(wabaId) ? "YES" : targets.size ? `NO (reaches: ${[...targets].join(",")})` : "NO (token has no account targets)",
        }
      : tokenInfo;
  const lastTurns = aiTurns.slice(0, 3).map((t: Record<string, unknown>) => {
    const trace = (t.trace as { tool: string; error?: string }[] | undefined) ?? [];
    const firstErr = trace.find((x) => x.error)?.error;
    return {
      at: t.at,
      outcome: t.outcome,
      tools: trace.length,
      firstError: firstErr ? firstErr.replace(/\\"/g, "").slice(0, 160) : null,
    };
  });
  const compactRecent = recent.slice(0, 2).map((c: { channel: string; assignedAgent: string; lastMessages: { dir: string; at: Date }[] }) => ({
    channel: c.channel,
    agent: c.assignedAgent,
    last: c.lastMessages.slice(0, 2).map((m: { dir: string; at: Date }) => `${m.dir} ${new Date(m.at).toISOString().slice(11, 16)}Z`),
  }));
  // ?msgs=1 : the latest pharmacy asks and the latest CareLink conversation, with message text.
  let msgsView: unknown = undefined;
  if (req.nextUrl.searchParams.get("msgs") === "1") {
    const inquiries = await prisma.carelinkInquiry.findMany({
      orderBy: { createdAt: "desc" },
      take: 4,
      select: {
        referenceCode: true,
        status: true,
        qty: true,
        quotedPrice: true,
        rawReply: true,
        createdAt: true,
        answeredAt: true,
        branch: { select: { name: true } },
        product: { select: { name: true } },
      },
    });
    const conv = await prisma.whatsappConversation.findFirst({
      where: { channel: "CARELINK" },
      orderBy: { updatedAt: "desc" },
      select: { messages: { orderBy: { createdAt: "desc" }, take: 8, select: { direction: true, type: true, createdAt: true, content: true } } },
    });
    msgsView = {
      inquiries: inquiries.map(
        (q: {
          referenceCode: string;
          status: string;
          qty: number;
          quotedPrice: unknown;
          rawReply: string | null;
          createdAt: Date;
          branch: { name: string };
          product: { name: string };
        }) => ({
          code: q.referenceCode,
          branch: q.branch.name,
          product: q.product.name,
          qty: q.qty,
          status: q.status,
          price: q.quotedPrice === null ? null : String(q.quotedPrice),
          reply: q.rawReply?.slice(0, 100) ?? null,
          at: q.createdAt,
        })
      ),
      messages: (conv?.messages ?? []).map((m: { direction: string; type: string; createdAt: Date; content: string }) => ({
        dir: m.direction,
        type: m.type,
        at: m.createdAt,
        text: m.content.slice(0, 160),
      })),
    };
  }
  // ?branches=1 : how each pharmacy number is stored + which recent CareLink chats are really
  // pharmacies (so a pharmacy mistaken for a customer is visible), plus the latest orders.
  let branchesView: unknown = undefined;
  if (req.nextUrl.searchParams.get("branches") === "1") {
    const bs = await prisma.branch.findMany({ select: { name: true, whatsappNumber: true, specialDeliveryContactWhatsapp: true } });
    const convs = await prisma.whatsappConversation.findMany({
      where: { channel: "CARELINK" },
      orderBy: { updatedAt: "desc" },
      take: 10,
      select: { assignedAgent: true, customer: { select: { name: true, phone: true } }, _count: { select: { messages: true } } },
    });
    const orders = await prisma.order.findMany({
      orderBy: { createdAt: "desc" },
      take: 3,
      select: { orderNumber: true, status: true, source: true, createdAt: true, notes: true, branch: { select: { name: true } } },
    });
    const notices = await prisma.auditLog.findMany({
      where: { action: "carelink.delivery.notify" },
      orderBy: { createdAt: "desc" },
      take: 4,
      select: { createdAt: true, entity: true, newValue: true },
    });
    type B = { name: string; whatsappNumber: string | null; specialDeliveryContactWhatsapp: string | null };
    branchesView = {
      branches: bs.map((b: B) => ({ name: b.name, wa: b.whatsappNumber, key: phoneKey(b.whatsappNumber), delivery: b.specialDeliveryContactWhatsapp })),
      chats: convs.map((c: { assignedAgent: string; customer: { name: string | null; phone: string }; _count: { messages: number } }) => ({
        name: c.customer.name,
        phone: c.customer.phone,
        isBranch: bs.find((b: B) => phoneKey(b.whatsappNumber) === phoneKey(c.customer.phone))?.name ?? null,
        msgs: c._count.messages,
      })),
      deliveryNotices: notices.map((n: { createdAt: Date; entity: string; newValue: unknown }) => {
        const v = (n.newValue ?? {}) as { via?: string; deliveryReached?: boolean; deliveryError?: string | null; deliveryContact?: string };
        return { at: n.createdAt, order: n.entity, via: v.via, reached: v.deliveryReached, to: v.deliveryContact, error: v.deliveryError ? String(v.deliveryError).slice(0, 140) : null };
      }),
      orders: orders.map((o: { orderNumber: string; status: string; source: string; createdAt: Date; notes: string | null; branch: { name: string } }) => ({
        no: o.orderNumber,
        status: o.status,
        source: o.source,
        branch: o.branch.name,
        at: o.createdAt,
        notes: o.notes?.slice(0, 200) ?? null,
      })),
    };
  }
  const body = {
    ready: allOk,
    ...(branchesView ? { branchesView } : {}),
    ...(msgsView ? { msgs: msgsView } : {}),
    token: tokenSummary,
    checks,
    lastTurns,
    recent: compactRecent,
    templates,
    templatesNote:
      templatesNote ?? (templatesReadable ? null : "لم تُقرأ حالة القوالب — تحقق منها يدوياً في WhatsApp Manager."),
  };
  if (!full) return NextResponse.json(body);
  return NextResponse.json({ ...body, env, branches: branchRows, recentFull: recent, aiTurns });
}

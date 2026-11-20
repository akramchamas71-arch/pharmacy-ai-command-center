import { prisma } from "@/lib/prisma";
import { NotFoundError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { appendInboundMessage } from "@/lib/conversations";
import { MessageType } from "@prisma/client";

/**
 * Partner suppliers (شركات شريكة، مثل شركة لطافة) — see the Supplier model's comment in
 * prisma/schema.prisma for the real business flow. A supplier is NOT a branch and has NO stock
 * rows: when no pharmacy has an item the AI asks the supplier over WhatsApp
 * (request_supplier_reservation in src/lib/aiTools.ts), and the supplier's reply comes back
 * through the WhatsApp webhook into handleSupplierReply() below.
 */

export type SupplierStatus = "ACTIVE" | "DISABLED";

export interface SupplierInput {
  name: string;
  whatsappNumber: string;
  specialty?: string | null;
  deliveryContactWhatsapp?: string | null;
  deliveryContactLabel?: string | null;
  paymentTerms?: string | null;
  notes?: string | null;
}

/** "009613854133", "+961 3 854 133", "9613854133" -> "+9613854133". */
export function normalizeWhatsapp(value: string): string {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  return `+${digits}`;
}

export async function listSuppliers(includeDisabled: boolean) {
  return prisma.supplier.findMany({
    where: includeDisabled ? {} : { status: "ACTIVE" },
    orderBy: { name: "asc" },
  });
}

export async function getSupplier(id: string) {
  const supplier = await prisma.supplier.findUnique({ where: { id } });
  if (!supplier) throw new NotFoundError(`لا توجد شركة بهذا المعرّف: ${id}`);
  return supplier;
}

export async function createSupplier(input: SupplierInput, userId: string | null = null) {
  const supplier = await prisma.supplier.create({
    data: {
      ...input,
      whatsappNumber: normalizeWhatsapp(input.whatsappNumber),
      deliveryContactWhatsapp: input.deliveryContactWhatsapp ? normalizeWhatsapp(input.deliveryContactWhatsapp) : null,
      status: "ACTIVE",
    },
  });
  await logAudit({ userId, action: "supplier.create", entity: `Supplier:${supplier.id}`, newValue: { name: supplier.name } });
  return supplier;
}

export async function updateSupplier(
  id: string,
  input: Partial<SupplierInput> & { status?: SupplierStatus },
  userId: string | null = null
) {
  const before = await getSupplier(id);
  const data: Record<string, unknown> = { ...input };
  if (input.whatsappNumber) data.whatsappNumber = normalizeWhatsapp(input.whatsappNumber);
  if (input.deliveryContactWhatsapp) data.deliveryContactWhatsapp = normalizeWhatsapp(input.deliveryContactWhatsapp);
  const updated = await prisma.supplier.update({ where: { id }, data });
  await logAudit({
    userId,
    action: "supplier.update",
    entity: `Supplier:${id}`,
    oldValue: { name: before.name, status: before.status },
    newValue: { name: updated.name, status: updated.status },
  });
  return updated;
}

export async function listSupplierInquiries(limit = 100) {
  return prisma.supplierInquiry.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { supplier: { select: { id: true, name: true } } },
  });
}

/**
 * Conservative price extraction from a supplier's free-text WhatsApp reply. Unlike a bare "first
 * number in the text" (which would read "متوفر 3 قطع بسعر 25$" as 3), this only accepts:
 *   1. a number right next to a dollar sign / "دولار" / "usd", or
 *   2. the ONLY number in the whole reply.
 * Anything ambiguous returns null, which the caller stores as NEEDS_REVIEW — a human decides,
 * the AI never guesses a price.
 */
export function parseSupplierPrice(text: string): number | null {
  const norm = text.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/,/g, ".");
  const near =
    norm.match(/(\d+(?:\.\d{1,2})?)\s*(?:\$|usd|دولار)/i) || norm.match(/(?:\$|usd)\s*(\d+(?:\.\d{1,2})?)/i);
  if (near) {
    const v = parseFloat(near[1]);
    return Number.isFinite(v) ? v : null;
  }
  const all = norm.match(/\d+(?:\.\d{1,2})?/g) ?? [];
  if (all.length === 1) {
    const v = parseFloat(all[0]);
    return Number.isFinite(v) ? v : null;
  }
  return null;
}

/**
 * Called by the WhatsApp webhook when an inbound message's SENDER is a registered supplier's
 * number: records the reply on the matching SupplierInquiry (by quoted SUP-XXXXXX code, else the
 * supplier's latest PENDING inquiry), writes a "[رد الشركة]" note into the waiting conversation,
 * and resumes the AI turn so it can relay the answer to the customer. Same shape as
 * handleCarelinkBranchReply() in src/lib/carelink.ts.
 */
export async function handleSupplierReply(input: { supplierId: string; content: string; waMessageId?: string }) {
  const { supplierId, content, waMessageId } = input;

  const codeMatch = content.match(/SUP-[A-Z0-9]{4,}/i);
  let inquiry = codeMatch
    ? await prisma.supplierInquiry.findFirst({
        where: { supplierId, status: "PENDING", referenceCode: codeMatch[0].toUpperCase() },
      })
    : null;
  if (!inquiry) {
    inquiry = await prisma.supplierInquiry.findFirst({
      where: { supplierId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
    });
  }
  if (!inquiry) {
    console.warn(`[supplier] رد وارد من شركة (${supplierId}) بلا طلب حجز معلّق ليُطابقه — تم تجاهله: "${content}"`);
    return;
  }

  const quotedPrice = parseSupplierPrice(content);
  await prisma.supplierInquiry.update({
    where: { id: inquiry.id },
    data: {
      status: quotedPrice !== null ? "ANSWERED" : "NEEDS_REVIEW",
      quotedPrice: quotedPrice ?? undefined,
      rawReply: content,
      answeredAt: new Date(),
    },
  });

  const note =
    quotedPrice !== null
      ? `[رد الشركة] السعر المعروض: ${quotedPrice} (الكمية المطلوبة: ${inquiry.qty}) — رمز الطلب ${inquiry.referenceCode}. النص الكامل: "${content}"`
      : `[رد الشركة - يحتاج مراجعة بشرية] لم يُفهم السعر أو التوفر تلقائياً — رمز الطلب ${inquiry.referenceCode}. النص الكامل: "${content}"`;

  await appendInboundMessage({
    conversationId: inquiry.conversationId,
    type: MessageType.SYSTEM,
    content: note,
    waMessageId,
  });

  try {
    const { runAiTurn } = await import("@/lib/aiOrchestrator");
    await runAiTurn(inquiry.conversationId);
  } catch (e) {
    console.error(`[supplier] فشل استكمال المحادثة (${inquiry.conversationId}) بعد رد الشركة`, e);
  }
}

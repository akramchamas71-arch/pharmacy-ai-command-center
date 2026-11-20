import { prisma } from "@/lib/prisma";
import { sendBusinessTemplate, WHATSAPP_TEMPLATES } from "@/lib/whatsapp";
import { appendInboundMessage } from "@/lib/conversations";
import { logAudit } from "@/lib/audit";
import { CarelinkInquiryStatus, MessageType } from "@prisma/client";

/**
 * A reservation request (to a pharmacy or a partner supplier) that Meta accepted but then reported as
 * FAILED in a status webhook — typically 131047, the 24h window was closed and the free text was dropped.
 * Before this file existed nobody found out: the customer was told "we are checking" while the pharmacy
 * never received anything (18 Nov 2026, CLK-AP2NGC / صيدلية يحيى).
 *
 * What happens now, at most once per inquiry:
 *  1. resend the same request as the approved template (carelink_reservation_request);
 *  2. if that also fails, close the inquiry and wake the AI with an honest note so it tells the customer.
 */
const SOURCES = ["carelink.inquiry.send", "carelink.inquiry.reminder", "supplier.inquiry.send"];

async function wakeAi(conversationId: string, note: string) {
  await appendInboundMessage({ conversationId, type: MessageType.SYSTEM, content: note });
  try {
    const { runAiTurn } = await import("@/lib/aiOrchestrator");
    await runAiTurn(conversationId);
  } catch (e) {
    console.error(`[inquiry-fallback] فشل إبلاغ الزبون (${conversationId})`, e);
  }
}

export async function handleFailedInquiryMessage(waMessageId: string, errorCode?: number, errorTitle?: string): Promise<boolean> {
  const src = await prisma.auditLog.findFirst({
    where: { action: { in: SOURCES }, newValue: { path: ["waMessageId"], equals: waMessageId } },
    orderBy: { createdAt: "desc" },
    select: { entity: true, action: true },
  });
  if (!src) return false; // not a reservation request of ours

  const already = await prisma.auditLog.findFirst({
    where: { action: "inquiry.template_resend", entity: src.entity },
    select: { id: true },
  });
  const from = process.env.WHATSAPP_CARELINK_PHONE_NUMBER_ID;

  if (src.entity.startsWith("CarelinkInquiry:")) {
    const id = src.entity.slice("CarelinkInquiry:".length);
    const inq = await prisma.carelinkInquiry.findUnique({
      where: { id },
      include: { branch: { select: { name: true, whatsappNumber: true } }, product: { select: { name: true } } },
    });
    if (!inq || inq.status !== CarelinkInquiryStatus.PENDING || !inq.branch.whatsappNumber) return true;

    if (!already) {
      try {
        const sent = await sendBusinessTemplate(
          inq.branch.whatsappNumber,
          { name: WHATSAPP_TEMPLATES.reservation(), params: [inq.referenceCode, inq.product.name, String(inq.qty)] },
          { fromPhoneNumberId: from }
        );
        // Logged under the SAME action as the first send so a failure of this resend is found again.
        await logAudit({ userId: null, action: "inquiry.template_resend", entity: src.entity, newValue: { failedWaMessageId: waMessageId, errorCode, errorTitle } });
        await logAudit({ userId: null, action: "carelink.inquiry.send", entity: src.entity, newValue: { referenceCode: inq.referenceCode, via: "template", waMessageId: sent.waMessageId, resend: true } });
        console.log(`[inquiry-fallback] ${inq.referenceCode}: النص لم يُسلَّم (${errorCode}) — أُعيد الإرسال بالقالب`);
        return true;
      } catch (e) {
        console.error(`[inquiry-fallback] ${inq.referenceCode}: فشل الإرسال بالقالب أيضاً`, e);
      }
    }

    await prisma.carelinkInquiry.update({ where: { id }, data: { status: CarelinkInquiryStatus.CANCELLED, answeredAt: new Date() } });
    await logAudit({ userId: null, action: "inquiry.undeliverable", entity: src.entity, newValue: { waMessageId, errorCode, errorTitle } });
    await wakeAi(
      inq.conversationId,
      `[تعذّر وصول طلب الحجز] طلب الحجز ${inq.referenceCode} (${inq.product.name} × ${inq.qty}) لم يصل إلى الصيدلية بسبب خطأ في واتساب (${errorCode ?? ""}). الطلب أُلغي ولم يعد قيد المتابعة. أخبر الزبون بصدق أن الصيدلية لم تستلم الطلب، ثم إما أعد المحاولة مع صيدلية أخرى عبر assign_pharmacy ثم request_branch_reservation، أو أخبره أن فريق Carelink سيتواصل معه.`
    );
    return true;
  }

  if (src.entity.startsWith("SupplierInquiry:")) {
    const id = src.entity.slice("SupplierInquiry:".length);
    const inq = await prisma.supplierInquiry.findUnique({ where: { id }, include: { supplier: { select: { name: true, whatsappNumber: true } } } });
    if (!inq || inq.status !== "PENDING") return true;

    if (!already) {
      try {
        const sent = await sendBusinessTemplate(
          inq.supplier.whatsappNumber,
          { name: WHATSAPP_TEMPLATES.reservation(), params: [inq.referenceCode, inq.productText, String(inq.qty)] },
          { fromPhoneNumberId: from }
        );
        await logAudit({ userId: null, action: "inquiry.template_resend", entity: src.entity, newValue: { failedWaMessageId: waMessageId, errorCode, errorTitle } });
        await logAudit({ userId: null, action: "supplier.inquiry.send", entity: src.entity, newValue: { referenceCode: inq.referenceCode, via: "template", waMessageId: sent.waMessageId, resend: true } });
        console.log(`[inquiry-fallback] ${inq.referenceCode}: النص لم يُسلَّم (${errorCode}) — أُعيد الإرسال بالقالب`);
        return true;
      } catch (e) {
        console.error(`[inquiry-fallback] ${inq.referenceCode}: فشل الإرسال بالقالب أيضاً`, e);
      }
    }

    await prisma.supplierInquiry.update({ where: { id }, data: { status: "CANCELLED", answeredAt: new Date() } });
    await logAudit({ userId: null, action: "inquiry.undeliverable", entity: src.entity, newValue: { waMessageId, errorCode, errorTitle } });
    await wakeAi(
      inq.conversationId,
      `[تعذّر وصول طلب الحجز] طلب الحجز ${inq.referenceCode} (${inq.productText} × ${inq.qty}) لم يصل إلى الشركة الشريكة بسبب خطأ في واتساب (${errorCode ?? ""}). الطلب أُلغي ولم يعد قيد المتابعة. أخبر الزبون بصدق أن الشركة لم تستلم الطلب وأن فريق Carelink سيتواصل معه.`
    );
    return true;
  }
  return false;
}

import { prisma } from "@/lib/prisma";
import { sendBusinessMessage } from "@/lib/whatsapp";
import { resolveBranchDeliveryContact } from "@/lib/deliveryContacts";
import { logAudit } from "@/lib/audit";

/**
 * Meta often ACCEPTS a free-text message to a number outside the 24h window (HTTP 200 + message id) and
 * only reports the real outcome later, in a status webhook ("failed", error 131047 / 131049 / 131026).
 * When that happens to a CareLink delivery notice, the order must not be left silent: this hands the
 * details to the PHARMACY (inside its own 24h window, since it replied to us) so it can pass them on to
 * the delivery contact, and flags the order so the team sees it. Runs at most once per order.
 */
export const FAILED_STATUS_CODES = [131047, 131049, 131026];

export async function handleFailedDeliveryNotice(waMessageId: string, errorCode?: number, errorTitle?: string): Promise<boolean> {
  const notice = await prisma.auditLog.findFirst({
    where: { action: "carelink.delivery.notify", newValue: { path: ["waMessageId"], equals: waMessageId } },
    orderBy: { createdAt: "desc" },
    select: { entity: true },
  });
  if (!notice) return false; // not one of our delivery notices

  const already = await prisma.auditLog.findFirst({
    where: { action: "carelink.delivery.fallback", entity: notice.entity },
    select: { id: true },
  });
  if (already) return true;

  const orderId = notice.entity.replace(/^Order:/, "");
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      orderNumber: true,
      deliveryAddress: true,
      notes: true,
      branch: {
        select: { name: true, address: true, whatsappNumber: true, specialDeliveryContactWhatsapp: true, specialDeliveryContactLabel: true },
      },
      customer: { select: { name: true, phone: true, address: true } },
    },
  });
  if (!order || !order.branch.whatsappNumber) return false;

  const contact = resolveBranchDeliveryContact(order.branch);
  const pickup = `${order.branch.name}${order.branch.address ? ` — ${order.branch.address}` : ""}`;
  const address = order.deliveryAddress ?? order.customer.address ?? "(لم يُحدَّد عنوان)";
  const customerLabel = `${order.customer.name ?? "زبون"} ${order.customer.phone}`;

  const sent = await sendBusinessMessage(
    order.branch.whatsappNumber,
    `طلب جديد مؤكد من Carelink — رقم الطلب ${order.orderNumber}. الرجاء تجهيزه وإبلاغ ${contact?.label ?? "الديلفري"}${contact ? ` (${contact.whatsapp})` : ""} للاستلام من: ${pickup} والتسليم إلى: ${address}. الزبون: ${customerLabel}.`,
    { fromPhoneNumberId: process.env.WHATSAPP_CARELINK_PHONE_NUMBER_ID }
  );

  await prisma.order
    .update({
      where: { id: orderId },
      data: {
        notes: `${order.notes ?? ""} | ⚠ رسالة الديلفري لم تُسلَّم (واتساب ${errorCode ?? ""} ${errorTitle ?? ""}): أُرسلت التفاصيل للصيدلية لتبلّغه — راجعوا يدوياً.`.trim(),
      },
    })
    .catch(() => undefined);

  await logAudit({
    userId: null,
    action: "carelink.delivery.fallback",
    entity: notice.entity,
    newValue: { failedWaMessageId: waMessageId, errorCode, errorTitle, fallbackWaMessageId: sent.waMessageId },
  });
  return true;
}

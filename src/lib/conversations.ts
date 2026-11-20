import { prisma } from "@/lib/prisma";
import { NotFoundError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { sendTextMessage, WhatsAppConfigError, hasOpenServiceWindow } from "@/lib/whatsapp";
import {
  AssignedAgent,
  ConversationChannel,
  ConversationStatus,
  MessageDirection,
  MessageType,
  Prisma,
} from "@prisma/client";

/**
 * Throws loudly rather than silently falling back to the default WHATSAPP_PHONE_NUMBER_ID —
 * see .env.example's WHATSAPP_CARELINK_PHONE_NUMBER_ID comment. Replying to a CareLink
 * customer from the pharmacy's own number would be actively wrong (breaks the premise that
 * they're talking to CareLink), so this is a hard config-time failure, same posture as
 * `requireWhatsAppConfig()` in whatsapp.ts.
 */
function careLinkPhoneNumberIdOrThrow(): string {
  // Single-number setup (Meta direct): the only registered number IS CareLink's, so fall back to it.
  const id = process.env.WHATSAPP_CARELINK_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!id) {
    throw new WhatsAppConfigError(
      "WHATSAPP_CARELINK_PHONE_NUMBER_ID غير معرّف في .env — لا يمكن الرد على محادثة Carelink دون رقم واتساب مخصص لها (راجع .env.example)."
    );
  }
  return id;
}

/**
 * One open conversation per customer at a time — a second inbound message from the same
 * customer while one is already OPEN continues that thread rather than starting a new one
 * (matches how a real WhatsApp chat behaves: it's one running conversation, not a new
 * ticket per message). A customer who was CLOSED out gets a fresh conversation next time
 * they write in.
 *
 * `channel` (added this session for CareLink, default DIRECT — see ConversationChannel's
 * comment in schema.prisma) is now part of the "open conversation" lookup key, not just the
 * create: the same real person could plausibly message BOTH the pharmacy's own number and
 * CareLink's number with the same phone (same Customer row, since customers are keyed by
 * phone) — without scoping by channel, a currently-open DIRECT conversation would wrongly
 * swallow a CareLink message (or vice versa), mixing two different AI roles into one thread.
 */
export async function getOrCreateOpenConversation(
  customerId: string,
  assignedBranchId?: string | null,
  channel: ConversationChannel = ConversationChannel.DIRECT
) {
  const existing = await prisma.whatsappConversation.findFirst({
    where: { customerId, status: ConversationStatus.OPEN, channel },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return existing;

  return prisma.whatsappConversation.create({
    data: {
      customerId,
      assignedAgent: AssignedAgent.AI,
      assignedBranchId: assignedBranchId ?? null,
      status: ConversationStatus.OPEN,
      channel,
    },
  });
}

export interface InboundMessageInput {
  conversationId: string;
  type: MessageType;
  content: string;
  waMessageId?: string;
}

/**
 * Persists an inbound message. Idempotent on `waMessageId`: Meta retries webhook delivery
 * on anything but a fast 200 OK, so the same message can legitimately arrive twice — a
 * second insert with the same `waMessageId` hits the column's `@unique` constraint, which
 * is caught here and treated as "already recorded," not an error.
 */
export async function appendInboundMessage(input: InboundMessageInput) {
  const { conversationId, type, content, waMessageId } = input;

  try {
    return await prisma.whatsappMessage.create({
      data: { conversationId, direction: MessageDirection.INBOUND, type, content, waMessageId },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && waMessageId) {
      const existing = await prisma.whatsappMessage.findUnique({ where: { waMessageId } });
      if (existing) return existing;
    }
    throw e;
  }
}

export interface SendReplyInput {
  conversationId: string;
  text: string;
  userId: string | null;
}

/**
 * The one path for an OUTBOUND message: call the real Cloud API first, and only persist a
 * WhatsappMessage row if Meta actually accepted it — a message that failed to send must
 * never show up in the thread as if it went out. No Phase 5 AI logic here yet; this is
 * called either by a human reply through the inbox (POST /api/whatsapp/send) or, from
 * Phase 5 onward, by the AI orchestrator's send_whatsapp_message tool.
 */
export async function sendReply(input: SendReplyInput) {
  const { conversationId, text, userId } = input;

  const conversation = await prisma.whatsappConversation.findUnique({
    where: { id: conversationId },
    include: { customer: true },
  });
  if (!conversation) throw new NotFoundError(`لا توجد محادثة بهذا المعرّف: ${conversationId}`);

  // See careLinkPhoneNumberIdOrThrow()'s own comment — a CARELINK-channel reply must go out
  // from CareLink's own registered number, never the pharmacy's default one.
  const fromPhoneNumberId =
    conversation.channel === ConversationChannel.CARELINK ? careLinkPhoneNumberIdOrThrow() : undefined;

  // Customer of the CareLink app (has written from the app, waMessageId = null) whose WhatsApp
  // 24h window is closed: the reply is delivered in the app only — a WhatsApp text would be
  // accepted by Meta and then silently dropped.
  let waMessageId: string | undefined;
  const usesApp = await prisma.whatsappMessage.findFirst({
    where: { conversationId, direction: MessageDirection.INBOUND, waMessageId: null, type: { not: MessageType.SYSTEM } },
    select: { id: true },
  });
  if (usesApp && !(await hasOpenServiceWindow(conversation.customer.phone))) {
    waMessageId = undefined;
  } else {
    ({ waMessageId } = await sendTextMessage(conversation.customer.phone, text, { fromPhoneNumberId }));
  }

  const message = await prisma.whatsappMessage.create({
    data: {
      conversationId,
      direction: MessageDirection.OUTBOUND,
      type: MessageType.TEXT,
      content: text,
      waMessageId,
    },
  });

  await logAudit({
    userId,
    action: "whatsapp.send",
    entity: `WhatsappConversation:${conversationId}`,
    newValue: { messageId: message.id, waMessageId },
  });

  return message;
}

/**
 * Best-effort outbound notification triggered by a non-WhatsApp domain event — Phase 6's
 * delivery status changes are the first caller. Reuses the same get-or-create-conversation
 * + sendReply() path as a human inbox reply, but a failure here (most commonly: the 24h
 * customer-service window is closed and no approved template exists yet — see the plan
 * doc's §4 template requirement) is caught and logged rather than thrown, because a WhatsApp
 * send failing must never block or roll back the delivery/order update that triggered it.
 */
export async function notifyCustomer(customerId: string, text: string, userId: string | null): Promise<void> {
  try {
    const conversation = await getOrCreateOpenConversation(customerId);
    await sendReply({ conversationId: conversation.id, text, userId });
  } catch (e) {
    console.error(
      `notifyCustomer: فشل إرسال إشعار للعميل ${customerId} (تم تجاهل الخطأ عمداً — انظر التعليق أعلاه):`,
      e instanceof Error ? e.message : e
    );
  }
}

export async function takeOverConversation(conversationId: string, userId: string | null) {
  const conversation = await prisma.whatsappConversation.findUnique({ where: { id: conversationId } });
  if (!conversation) throw new NotFoundError(`لا توجد محادثة بهذا المعرّف: ${conversationId}`);

  const updated = await prisma.whatsappConversation.update({
    where: { id: conversationId },
    data: { assignedAgent: AssignedAgent.HUMAN },
  });

  await logAudit({
    userId,
    action: "whatsapp.takeover",
    entity: `WhatsappConversation:${conversationId}`,
    oldValue: { assignedAgent: conversation.assignedAgent },
    newValue: { assignedAgent: updated.assignedAgent },
  });

  return updated;
}

export async function returnToAI(conversationId: string, userId: string | null) {
  const conversation = await prisma.whatsappConversation.findUnique({ where: { id: conversationId } });
  if (!conversation) throw new NotFoundError(`لا توجد محادثة بهذا المعرّف: ${conversationId}`);

  const updated = await prisma.whatsappConversation.update({
    where: { id: conversationId },
    data: { assignedAgent: AssignedAgent.AI },
  });

  await logAudit({
    userId,
    action: "whatsapp.returnToAI",
    entity: `WhatsappConversation:${conversationId}`,
    oldValue: { assignedAgent: conversation.assignedAgent },
    newValue: { assignedAgent: updated.assignedAgent },
  });

  return updated;
}

/**
 * The plan doc's medication-safety handoff (§7): a CONTROLLED/PRESCRIPTION product or any
 * clinical question must transfer to a pharmacist, not stay with CS or the AI. Phase 4
 * only exposes the manual action (a human in the inbox clicking "transfer"); Phase 5 will
 * have the AI trigger this automatically when it detects one of those products.
 */
export async function transferToPharmacist(conversationId: string, userId: string | null) {
  const conversation = await prisma.whatsappConversation.findUnique({ where: { id: conversationId } });
  if (!conversation) throw new NotFoundError(`لا توجد محادثة بهذا المعرّف: ${conversationId}`);

  const updated = await prisma.whatsappConversation.update({
    where: { id: conversationId },
    data: { status: ConversationStatus.TRANSFERRED_TO_PHARMACIST, assignedAgent: AssignedAgent.HUMAN },
  });

  await logAudit({
    userId,
    action: "whatsapp.transferToPharmacist",
    entity: `WhatsappConversation:${conversationId}`,
    oldValue: { status: conversation.status },
    newValue: { status: updated.status },
  });

  return updated;
}

export async function closeConversation(conversationId: string, userId: string | null) {
  const conversation = await prisma.whatsappConversation.findUnique({ where: { id: conversationId } });
  if (!conversation) throw new NotFoundError(`لا توجد محادثة بهذا المعرّف: ${conversationId}`);

  const updated = await prisma.whatsappConversation.update({
    where: { id: conversationId },
    data: { status: ConversationStatus.CLOSED },
  });

  await logAudit({
    userId,
    action: "whatsapp.close",
    entity: `WhatsappConversation:${conversationId}`,
    oldValue: { status: conversation.status },
    newValue: { status: updated.status },
  });

  return updated;
}

export interface ConversationListOptions {
  status?: ConversationStatus;
  assignedAgent?: AssignedAgent;
  branchId?: string;
  limit?: number;
}

export async function listConversations(opts: ConversationListOptions = {}) {
  return prisma.whatsappConversation.findMany({
    where: {
      status: opts.status,
      assignedAgent: opts.assignedAgent,
      assignedBranchId: opts.branchId,
    },
    include: {
      customer: true,
      messages: { orderBy: { createdAt: "desc" }, take: 1 }, // last message, for an inbox preview
    },
    orderBy: { updatedAt: "desc" },
    take: Math.min(opts.limit ?? 50, 200),
  });
}

export async function getConversationWithMessages(id: string) {
  const conversation = await prisma.whatsappConversation.findUnique({
    where: { id },
    include: { customer: true, messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!conversation) throw new NotFoundError(`لا توجد محادثة بهذا المعرّف: ${id}`);
  return conversation;
}

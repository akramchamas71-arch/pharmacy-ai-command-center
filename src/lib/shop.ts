import { prisma } from "@/lib/prisma";
import { appendInboundMessage, getOrCreateOpenConversation } from "@/lib/conversations";
import { AssignedAgent, ConversationChannel, MessageDirection, MessageType } from "@prisma/client";

/**
 * The CareLink shop app talks to the SAME CareLink conversation as WhatsApp: an order or a message
 * from the app is stored as an inbound message (waMessageId = null marks it as "from the app") and
 * the same AI agent handles it — same inventory, same Bekaa/Beirut rule, same pharmacy reservation
 * flow. Replies show in the app (and also go out on WhatsApp when the customer's 24h window is open
 * — see sendReply in conversations.ts).
 */
export const APP_ORDER_PREFIX = "[طلب من التطبيق]";
const MAX_IMAGE_CHARS = 2_000_000; // ~1.5 MB as a data URL; the app resizes photos before upload

export async function getShopConversation(customerId: string) {
  return getOrCreateOpenConversation(customerId, null, ConversationChannel.CARELINK);
}

export async function addAppMessage(customerId: string, text: string, image?: string | null) {
  const conversation = await getShopConversation(customerId);
  if (image) {
    if (!/^data:image\/(jpeg|png|webp);base64,/.test(image) || image.length > MAX_IMAGE_CHARS) {
      throw new Error("الصورة غير صالحة أو كبيرة جداً.");
    }
    await appendInboundMessage({ conversationId: conversation.id, type: MessageType.IMAGE, content: image });
  }
  if (text.trim()) {
    await appendInboundMessage({ conversationId: conversation.id, type: MessageType.TEXT, content: text.trim() });
  }
  return conversation;
}

/** Runs the AI on the conversation unless a human has taken it over. Never throws. */
export async function wakeAgent(conversationId: string) {
  try {
    const c = await prisma.whatsappConversation.findUnique({ where: { id: conversationId }, select: { assignedAgent: true } });
    if (c?.assignedAgent !== AssignedAgent.AI) return;
    const { runAiTurn } = await import("@/lib/aiOrchestrator");
    await runAiTurn(conversationId);
  } catch (e) {
    console.error(`[shop] AI turn failed (${conversationId})`, e);
  }
}

/** What the customer may see: their own messages and our replies — never internal SYSTEM notes. */
export async function getShopThread(customerId: string) {
  const conversations = await prisma.whatsappConversation.findMany({
    where: { customerId, channel: ConversationChannel.CARELINK },
    select: { id: true },
    orderBy: { createdAt: "desc" },
    take: 3,
  });
  const messages = await prisma.whatsappMessage.findMany({
    where: { conversationId: { in: conversations.map((c: { id: string }) => c.id) }, type: { not: MessageType.SYSTEM } },
    orderBy: { createdAt: "asc" },
    take: 200,
    select: { id: true, direction: true, type: true, content: true, createdAt: true },
  });
  return messages.map((m: { id: string; direction: MessageDirection; type: MessageType; content: string; createdAt: Date }) => ({
    id: m.id,
    fromCustomer: m.direction === MessageDirection.INBOUND,
    text: m.type === MessageType.IMAGE ? "📎 صورة الوصفة" : m.type === MessageType.TEXT ? m.content : "📎 مرفق",
    at: m.createdAt.toISOString(),
  }));
}

/**
 * Plain string-literal mirrors of the WhatsApp-related Prisma enums, matching
 * prisma/schema.prisma's real values exactly (see "WHATSAPP (Phase 4-5)" section).
 * Never import from "@prisma/client" in client-component code — see the API routes'
 * own imports for the server-side source of truth.
 */
export type ConversationStatus = "OPEN" | "TRANSFERRED_TO_PHARMACIST" | "CLOSED";
export type AssignedAgent = "AI" | "HUMAN";
export type ConversationChannel = "DIRECT" | "CARELINK";
export type MessageDirection = "INBOUND" | "OUTBOUND";
export type MessageType = "TEXT" | "IMAGE" | "AUDIO" | "TEMPLATE" | "SYSTEM";

export interface CustomerDto {
  id: string;
  name: string | null;
  phone: string;
}

export interface WhatsappMessageDto {
  id: string;
  conversationId: string;
  direction: MessageDirection;
  type: MessageType;
  content: string;
  waMessageId: string | null;
  createdAt: string;
}

/** Shape returned by GET /api/whatsapp/conversations — `messages` holds at most the one
 * latest message (an inbox preview), not the full thread. */
export interface ConversationSummaryDto {
  id: string;
  customerId: string;
  assignedAgent: AssignedAgent;
  assignedBranchId: string | null;
  status: ConversationStatus;
  channel: ConversationChannel;
  createdAt: string;
  updatedAt: string;
  customer: CustomerDto;
  messages: WhatsappMessageDto[];
}

/** Shape returned by GET /api/whatsapp/conversations/[id] — `messages` holds the full
 * thread, oldest first. */
export interface ConversationDetailDto {
  id: string;
  customerId: string;
  assignedAgent: AssignedAgent;
  assignedBranchId: string | null;
  status: ConversationStatus;
  channel: ConversationChannel;
  createdAt: string;
  updatedAt: string;
  customer: CustomerDto;
  messages: WhatsappMessageDto[];
}

export interface BranchDto {
  id: string;
  name: string;
}

/** The scalar-only shape returned by the four action endpoints (takeover/return-to-ai/
 * transfer-to-pharmacist/close) — their underlying lib/conversations.ts functions update
 * the row with no `include`, so the response has no nested `customer`/`messages`. Callers
 * must merge this into whatever full conversation object they already hold locally. */
export interface ConversationScalarDto {
  id: string;
  customerId: string;
  assignedAgent: AssignedAgent;
  assignedBranchId: string | null;
  status: ConversationStatus;
  channel: ConversationChannel;
  createdAt: string;
  updatedAt: string;
}

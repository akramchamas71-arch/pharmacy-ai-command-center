import { NextRequest, NextResponse, after } from "next/server";
import { verifyWebhookChallenge, verifyWebhookSignature, verifyKapsoSignature, whatsappProvider, WhatsAppConfigError, phoneDigits, phoneKey } from "@/lib/whatsapp";
import { findOrCreateCustomerByPhone } from "@/lib/customers";
import { getOrCreateOpenConversation, appendInboundMessage } from "@/lib/conversations";
import { handleCarelinkBranchReply } from "@/lib/carelink";
import { handleFailedDeliveryNotice, FAILED_STATUS_CODES } from "@/lib/deliveryFallback";
import { handleFailedInquiryMessage } from "@/lib/inquiryFallback";
import { knownDeliveryDigits } from "@/lib/deliveryContacts";
import { logAudit } from "@/lib/audit";
import { handleWhatsAppLoginMessage } from "@/lib/customerAuth";
import { handleSupplierReply } from "@/lib/suppliers";
import { runAiTurn } from "@/lib/aiOrchestrator";
import { AnthropicConfigError } from "@/lib/anthropic";
import { prisma } from "@/lib/prisma";
import { AssignedAgent, ConversationChannel, MessageType } from "@prisma/client";

// Shared by BOTH routes: /api/webhook/whatsapp (the one to give Meta) and the older
// /api/whatsapp/webhook (kept so an existing Kapso webhook keeps working).
// ---- GET: the one-time handshake Meta performs when you save the webhook URL ----
// https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verification-requests
export async function handleWhatsAppGet(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const mode = sp.get("hub.mode");
  const token = sp.get("hub.verify_token");
  const challenge = sp.get("hub.challenge");

  try {
    if (challenge && verifyWebhookChallenge(mode, token)) {
      // Meta expects the raw challenge string back, not JSON.
      return new NextResponse(challenge, { status: 200 });
    }
  } catch (e) {
    if (e instanceof WhatsAppConfigError) {
      console.error("[whatsapp webhook] " + e.message);
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
    throw e;
  }

  return NextResponse.json({ error: "Verification failed" }, { status: 403 });
}

// A WhatsApp inbound message type we don't have a dedicated MessageType for (location,
// contacts, interactive button replies, reactions, …) is stored as SYSTEM with a note of
// the real type, rather than dropped — nothing Meta sends is silently discarded.
function mapWaMessageType(waType: string): MessageType {
  switch (waType) {
    case "text":
      return MessageType.TEXT;
    case "image":
      return MessageType.IMAGE;
    case "audio":
    case "voice":
      return MessageType.AUDIO;
    default:
      return MessageType.SYSTEM;
  }
}

// Best-effort extraction of a human-readable body for every WhatsApp message type Meta can
// send — only "text" has a real body today; everything else is stored as a readable
// placeholder so the conversation thread never has a blank bubble. Media binaries
// themselves (Meta gives a short-lived media `id`, not the file) are Phase 8 (Document AI)
// territory, not Phase 4's.
function extractContent(message: Record<string, unknown>): string {
  const type = message.type as string;
  if (type === "text") return (message.text as { body?: string } | undefined)?.body ?? "";
  if (type === "image") {
    const caption = (message.image as { caption?: string } | undefined)?.caption;
    return caption ? `[صورة] ${caption}` : "[صورة]";
  }
  if (type === "audio" || type === "voice") return "[رسالة صوتية]";
  if (type === "document") return "[ملف]";
  if (type === "location") return "[موقع]";
  if (type === "button") return (message.button as { text?: string } | undefined)?.text ?? "[رد على زر]";
  if (type === "interactive") return "[رد تفاعلي]";
  return `[رسالة من نوع غير مدعوم: ${type}]`;
}

interface WaValue {
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  contacts?: { wa_id?: string; profile?: { name?: string } }[];
  messages?: Record<string, unknown>[];
  statuses?: Record<string, unknown>[];
}

// ---- Kapso adapter ----
// Kapso's `whatsapp.message.received` payload (https://docs.kapso.ai/docs/platform/webhooks/message-events):
// { message: { id, type, from, text:{body}, ... }, conversation: { contact_name, phone_number, phone_number_id },
//   phone_number_id, whatsapp_config?: {...} }. `message` keeps Meta's own shape (type/text/image/...),
// so extractContent() keeps working as-is. The receiving number's display digits are optional there, so
// they fall back to KAPSO_DISPLAY_PHONE_NUMBER (the number customers actually message) when absent.
interface KapsoMessageEvent {
  message?: Record<string, unknown>;
  conversation?: { contact_name?: string; phone_number?: string; phone_number_id?: string };
  phone_number_id?: string;
  whatsapp_config?: { display_phone_number?: string; phone_number?: string; phone_number_id?: string };
}

function kapsoEventToWaValue(ev: KapsoMessageEvent): WaValue | null {
  const msg = ev.message;
  if (!msg || !msg.from) return null;
  const direction = (msg.kapso as { direction?: string } | undefined)?.direction;
  if (direction && direction !== "inbound") return null; // never treat our own outbound as a customer message
  const from = String(msg.from).replace(/\D/g, "");
  // KAPSO_ACT_AS_CARELINK=true: the Kapso number temporarily stands in for CareLink's real number
  // (+96179003663) until that number is approved at Meta — so every message arriving on it is routed
  // down the existing CareLink path. Outbound replies then need WHATSAPP_CARELINK_PHONE_NUMBER_ID set
  // to the SAME Kapso phone number id as WHATSAPP_PHONE_NUMBER_ID (see DEPLOY.md).
  const display =
    process.env.KAPSO_ACT_AS_CARELINK === "true"
      ? process.env.CARELINK_CONTACT_WHATSAPP ?? ""
      : ev.whatsapp_config?.display_phone_number ??
        ev.whatsapp_config?.phone_number ??
        process.env.KAPSO_DISPLAY_PHONE_NUMBER ??
        "";
  return {
    metadata: {
      display_phone_number: display,
      phone_number_id: ev.phone_number_id ?? ev.conversation?.phone_number_id ?? ev.whatsapp_config?.phone_number_id,
    },
    contacts: [{ wa_id: from, profile: { name: ev.conversation?.contact_name } }],
    messages: [{ ...msg, from }],
  };
}

// Message ids being processed right now (see the duplicate protection in processValues()).
const inflightMessageIds = new Set<string>();

async function processValues(values: WaValue[]) {
  for (const value of values) {
    // Delivery/read receipts for messages WE sent — not stored yet (no status column on
    // WhatsappMessage today); logged so nothing is silently lost, picked up for real once
    // a reporting need asks for it.
    if (value.statuses?.length) {
      console.log(`[whatsapp webhook] ${value.statuses.length} status update(s) — not yet persisted`);
      // A message we sent was accepted but then FAILED to deliver (e.g. outside the 24h window): if it was a
      // CareLink delivery notice, hand the details to the pharmacy instead of leaving the order silent.
      for (const st of value.statuses) {
        try {
          if (st.status !== "failed" || typeof st.id !== "string") continue;
          const errs = Array.isArray(st.errors) ? (st.errors as { code?: number; title?: string }[]) : [];
          const code = Number(errs[0]?.code);
          // Every undelivered message is now recorded (audit + log) — before, failures were invisible.
          console.error(`[whatsapp webhook] رسالة لم تُسلَّم إلى ${st.recipient_id ?? "?"}: ${code} ${errs[0]?.title ?? ""}`);
          await logAudit({
            userId: null,
            action: "whatsapp.delivery_failed",
            entity: `WhatsappMessage:${st.id}`,
            newValue: { waMessageId: st.id, recipient: st.recipient_id ?? null, errorCode: code, errorTitle: errs[0]?.title ?? null },
          }).catch(() => undefined);
          // A reservation request to a pharmacy / supplier: resend as the approved template, or tell the customer.
          if (await handleFailedInquiryMessage(st.id, code, errs[0]?.title)) continue;
          if (!FAILED_STATUS_CODES.includes(code)) continue;
          await handleFailedDeliveryNotice(st.id, code, errs[0]?.title);
        } catch (e) {
          console.error("[whatsapp webhook] delivery-failure fallback error", e);
        }
      }
    }

    if (!value.messages?.length) continue;

    // Digit-only comparison throughout (phoneDigits) — see that function's own comment: Meta's
    // `display_phone_number`/`from` values and this app's stored `+961...` numbers don't share
    // one literal format, so a bare `===`/Prisma `findUnique` can silently never match. Branches
    // are small in number, so loading them all and comparing in JS (once per batch) is simpler
    // and more robust here than trying to normalize at the database/query level.
    const receivingDigits = phoneDigits(value.metadata?.display_phone_number);
    // CareLink channel = the message arrived on CareLink's number: matched by its display number,
    // or (Meta direct) by its phone-number-id when WHATSAPP_CARELINK_PHONE_NUMBER_ID is set.
    // Single-number setup (Meta direct): CareLink's number is the only registered one, so when
    // WHATSAPP_CARELINK_PHONE_NUMBER_ID is not set, the default number id is CareLink's.
    const carelinkPhoneId =
      process.env.WHATSAPP_CARELINK_PHONE_NUMBER_ID ||
      (whatsappProvider() === "meta" ? process.env.WHATSAPP_PHONE_NUMBER_ID : undefined);
    const isCareLinkChannel =
      (Boolean(receivingDigits) && receivingDigits === phoneDigits(process.env.CARELINK_CONTACT_WHATSAPP)) ||
      (Boolean(carelinkPhoneId) && value.metadata?.phone_number_id === carelinkPhoneId);

    const allBranches = receivingDigits
      ? await prisma.branch.findMany({
          select: { id: true, whatsappNumber: true, specialDeliveryContactWhatsapp: true },
        })
      : [];
    // Numbers of delivery people / companies: their replies ("تم الاستلام") are staff chatter, not
    // customers — stored for the team to read, but the AI must never answer them as a customer.
    const deliveryDigits = new Set<string>(
      [
        ...allBranches.map((b: { specialDeliveryContactWhatsapp: string | null }) => phoneKey(b.specialDeliveryContactWhatsapp)),
        ...knownDeliveryDigits().map((n: string) => phoneKey(n)),
        // our own pharmacies' numbers: staff writing to the CareLink line are not customers either
        ...allBranches.map((b: { whatsappNumber: string | null }) => phoneKey(b.whatsappNumber)),
      ].filter(Boolean)
    );
    const receivingBranch = !isCareLinkChannel
      ? allBranches.find((b: { whatsappNumber: string | null }) => phoneDigits(b.whatsappNumber) === receivingDigits) ?? null
      : null;

    // Registered partner suppliers (e.g. شركة لطافة) — a message whose SENDER is one of their
    // numbers is their answer to a SupplierInquiry, whichever of our numbers it arrived on.
    const allSuppliers: { id: string; whatsappNumber: string; deliveryContactWhatsapp: string | null }[] = await prisma.supplier.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, whatsappNumber: true, deliveryContactWhatsapp: true },
    }).catch(() => []); // never break webhook delivery if the suppliers table isn't set up yet
    for (const x of allSuppliers) {
      const d = phoneKey(x.deliveryContactWhatsapp);
      if (d) deliveryDigits.add(d);
    }

    for (const message of value.messages) {
      // Duplicate protection: Meta re-delivers a message when it doesn't get a fast 200, and can
      // deliver the same one twice concurrently. Skip a message id already stored (DB) or currently
      // being processed (in-memory) — otherwise the AI would answer the same message twice.
      const waId = typeof message.id === "string" ? message.id : undefined;
      if (waId) {
        if (inflightMessageIds.has(waId)) {
          console.log(`[whatsapp webhook] duplicate (in progress) ${waId} ignored`);
          continue;
        }
        inflightMessageIds.add(waId);
        const already = await prisma.whatsappMessage
          .findUnique({ where: { waMessageId: waId }, select: { id: true } })
          .catch(() => null);
        if (already) {
          inflightMessageIds.delete(waId);
          console.log(`[whatsapp webhook] duplicate ${waId} ignored`);
          continue;
        }
      }
      // One bad message in a batch must never fail the whole webhook delivery — Meta
      // retries (and eventually disables) a webhook that doesn't answer 200 quickly, so
      // every entry is isolated in its own try/catch.
      try {
        // CareLink-channel only: a message whose SENDER is one of our own branches' WhatsApp
        // numbers is that branch replying to a CarelinkInquiry (src/lib/aiTools.ts's
        // request_branch_reservation), not a customer writing in — see CarelinkInquiry's
        // schema comment for the full flow. Routed entirely differently: no Customer, no new
        // conversation, just matching this reply back to the pending inquiry and resuming the
        // CareLink conversation that's waiting on it.
        // `allBranches` is already loaded whenever isCareLinkChannel is true (receivingDigits
        // is non-empty in that case — it matched CARELINK_CONTACT_WHATSAPP), so no extra query
        // is needed here.
        const fromDigits = phoneKey(message.from as string);

        const replyingSupplier = allSuppliers.find((x) => phoneKey(x.whatsappNumber) === fromDigits) ?? null;
        if (replyingSupplier) {
          await handleSupplierReply({
            supplierId: replyingSupplier.id,
            content: extractContent(message),
            waMessageId: message.id as string | undefined,
          });
          continue;
        }

        const replyingBranch = isCareLinkChannel
          ? allBranches.find((b: { whatsappNumber: string | null }) => phoneKey(b.whatsappNumber) === fromDigits) ?? null
          : null;

        if (replyingBranch) {
          const matched = await handleCarelinkBranchReply({
            branchId: replyingBranch.id,
            content: extractContent(message),
            waMessageId: message.id as string | undefined,
          });
          if (matched) continue;
          // No pending ask for this pharmacy (e.g. a "test" message): fall through and store it in the
          // inbox like any chat, but never let the AI answer a pharmacy as if it were a customer.
        }

        const fromPhone = `+${message.from as string}`;
        const contact = value.contacts?.find((c) => c.wa_id === (message.from as string));

        // CareLink app login: the customer sent the ready-made "CL-XXXXXX" message from the app.
        if (isCareLinkChannel && (await handleWhatsAppLoginMessage(fromPhone, extractContent(message)))) continue;

        const customer = await findOrCreateCustomerByPhone({
          phone: fromPhone,
          name: contact?.profile?.name ?? null,
        });

        const conversation = await getOrCreateOpenConversation(
          customer.id,
          receivingBranch?.id ?? null,
          isCareLinkChannel ? ConversationChannel.CARELINK : ConversationChannel.DIRECT
        );

        await appendInboundMessage({
          conversationId: conversation.id,
          type: mapWaMessageType(message.type as string),
          content: extractContent(message),
          waMessageId: message.id as string | undefined,
        });

        // Phase 5 (preparatory): best-effort only — never lets an AI failure break webhook
        // message persistence or Meta's required fast-200 ack. Runs synchronously inside the
        // request for now (no background queue yet — that's Phase 10's job, same documented
        // gap as releaseExpiredReservations()); with no ANTHROPIC_API_KEY set this just logs
        // a warning and returns immediately.
        if (conversation.assignedAgent === AssignedAgent.AI && !deliveryDigits.has(fromDigits)) {
          try {
            await runAiTurn(conversation.id);
          } catch (aiErr) {
            if (aiErr instanceof AnthropicConfigError) {
              console.warn(`[whatsapp webhook] ${aiErr.message}`);
            } else {
              console.error("[whatsapp webhook] AI turn failed", aiErr);
              await logAudit({
                userId: null,
                action: "ai.turn",
                entity: `WhatsappConversation:${conversation.id}`,
                newValue: { outcome: "exception", extra: (aiErr instanceof Error ? aiErr.message : String(aiErr)).slice(0, 300) },
              }).catch(() => undefined);
            }
          }
        }
      } catch (err) {
        console.error("[whatsapp webhook] failed to process one message", err);
      } finally {
        if (waId) inflightMessageIds.delete(waId);
      }
    }
  }

}

// ---- POST: the actual event delivery (inbound messages + delivery/read status receipts) ----
// Meta needs a fast 200: the signature is verified first (on the RAW body), then the 200 goes out
// immediately and the real work (customer, conversation, AI turn, CareLink/supplier routing) runs
// after the response via next/server's after().
export async function handleWhatsAppPost(req: NextRequest) {
  // MUST verify against the raw bytes sent — read as text, never req.json(), and never
  // re-serialize before hashing (see verifyWebhookSignature's own comment for why).
  const rawBody = await req.text();

  // WHATSAPP_PROVIDER=meta (default): only Meta's own signed deliveries are accepted
  // (X-Hub-Signature-256 with WHATSAPP_APP_SECRET). WHATSAPP_PROVIDER=kapso: Kapso deliveries
  // (X-Webhook-Signature) are also accepted and normalized into the same shape below.
  const kapsoSignature = whatsappProvider() === "kapso" ? req.headers.get("x-webhook-signature") : null;
  let values: WaValue[];

  try {
    if (kapsoSignature) {
      if (!verifyKapsoSignature(rawBody, kapsoSignature)) {
        return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
      }
      // Only inbound messages matter here; delivered/read/failed/conversation events are acknowledged.
      const eventName = req.headers.get("x-webhook-event") ?? "";
      if (eventName && eventName !== "whatsapp.message.received") {
        return NextResponse.json({ received: true, ignored: eventName });
      }
      const kapsoPayload = JSON.parse(rawBody) as Record<string, unknown>;
      const items: KapsoMessageEvent[] = Array.isArray(kapsoPayload.data)
        ? (kapsoPayload.data as KapsoMessageEvent[]) // buffered/batched delivery
        : [kapsoPayload as unknown as KapsoMessageEvent];
      values = items.map(kapsoEventToWaValue).filter((v): v is WaValue => v !== null);
    } else {
      if (!verifyWebhookSignature(rawBody, req.headers.get("x-hub-signature-256"))) {
        return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
      }
      const payload = JSON.parse(rawBody) as { entry?: { changes?: { value?: WaValue }[] }[] };
      values = (payload.entry ?? []).flatMap((entry) =>
        (entry.changes ?? []).map((change) => change.value).filter((v): v is WaValue => Boolean(v))
      );
    }
  } catch (e) {
    if (e instanceof WhatsAppConfigError) {
      console.error("[whatsapp webhook] " + e.message);
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
    if (e instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    throw e;
  }

  after(async () => {
    try {
      await processValues(values);
    } catch (err) {
      console.error("[whatsapp webhook] background processing failed", err);
    }
  });

  return NextResponse.json({ received: true });
}

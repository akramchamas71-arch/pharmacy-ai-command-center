import crypto from "crypto";
import { prisma } from "@/lib/prisma";

/**
 * Thin client over the real WhatsApp Business Cloud API (Meta's Graph API) — per the plan
 * doc's hard rule, this is the actual documented integration, not an invented stand-in.
 * Everything here needs four env vars (see .env.example): WHATSAPP_ACCESS_TOKEN,
 * WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_APP_SECRET, WHATSAPP_WEBHOOK_VERIFY_TOKEN. None of
 * them are required to build or boot the rest of the app — only to actually call Meta or
 * verify its webhook — so missing config fails loudly at CALL time (see
 * `requireWhatsAppConfig()`), not at import time like `JWT_SECRET` in auth.ts; most of the
 * app (Phases 1-3) has nothing to do with WhatsApp and must keep working without it.
 *
 * You do NOT need your own business-verified number to exercise this end to end: every
 * Meta app comes with a free TEST number (Meta for Developers → your app → WhatsApp → API
 * Setup) with a temporary access token and up to 5 verified recipient numbers — enough to
 * test the whole webhook + send flow before the "which number do we dedicate" decision is
 * even made. See the README's Phase 4 section for the exact setup steps.
 */

const GRAPH_API_VERSION = process.env.WHATSAPP_API_VERSION || "v21.0";

export class WhatsAppConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WhatsAppConfigError";
  }
}

// `fromPhoneNumberId` lets a caller send from a DIFFERENT registered Meta phone number than
// the default WHATSAPP_PHONE_NUMBER_ID — added this session for CareLink (Phase 7): CareLink
// has its own WhatsApp Business number (see .env.example's WHATSAPP_CARELINK_PHONE_NUMBER_ID),
// and a reply to a CareLink customer must go out from THAT identity, not the pharmacy's
// default one. Omitted (the normal case for every Phase 1-6 caller), this falls back to
// WHATSAPP_PHONE_NUMBER_ID exactly as before — no behavior change for existing callers.
/**
 * WHATSAPP_PROVIDER picks how messages are sent and which webhook deliveries are accepted:
 *  - "meta" (the default): straight to Meta's WhatsApp Cloud API with WHATSAPP_TOKEN.
 *  - "kapso": through Kapso's Meta proxy with KAPSO_API_KEY (the earlier setup — kept intact).
 */
export function whatsappProvider(): "meta" | "kapso" {
  return (process.env.WHATSAPP_PROVIDER ?? "").trim().toLowerCase() === "kapso" ? "kapso" : "meta";
}

/** A rejection from the Graph API, keeping Meta's numeric error code (e.g. 131047 = outside the 24h window). */
export class WhatsAppApiError extends Error {
  status: number;
  code?: number;
  subcode?: number;
  constructor(message: string, status: number, code?: number, subcode?: number) {
    super(message);
    this.name = "WhatsAppApiError";
    this.status = status;
    this.code = code;
    this.subcode = subcode;
  }
}

function requireWhatsAppConfig(fromPhoneNumberId?: string) {
  const provider = whatsappProvider();
  const phoneNumberId = fromPhoneNumberId ?? process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (provider === "kapso") {
    const kapsoKey = process.env.KAPSO_API_KEY;
    if (!kapsoKey || !phoneNumberId) {
      throw new WhatsAppConfigError(
        "WHATSAPP_PROVIDER=kapso يحتاج KAPSO_API_KEY و WHATSAPP_PHONE_NUMBER_ID — راجع قسم WhatsApp في DEPLOY.md."
      );
    }
    return { kapsoKey, accessToken: undefined, phoneNumberId };
  }
  // Meta direct. WHATSAPP_ACCESS_TOKEN is the older name for the same token.
  const accessToken = process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN;
  if (!accessToken || !phoneNumberId) {
    throw new WhatsAppConfigError(
      "WHATSAPP_TOKEN و WHATSAPP_PHONE_NUMBER_ID غير معرّفين — راجع قسم WhatsApp في DEPLOY.md."
    );
  }
  return { kapsoKey: undefined, accessToken, phoneNumberId };
}

/**
 * Two interchangeable ways to reach the SAME Cloud API, chosen by WHATSAPP_PROVIDER:
 *  - kapso -> via Kapso's Meta proxy (https://app.kapso.ai/api/meta/<ver>/<phone_number_id>/messages,
 *    header X-API-Key). Kapso is an official Meta Business Partner, so no own Meta number/verification
 *    is needed. Request bodies are exactly Meta's — nothing else in this app changes.
 *  - meta (default) -> straight to graph.facebook.com with Bearer WHATSAPP_TOKEN.
 */
async function callGraphApi(body: Record<string, unknown>, fromPhoneNumberId?: string) {
  const { kapsoKey, accessToken, phoneNumberId } = requireWhatsAppConfig(fromPhoneNumberId);

  const url = kapsoKey
    ? `https://app.kapso.ai/api/meta/${GRAPH_API_VERSION}/${phoneNumberId}/messages`
    : `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (kapsoKey) headers["X-API-Key"] = kapsoKey;
  else headers["Authorization"] = `Bearer ${accessToken}`;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // Meta's error payload shape: { error: { message, type, code, error_subcode, fbtrace_id } }
    const message = data?.error?.message || `HTTP ${res.status}`;
    throw new WhatsAppApiError(`فشل إرسال رسالة واتساب: ${message}`, res.status, data?.error?.code, data?.error?.error_subcode);
  }

  // Success shape: { messaging_product, contacts: [...], messages: [{ id: "wamid...." }] }
  const waMessageId: string | undefined = data?.messages?.[0]?.id;
  return { waMessageId, raw: data };
}

/**
 * A free-form text message. Only deliverable inside the 24-hour "customer service window"
 * that opens when the customer last messaged — outside it, Meta rejects this and a template
 * message (sendTemplateMessage) is required instead. The caller (src/lib/conversations.ts)
 * doesn't guess which applies; it just calls this and surfaces Meta's error if it's rejected.
 */
export async function sendTextMessage(to: string, body: string, opts?: { fromPhoneNumberId?: string }) {
  return callGraphApi({ to, type: "text", text: { body, preview_url: false } }, opts?.fromPhoneNumberId);
}

/**
 * A pre-approved template message — the only way to message a customer outside the
 * 24-hour window (e.g. "your order is ready"), and Meta requires every template to be
 * submitted and approved in Meta Business Manager before it can be sent. `components`
 * follows Meta's template-parameter shape; pass [] for a template with no variables.
 */
export async function sendTemplateMessage(
  to: string,
  templateName: string,
  languageCode: string,
  components: unknown[] = [],
  opts?: { fromPhoneNumberId?: string }
) {
  return callGraphApi(
    {
      to,
      type: "template",
      template: { name: templateName, language: { code: languageCode }, components },
    },
    opts?.fromPhoneNumberId
  );
}

// ---------------------------------------------------------------------------
// Business-initiated messages (CareLink flow): pharmacy / delivery / supplier.
// ---------------------------------------------------------------------------
// WhatsApp only allows a free-text message to someone who wrote to us in the last 24 hours.
// A pharmacy or delivery contact that has not messaged the CareLink number recently can only
// receive an APPROVED TEMPLATE (paid per conversation by Meta). sendBusinessMessage() tries the
// free text first (free inside the window) and, when Meta says the window is closed (error
// 131047), falls back to the template. The two templates below must be created and approved in
// WhatsApp Manager (texts in DEPLOY.md / the CareLink setup guide); names can be overridden by env.

export const WHATSAPP_TEMPLATES = {
  /** 3 variables: {{1}} reference code, {{2}} product, {{3}} quantity. */
  reservation: () => process.env.WHATSAPP_TPL_RESERVATION || "carelink_reservation_request",
  /** 4 variables: {{1}} order/reference, {{2}} pick up from, {{3}} deliver to, {{4}} customer. */
  delivery: () => process.env.WHATSAPP_TPL_DELIVERY || "carelink_delivery_request",
};

export interface BusinessTemplate {
  name: string;
  params: string[];
  language?: string;
}

export function isOutsideServiceWindowError(e: unknown): boolean {
  if (e instanceof WhatsAppApiError && e.code === 131047) return true;
  return e instanceof Error && /re-?engagement|24.?hour/i.test(e.message);
}

// Meta rejects template variables that are empty, contain new lines / tabs, or 4+ spaces in a row.
function cleanTemplateParam(value: string): string {
  const v = String(value ?? "").replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim();
  return (v || "-").slice(0, 900);
}

/**
 * Did this number write to us in the last ~23h? Meta ACCEPTS a free-text message outside the 24h window
 * (HTTP 200 + message id) and only reports the failure later in a status webhook — so we cannot rely on
 * a synchronous 131047 to switch to the template. Inbound messages from pharmacies / suppliers are stored
 * like any customer's (Customer.phone = their number), so the last INBOUND message tells us.
 * Any lookup error counts as "closed" (the template is the safe choice).
 */
export async function hasOpenServiceWindow(to: string): Promise<boolean> {
  const key = phoneKey(to);
  if (!key) return false;
  try {
    const recent = await prisma.whatsappMessage.findFirst({
      where: {
        direction: "INBOUND",
        type: { not: "SYSTEM" },
        waMessageId: { not: null }, // a real WhatsApp message (app messages have none)
        createdAt: { gt: new Date(Date.now() - 23 * 3600 * 1000) },
        conversation: { customer: { phone: { endsWith: key } } },
      },
      select: { id: true },
    });
    return !!recent;
  } catch (e) {
    console.warn("[whatsapp] could not check the 24h window — using the template", e);
    return false;
  }
}

/** Sends the approved template (no free-text attempt). Throws a clear Arabic error if Meta rejects it. */
export async function sendBusinessTemplate(
  to: string,
  t: BusinessTemplate,
  opts?: { fromPhoneNumberId?: string }
): Promise<{ waMessageId?: string; raw: unknown; via: "template" }> {
  try {
    const sent = await sendTemplateMessage(
      to,
      t.name,
      t.language || process.env.WHATSAPP_TEMPLATE_LANG || "ar",
      [{ type: "body", parameters: t.params.map((p) => ({ type: "text", text: cleanTemplateParam(p) })) }],
      { fromPhoneNumberId: opts?.fromPhoneNumberId }
    );
    return { ...sent, via: "template" };
  } catch (te) {
    const reason = te instanceof Error ? te.message : "خطأ غير معروف";
    throw new Error(
      `الرقم لم يراسلنا خلال 24 ساعة، وقالب واتساب "${t.name}" غير جاهز للإرسال (${reason}). يلزم إنشاء القالب واعتماده من ميتا وإضافة وسيلة دفع لحساب واتساب.`
    );
  }
}

/**
 * Business-initiated message to a pharmacy / supplier / delivery contact.
 *  - Inside the 24h window (they wrote to us recently): free text (free of charge, richer wording).
 *  - Outside it, when a template is given: the approved template straight away — a free text would be
 *    accepted by Meta and then silently dropped (this is what lost reservation requests on 18 Nov 2026).
 *  - The old synchronous 131047 fallback is kept for the rare case Meta does reject immediately.
 */
export async function sendBusinessMessage(
  to: string,
  text: string,
  opts?: { fromPhoneNumberId?: string; template?: BusinessTemplate }
): Promise<{ waMessageId?: string; raw: unknown; via: "text" | "template" }> {
  if (opts?.template && !(await hasOpenServiceWindow(to))) {
    return sendBusinessTemplate(to, opts.template, { fromPhoneNumberId: opts.fromPhoneNumberId });
  }
  try {
    const sent = await sendTextMessage(to, text, { fromPhoneNumberId: opts?.fromPhoneNumberId });
    return { ...sent, via: "text" };
  } catch (e) {
    if (!opts?.template || !isOutsideServiceWindowError(e)) throw e;
    return sendBusinessTemplate(to, opts.template, { fromPhoneNumberId: opts.fromPhoneNumberId });
  }
}

/**
 * Digits-only comparison key for a phone number — strips everything but 0-9 so "+961 79
 * 003663", "96179003663", and "+96179003663" all compare equal. Added this session: the
 * webhook's branch lookup by `display_phone_number` was comparing Meta's raw value against
 * `Branch.whatsappNumber` with a bare `===`/Prisma `findUnique`, which silently never matches
 * if Meta sends the number without a "+" while our rows store it with one (a real, previously
 * undetected gap — Meta's documented behavior for `metadata.display_phone_number` is digits
 * only, no "+"). Fixed here rather than left in place, because the new CareLink-channel
 * detection in the webhook depends on this same comparison working correctly — see that
 * file's comment.
 */
export function phoneDigits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

/**
 * Format-tolerant key for comparing Lebanese phone numbers: "+961 76 725839", "0096176725839",
 * "76725839" and "076 725 839" all give "76725839". Used to recognise a pharmacy / delivery / supplier
 * number whichever way it was typed into the dashboard (a branch saved without the country code used
 * to be mistaken for a customer, so its replies never reached the pending CareLink inquiry).
 */
export function phoneKey(value: string | null | undefined): string {
  let d = phoneDigits(value);
  if (!d) return "";
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("961") && d.length > 9) d = d.slice(3);
  if (d.startsWith("0")) d = d.replace(/^0+/, "");
  return d;
}

/**
 * Verifies Meta's `X-Hub-Signature-256` header against the RAW request body — must be the
 * untouched bytes/text Meta sent, never a re-serialized `JSON.stringify(parsedBody)`, since
 * that can differ byte-for-byte from what was signed and would make every signature "fail."
 * `crypto.timingSafeEqual` avoids a timing side-channel on the comparison.
 */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) {
    throw new WhatsAppConfigError("WHATSAPP_APP_SECRET غير معرّف في .env — لا يمكن التحقق من صحة الطلبات الواردة من Meta.");
  }
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;

  const expected = crypto.createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const provided = signatureHeader.slice("sha256=".length);

  // Lengths must match before timingSafeEqual (it throws on mismatched buffer lengths).
  if (expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(provided, "hex"));
}

/** The GET webhook handshake Meta performs once when you save the webhook URL. */
export function verifyWebhookChallenge(mode: string | null, token: string | null): boolean {
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (!verifyToken) {
    throw new WhatsAppConfigError("WHATSAPP_VERIFY_TOKEN غير معرّف في .env.");
  }
  if (mode !== "subscribe" || !token) return false;
  const a = Buffer.from(token, "utf8");
  const b = Buffer.from(verifyToken, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Verifies Kapso's `X-Webhook-Signature` header: HMAC-SHA256 of the RAW body with the webhook's
 * secret (KAPSO_WEBHOOK_SECRET — shown in Kapso dashboard → the webhook), lowercase hex, no prefix.
 */
export function verifyKapsoSignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.KAPSO_WEBHOOK_SECRET;
  if (!secret) {
    throw new WhatsAppConfigError("KAPSO_WEBHOOK_SECRET غير معرّف في .env — لا يمكن التحقق من صحة الطلبات الواردة من Kapso.");
  }
  if (!signatureHeader) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const provided = signatureHeader.trim().toLowerCase();
  if (expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(provided, "utf8"));
}

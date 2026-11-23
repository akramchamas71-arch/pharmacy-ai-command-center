import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { PERMISSIONS, PermissionKey, hasPermission } from "@/lib/rbac";
import { getAiSystemUser } from "@/lib/aiSystem";
import { BusinessRuleError, NotFoundError } from "@/lib/errors";
import { searchProducts } from "@/lib/products";
import { listBranches } from "@/lib/branches";
import { createOrder, createCarelinkBrokerOrder } from "@/lib/orders";
import { searchCustomers } from "@/lib/customers";
import { sendReply } from "@/lib/conversations";
import { createDelivery } from "@/lib/delivery";
import { listDrivers } from "@/lib/drivers";
import { searchDocuments } from "@/lib/documents";
import { CarelinkInquiryStatus, ConversationChannel, DriverAvailability, OrderSource } from "@prisma/client";
import { sendTextMessage, sendBusinessMessage, WHATSAPP_TEMPLATES } from "@/lib/whatsapp";
import { resolveBranchDeliveryContact } from "@/lib/deliveryContacts";
import { logAudit } from "@/lib/audit";
import { isLikelyBekaaAddress } from "@/lib/region";

/**
 * The plan doc's "قواعد الذكاء الاصطناعي (ثابتة لا تتغيّر)": the LLM never touches the
 * database directly — only these 11 named Tools (9 through Phase 6, plus
 * request_branch_reservation/notify_carelink_delivery added this session for the real CareLink
 * order-broker flow — see CarelinkInquiry's comment in schema.prisma), called exclusively by
 * src/lib/aiOrchestrator.ts. Every one of them starts with requireAiPermission(), which is
 * this file's whole enforcement mechanism for the plan doc's two hard rules:
 *   1. "كل Tool يتحقق قبل التنفيذ من: authentication، permissions، input validation،
 *      business rules" — the AI's identity (src/lib/aiSystem.ts) and its real permission
 *      row (prisma/seed.ts's AI_AGENT grant) are checked here, every call, never assumed.
 *   2. The Human Approval list (price changes, manual inventory edits, deleting files,
 *      cancelling a confirmed order, prescription dispensing, any CareLink ADMIN op — i.e.
 *      create_carelink_job/CarelinkJob, not the order-broker Tools above, see those Tools'
 *      own comments for why they're different) is enforced by AI_AGENT simply not holding
 *      those permissions — create_carelink_job below
 *      is blocked this way, not by a special-cased check that could be forgotten elsewhere.
 * The medication-safety rule ("ممنوع التشخيص أو إنشاء وصفة طبية أو تغيير جرعات... TRANSFER TO
 * PHARMACIST فوراً") is NOT a Tool here — it's a system-prompt instruction to the model itself
 * (src/lib/aiOrchestrator.ts), enforced the same way src/lib/conversations.ts's
 * transferToPharmacist() already exists for the human inbox (Phase 4).
 */

async function requireAiPermission(permission: PermissionKey) {
  const aiUser = await getAiSystemUser();
  const allowed = await hasPermission(aiUser.roleId, permission);
  if (!allowed) {
    throw new BusinessRuleError(
      `هذا الإجراء يتطلب صلاحية (${permission}) لا يملكها الذكاء الاصطناعي عمداً — يتطلب موافقة بشرية حسب "قواعد الذكاء الاصطناعي" في خطة المشروع.`
    );
  }
  return aiUser;
}

/**
 * Per-call context aiOrchestrator.ts supplies alongside the model's own tool-call input.
 * Deliberately separate from `input`: `input`'s fields are whatever the model decided to type
 * into the tool call, but which conversation/customer this call is happening for is something
 * the orchestrator already knows for certain (it loaded the conversation to build the prompt in
 * the first place) — so the Bekaa-routing rule below is enforced from this trusted value, never
 * from a `customerPhone`-shaped field the model could get wrong or omit. Same trust posture now
 * also backs getConversationChannel() (create_order's CARELINK-source detection) and
 * request_branch_reservation's CarelinkInquiry linkage — all three read the real conversation
 * row instead of trusting anything the model self-reports.
 */
export interface AiToolContext {
  conversationId?: string;
}

/**
 * The Bekaa/Baalbek-Hermel → "الجواد كير + العاصي فقط" rule the user gave this session. Looks up
 * the calling conversation's real Customer.address (never trusts the model to say "this customer
 * is in Bekaa") and runs it through region.ts's real-place-name match. Returns `null` when there
 * is no restriction (no conversation context, no address, or the address doesn't match) — the
 * normal, unrestricted branch pool — and the real isBekaaExclusive branch id list otherwise.
 *
 * NOT yet linked to a dedicated delivery flow for these two branches — the user said their
 * special delivery arrangement's contact number is still coming ("وازودك برقمهما قريبا"), and
 * explicitly asked to start with the search/routing logic now and link delivery later. So this
 * only narrows WHICH branch(es) can fulfill the order; create_delivery/drivers are unchanged.
 */
/**
 * Region routing (user rule, 20 Nov 2026): a customer in البقاع is served ONLY by الجواد كير / العاصي
 * (isBekaaExclusive), every other customer ONLY by the Beirut branches (isBekaaExclusive=false).
 * Region comes from the area the customer states in this conversation (customerArea, passed by the
 * model) or else the saved Customer.address. The stated area is saved as the address when none exists.
 * Returns known=false when neither is available — assign_pharmacy then refuses on CareLink until the
 * model asks the customer for their area.
 */
async function resolveRegionBranches(
  context: AiToolContext | undefined,
  customerArea?: string
): Promise<{ known: false } | { known: true; bekaa: boolean; ids: Set<string> }> {
  let address: string | null = null;
  let customerId: string | null = null;
  if (context?.conversationId) {
    const conv = await prisma.whatsappConversation.findUnique({
      where: { id: context.conversationId },
      include: { customer: true },
    });
    address = conv?.customer.address ?? null;
    customerId = conv?.customer.id ?? null;
  }
  const area = (customerArea ?? "").trim();
  if (area && customerId && !address) {
    await prisma.customer.update({ where: { id: customerId }, data: { address: area } }).catch(() => undefined);
  }
  const text = area || address || "";
  if (!text) return { known: false };
  const bekaa = isLikelyBekaaAddress(text);
  const rows = await prisma.branch.findMany({
    where: { status: "ACTIVE", isBekaaExclusive: bekaa },
    select: { id: true },
  });
  return { known: true, bekaa, ids: new Set(rows.map((b: { id: string }) => b.id)) };
}

export async function getBekaaBranchRestriction(context: AiToolContext | undefined): Promise<Set<string> | null> {
  if (!context?.conversationId) return null;

  const conversation = await prisma.whatsappConversation.findUnique({
    where: { id: context.conversationId },
    include: { customer: true },
  });
  if (!conversation || !isLikelyBekaaAddress(conversation.customer.address)) return null;

  const bekaaBranches = await prisma.branch.findMany({
    where: { isBekaaExclusive: true, status: "ACTIVE" },
    select: { id: true },
  });
  // Deliberately NOT falling back to "no restriction" if this is empty (e.g. before the real
  // branch data below has been loaded into a given database) — an empty real result here means
  // "no branch is marked for this yet", which should surface as "no branch can serve this right
  // now" (assign_pharmacy/search_inventory's existing, honest empty-result semantics), not
  // silently widen back out to every branch.
  return new Set(bekaaBranches.map((b: { id: string }) => b.id));
}

/**
 * Added this session now that the once-open CareLink intake question is resolved (see
 * ConversationChannel's comment in schema.prisma and create_order's own comment below): looks
 * up the calling conversation's real, server-recorded `channel` — never trusts the model to
 * self-report "this is a CareLink order," same trust posture as getBekaaBranchRestriction()
 * above. Returns `null` when there's no conversation context at all (a direct API call, not
 * through the AI orchestrator), which callers treat as DIRECT.
 */
async function getConversationChannel(context: AiToolContext | undefined): Promise<ConversationChannel | null> {
  if (!context?.conversationId) return null;
  const conversation = await prisma.whatsappConversation.findUnique({
    where: { id: context.conversationId },
    select: { channel: true },
  });
  return conversation?.channel ?? null;
}

// ---------------------------------------------------------------------------
// 1. search_inventory
// ---------------------------------------------------------------------------

const searchInventorySchema = z.object({
  query: z.string().optional(),
  branchId: z.string().optional(),
  customerArea: z.string().optional(),
});

/** Real catalog + real per-branch stock — never an invented "yes, it's available." */
async function search_inventory(input: unknown, context?: AiToolContext) {
  await requireAiPermission(PERMISSIONS.INVENTORY_READ);
  const { query, branchId, customerArea } = searchInventorySchema.parse(input);

  const products = await searchProducts({ query, limit: 20 });
  if (products.length === 0) return { results: [] };

  // Bekaa rule: when it applies, it overrides whatever branchId the model passed (or didn't
  // pass) — see getBekaaBranchRestriction()'s own comment for why this is trusted over the
  // model's input rather than merged with it.
  const region = await resolveRegionBranches(context, customerArea);
  const bekaaRestriction = region.known ? region.ids : null;
  const effectiveBranchFilter = bekaaRestriction
    ? branchId && bekaaRestriction.has(branchId)
      ? branchId
      : { in: Array.from(bekaaRestriction) }
    : branchId;

  const productIds = products.map((p: { id: string }) => p.id);
  const inventory = await prisma.inventory.findMany({
    where: { productId: { in: productIds }, branchId: effectiveBranchFilter },
    include: { branch: true },
  });

  return {
    region: region.known ? (region.bekaa ? "BEKAA" : "BEIRUT") : "UNKNOWN",
    ...(region.known && region.bekaa ? { restrictedToBekaaBranches: true } : {}),
    results: products.map((product: { id: string; name: string; brand: string | null; type: string }) => ({
      productId: product.id,
      name: product.name,
      brand: product.brand,
      type: product.type,
      availability: inventory
        .filter((i: { productId: string }) => i.productId === product.id)
        .map((i: { branchId: string; branch: { name: string }; qtyOnHand: number; qtyReserved: number; price: { toString(): string } }) => ({
          branchId: i.branchId,
          branchName: i.branch.name,
          available: i.qtyOnHand - i.qtyReserved,
          // A price of 0 means "no price on file yet" (imported stock with no known cost) —
          // never present it to a customer as a real price.
          price: Number(i.price) > 0 ? i.price.toString() : null,
          ...(Number(i.price) > 0 ? {} : { priceNote: "السعر غير محدد بعد — لا تذكر سعراً للعميل، واطلب من الصيدلاني تأكيده." }),
        })),
    })),
  };
}

// ---------------------------------------------------------------------------
// 2. reserve_product
// ---------------------------------------------------------------------------

const reserveProductSchema = z.object({
  productId: z.string().min(1),
  branchId: z.string().min(1),
  qty: z.number().int().positive(),
});

/**
 * A dry-run availability check — NOT a database write. The schema's Reservation model is
 * keyed on orderItemId (its primary key), so there is no "hold without an order" concept to
 * create: the real stock reservation only ever happens atomically inside create_order()
 * (orders.ts's createOrder(), which re-checks this exact math at commit time — a race
 * between this check and the real order is still caught there, never silently allowed
 * through). This tool exists so the AI can confirm availability to the customer in
 * conversation BEFORE committing to create_order.
 */
async function reserve_product(input: unknown) {
  await requireAiPermission(PERMISSIONS.INVENTORY_READ);
  const { productId, branchId, qty } = reserveProductSchema.parse(input);

  const inventory = await prisma.inventory.findUnique({
    where: { productId_branchId: { productId, branchId } },
    include: { product: true },
  });
  if (!inventory) throw new NotFoundError("هذا المنتج غير متوفر في هذا الفرع.");

  const available = inventory.qtyOnHand - inventory.qtyReserved;
  return {
    productName: inventory.product.name,
    requested: qty,
    available,
    canFulfill: available >= qty,
    price: Number(inventory.price) > 0 ? inventory.price.toString() : null,
    ...(Number(inventory.price) > 0 ? {} : { priceNote: "السعر غير محدد بعد — لا تذكر سعراً للعميل، واطلب من الصيدلاني تأكيده." }),
  };
}

// ---------------------------------------------------------------------------
// 3. create_order
// ---------------------------------------------------------------------------

const createOrderToolSchema = z.object({
  branchId: z.string().min(1),
  customerPhone: z.string().min(3),
  customerName: z.string().optional(),
  deliveryAddress: z.string().optional(),
  items: z.array(z.object({ productId: z.string().min(1), qty: z.number().int().positive() })).min(1),
});

/**
 * Wraps orders.ts's createOrder() — the real reservation + order-number generation happen there.
 *
 * UPDATE (this session): the once-open "how does a CareLink order reach us" question is
 * resolved — CareLink customers talk to the AI through their own WhatsApp number, exactly
 * like a direct customer talks to a branch's number, just on a conversation whose `channel`
 * is CARELINK (see ConversationChannel in schema.prisma). So this tool still does NOT let the
 * MODEL set `source` directly in its own tool-call input (still no field for it in the zod
 * schema below — the model could get it wrong or lie about it), but it now sets it correctly
 * itself, from the trusted, server-recorded conversation channel — same trust posture as
 * getBekaaBranchRestriction()'s address check. A direct (non-CareLink) order is unaffected:
 * `channel` is DIRECT (or there's no conversation context at all, e.g. a test call), and
 * `source` stays OrderSource.DIRECT exactly as before.
 */
async function create_order(input: unknown, context?: AiToolContext) {
  const aiUser = await requireAiPermission(PERMISSIONS.ORDERS_WRITE);
  const parsed = createOrderToolSchema.parse(input);
  const channel = await getConversationChannel(context);
  const source = channel === ConversationChannel.CARELINK ? OrderSource.CARELINK : OrderSource.DIRECT;
  return createOrder({ ...parsed, source, userId: aiUser.id });
}

// ---------------------------------------------------------------------------
// 4. assign_pharmacy
// ---------------------------------------------------------------------------

const assignPharmacySchema = z.object({
  items: z.array(z.object({ productId: z.string().min(1), qty: z.number().int().positive() })).min(1),
  preferredBranchId: z.string().optional(),
  customerArea: z.string().optional(),
});

/**
 * Picks which branch should fulfill an order. The plan doc names this tool but doesn't
 * specify a selection rule, and `Branch` has no stored geolocation to pick "nearest" by (only
 * `Customer` does) — inventing a geo-distance rule the schema can't back would be exactly the
 * kind of unfounded assumption this project avoids. The honest, schema-backed rule
 * implemented here: try `preferredBranchId` first (if given), then every other ACTIVE
 * branch, and return the first one that actually has enough real stock for EVERY requested
 * line. Returns `null` — not an error — when no branch can fulfill the whole order; "no
 * branch can serve this right now" is a normal outcome for the AI to relay to the customer,
 * not a tool failure.
 */
async function assign_pharmacy(input: unknown, context?: AiToolContext) {
  await requireAiPermission(PERMISSIONS.INVENTORY_READ);
  const { items, preferredBranchId, customerArea } = assignPharmacySchema.parse(input);

  const branches = await listBranches(false); // ACTIVE only

  // Bekaa rule: when the ordering customer's address matches (region.ts), the candidate list is
  // narrowed to ONLY the isBekaaExclusive branches (الجواد كير والعاصي today) before anything
  // else runs — a preferredBranchId outside that set is simply not a candidate, same as any
  // other branch that can't fulfill the order. See getBekaaBranchRestriction()'s comment.
  const region = await resolveRegionBranches(context, customerArea);
  if (!region.known && (await getConversationChannel(context)) === ConversationChannel.CARELINK) {
    throw new BusinessRuleError(
      "منطقة الزبون غير معروفة. اسأله أولاً: هل هو في البقاع أم في بيروت وضواحيها (أو اسم منطقته)، ثم أعد استدعاء assign_pharmacy مع customerArea."
    );
  }
  const bekaaRestriction = region.known ? region.ids : null;
  const candidates = bekaaRestriction
    ? branches.filter((b: { id: string }) => bekaaRestriction.has(b.id))
    : branches;

  const ordered = preferredBranchId
    ? [
        ...candidates.filter((b: { id: string }) => b.id === preferredBranchId),
        ...candidates.filter((b: { id: string }) => b.id !== preferredBranchId),
      ]
    : candidates;

  const productIds = items.map((i) => i.productId);
  for (const branch of ordered) {
    const inventory = await prisma.inventory.findMany({
      where: { branchId: branch.id, productId: { in: productIds } },
    });
    const canFulfillAll = items.every((item) => {
      const row = inventory.find((i: { productId: string }) => i.productId === item.productId);
      return row && row.qtyOnHand - row.qtyReserved >= item.qty;
    });
    if (canFulfillAll) {
      return {
        branchId: branch.id,
        branchName: branch.name,
        restrictedToBekaaBranches: region.known && region.bekaa,
        region: region.known ? (region.bekaa ? "BEKAA" : "BEIRUT") : "UNKNOWN",
        // Surfaced here too (not just inside create_delivery's error) so the AI can mention it
        // while still talking through the order, before create_delivery is even called — see
        // that function's own comment for why this branch type skips the normal driver pool.
        specialDeliveryContactWhatsapp: branch.specialDeliveryContactWhatsapp ?? null,
        specialDeliveryContactLabel: branch.specialDeliveryContactLabel ?? null,
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 5. create_delivery
// ---------------------------------------------------------------------------

const createDeliveryToolSchema = z.object({
  orderId: z.string().min(1),
  driverId: z.string().optional(),
});

/**
 * Backs the plan doc's automated "READY FOR DELIVERY → إنشاء Delivery Task تلقائياً" step.
 * Unlike the human dispatcher's `POST /api/deliveries` (src/app/api/deliveries/route.ts),
 * which always requires an explicit driverId, this tool auto-picks the first AVAILABLE
 * driver when none is given — the AI is executing an automatic hand-off, not making a
 * dispatcher's judgment call. Throws a BusinessRuleError when no driver is AVAILABLE rather
 * than silently leaving the order stuck; src/lib/aiOrchestrator.ts's caller surfaces that
 * as a tool_result the model can relay ("no driver free right now").
 *
 * الجواد كير والعاصي، وكذلك فروع بيروت الأربعة (via "شركة المختار" — see
 * `Branch.specialDeliveryContactWhatsapp`/`specialDeliveryContactLabel`) don't use this in-app
 * driver pool at all — their delivery line is a phone/WhatsApp contact (one per branch for
 * الجواد كير/العاصي, one SHARED company number across all 4 Beirut branches) a human calls, not
 * a `Driver` resource this app tracks. So when the order's branch has one AND no explicit
 * driverId was given, auto-picking a random AVAILABLE driver from the network-wide pool would be
 * exactly wrong — this throws instead, naming the real contact (and company name, if one exists)
 * so the AI can relay it ("سيُنسَّق التوصيل عبر [الشركة/الفرع]: [الرقم]") rather than silently
 * mis-assigning a driver.
 *
 * Same logic, different reason, for `order.source === OrderSource.CARELINK` (added this
 * session — see the OrderSource enum's comment in schema.prisma): the user directly confirmed
 * "Carelink دائماً يوصّل طلباتها بنفسه" (CareLink always delivers its own orders itself), so an
 * order tagged CARELINK is refused here even if its branch has no specialDeliveryContactWhatsapp
 * at all — the two checks are independent, and either one alone is enough to refuse internal
 * dispatch. This check is checked first since it names a whole order, not a branch property.
 * Nothing currently sets an order's source to CARELINK (see create_order/createOrder's own
 * comments), so in today's real traffic this branch is dormant — it exists so the rule is
 * already correct the moment a CareLink-sourced order exists, whatever creates it.
 *
 * An explicit driverId is still honored untouched in every case above — a human dispatcher who
 * deliberately chose an in-app driver anyway is not second-guessed here.
 */
async function create_delivery(input: unknown) {
  const aiUser = await requireAiPermission(PERMISSIONS.DELIVERY_MANAGE);
  const { orderId, driverId: givenDriverId } = createDeliveryToolSchema.parse(input);

  // Declared `string` explicitly (not inferred from the optional `givenDriverId`) so both
  // branches below must produce a real string — the type-shim verification pass caught this
  // as a real bug when it was `let driverId = givenDriverId`: reassigning `available[0].id`
  // (an `any`, pre-`prisma generate`) narrowed back to `string | undefined`, not `string`,
  // letting a theoretically-undefined driverId through to createDelivery() uncaught by tsc.
  let driverId: string;
  if (givenDriverId) {
    driverId = givenDriverId;
  } else {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        source: true,
        branch: { select: { name: true, specialDeliveryContactWhatsapp: true, specialDeliveryContactLabel: true } },
      },
    });

    if (order?.source === OrderSource.CARELINK) {
      throw new BusinessRuleError(
        "هذا الطلب مصدره Carelink — وهي تتولى توصيل طلباتها بنفسها؛ لا يُستخدم سائقو التطبيق أو خط التوصيل الخاص بالفرع لهذا الطلب."
      );
    }
    if (order?.branch.specialDeliveryContactWhatsapp) {
      const who = order.branch.specialDeliveryContactLabel ?? `فرع ${order.branch.name}`;
      throw new BusinessRuleError(
        `${who} له خط توصيل خاص (${order.branch.specialDeliveryContactWhatsapp}) — لا يُستخدم السائقون العاديون هنا؛ التنسيق يتم عبر هذا الرقم مباشرة من فريق الصيدلية.`
      );
    }

    const available = await listDrivers({ availability: DriverAvailability.AVAILABLE });
    if (available.length === 0) {
      throw new BusinessRuleError("لا يوجد سائق متوفر (AVAILABLE) حالياً لتعيينه على هذا الطلب.");
    }
    driverId = available[0].id as string;
  }

  return createDelivery({ orderId, driverId, userId: aiUser.id });
}

// ---------------------------------------------------------------------------
// 6. request_branch_reservation (CareLink-channel only)
// ---------------------------------------------------------------------------

const requestBranchReservationSchema = z.object({
  branchId: z.string().min(1),
  productId: z.string().min(1),
  qty: z.number().int().positive(),
});

/**
 * New this session, for the now-confirmed CareLink order-broker flow (see CarelinkInquiry's
 * comment in schema.prisma, and src/lib/carelink.ts). Step 2 of the user's own description:
 * "...ثم يرسل رسالة للصيدلية بحجز المنتج ولدى رد الصيدلية وتزويده بالسعر..." — after
 * assign_pharmacy has picked a branch with real stock, this sends that branch a REAL WhatsApp
 * message (not a fake notification — the same Meta Graph API every other outbound message in
 * this app uses) asking them to reserve the item and reply with a price, and opens a
 * CarelinkInquiry row to track the ask.
 *
 * Does NOT create the real Order/Reservation — that still only happens in create_order, after
 * the customer approves. Does NOT wait for the reply either — it returns immediately with
 * status PENDING; the AI's job after calling this is to tell the customer "سأتحقق مع الصيدلية
 * وأعود إليك" via send_whatsapp_message and stop. The branch's eventual WhatsApp reply is
 * handled entirely outside this call, by the webhook (src/app/api/whatsapp/webhook/route.ts)
 * recognizing the sender as a branch number and calling handleCarelinkBranchReply(), which
 * appends a "[رد الفرع]" note to this same conversation and re-runs the AI turn — so the next
 * time this conversation's AI turn runs, the price is already there in the message history,
 * no polling tool needed.
 *
 * Restricted to CareLink conversations at the orchestrator level (src/lib/aiOrchestrator.ts
 * only offers this Tool when channel=CARELINK) — a direct branch conversation has no reason to
 * message itself. Uses WHATSAPP_SEND, the same permission send_whatsapp_message already uses:
 * this is the same action (sending a real WhatsApp message) to a different kind of recipient,
 * not a new category of privileged operation.
 */
async function request_branch_reservation(input: unknown, context?: AiToolContext) {
  const aiUser = await requireAiPermission(PERMISSIONS.WHATSAPP_SEND);
  const { branchId, productId, qty } = requestBranchReservationSchema.parse(input);

  if (!context?.conversationId) {
    throw new BusinessRuleError(
      "هذه الأداة تتطلب سياق محادثة Carelink حقيقياً (conversationId) — لا يمكن استخدامها خارج محادثة فعلية."
    );
  }

  const branch = await prisma.branch.findUnique({ where: { id: branchId } });
  if (!branch) throw new NotFoundError(`لا يوجد فرع بهذا المعرّف: ${branchId}`);
  if (!branch.whatsappNumber) {
    throw new BusinessRuleError(`الفرع "${branch.name}" لا يملك رقم واتساب مسجّلاً — لا يمكن إرسال طلب حجز إليه تلقائياً.`);
  }

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new NotFoundError(`لا يوجد منتج بهذا المعرّف: ${productId}`);

  // Included in the outbound text so the branch CAN quote it back in their reply, letting
  // handleCarelinkBranchReply() match it exactly — see that function's own comment for the
  // documented fallback (latest PENDING inquiry for the branch) when they don't.
  const referenceCode = `CLK-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  const inquiry = await prisma.carelinkInquiry.create({
    data: { conversationId: context.conversationId, branchId, productId, qty, referenceCode },
  });

  let waMessageId: string | undefined;
  try {
    const sent = await sendBusinessMessage(
      branch.whatsappNumber,
      `طلب حجز من Carelink (الرمز: ${referenceCode}): هل يتوفر لديكم "${product.name}" بكمية ${qty}؟ الرجاء الرد بالسعر للتأكيد، ويفضَّل ذكر الرمز ${referenceCode} في الرد.`,
      {
        fromPhoneNumberId: process.env.WHATSAPP_CARELINK_PHONE_NUMBER_ID,
        template: { name: WHATSAPP_TEMPLATES.reservation(), params: [referenceCode, product.name, String(qty)] },
      }
    );
    waMessageId = sent.waMessageId;
  } catch (e) {
    // The ask never reached the branch — drop the PENDING row so nothing waits on a reply that
    // can never come, and tell the model plainly (it must not promise the customer a check).
    await prisma.carelinkInquiry.delete({ where: { id: inquiry.id } }).catch(() => undefined);
    console.error("[request_branch_reservation] sending to branch failed", e);
    throw new BusinessRuleError(
      `تعذّر إرسال رسالة الحجز إلى الفرع عبر واتساب (${e instanceof Error ? e.message : "خطأ غير معروف"}). لم يُرسل شيء للفرع.`
    );
  }

  await logAudit({
    userId: aiUser.id,
    action: "carelink.inquiry.send",
    entity: `CarelinkInquiry:${inquiry.id}`,
    newValue: { branchId, productId, qty, referenceCode, waMessageId },
  });

  return { inquiryId: inquiry.id, referenceCode, status: "PENDING" as const };
}

// ---------------------------------------------------------------------------
// 7. notify_carelink_delivery (CareLink-channel only)
// ---------------------------------------------------------------------------

const notifyCarelinkDeliverySchema = z.object({ orderId: z.string().min(1) });

/**
 * Step 4 of the user's own description: "وعند الموافقة يتصل الذكاء الاصطناعي برقم الديلفري
 * ويعلمه بالعنوان واي صيدلية الطلب" — confirmed by the user to be an automatic WhatsApp/text
 * message, not a real voice call. Deliberately separate from create_delivery/Delivery (Phase
 * 6): create_delivery already refuses any order with source=CARELINK outright (see its own
 * comment) — CareLink handles delivery for its own orders itself, never through this app's
 * driver pool — so this tool exists specifically to do what CareLink orders need instead.
 *
 * UPDATED: the message goes to the delivery contact of the order's PHARMACY (Beirut ->
 * شركة المختار; الجواد كير and العاصي -> their own delivery person) via
 * resolveBranchDeliveryContact(), never to CareLink's own customer-facing number. Outside the
 * 24h window it is sent as the approved delivery template (see sendBusinessMessage).
 */
async function notify_carelink_delivery(input: unknown) {
  const aiUser = await requireAiPermission(PERMISSIONS.DELIVERY_MANAGE);
  const { orderId } = notifyCarelinkDeliverySchema.parse(input);
  return deliverCarelinkNotice(orderId, aiUser.id);
}

async function deliverCarelinkNotice(orderId: string, aiUserId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      orderNumber: true,
      source: true,
      deliveryAddress: true,
      notes: true,
      branch: {
        select: {
          name: true,
          address: true,
          whatsappNumber: true,
          specialDeliveryContactWhatsapp: true,
          specialDeliveryContactLabel: true,
        },
      },
      customer: { select: { name: true, phone: true, address: true } },
    },
  });
  if (!order) throw new NotFoundError(`لا يوجد طلب بهذا المعرّف: ${orderId}`);
  if (order.source !== OrderSource.CARELINK) {
    throw new BusinessRuleError("هذا الطلب ليس من مصدر Carelink — استخدم create_delivery لتوصيله بدلاً من هذه الأداة.");
  }

  // The delivery number is chosen PER PHARMACY (Beirut -> شركة المختار, الجواد كير -> its own
  // delivery person, العاصي -> its own) — never CareLink's own customer-facing number.
  const contact = resolveBranchDeliveryContact(order.branch);
  if (!contact) {
    throw new BusinessRuleError(
      `لا يوجد رقم ديلفري مسجّل لفرع "${order.branch.name}" — أخبر العميل أن فريق Carelink سينسّق التوصيل معه مباشرة.`
    );
  }

  const address = order.deliveryAddress ?? order.customer.address ?? "(لم يُحدَّد عنوان)";
  const customerLabel = `${order.customer.name ?? "زبون"} ${order.customer.phone}`;
  const pickup = `${order.branch.name}${order.branch.address ? ` — ${order.branch.address}` : ""}`;
  const deliveryText = `طلب توصيل جديد من Carelink — رقم الطلب ${order.orderNumber}. الاستلام من: ${pickup}. التسليم إلى: ${address}. الزبون: ${customerLabel}. الرجاء تأكيد الاستلام بالرد على هذه الرسالة.`;
  let waMessageId: string | undefined;
  let via: string = "text";
  let deliveryReached = true;
  let deliveryError: string | null = null;
  try {
    const sent = await sendBusinessMessage(contact.whatsapp, deliveryText, {
      fromPhoneNumberId: process.env.WHATSAPP_CARELINK_PHONE_NUMBER_ID,
      template: { name: WHATSAPP_TEMPLATES.delivery(), params: [order.orderNumber, pickup, address, customerLabel] },
    });
    waMessageId = sent.waMessageId;
    via = sent.via;
  } catch (e) {
    // Typically: the delivery contact has not written to CareLink's number in the last 24h AND the
    // delivery template is not approved yet. Don't leave the order dangling: hand the details to the
    // PHARMACY (it replied to us recently, so we are inside its 24h window) so it can pass them on,
    // and record the gap on the order so the team sees it.
    deliveryReached = false;
    deliveryError = e instanceof Error ? e.message : String(e);
    console.error("[carelink] delivery contact could not be messaged — falling back to the pharmacy", e);
    if (!order.branch.whatsappNumber) throw e;
    const sent = await sendBusinessMessage(
      order.branch.whatsappNumber,
      `طلب جديد مؤكد من Carelink — رقم الطلب ${order.orderNumber}. الرجاء تجهيزه وإبلاغ ${contact.label ?? "الديلفري"} (${contact.whatsapp}) للاستلام من: ${pickup} والتسليم إلى: ${address}. الزبون: ${customerLabel}.`,
      { fromPhoneNumberId: process.env.WHATSAPP_CARELINK_PHONE_NUMBER_ID }
    );
    waMessageId = sent.waMessageId;
    via = `pharmacy-fallback:${sent.via}`;
    await prisma.order
      .update({
        where: { id: orderId },
        data: { notes: `${order.notes ?? ""} | ⚠ لم تصل رسالة الديلفري (${contact.label ?? contact.whatsapp}): أُرسلت التفاصيل للصيدلية لتبلّغه — راجعوا يدوياً.`.trim() },
      })
      .catch(() => undefined);
  }

  // Best-effort courtesy to the pharmacy (skipped when the fallback already messaged it).
  if (deliveryReached && order.branch.whatsappNumber) {
    try {
      await sendTextMessage(
        order.branch.whatsappNumber,
        `تأكيد من Carelink: تمت موافقة الزبون على الطلب ${order.orderNumber}. الرجاء تجهيزه، وسيمرّ ${contact.label ?? "الديلفري"} لاستلامه.`,
        { fromPhoneNumberId: process.env.WHATSAPP_CARELINK_PHONE_NUMBER_ID }
      );
    } catch (e) {
      console.warn(`[carelink] تعذّر إرسال تأكيد الطلب إلى الصيدلية (${order.branch.name})`, e);
    }
  }

  await logAudit({
    userId: aiUserId,
    action: "carelink.delivery.notify",
    entity: `Order:${orderId}`,
    newValue: { waMessageId, address, via, deliveryReached, deliveryError, deliveryContact: contact.label ?? contact.source },
  });

  return {
    notified: true as const,
    deliveryContactReached: deliveryReached,
    deliveryBy: contact.label ?? "فريق التوصيل",
    ...(deliveryReached ? {} : { note: "تعذّر مراسلة الديلفري مباشرة فأُرسلت التفاصيل للصيدلية لتبلّغه. أخبر العميل أن الطلب أُكّد وأن التوصيل يُنسَّق الآن، دون وعد بوقت محدد." }),
  };
}

// ---------------------------------------------------------------------------
// 7a. confirm_carelink_order (CareLink-channel only)
// ---------------------------------------------------------------------------

const confirmCarelinkOrderSchema = z.object({
  referenceCodes: z.array(z.string().min(4)).min(1),
  deliveryAddress: z.string().min(3).optional(),
});

/**
 * After the customer approves the price a pharmacy quoted (CarelinkInquiry ANSWERED), this creates
 * the CareLink order from the inquiry codes ONLY (the model never has to know product/branch ids,
 * which is what broke the old create_order path: after a pharmacy reply the model only had text,
 * invented ids like "UNKNOWN", and the order failed) and immediately sends the delivery
 * notification to that pharmacy's delivery contact. One call per pharmacy.
 */
async function confirm_carelink_order(input: unknown, context?: AiToolContext) {
  const aiUser = await requireAiPermission(PERMISSIONS.ORDERS_WRITE);
  await requireAiPermission(PERMISSIONS.DELIVERY_MANAGE);
  const { referenceCodes, deliveryAddress } = confirmCarelinkOrderSchema.parse(input);
  if (!context?.conversationId) {
    throw new BusinessRuleError("هذه الأداة تتطلب سياق محادثة Carelink حقيقياً (conversationId).");
  }
  const channel = await getConversationChannel(context);
  if (channel !== ConversationChannel.CARELINK) {
    throw new BusinessRuleError("هذه الأداة لمحادثات Carelink فقط.");
  }

  const codes = Array.from(new Set(referenceCodes.map((c) => c.trim().toUpperCase())));
  const inquiries = await prisma.carelinkInquiry.findMany({
    where: { referenceCode: { in: codes }, conversationId: context.conversationId },
    include: { product: true, branch: true },
  });
  const missing = codes.filter((c) => !inquiries.some((i: { referenceCode: string }) => i.referenceCode === c));
  if (missing.length > 0) {
    throw new NotFoundError(`لا يوجد طلب حجز بهذه الرموز في هذه المحادثة: ${missing.join("، ")}`);
  }
  const notReady = inquiries.filter(
    (i: { status: string; quotedPrice: unknown }) => i.status !== CarelinkInquiryStatus.ANSWERED || i.quotedPrice == null
  );
  if (notReady.length > 0) {
    throw new BusinessRuleError(
      `هذه الرموز لم تُجب عنها الصيدلية بسعر بعد، فلا يمكن تأكيدها: ${notReady
        .map((i: { referenceCode: string }) => i.referenceCode)
        .join("، ")}`
    );
  }
  const branchIds = Array.from(new Set(inquiries.map((i: { branchId: string }) => i.branchId)));
  if (branchIds.length > 1) {
    throw new BusinessRuleError("الرموز تعود لأكثر من صيدلية — استدعِ الأداة مرة منفصلة لكل صيدلية (رموزها وحدها).");
  }

  for (const code of codes) {
    const existing = await prisma.order.findFirst({
      where: { source: OrderSource.CARELINK, notes: { contains: code } },
      select: { id: true, orderNumber: true },
    });
    if (existing) {
      throw new BusinessRuleError(
        `أُنشئ طلب لهذا الرمز مسبقاً (${existing.orderNumber}، orderId: ${existing.id}). إن لم تصل رسالة الديلفري استخدم notify_carelink_delivery بهذا orderId، ولا تنشئ طلباً جديداً.`
      );
    }
  }

  const conversation = await prisma.whatsappConversation.findUnique({
    where: { id: context.conversationId },
    select: { customerId: true },
  });
  if (!conversation) throw new NotFoundError("المحادثة غير موجودة.");

  const order = await createCarelinkBrokerOrder({
    branchId: branchIds[0] as string,
    customerId: conversation.customerId,
    deliveryAddress,
    notes: `طلب Carelink — رموز الحجز: ${codes.join(" ")} — الأسعار حسب ردّ الصيدلية: ${inquiries
      .map((i: { product: { name: string }; qty: number; quotedPrice: { toString(): string } | null }) => `${i.product.name} ×${i.qty} = ${i.quotedPrice?.toString()}`)
      .join(" | ")}`,
    items: inquiries.map((i: { productId: string; qty: number; quotedPrice: { toString(): string } | null }) => ({
      productId: i.productId,
      qty: i.qty,
      price: Number(i.quotedPrice?.toString() ?? 0),
    })),
    userId: aiUser.id,
  });

  try {
    const sent = await deliverCarelinkNotice(order.id, aiUser.id);
    return { orderId: order.id, orderNumber: order.orderNumber, notified: true as const, deliveryBy: sent.deliveryBy };
  } catch (e) {
    console.error("[confirm_carelink_order] delivery notification failed", e);
    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      notified: false as const,
      error: e instanceof Error ? e.message : "خطأ غير معروف",
      note: "الطلب سُجّل لكن رسالة الديلفري لم تُرسل. أخبر العميل بصدق أن طلبه سُجّل وأن فريق Carelink سينسّق التوصيل معه مباشرة. لا تُنشئ طلباً جديداً.",
    };
  }
}

// ---------------------------------------------------------------------------
// 7b. Partner suppliers (شركات شريكة — e.g. شركة لطافة): list_partner_suppliers,
//     request_supplier_reservation, notify_supplier_delivery
// ---------------------------------------------------------------------------
//
// Real flow, from the user: a partner company (no stock kept in this system) is asked over
// WhatsApp when NO pharmacy has the item; after the customer agrees, the delivery company
// (e.g. شركة المختار) is told to collect from the supplier and deliver; the supplier is paid
// later. Mirrors request_branch_reservation/notify_carelink_delivery, but the item is free text
// (supplier goods are not in the product catalog) and there is no Order row.

async function list_partner_suppliers() {
  await requireAiPermission(PERMISSIONS.INVENTORY_READ);
  const suppliers = await prisma.supplier.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" } });
  return {
    suppliers: suppliers.map(
      (x: { id: string; name: string; specialty: string | null; paymentTerms: string | null }) => ({
        supplierId: x.id,
        name: x.name,
        specialty: x.specialty,
        paymentTerms: x.paymentTerms,
      })
    ),
  };
}

const requestSupplierReservationSchema = z.object({
  supplierId: z.string().min(1),
  productText: z.string().min(1),
  qty: z.number().int().positive(),
  knownPrice: z.number().positive().optional(), // fixed customer price from the company's price list (app orders)
});

async function request_supplier_reservation(input: unknown, context?: AiToolContext) {
  const aiUser = await requireAiPermission(PERMISSIONS.WHATSAPP_SEND);
  const { supplierId, productText, qty, knownPrice } = requestSupplierReservationSchema.parse(input);

  if (!context?.conversationId) {
    throw new BusinessRuleError("هذه الأداة تتطلب سياق محادثة حقيقياً (conversationId) — لا يمكن استخدامها خارج محادثة فعلية.");
  }

  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier || supplier.status !== "ACTIVE") {
    throw new NotFoundError(`لا توجد شركة شريكة فعّالة بهذا المعرّف: ${supplierId}`);
  }

  const referenceCode = `SUP-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const inquiry = await prisma.supplierInquiry.create({
    data: { supplierId, conversationId: context.conversationId, productText, qty, referenceCode, ...(knownPrice ? { quotedPrice: knownPrice } : {}) },
  });

  let waMessageId: string | undefined;
  try {
    const sent = await sendBusinessMessage(
      supplier.whatsappNumber,
      knownPrice
        ? `طلب حجز (الرمز: ${referenceCode}): "${productText}" بكمية ${qty}، حسب لائحة أسعاركم. الرجاء الرد بـ "متوفر" أو "غير متوفر" فقط، مع ذكر الرمز ${referenceCode}.`
        : `طلب حجز (الرمز: ${referenceCode}): هل يتوفر لديكم "${productText}" بكمية ${qty}؟ الرجاء الرد بالتوفر والسعر، ويفضَّل ذكر الرمز ${referenceCode} في الرد.`,
      {
        fromPhoneNumberId: process.env.WHATSAPP_CARELINK_PHONE_NUMBER_ID,
        template: { name: WHATSAPP_TEMPLATES.reservation(), params: [referenceCode, productText, String(qty)] },
      }
    );
    waMessageId = sent.waMessageId;
  } catch (e) {
    // Same rule as request_branch_reservation: a request that never left must not stay PENDING
    // (SUP-LM4ILR on 18 Nov stayed open after a failed send and later swallowed an unrelated reply).
    await prisma.supplierInquiry.delete({ where: { id: inquiry.id } }).catch(() => undefined);
    console.error("[request_supplier_reservation] sending to supplier failed", e);
    throw new BusinessRuleError(
      `تعذّر إرسال طلب الحجز إلى الشركة عبر واتساب (${e instanceof Error ? e.message : "خطأ غير معروف"}). لم يُرسل شيء للشركة.`
    );
  }

  await logAudit({
    userId: aiUser.id,
    action: "supplier.inquiry.send",
    entity: `SupplierInquiry:${inquiry.id}`,
    newValue: { supplierId, productText, qty, referenceCode, waMessageId },
  });

  return { inquiryId: inquiry.id, referenceCode, status: "PENDING" as const };
}

const notifySupplierDeliverySchema = z.object({
  inquiryId: z.string().min(1),
  deliveryAddress: z.string().min(3),
  customerName: z.string().optional(),
});

async function notify_supplier_delivery(input: unknown, context?: AiToolContext) {
  const aiUser = await requireAiPermission(PERMISSIONS.DELIVERY_MANAGE);
  const { inquiryId, deliveryAddress, customerName } = notifySupplierDeliverySchema.parse(input);

  const inquiry = await prisma.supplierInquiry.findUnique({ where: { id: inquiryId }, include: { supplier: true } });
  if (!inquiry) throw new NotFoundError(`لا يوجد طلب حجز بهذا المعرّف: ${inquiryId}`);
  if (context?.conversationId && inquiry.conversationId !== context.conversationId) {
    throw new BusinessRuleError("طلب الحجز هذا يخص محادثة أخرى.");
  }
  if (inquiry.status === "CONFIRMED") {
    throw new BusinessRuleError("تم إبلاغ شركة التوصيل بهذا الطلب مسبقاً.");
  }
  if (inquiry.status !== "ANSWERED") {
    throw new BusinessRuleError(
      "لا يمكن طلب التوصيل قبل أن تؤكد الشركة التوفر والسعر (الحالة الحالية: " + inquiry.status + ") — انتظر رد الشركة وموافقة العميل."
    );
  }
  if (!inquiry.supplier.deliveryContactWhatsapp) {
    throw new BusinessRuleError(`الشركة "${inquiry.supplier.name}" ليس لها رقم توصيل مسجّل — يلزم تنسيق التوصيل يدوياً.`);
  }

  const conversation = await prisma.whatsappConversation.findUnique({
    where: { id: inquiry.conversationId },
    include: { customer: true },
  });
  const customerLabel = customerName ?? conversation?.customer?.name ?? "—";
  const customerPhone = conversation?.customer?.phone ?? "—";
  const company = inquiry.supplier.deliveryContactLabel ?? "التوصيل";

  const { waMessageId } = await sendBusinessMessage(
    inquiry.supplier.deliveryContactWhatsapp,
    `طلب توصيل (${company}) — الرمز ${inquiry.referenceCode}: الاستلام من ${inquiry.supplier.name} (${inquiry.supplier.whatsappNumber}) — الصنف: ${inquiry.productText}، الكمية: ${inquiry.qty}${
      inquiry.quotedPrice !== null ? `، السعر المعروض: ${inquiry.quotedPrice}` : ""
    }. التوصيل إلى: ${deliveryAddress}. الزبون: ${customerLabel} — ${customerPhone}.`,
    {
      fromPhoneNumberId: process.env.WHATSAPP_CARELINK_PHONE_NUMBER_ID,
      template: {
        name: WHATSAPP_TEMPLATES.delivery(),
        params: [
          inquiry.referenceCode,
          `${inquiry.supplier.name} — ${inquiry.productText} (الكمية ${inquiry.qty})`,
          deliveryAddress,
          `${customerLabel} ${customerPhone}`,
        ],
      },
    }
  );

  // Best-effort courtesy message to the supplier itself (the order is confirmed; the driver is coming).
  try {
    await sendTextMessage(
      inquiry.supplier.whatsappNumber,
      `تأكيد الحجز (الرمز: ${inquiry.referenceCode}): سيمرّ ${company} لاستلام "${inquiry.productText}" (الكمية ${inquiry.qty}). الحساب لاحقاً حسب الاتفاق.`
    );
  } catch (e) {
    console.warn(`[supplier] تعذّر إرسال رسالة التأكيد للشركة (${inquiry.supplier.name})`, e);
  }

  await prisma.supplierInquiry.update({
    where: { id: inquiry.id },
    data: { status: "CONFIRMED", deliveryAddress, deliveryNotifiedAt: new Date() },
  });
  await logAudit({
    userId: aiUser.id,
    action: "supplier.delivery.notify",
    entity: `SupplierInquiry:${inquiry.id}`,
    newValue: { waMessageId, deliveryAddress },
  });

  return { notified: true as const, referenceCode: inquiry.referenceCode };
}

// ---------------------------------------------------------------------------
// 8. search_customer
// ---------------------------------------------------------------------------

const searchCustomerSchema = z.object({ query: z.string().min(1) });

async function search_customer(input: unknown) {
  await requireAiPermission(PERMISSIONS.CUSTOMERS_READ);
  const { query } = searchCustomerSchema.parse(input);
  return searchCustomers(query, 20);
}

// ---------------------------------------------------------------------------
// 9. send_whatsapp_message
// ---------------------------------------------------------------------------

const sendWhatsappMessageSchema = z.object({
  conversationId: z.string().min(1),
  text: z.string().min(1),
});

/**
 * The ONLY way the AI replies to a customer — src/lib/aiOrchestrator.ts's system prompt
 * instructs the model to never produce a final answer without calling this, per the plan
 * doc's "ينفّذ حصراً عبر Tool Calling" rule applying to outbound replies too, not just data
 * reads/writes. Wraps conversations.ts's sendReply(), which already calls the real Meta
 * Graph API first and only persists the message if Meta actually accepted it.
 */
async function send_whatsapp_message(input: unknown) {
  const aiUser = await requireAiPermission(PERMISSIONS.WHATSAPP_SEND);
  const { conversationId, text } = sendWhatsappMessageSchema.parse(input);
  return sendReply({ conversationId, text, userId: aiUser.id });
}


// ---------------------------------------------------------------------------
// refer_consultation (app «استشارة» tab): hand a medical question to the command center
// ---------------------------------------------------------------------------

const referConsultationSchema = z.object({
  question: z.string().min(2).max(2000),
  summary: z.string().min(2).max(1000),
  specialist: z.enum(["pharmacist", "doctor"]).default("pharmacist"),
  urgent: z.boolean().default(false),
});

/**
 * Owner's rule (23 Nov 2026): the AI answers general consultations itself; anything that needs a
 * pharmacist or a doctor is referred to the command center («الاستشارات» page), where staff follow
 * up with a pharmacy or a specialist and reply later in the same conversation. Free of charge.
 * Stored as an AuditLog row (no schema migration); the conversation stays with the AI.
 */
async function refer_consultation(input: unknown, context?: AiToolContext) {
  const aiUser = await requireAiPermission(PERMISSIONS.WHATSAPP_SEND);
  const data = referConsultationSchema.parse(input);
  if (!context?.conversationId) throw new BusinessRuleError("هذه الأداة تتطلب محادثة حقيقية.");
  await logAudit({
    userId: aiUser.id,
    action: "consult.referred",
    entity: `WhatsappConversation:${context.conversationId}`,
    newValue: { ...data, at: new Date().toISOString() },
  });
  return { referred: true, note: "أُحيلت الاستشارة إلى فريق Carelink — الرد يحتاج وقتاً وليس فورياً." };
}

// ---------------------------------------------------------------------------
// 10. search_documents
// ---------------------------------------------------------------------------

const searchDocumentsSchema = z.object({
  query: z.string().optional(),
  ownerType: z.string().optional(),
});

/**
 * Delegates to src/lib/documents.ts's searchDocuments() — the same canonical query Phase 8's
 * API routes use, rather than keeping a second copy here. Filename/tag substring matching
 * only; semantic search would need every existing row classified first (src/lib/
 * documentAi.ts's runDocumentAi(), which is on-demand, not automatic — see its own comment).
 * This will legitimately return an empty list until something has actually been uploaded
 * through Phase 8's storage adapter (still unconfigured — see src/lib/storage.ts); it is the
 * real (currently empty, pending that decision) table, never a mocked result.
 */
async function search_documents(input: unknown) {
  await requireAiPermission(PERMISSIONS.DOCUMENTS_READ);
  const { query, ownerType } = searchDocumentsSchema.parse(input);
  return searchDocuments({ query, ownerType });
}

// ---------------------------------------------------------------------------
// 11. create_carelink_job
// ---------------------------------------------------------------------------

const createCarelinkJobSchema = z.object({
  type: z.string().min(1),
  payload: z.record(z.unknown()).optional(),
});

/**
 * Deliberately NOT callable by the AI today. CARELINK_ADMIN is NOT in AI_AGENT's permission
 * set (prisma/seed.ts) — "أي عملية إدارية على CareLink" is on the plan doc's Human Approval
 * list, so requireAiPermission() below always rejects it for the AI identity. Even a human
 * caller who DOES hold CARELINK_ADMIN still hits the BusinessRuleError after that.
 *
 * This comment has been wrong twice before, so it's worth being explicit about what's actually
 * known now vs. still guessed. Three successive pictures of CareLink this session:
 *   1. The plan doc's original CarelinkJob.type examples (classify_files/find_duplicates/
 *      create_folder) — a pre-real-data guess, now disproven.
 *   2. "Just a phone/WhatsApp delivery contact, same category as شركة المختار" — this session's
 *      early guess from the branch-list data, also superseded.
 *   3. The user's own, much more detailed description, verbatim: "Carelink هي عبارة عن واسطة
 *      لتلقي الطلبيات من خلال رقمها وموقعها والانستغرام وتحويله الى الصيدليات للبحث عن المنتج ثم
 *      تحويله الى الديلفري" — CareLink is an order-broker: it takes customer orders through its
 *      OWN phone/website/Instagram, relays them to a pharmacy to check/fulfill, then arranges
 *      delivery itself (separately confirmed: "Carelink دائماً يوصّل طلباتها بنفسه" — see
 *      OrderSource.CARELINK in schema.prisma, now enforced in create_delivery above).
 * So CareLink is real business logic, not a file-management platform and not a bare phone
 * number with nothing behind it. What's STILL unconfirmed, asked twice, "لا تفضيل" both times:
 * the technical mechanism by which a CareLink-relayed order reaches a specific pharmacy branch
 * (plain phone/WhatsApp to the branch's existing number? a portal? something else?). That's what
 * actually blocks building this for real — not a missing API key or Adapter config, but not
 * knowing what shape the integration even has yet.
 *
 * Given picture (3), CarelinkJob/create_carelink_job are probably the wrong shape regardless of
 * how the intake-channel question resolves: a "job" implies queueable automatable work, but what
 * CareLink actually hands the pharmacy is an ORDER (product + customer + "please check stock and
 * fulfill, we'll handle delivery") — i.e. closer to create_order with source=CARELINK than to a
 * CarelinkJob row. Not changed here — that's a real design decision (redesign CarelinkJob vs.
 * deprecate it vs. leave it for a genuinely different future use) that deserves asking the user
 * rather than guessing, so this function keeps throwing exactly as before until that's decided.
 */
async function create_carelink_job(input: unknown) {
  await requireAiPermission(PERMISSIONS.CARELINK_ADMIN);
  createCarelinkJobSchema.parse(input);
  throw new BusinessRuleError(
    "تكامل CareLink لم يُبن بعد (المرحلة 7 — معروف الآن أنها واسطة طلبات حقيقية، لكن آلية استقبال الصيدلية للطلب المحوَّل من Carelink ما زالت غير مؤكّدة) — لا يوجد Adapter حقيقي لتنفيذ هذه المهمة."
  );
}

// ---------------------------------------------------------------------------
// Registry — what src/lib/aiOrchestrator.ts actually hands to the Anthropic API
// ---------------------------------------------------------------------------

export interface AiToolSpec {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  // `context` is optional and most handlers ignore it (only search_inventory/assign_pharmacy use
  // it today, for the Bekaa-routing rule) — declared on the shared type so aiOrchestrator.ts has
  // exactly one call-site shape for every tool, instead of special-casing these two.
  handler: (input: unknown, context?: AiToolContext) => Promise<unknown>;
}

export const AI_TOOLS: AiToolSpec[] = [
  {
    name: "search_inventory",
    description: "يبحث في كتالوج المنتجات ومخزون الفروع الحقيقي (لا يخترع توفراً). اسم المنتج اختياري، والفرع اختياري لعرض كل الفروع. إن كان عنوان العميل المسجّل في منطقة البقاع/بعلبك-الهرمل، تُقصر النتائج تلقائياً على صيدلية الجواد كير والعاصي فقط (restrictedToBekaaBranches=true في الرد)، بغض النظر عن أي branchId تمّ تمريره.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "اسم المنتج أو الماركة أو الباركود (جزئي)" },
        branchId: { type: "string", description: "قصر البحث على فرع معيّن (اختياري)" },
        customerArea: { type: "string", description: "منطقة الزبون كما ذكرها (مثل: بعلبك، زحلة، الضاحية، بيروت). تحدّد الصيدليات: البقاع = الجواد كير والعاصي فقط، غير ذلك = صيدليات بيروت فقط." },
      },
    },
    handler: search_inventory,
  },
  {
    name: "reserve_product",
    description: "يتحقق من توفر كمية معيّنة من منتج في فرع معيّن قبل تأكيد الطلب مع العميل (فحص فقط، لا يحجز فعلياً — الحجز الحقيقي يحدث عند create_order).",
    input_schema: {
      type: "object",
      properties: {
        productId: { type: "string" },
        branchId: { type: "string" },
        qty: { type: "integer", minimum: 1 },
      },
      required: ["productId", "branchId", "qty"],
    },
    handler: reserve_product,
  },
  {
    name: "create_order",
    description: "ينشئ طلباً جديداً ويحجز الكمية فوراً (PENDING_CONFIRMATION) بعد موافقة العميل على الأصناف والسعر.",
    input_schema: {
      type: "object",
      properties: {
        branchId: { type: "string" },
        customerPhone: { type: "string" },
        customerName: { type: "string" },
        deliveryAddress: { type: "string" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { productId: { type: "string" }, qty: { type: "integer", minimum: 1 } },
            required: ["productId", "qty"],
          },
        },
      },
      required: ["branchId", "customerPhone", "items"],
    },
    handler: create_order,
  },
  {
    name: "assign_pharmacy",
    description: "يختار الفرع الذي سينفّذ الطلب بناءً على المخزون الفعلي لكل الأصناف المطلوبة (يعيد null إن لم يقدر أي فرع). إن كان عنوان العميل المسجّل في منطقة البقاع/بعلبك-الهرمل، يُقصر الاختيار تلقائياً على صيدلية الجواد كير والعاصي فقط. إن كان للفرع المختار رقم توصيل خاص (specialDeliveryContactWhatsapp، مع اسم شركة التوصيل في specialDeliveryContactLabel إن وُجد)، فهذا يعني أن توصيله يتم عبر هذا الرقم مباشرة لا عبر سائقي التطبيق.",
    input_schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { productId: { type: "string" }, qty: { type: "integer", minimum: 1 } },
            required: ["productId", "qty"],
          },
        },
        preferredBranchId: { type: "string" },
        customerArea: { type: "string", description: "منطقة الزبون كما ذكرها في المحادثة (إلزامية في Carelink إن لم يكن عنوانه محفوظاً). البقاع/بعلبك/الهرمل/زحلة → الجواد كير أو العاصي فقط؛ أي منطقة أخرى → صيدليات بيروت فقط." },
      },
      required: ["items"],
    },
    handler: assign_pharmacy,
  },
  {
    name: "create_delivery",
    description: "يعيّن توصيلاً لطلب في حالة READY_FOR_DELIVERY — يختار سائقاً متوفراً تلقائياً إن لم يُحدَّد driverId. إن كان مصدر الطلب (source) هو CARELINK، أو كان فرع الطلب من الفروع ذات خط التوصيل الخاص (الجواد كير/العاصي، أو أي من فروع بيروت الأربعة عبر شركة المختار)، ترفض الأداة التعيين التلقائي — في حالة CARELINK لأن Carelink توصّل طلباتها بنفسها، وفي الحالة الأخرى تعيد رقم الخط الخاص (واسم الشركة إن وُجد) لتنسيق التوصيل يدوياً عبره.",
    input_schema: {
      type: "object",
      properties: { orderId: { type: "string" }, driverId: { type: "string" } },
      required: ["orderId"],
    },
    handler: create_delivery,
  },
  {
    name: "request_branch_reservation",
    description: "(قناة Carelink فقط) يرسل رسالة واتساب حقيقية لرقم الفرع المحدَّد يطلب فيها تأكيد توفر منتج وكميته وسعره، وينشئ CarelinkInquiry لتتبّع الطلب. لا يحجز فعلياً ولا ينتظر الرد — الرد يصل لاحقاً كرسالة واتساب من الفرع ويظهر تلقائياً كملاحظة [رد الفرع] في هذه المحادثة عند توفره.",
    input_schema: {
      type: "object",
      properties: {
        branchId: { type: "string" },
        productId: { type: "string" },
        qty: { type: "integer", minimum: 1 },
      },
      required: ["branchId", "productId", "qty"],
    },
    handler: request_branch_reservation,
  },
  {
    name: "confirm_carelink_order",
    description: "(قناة Carelink فقط) بعد موافقة العميل على سعر ردّت به صيدلية: ينشئ الطلب ويرسل رسالة التوصيل للديلفري في خطوة واحدة. تمرّر فقط رموز الحجز (CLK-...) التي ردّت عليها الصيدلية بسعر (حالة ANSWERED) وعنوان العميل. استدعِها مرة واحدة لكل صيدلية. لا تستخدم create_order في Carelink.",
    input_schema: {
      type: "object",
      properties: {
        referenceCodes: { type: "array", items: { type: "string" }, description: "رموز الحجز CLK-XXXXXX لنفس الصيدلية" },
        deliveryAddress: { type: "string", description: "عنوان التوصيل كما كتبه العميل" },
      },
      required: ["referenceCodes"],
    },
    handler: confirm_carelink_order,
  },
  {
    name: "notify_carelink_delivery",
    description: "(قناة Carelink فقط) يرسل رسالة واتساب/نصية تلقائية لرقم توصيل Carelink بعد إنشاء الطلب فعلاً، تتضمن رقم الطلب والفرع والعنوان — فقط لطلبات مصدرها CARELINK (يرفض غير ذلك). لا يستخدم create_delivery إطلاقاً مع طلبات Carelink.",
    input_schema: {
      type: "object",
      properties: { orderId: { type: "string" } },
      required: ["orderId"],
    },
    handler: notify_carelink_delivery,
  },
  {
    name: "list_partner_suppliers",
    description: "يعرض الشركات الشريكة الفعّالة (مثل شركة لطافة للعطور والروائح) — شركات ليست صيدليات ولا مخزون لها في النظام. استخدمها فقط عندما لا يتوفر الصنف المطلوب في أي صيدلية وكان تخصص الشركة (specialty) يناسبه.",
    input_schema: { type: "object", properties: {} },
    handler: list_partner_suppliers,
  },
  {
    name: "request_supplier_reservation",
    description: "يرسل رسالة واتساب حقيقية لشركة شريكة يسألها عن توفر صنف (نص حر) وكميته وسعره، وينشئ SupplierInquiry لتتبّعه. لا ينتظر الرد — يصل لاحقاً كملاحظة [رد الشركة] في هذه المحادثة. أخبر العميل فوراً أنك تتحقق مع الشركة ثم توقف.",
    input_schema: {
      type: "object",
      properties: {
        supplierId: { type: "string" },
        productText: { type: "string", description: "اسم الصنف كما طلبه العميل (مع الماركة/الحجم إن ذُكر)" },
        qty: { type: "integer", minimum: 1 },
        knownPrice: { type: "number", description: "سعر الزبون الثابت للقطعة بالدولار إن كان معروفاً من لائحة الشركة (طلبات التطبيق من تبويب لطافة). عندها تُسأل الشركة عن التوفر فقط." },
      },
      required: ["supplierId", "productText", "qty"],
    },
    handler: request_supplier_reservation,
  },
  {
    name: "notify_supplier_delivery",
    description: "بعد أن تؤكد الشركة التوفر والسعر (حالة ANSWERED) ويوافق العميل صراحةً، يُبلغ شركة التوصيل المرتبطة بالشركة (مثل شركة المختار) بالاستلام من الشركة والتوصيل لعنوان العميل، ويُعلم الشركة بالتأكيد. الحساب مع الشركة يتم لاحقاً.",
    input_schema: {
      type: "object",
      properties: {
        inquiryId: { type: "string" },
        deliveryAddress: { type: "string", description: "عنوان التوصيل الكامل كما أكّده العميل" },
        customerName: { type: "string" },
      },
      required: ["inquiryId", "deliveryAddress"],
    },
    handler: notify_supplier_delivery,
  },
  {
    name: "search_customer",
    description: "يبحث عن عميل بالاسم أو رقم الهاتف في السجلات الحقيقية.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
    handler: search_customer,
  },
  {
    name: "send_whatsapp_message",
    description: "الطريقة الوحيدة لإرسال رد للعميل على واتساب — كل رد نهائي للعميل يجب أن يمر من هنا.",
    input_schema: {
      type: "object",
      properties: { conversationId: { type: "string" }, text: { type: "string" } },
      required: ["conversationId", "text"],
    },
    handler: send_whatsapp_message,
  },
  {
    name: "refer_consultation",
    description: "يحيل استشارة طبية من الزبون إلى مركز القيادة (فريق Carelink يتابع مع صيدلي أو طبيب مختص ويرد لاحقاً — ليس فورياً). استعملها عندما يحتاج السؤال قراراً شخصياً من صيدلي أو طبيب (جرعة لطفل أو حامل أو مرضع، أمراض مزمنة، أدوية بوصفة، تشخيص، أعراض مستمرة)، أو إذا طلب الزبون ذلك. question = سؤال الزبون كما كتبه، summary = ملخص قصير بالمعلومات المهمة (العمر، الأعراض، الأدوية الحالية...).",
    input_schema: {
      type: "object",
      properties: {
        question: { type: "string" },
        summary: { type: "string" },
        specialist: { type: "string", enum: ["pharmacist", "doctor"] },
        urgent: { type: "boolean" },
      },
      required: ["question", "summary"],
    },
    handler: refer_consultation,
  },
  {
    name: "search_documents",
    description: "يبحث في المستندات المخزّنة (اسم الملف أو الوسوم) — نتائجه ستكون فارغة حتى تُبنى المرحلة 8 (Document AI).",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" }, ownerType: { type: "string" } },
    },
    handler: search_documents,
  },
  {
    name: "create_carelink_job",
    description: "محجوبة حالياً عمداً — تكامل CareLink (المرحلة 7) غير مبنيّ بعد وأي عملية إدارية عليه تتطلب موافقة بشرية.",
    input_schema: {
      type: "object",
      properties: { type: { type: "string" }, payload: { type: "object" } },
      required: ["type"],
    },
    handler: create_carelink_job,
  },
];

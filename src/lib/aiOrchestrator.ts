import { callMessagesApi, AnthropicContentBlock, AnthropicMessage } from "@/lib/anthropic";
import { AI_TOOLS } from "@/lib/aiTools";
import { getConversationWithMessages } from "@/lib/conversations";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { sendTextMessage } from "@/lib/whatsapp";
import { ConversationChannel, MessageDirection, MessageType } from "@prisma/client";

// A defensive ceiling, not a tuned budget — stops a confused tool-calling loop (e.g. the
// model repeatedly calling a tool that keeps failing) from running forever against a paid
// API. Raised from 6 to 14: a real order with several items (e.g. two products) legitimately
// needs a search per item plus pharmacy selection, and 6 ran out before any reply was sent.
// The last 2 iterations force the reply tool, and if it still ends without a reply the customer
// gets a short holding message instead of silence.
const MAX_TOOL_ITERATIONS = 14;
const FORCE_REPLY_FROM = MAX_TOOL_ITERATIONS - 2;

// Encodes the plan doc's "قواعد الذكاء الاصطناعي (ثابتة لا تتغيّر)" directly into the system
// prompt — these are NOT optional/configurable per the plan doc, so they're hardcoded here
// rather than pulled from any admin-editable setting.
const SYSTEM_PROMPT = `أنت مساعد خدمة العملاء الآلي لصيدلية، تتواصل مع العملاء عبر واتساب.
قواعد ثابتة لا تتغيّر أبداً:
- ممنوع عليك الوصول المباشر لقاعدة البيانات أو أي نظام خارجي — تنفّذ كل شيء فقط من خلال الأدوات (Tools) المتاحة لك. لا تخترع توفر منتج أو سعراً أو حالة طلب لم تحصل عليها من أداة فعلية.
- ممنوع عليك التشخيص الطبي، أو إنشاء/تعديل وصفة طبية، أو تغيير جرعة أي دواء. أي رسالة من هذا النوع: أخبر العميل بأدب أنك ستحوّله لصيدلاني بشري، ولا تحاول الإجابة عن السؤال الطبي نفسه.
- أرسل كل رد نهائي للعميل فقط عبر أداة send_whatsapp_message — لا يوجد رد "نهائي" آخر، وأي نص تكتبه بدون استدعاء هذه الأداة لن يصل للعميل إطلاقاً.
- بعض الإجراءات (تعديل الأسعار، تعديل المخزون يدوياً، إلغاء طلب مؤكّد، صرف دواء بوصفة، أي عملية إدارية على CareLink مثل create_carelink_job) تتطلب موافقة بشرية ولن تنجح من جهتك — إن رفضتها أداة بسبب الصلاحيات، أخبر العميل أن طلبه يحتاج مراجعة من فريق الصيدلية. (هذا لا يشمل التعامل مع عملاء Carelink نفسها عبر الأدوات المخصصة لذلك — انظر التعليمات الإضافية أدناه إن كانت هذه محادثة Carelink.)
- إن ظهر في رد أداة search_inventory أو assign_pharmacy الحقل restrictedToBekaaBranches=true، فهذا يعني أن البحث والاختيار اقتصرا تلقائياً على صيدلية الجواد كير والعاصي (قاعدة البقاع/بعلبك-الهرمل) — هذا قرار النظام نفسه وليس خطأ، لا تتجاهله ولا تحاول تمرير فرع آخر.
- إن ظهر في رد assign_pharmacy رقم في specialDeliveryContactWhatsapp (ومعه specialDeliveryContactLabel إن وُجد اسم شركة)، أو رفضت أداة create_delivery التعيين التلقائي لهذا السبب، فهذا يعني أن توصيل هذا الفرع (الجواد كير، العاصي، أو أي فرع بيروت عبر شركة المختار) يتم عبر خط/شركة خاصة لا عبر سائقي التطبيق — أخبر العميل أن فريق الصيدلية سينسّق التوصيل عبر هذا الخط، ولا تحاول استدعاء create_delivery مجدداً بدون driverId محدد يدوياً من فريق بشري.
- إن رفضت أداة create_delivery التعيين لأن مصدر الطلب Carelink، فهذا يعني أن Carelink تتولى توصيل هذا الطلب بنفسها دائماً — أخبر العميل أن التوصيل سيتم عبر Carelink، ولا تحاول استدعاء create_delivery مجدداً لهذا الطلب بأي شكل (لا تلقائياً ولا بـ driverId يدوي).
- الشركات الشريكة (مثل شركة لطافة للعطور والروائح): ليست صيدليات ولا مخزون لها في النظام. فقط إن بحثت بـ search_inventory ولم تجد الصنف في أي صيدلية، واستدعيت list_partner_suppliers فوجدت شركة يناسب تخصصها (specialty) هذا الصنف: أخبر العميل أنه غير متوفر في الصيدليات وأنك ستتحقق من شركة شريكة، ثم استدعِ request_supplier_reservation (بنص الصنف والكمية) وأخبر العميل أنك تتحقق وتوقف — الرد يصل لاحقاً كملاحظة تبدأ بـ "[رد الشركة]". عند وصوله بسعر: أخبر العميل بالسعر والكمية واطلب موافقته الصريحة وعنوان التوصيل. عند موافقته استدعِ notify_supplier_delivery (inquiryId + العنوان) ثم أخبره أن التوصيل سيتم عبر شركة التوصيل. لا تخترع سعراً أو توفراً أبداً؛ وإن ظهر "[رد الشركة - يحتاج مراجعة بشرية]" أخبر العميل أنك تحتاج لحظة إضافية. لا تستخدم هذه الأدوات لصنف متوفر في صيدلية.
- الصدق في المتابعة (قاعدة صارمة): لا تقل للعميل إنك "تتحقق" أو "تتابع" أو "ستتواصل" مع صيدلية أو شركة إلا إذا (أ) استدعيت في هذا الدور نفسه أداة الطلب (request_branch_reservation أو request_supplier_reservation) ونجحت، أو (ب) كان في قسم "حالة طلبات الحجز" أدناه طلب حالته PENDING لهذا الصنف. إن لم يتحقق أي منهما فإما أن تستدعي الأداة الآن، أو تقول له بصدق إن الطلب غير مُرسل/مُغلق وتعرض عليه الخيارات. لا تَعِد بالتواصل مع جهة دون استدعاء الأداة.`;

// Appended to SYSTEM_PROMPT only when the conversation's channel is CARELINK (see
// ConversationChannel in schema.prisma) — this is the real, user-confirmed flow, not a
// speculative persona. The Tool list itself is also filtered for this channel (see
// CARELINK_ONLY_TOOLS/DIRECT_ONLY_TOOLS below), so the model can't call create_delivery here
// or request_branch_reservation/notify_carelink_delivery in a normal branch conversation even
// if it ignored this text — the filtering is the real enforcement, this is just guidance.
const CARELINK_SYSTEM_PROMPT_ADDENDUM = `

ملاحظة مهمة: هذه محادثة عبر قناة Carelink — أنت هنا مساعد Carelink نفسها (وسيط الطلبات)، لا مساعد فرع واحد بعينه.
قاعدة صارمة: لا تذكر للعميل أبداً اسم أي صيدلية أو فرع أو عنوانه أو رقمه، لا قبل الحجز ولا بعده. قل فقط "إحدى الصيدليات الشريكة" أو "الصيدلية الأقرب لك". اسم الفرع للاستخدام الداخلي بينك وبين الأدوات فقط.
لا تعطِ العميل سعراً نهائياً قبل ردّ الفرع؛ يمكنك أن تقول إن السعر مبدئي فقط إن كان مصدره search_inventory.
إن فشلت أداة request_branch_reservation (ظهر error في نتيجتها)، فلا تقل للعميل إنك "تتحقق مع الصيدلية" — أخبره بصدق أن طلبه سُجّل وأن أحد الفريق سيتواصل معه قريباً.
دورك بالضبط:
0. إن طلب العميل عدة أصناف: استدعِ search_inventory لكل صنف في الخطوة نفسها (استدعاءات متوازية)، ولا تكرر البحث عن الصنف نفسه بأسماء بديلة أكثر من مرة واحدة، ثم تابع مباشرة. لا تُطل الخطوات: يجب أن يصل العميل ردّ خلال بضع خطوات.
1. اعرف منطقة الزبون قبل اختيار الصيدلية: إن لم يذكرها ولم تكن محفوظة فاسأله "بأي منطقة أنت؟" (سؤال واحد قصير). ثم ابحث عن المنتج عبر search_inventory واختر الفرع عبر assign_pharmacy، ومرّر منطقته في customerArea لكليهما. القاعدة: زبون البقاع (بعلبك، الهرمل، زحلة...) يُخدم فقط من صيدليتي الجواد كير والعاصي، وأي زبون آخر فقط من صيدليات بيروت — النظام يطبّق ذلك تلقائياً عند تمرير customerArea.
2. اطلب من ذاك الفرع تأكيد الحجز والسعر عبر request_branch_reservation، ثم أخبر العميل فوراً أنك تتحقق مع الصيدلية عبر send_whatsapp_message وتوقف — لا تنتظر رداً فورياً، الرد سيصل كرسالة جديدة.
3. عندما يظهر في المحادثة نص يبدأ بـ "[رد الفرع]" يتضمّن سعراً، أخبر العميل بالسعر والكمية عبر send_whatsapp_message واطلب موافقته.
4. إن ظهر نص "[رد الفرع - يحتاج مراجعة بشرية]"، فهذا يعني أن السعر لم يُفهم تلقائياً — أخبر العميل أنك تحتاج لحظة إضافية، ولا تخترع سعراً بنفسك مهما كان السياق.
5. عند موافقة العميل الصريحة على السعر: اطلب منه عنوان التوصيل إن لم يكن عندك، ثم استدعِ confirm_carelink_order مرة واحدة لكل صيدلية، مع رموز الحجز (CLK-...) المذكورة في قسم "حالة طلبات الحجز" أدناه (تلك التي حالتها ANSWERED) وعنوان العميل. هذه الأداة تُنشئ الطلب وترسل رسالة التوصيل للديلفري معاً. لا تستخدم create_order ولا تخترع أي معرّف منتج أو فرع أبداً — لا تحتاجها.
6. بعد نجاح confirm_carelink_order (notified=true) أخبر العميل أن طلبه أُكّد وأن الديلفري في طريقه إليه، دون ذكر اسم الصيدلية ولا رقم الديلفري. إن رجعت notified=false أو error فأخبره بصدق أن الطلب سُجّل وأن فريق Carelink سينسّق التوصيل معه مباشرة، ولا تُنشئ طلباً ثانياً. لا تقل للعميل "تم التأكيد" قبل أن تنجح الأداة فعلاً.
7. إن ظهر نص "[رد الفرع] الصنف غير متوفر" فأبلغ العميل بأن الصنف غير متوفر لدى تلك الصيدلية واقترح بديلاً أو اسأل صيدلية أخرى عبر request_branch_reservation.
8. رسالة تبدأ بـ "[طلب من التطبيق]" هي طلب من تطبيق Carelink للزبائن: فيها المنطقة والعنوان والأصناف مع productId لكل صنف. لا تسأله عن المنطقة أو العنوان مجدداً؛ مرّر المنطقة في customerArea، واستخدم productId كما هو مع assign_pharmacy ثم request_branch_reservation، ثم أكّد للزبون عبر send_whatsapp_message (الرد يظهر له في التطبيق). الأصناف المكتوب عليها "بوصفة" أرفق الزبون صورة وصفتها؛ اذكر للصيدلية في الطلب أن الوصفة ستُراجَع عند التسليم ولا تحكم أنت على الوصفة.
9. إن تضمّن "[طلب من التطبيق]" قسم "أصناف شركة لطافة (السعر ثابت ومعروف)": هذه أصناف من لائحة شركة لطافة بسعر ثابت للزبون. لا تبحث عنها في المخزون ولا تستعمل assign_pharmacy لها؛ استدعِ list_partner_suppliers ثم request_supplier_reservation لشركة لطافة لكل صنف (productText = الاسم والحجم والرمز كما وردت، qty، knownPrice = سعر القطعة المذكور). أخبر الزبون بالسعر الإجمالي (السعر × الكمية بالدولار) وأنك تتأكد من التوفر. عند وصول "[رد الشركة]" بالتأكيد اطلب موافقته ثم notify_supplier_delivery بعنوانه المذكور في الطلب. قاعدة البقاع/بيروت لا تنطبق على شركة لطافة.
10. إن تضمّن "[طلب من التطبيق]" قسم "أصناف DEBORAH (حصراً من صيدلية الجواد كير...)": هذه مستحضرات تجميل DEBORAH MILANO بسعر ثابت للزبون، ولا يتعامل معها إلا صيدلية الجواد كير أياً كانت منطقة الزبون (قاعدة البقاع/بيروت لا تنطبق عليها). لا تستعمل search_inventory ولا assign_pharmacy لها؛ استدعِ request_branch_reservation مباشرة بالـ branchId والـ productId المذكورين لكل صنف وبالكمية. أخبر الزبون بالسعر الإجمالي (السعر × الكمية بالدولار، إضافة لكلفة التوصيل) وأنك تتأكد من التوفر مع الصيدلية. عند وصول "[رد الفرع]" بالتأكيد اطلب موافقته ثم confirm_carelink_order بعنوانه المذكور في الطلب. لا تعرض على الزبون سعراً غير السعر الثابت المذكور.
لا تستخدم create_delivery في هذه المحادثة أبداً — غير متاحة لأن Carelink تتولى توصيل طلباتها بنفسها دائماً.`;

const CARELINK_ONLY_TOOLS = new Set(["request_branch_reservation", "notify_carelink_delivery", "confirm_carelink_order"]);
// create_order is excluded on CareLink: its orders come only from confirm_carelink_order (pharmacy-quoted).
const DIRECT_ONLY_TOOLS = new Set(["create_delivery", "create_order"]);

/**
 * The Phase 5 Tool-Calling loop. Gated entirely behind ANTHROPIC_API_KEY (src/lib/anthropic.ts
 * throws AnthropicConfigError immediately if it's unset) — the caller (the WhatsApp webhook)
 * catches that and logs it as an expected, best-effort no-op, same pattern as
 * notifyCustomer() in src/lib/conversations.ts.
 *
 * THIS HAS NEVER RUN AGAINST A REAL MODEL in this sandbox — there is no ANTHROPIC_API_KEY to
 * test with here. It is written and type-checked (see README's shim-verification note), not
 * a tested feature; run it once against a real key and a real conversation before trusting
 * it in production.
 */
export async function runAiTurn(conversationId: string): Promise<void> {
  const conversation = await getConversationWithMessages(conversationId);

  // Why the AI did or did not answer is otherwise only visible in server logs. Every turn leaves one
  // audit row (tools called + any tool error) that /api/carelink/readiness shows to the owner.
  const trace: { tool: string; error?: string }[] = [];
  const record = async (outcome: string, extra?: string) => {
    try {
      await logAudit({
        userId: null,
        action: "ai.turn",
        entity: `WhatsappConversation:${conversationId}`,
        newValue: { outcome, trace, extra: extra?.slice(0, 200) },
      });
    } catch {
      /* diagnostics must never break the turn */
    }
  };

  const messages: AnthropicMessage[] = conversation.messages.map(
    (m: { direction: MessageDirection; content: string; type?: string }) => ({
      role: m.direction === MessageDirection.INBOUND ? "user" : "assistant",
      // App uploads are stored as data URLs — never send the raw image bytes to the model as text.
      content: m.type === "IMAGE" ? "[أرفق الزبون صورة (وصفة طبية) — تُراجَع من الصيدلي]" : m.content,
    })
  );

  // Channel-scoped Tool list (see CARELINK_ONLY_TOOLS/DIRECT_ONLY_TOOLS above) — the real
  // enforcement that a normal branch conversation can't call request_branch_reservation/
  // notify_carelink_delivery, and a CareLink conversation can't call create_delivery; the
  // system-prompt addendum below is guidance on top of this, not the only thing stopping it.
  const excludedTools = conversation.channel === ConversationChannel.CARELINK ? DIRECT_ONLY_TOOLS : CARELINK_ONLY_TOOLS;
  const toolDefs = AI_TOOLS.filter((t) => !excludedTools.has(t.name)).map(({ name, description, input_schema }) => ({
    name,
    description,
    input_schema,
  }));
  const baseSystem =
    conversation.channel === ConversationChannel.CARELINK ? SYSTEM_PROMPT + CARELINK_SYSTEM_PROMPT_ADDENDUM : SYSTEM_PROMPT;
  // The model has no other way to know this id, and send_whatsapp_message (plus several other
  // tools) require it as input — without it the model ends its turn with plain text that is
  // never delivered to the customer.
  // CareLink only: the model sees just message TEXT between turns (tool results are not kept), so
  // after a pharmacy reply it would not know codes/status/price and used to invent ids. Give it
  // the real state of this conversation's reservation inquiries every turn.
  let inquiryBlock = "";
  if (conversation.channel === ConversationChannel.CARELINK) {
    const inqs = await prisma.carelinkInquiry.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
      take: 30,
      include: { product: { select: { name: true } }, branch: { select: { name: true } } },
    });
    if (inqs.length > 0) {
      inquiryBlock =
        "\n\nحالة طلبات الحجز في هذه المحادثة (للاستخدام الداخلي فقط — لا تذكر أسماء الصيدليات للعميل):\n" +
        inqs
          .map(
            (q: { referenceCode: string; status: string; qty: number; rawReply: string | null; quotedPrice: { toString(): string } | null; product: { name: string }; branch: { name: string } }) =>
              `- ${q.referenceCode} | ${q.product.name} ×${q.qty} | الحالة: ${
                q.status === "NEEDS_REVIEW" && !q.rawReply && !q.quotedPrice
                  ? "CLOSED_NO_REPLY (مُغلق: الصيدلية لم تردّ — ليس قيد المتابعة. إن سأل الزبون عن هذا الصنف أو أراد الانتظار فاستدعِ request_branch_reservation الآن لطلب جديد، ولا تقل إنه قيد المتابعة قبل ذلك)"
                  : q.status
              }${q.quotedPrice ? ` | السعر الذي ردّت به الصيدلية: ${q.quotedPrice.toString()}` : ""} | الصيدلية (داخلي): ${q.branch.name}`
          )
          .join("\n") +
        "\nPENDING = أُرسل للصيدلية وننتظر ردها (هذا وحده يعني قيد المتابعة)؛ ANSWERED = ردّت بسعر؛ NEEDS_REVIEW = رد غير مفهوم، أو الصنف غير متوفر، أو لم تردّ وأُغلق الطلب؛ CANCELLED = لم يصل الطلب للصيدلية أو أُلغي. فقط PENDING قيد المتابعة.";
    }
  }
  // Partner-supplier requests (e.g. شركة لطافة) — same reason: the model must know what is really open.
  {
    const sups = await prisma.supplierInquiry.findMany({
      where: { conversationId, createdAt: { gt: new Date(Date.now() - 7 * 24 * 3600 * 1000) } },
      orderBy: { createdAt: "asc" },
      take: 20,
      include: { supplier: { select: { name: true } } },
    });
    if (sups.length > 0) {
      inquiryBlock +=
        "\n\nحالة طلبات الشركات الشريكة في هذه المحادثة:\n" +
        sups
          .map(
            (q: { id: string; referenceCode: string; status: string; qty: number; productText: string; quotedPrice: { toString(): string } | null; supplier: { name: string } }) =>
              `- ${q.referenceCode} (inquiryId: ${q.id}) | ${q.productText} ×${q.qty} | الحالة: ${q.status}${q.quotedPrice ? ` | السعر: ${q.quotedPrice.toString()}` : ""} | الشركة: ${q.supplier.name}`
          )
          .join("\n") +
        "\nفقط PENDING قيد المتابعة؛ NEEDS_REVIEW = رد يحتاج مراجعة بشرية؛ CANCELLED = لم يصل أو أُلغي.";
    }
  }
  const system = `${baseSystem}${inquiryBlock}\n\nمعرّف المحادثة الحالية (conversationId): ${conversationId}\nاستخدم هذه القيمة بالضبط في كل أداة تطلب conversationId، ومنها send_whatsapp_message.`;

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    // tool_choice "any": the model must always act through a tool (its only way to reach the customer).
    const forceReply = iteration >= FORCE_REPLY_FROM;
    if (forceReply && iteration === FORCE_REPLY_FROM) {
      // Tell the model it is nearly out of steps so the forced reply says something useful.
      const last = messages[messages.length - 1];
      if (last && last.role === "user" && Array.isArray(last.content)) {
        (last.content as AnthropicContentBlock[]).push({
          type: "text",
          text: "تنبيه من النظام: اقتربت من حد الخطوات المسموحة. أرسل الآن ردّك للعميل بما توفّر لديك فقط (ما وجدته وما تتحقق منه)، ولا تستدعِ أدوات بحث أخرى.",
        } as AnthropicContentBlock);
      }
    }
    const response = await callMessagesApi({
      system,
      messages,
      tools: toolDefs,
      toolChoice: forceReply ? { type: "tool", name: "send_whatsapp_message" } : { type: "any" },
    });

    const toolUseBlocks = response.content.filter(
      (b): b is AnthropicContentBlock & { id: string; name: string; input: unknown } => b.type === "tool_use"
    );

    if (toolUseBlocks.length === 0) {
      // The model stopped without calling send_whatsapp_message — per the system prompt it
      // always should, so a bare stop here is logged, never auto-forwarded to the customer:
      // sending raw model text directly would bypass Tool Calling entirely (the plan doc's
      // "ينفّذ حصراً عبر Tool Calling" rule), which is exactly the thing this file exists to
      // prevent.
      const stray = response.content
        .filter((b) => b.type === "text")
        .map((b) => String((b as { text?: unknown }).text ?? ""))
        .join(" ")
        .slice(0, 200);
      console.warn(
        `[aiOrchestrator] المحادثة ${conversationId} توقفت بدون استدعاء أداة (stop_reason=${response.stop_reason}) — لم يُرسل أي رد للعميل. النص: ${stray}`
      );
      await record("stopped_without_tool", `${response.stop_reason}: ${stray}`);
      return;
    }

    messages.push({ role: "assistant", content: response.content });

    const toolResults: AnthropicContentBlock[] = [];
    for (const block of toolUseBlocks) {
      const tool = AI_TOOLS.find((t) => t.name === block.name);
      let resultContent: string;
      try {
        // { conversationId } is the trusted context getBekaaBranchRestriction() (aiTools.ts)
        // uses for the Bekaa-routing rule — loaded from the real conversation/customer record,
        // never from whatever the model typed into its own tool-call input.
        const result = tool
          ? await tool.handler(block.input, { conversationId })
          : { error: `أداة غير معروفة: ${block.name}` };
        resultContent = JSON.stringify(result);
      } catch (e) {
        // A Tool rejecting the call (permission denied, business rule, not found) is a normal
        // outcome the model needs to see and relay — never thrown back up to the webhook.
        resultContent = JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
      }
      trace.push({ tool: block.name, error: resultContent.includes('"error"') ? resultContent.slice(0, 200) : undefined });
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: resultContent });
    }
    messages.push({ role: "user", content: toolResults });

    // The customer-facing reply has been sent: the turn is complete (tool_choice "any" would
    // otherwise force yet another tool call and risk a duplicate message).
    const sentReply = toolUseBlocks.some((b, i) => {
      if (b.name !== "send_whatsapp_message") return false;
      const r = toolResults[i] as { content?: unknown };
      return typeof r?.content === "string" && !r.content.includes('"error"');
    });
    if (sentReply) {
      await record("replied");
      return;
    }
  }
  await record("max_iterations");
  // Never leave the customer in silence: a short, honest holding message (outside the AI's control).
  try {
    const holding = "وصلنا طلبك ونتحقق منه مع الصيدلية الآن. سنوافيك بالتفاصيل خلال دقائق.";
    await sendTextMessage(conversation.customer.phone, holding, {
      fromPhoneNumberId:
        conversation.channel === ConversationChannel.CARELINK
          ? process.env.WHATSAPP_CARELINK_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_NUMBER_ID
          : undefined,
    });
    await prisma.whatsappMessage.create({
      data: { conversationId, direction: MessageDirection.OUTBOUND, type: MessageType.TEXT, content: holding },
    });
  } catch (e) {
    console.error("[aiOrchestrator] تعذّر إرسال رسالة الانتظار", e);
  }

  console.warn(
    `[aiOrchestrator] المحادثة ${conversationId} تجاوزت الحد الأقصى لاستدعاءات الأدوات (${MAX_TOOL_ITERATIONS}) — توقفت دفاعياً بدون رد نهائي.`
  );
}

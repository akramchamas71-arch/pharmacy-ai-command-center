import type { Metadata } from "next";

// Public page (no login): the privacy-policy URL required by Meta to publish the WhatsApp app.
// https://<app>/privacy
export const metadata: Metadata = {
  title: "سياسة الخصوصية | CareLink — Privacy Policy",
  description: "سياسة الخصوصية لخدمة CareLink للطلب والتوصيل عبر واتساب.",
};

const CONTACT_WHATSAPP = "+961 79 003 663";
const UPDATED = "4 تشرين الثاني 2026 / November 4, 2026";

const wrap: React.CSSProperties = {
  maxWidth: 820,
  margin: "0 auto",
  padding: "32px 20px 64px",
  lineHeight: 1.9,
  fontSize: 16,
  color: "#16213a",
};
const h2: React.CSSProperties = { fontSize: 20, fontWeight: 800, margin: "28px 0 8px" };
const box: React.CSSProperties = {
  background: "#fff",
  border: "2px solid #16213a",
  borderRadius: 18,
  boxShadow: "4px 4px 0 #16213a",
  padding: "8px 24px 24px",
  marginBottom: 32,
};

export default function PrivacyPage() {
  return (
    <main style={{ background: "#f5f7fb", minHeight: "100vh" }}>
      <div style={wrap}>
        {/* ---------------- العربية ---------------- */}
        <section dir="rtl" lang="ar" style={box}>
          <h1 style={{ fontSize: 28, fontWeight: 800, margin: "20px 0 4px" }}>سياسة الخصوصية — CareLink</h1>
          <p style={{ color: "#51607f", margin: 0 }}>آخر تحديث: {UPDATED}</p>

          <p>
            تشرح هذه السياسة كيف تتعامل خدمة <strong>CareLink</strong> (خدمة طلب وتوصيل المنتجات الصيدلانية ومنتجات العناية عبر
            واتساب، لبنان) مع المعلومات التي تصلنا عندما تراسلنا عبر واتساب أو تطلب منا خدمة.
          </p>

          <h2 style={h2}>1. المعلومات التي نجمعها</h2>
          <p>
            رقم هاتفك واسمك كما يظهر في واتساب، ونص رسائلك والصور أو الملفات أو الرسائل الصوتية التي ترسلها لنا، وعنوان التوصيل
            وتفاصيل طلبك (المنتجات والكميات وطريقة الدفع)، وتاريخ المحادثة ووقتها.
          </p>

          <h2 style={h2}>2. كيف نستخدمها</h2>
          <p>
            للرد على استفساراتك، ولتجهيز طلبك والتأكد من توفر المنتجات في الصيدليات، وللتوصيل، ولخدمة العملاء ومتابعة الشكاوى،
            ولتحسين جودة الخدمة. لا نستخدم معلوماتك للإعلان لجهات أخرى، ولا نبيعها.
          </p>

          <h2 style={h2}>3. المساعد الآلي (الذكاء الاصطناعي)</h2>
          <p>
            قد يقرأ مساعد آلي رسائلك ويجيب عنها ويقترح عليك الطلب، وقد يحوّل المحادثة إلى موظف بشري عند الحاجة. لا تعتمد على
            المساعد الآلي في القرارات الطبية؛ استشر الصيدلي أو الطبيب دائماً. ولا ترسل لنا معلومات صحية إلا بالقدر اللازم
            لتنفيذ طلبك.
          </p>

          <h2 style={h2}>4. مع من نشارك المعلومات</h2>
          <p>
            مع الصيدلية أو الفرع الذي ينفّذ طلبك، ومع سائق التوصيل بالقدر اللازم للتسليم فقط. ونستعين بمزوّدي خدمات تقنية لتشغيل
            الخدمة: Meta (واجهة WhatsApp Business) لإرسال الرسائل واستقبالها، ومزوّد استضافة وقواعد بيانات وتخزين ملفات، ومزوّد
            خدمة ذكاء اصطناعي لمعالجة النصوص. لا نشارك معلوماتك مع غير هؤلاء إلا إذا أُلزمنا بذلك قانوناً.
          </p>

          <h2 style={h2}>5. مدة الاحتفاظ</h2>
          <p>
            نحتفظ بالمحادثات وتفاصيل الطلبات المدة اللازمة لتنفيذ الخدمة والمتابعة والمحاسبة والالتزامات القانونية، ثم نحذفها أو
            نجعلها مجهولة الهوية.
          </p>

          <h2 style={h2}>6. حمايتك وحقوقك</h2>
          <p>
            نحمي البيانات بإجراءات تقنية وتنظيمية، منها تقييد الدخول إلى لوحة الإدارة بحسابات وصلاحيات والتحقق بخطوتين. يحق لك
            طلب الاطلاع على بياناتك أو تصحيحها أو <strong>حذفها</strong> في أي وقت بمراسلتنا على واتساب على الرقم{" "}
            <bdi dir="ltr">{CONTACT_WHATSAPP}</bdi> وسنستجيب خلال مدة معقولة. وتستطيع التوقف عن مراسلتنا في أي وقت.
          </p>

          <h2 style={h2}>7. الأطفال</h2>
          <p>الخدمة غير موجّهة لمن هم دون 18 عاماً، ولا نجمع عن قصد معلومات عنهم.</p>

          <h2 style={h2}>8. التغييرات</h2>
          <p>قد نحدّث هذه السياسة، ويظهر تاريخ آخر تحديث أعلاها.</p>

          <h2 style={h2}>9. التواصل</h2>
          <p>
            لأي سؤال عن الخصوصية أو لطلب حذف بياناتك: واتساب <bdi dir="ltr">{CONTACT_WHATSAPP}</bdi>.
          </p>
        </section>

        {/* ---------------- English ---------------- */}
        <section dir="ltr" lang="en" style={box}>
          <h1 style={{ fontSize: 28, fontWeight: 800, margin: "20px 0 4px" }}>Privacy Policy — CareLink</h1>
          <p style={{ color: "#51607f", margin: 0 }}>Last updated: November 4, 2026</p>

          <p>
            This policy explains how <strong>CareLink</strong> (an ordering and delivery service for pharmacy and personal-care
            products via WhatsApp, Lebanon) handles the information we receive when you message us on WhatsApp or request a
            service.
          </p>

          <h2 style={h2}>1. Information we collect</h2>
          <p>
            Your phone number and the name shown on your WhatsApp profile; the text of your messages and any images, files or
            voice notes you send; your delivery address and order details (products, quantities, payment method); and the date
            and time of the conversation.
          </p>

          <h2 style={h2}>2. How we use it</h2>
          <p>
            To answer your questions, prepare your order and check product availability at our pharmacies, deliver it, provide
            customer support, and improve the service. We do not sell your information and do not use it to advertise for third
            parties.
          </p>

          <h2 style={h2}>3. Automated assistant (AI)</h2>
          <p>
            An automated assistant may read and answer your messages and suggest an order, and may hand the conversation over to
            a human agent. Do not rely on the assistant for medical decisions; always consult a pharmacist or doctor. Please
            share health information only as needed to fulfil your request.
          </p>

          <h2 style={h2}>4. Who we share it with</h2>
          <p>
            The pharmacy or branch that fulfils your order, and the delivery driver only as needed to deliver it. We use
            technology providers to run the service: Meta (WhatsApp Business platform) to send and receive messages, hosting,
            database and file-storage providers, and an AI service provider to process text. We do not share your information
            with anyone else unless required by law.
          </p>

          <h2 style={h2}>5. Retention</h2>
          <p>
            We keep conversations and order details for as long as needed to provide the service, follow up, keep accounting
            records and meet legal obligations, then delete or anonymise them.
          </p>

          <h2 style={h2}>6. Security and your rights</h2>
          <p>
            We protect data with technical and organisational measures, including role-based access and two-step verification
            for our admin dashboard. You may ask to access, correct or <strong>delete</strong> your data at any time by
            messaging us on WhatsApp at <bdi>{CONTACT_WHATSAPP}</bdi>. You can stop messaging us at any time.
          </p>

          <h2 style={h2}>7. Children</h2>
          <p>The service is not directed to anyone under 18 and we do not knowingly collect their information.</p>

          <h2 style={h2}>8. Changes</h2>
          <p>We may update this policy; the date above shows when it was last changed.</p>

          <h2 style={h2}>9. Contact and data deletion</h2>
          <p>
            For privacy questions or to request deletion of your data: WhatsApp <bdi>{CONTACT_WHATSAPP}</bdi>.
          </p>
        </section>
      </div>
    </main>
  );
}

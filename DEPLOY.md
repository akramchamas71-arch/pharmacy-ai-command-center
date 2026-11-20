# نشر مركز قيادة الصيدليات — دليل خطوة بخطوة

## القرار المتخذ (ولماذا)

هذا مشروع مختلف تماماً عن لوحة الصيدليات الحالية (تلك منشورة أصلاً على Cloudflare
Workers + D1 + Pages — راجع `pharmacy-cloudflare-deploy.zip` المرسل سابقاً، ولم يُمسّ).

هذا المشروع مبني على **Postgres عبر Prisma** مع عمليات معقّدة (transactions، حجوزات
مخزون، تحقق من قيود CHECK). تشغيله على Cloudflare Workers مباشرة يحتاج إعادة كتابة
طبقة الاتصال بقاعدة البيانات بالكامل (محوّلات Prisma + Cloudflare Hyperdrive) — تغيير
كبير لا يمكن اختباره فعلياً من هذه البيئة المحدودة قبل تسليمه لك. بدل المجازفة بذلك:

- **الخادم (الكود نفسه): Railway.** يشغّل Node.js العادي بلا أي تعديل على الكود —
  نفس الكود المُسلَّم بالضبط، بدون أي مخاطرة.
- **قاعدة البيانات: Postgres على Railway نفسه.** خدمة واحدة، بلا حساب إضافي.
- **تخزين الملفات (Phase 8): Cloudflare R2.** هذا هو ربطك الفعلي بـ Cloudflare —
  بلا رسوم نقل بيانات خارجة (egress)، وهو ما يهم لأن كل عملية تصنيف مستند تُنزِّل
  الملف من التخزين. مبني فعلياً في `src/lib/storage.ts` (`R2Adapter`).
- **النطاق (اختياري لاحقاً): Cloudflare DNS** أمام Railway — يعطيك رابطاً باسمك
  الخاص وحماية Cloudflare القياسية، خطوة منفصلة تضاف في أي وقت دون التأثير على ما
  سبق.

لم يُبنَ أي كود وهمي لأي من هذا — R2 عبر `@aws-sdk/client-s3` الحقيقي، وRailway عبر
أوامره الموثّقة فعلياً أدناه.

---

## 1) تثبيت أداة Railway (مرة واحدة)

```
npm install -g @railway/cli
```

## 2) تسجيل الدخول

```
railway login
```

سيفتح متصفحك الحقيقي لتسجيل الدخول والموافقة.

## 3) إنشاء المشروع وربط قاعدة بيانات Postgres

من داخل مجلد المشروع (`pharmacy-ai-command-center`):

```
railway init
railway add --database postgres
```

## 4) ضبط متغيرات البيئة

```
railway variable set JWT_SECRET="$(openssl rand -base64 48)"
railway variable set JWT_EXPIRES_IN="12h"
railway variable set SEED_SUPERADMIN_EMAIL="بريدك@example.com"
railway variable set SEED_SUPERADMIN_PASSWORD="كلمة-مرور-قوية-غيّرها-فوراً"
railway variable set ANTHROPIC_API_KEY="المفتاح-الذي-أنشأته-في-platform.claude.com"
railway variable set CARELINK_CONTACT_WHATSAPP="+96179003663"
railway variable set FILE_STORAGE_PROVIDER="r2"
```

`DATABASE_URL` يضبطه Railway نفسه تلقائياً بعد خطوة `railway add --database postgres`
أعلاه — لا تكتبه يدوياً.

أضف أيضاً متغيرات WhatsApp (`WHATSAPP_ACCESS_TOKEN`، `WHATSAPP_PHONE_NUMBER_ID`،
`WHATSAPP_APP_SECRET`، `WHATSAPP_WEBHOOK_VERIFY_TOKEN`) ومتغيرات R2 الأربعة (الخطوة
التالية) بنفس الطريقة متى توفّرت لديك.

## 5) إنشاء bucket على Cloudflare R2

```
npx wrangler login
npx wrangler r2 bucket create pharmacy-documents
```

ثم من لوحة Cloudflare: **R2 → Manage API Tokens → Create API token**، اختر صلاحية
"Object Read & Write" مقتصرة على `pharmacy-documents`. ستظهر لك قيمتان **مرة واحدة
فقط** — انسخهما فوراً: Access Key ID وSecret Access Key. رقم حسابك (Account ID)
يظهر في نفس صفحة R2 ضمن رابط الـ S3 endpoint (`https://<ACCOUNT_ID>.r2.cloudflarestorage.com`).

```
railway variable set R2_BUCKET="pharmacy-documents"
railway variable set R2_ACCOUNT_ID="رقم-حسابك"
railway variable set R2_ACCESS_KEY_ID="القيمة-التي-نسختها"
railway variable set R2_SECRET_ACCESS_KEY="القيمة-التي-نسختها"
```

## 6) تجهيز قاعدة البيانات (من جهازك — هذه الخطوة لا تعمل من بيئة التطوير السحابية الحالية)

اجلب رابط قاعدة البيانات من Railway أولاً:

```
railway variable list --kv
```

انسخ قيمة `DATABASE_URL`، ثم على جهازك (حيث الإنترنت غير مقيَّد، بخلاف بيئة
Claude السحابية التي بُني فيها هذا الكود):

```
DATABASE_URL="القيمة-المنسوخة" npx prisma migrate dev --name init
DATABASE_URL="القيمة-المنسوخة" npx tsx prisma/seed.ts
DATABASE_URL="القيمة-المنسوخة" npx tsx prisma/real-data/seedRealBranches.ts
DATABASE_URL="القيمة-المنسوخة" psql "القيمة-المنسوخة" -f prisma/manual-sql/qty_reserved_check.sql
```

(آخر أمر يفترض وجود `psql` على جهازك؛ أي عميل Postgres آخر يعمل بنفس الملف.)

## 7) النشر

```
railway up
```

سيطبع رابط التطبيق النهائي، شكله:
```
https://app-production-55aa.up.railway.app
```

هذا هو الرابط الذي تُدخله لاحقاً في Meta كعنوان Webhook الخاص بواتساب.

## للتحديثات لاحقاً

في كل مرة يُسلَّم لك فيها كود محدَّث: فكّ الضغط فوق نفس المجلد، ثم من داخله:
```
railway up
```
فقط. متغيرات البيئة تبقى كما هي.

## ملاحظات مهمّة

- **لم يُختبر هذا النشر فعلياً من طرفي** — بيئة التطوير التي بُني فيها هذا الكود
  محظور عليها تحميل ملفات Prisma الثنائية (`binaries.prisma.sh`)، فلا يمكنها تشغيل
  `prisma generate`/`migrate` إطلاقاً (انظر قسم "Known limitation" في README) —
  لهذا الخطوة 6 أعلاه تحديداً تتم من جهازك، لا من هنا. كل شيء آخر (الكود، التبعيات،
  R2Adapter) فُحص بأدوات فحص الأنواع (`tsc --noEmit`) وأُكّد خلوّه من الأخطاء، لكن
  التشغيل الفعلي الأول يبقى مسؤوليتك حتى تؤكّد لي نجاحه.
- **ربط نطاق خاص عبر Cloudflare** (مثل `app.صيدليتك.com`) يتم لاحقاً بإضافة سجل
  CNAME في Cloudflare DNS يشير إلى رابط Railway أعلاه — خطوة مستقلة، أخبرني متى
  تريدها.
- **مفتاح Anthropic ومتغيرات واتساب سرّية** — لا تُشارك قيمها خارج فريق العمل
  الموثوق، تماماً كما هو الحال مع بيانات لوحة الصيدليات الحالية.

## واتساب عبر Kapso (بدل انتظار رقم ميتا)

1. في kapso.ai: افتح مشروعك، واصنع **API Key** (احتفظ به سراً، لا ترسله في أي محادثة).
2. في Kapso: WhatsApp → اختر الرقم (التجريبي أو الأمريكي) → **Webhooks → Add Webhook**:
   - العنوان: `https://عنوان-موقعك-على-railway/api/whatsapp/webhook`
   - الحدث: `whatsapp.message.received`
   - بعد الإنشاء انسخ **السر (secret)** الخاص بالـ webhook.
3. في Railway ضع هذه المتغيرات:

```
railway variable set KAPSO_API_KEY="المفتاح"
railway variable set KAPSO_WEBHOOK_SECRET="سر-الـ-webhook"
railway variable set WHATSAPP_PHONE_NUMBER_ID="Phone number ID كما يظهر في Kapso"
railway variable set WHATSAPP_CARELINK_PHONE_NUMBER_ID="نفس القيمة السابقة"
railway variable set KAPSO_ACT_AS_CARELINK="true"
```

(السطران الأخيران يجعلان رقم Kapso يقوم بدور رقم كير لينك مؤقتاً حتى يُعتمد الرقم الأصلي عند ميتا.)

4. لا حاجة لـ `WHATSAPP_ACCESS_TOKEN` ولا `WHATSAPP_APP_SECRET` عند استعمال Kapso.
5. التجربة: من هاتفك (المضاف كمستلم تجريبي) أرسل رسالة إلى رقم Kapso التجريبي — ستظهر المحادثة في «صندوق الواتساب» ويردّ عليها الموظف الذكي.

## ربط واتساب المباشر مع Meta (بدل Kapso)

- المتغيرات في Railway: `WHATSAPP_TOKEN` و`WHATSAPP_PHONE_NUMBER_ID` و`WHATSAPP_APP_SECRET` و`WHATSAPP_VERIFY_TOKEN`.
- `WHATSAPP_PROVIDER` اختياري: `meta` (الافتراضي) أو `kapso` لإعادة العمل بالربط القديم.
- عنوان الـ Webhook في لوحة Meta: `https://<موقعك>/api/webhook/whatsapp` (المسار القديم `/api/whatsapp/webhook` ما زال يعمل).
- الاختبار: افتح `/api/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=<WHATSAPP_VERIFY_TOKEN>&hub.challenge=12345` فيجب أن يظهر `12345`؛ وبتوكن خاطئ يظهر 403.
- الرسائل المكررة تُتجاهل، ويُرجَع 200 فوراً بعد التحقق من التوقيع ثم تُعالَج الرسالة في الخلفية.
- النشر: ملف «22 - نشر ربط واتساب ميتا.bat» (ينفّذ `railway up`).


## CareLink flow: pharmacy -> price -> delivery (Meta direct)

1. Customer writes to the CareLink number -> AI searches stock -> `request_branch_reservation` WhatsApps the pharmacy.
2. The pharmacy's reply (price) resumes the same conversation -> AI tells the customer the price.
3. On approval `create_order` + `notify_carelink_delivery` WhatsApps the delivery contact of that pharmacy
   (`Branch.specialDeliveryContactWhatsapp`; fallback table in `src/lib/deliveryContacts.ts`).
4. Messages to a number that did not write to us in the last 24h go out as approved templates
   `carelink_reservation_request` (3 vars) and `carelink_delivery_request` (4 vars) — see `sendBusinessMessage` in `src/lib/whatsapp.ts`.
5. Self-check (logged-in dashboard user): `/api/carelink/readiness`.
Variables needed: `WHATSAPP_PHONE_NUMBER_ID` (and optionally `WHATSAPP_CARELINK_PHONE_NUMBER_ID` = same id when there is only one number),
`CARELINK_CONTACT_WHATSAPP`. Deploy with `ابدأ من هنا/24 - نشر مسار كير لينك الكامل.bat`.

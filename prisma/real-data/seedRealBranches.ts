import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * REAL business data the user sent this session (an uploaded .docx: "فيما يلي لائحة بالصيدليات",
 * signed "مدير وحدة الصيدليات د. أكرم شمص") — not sample/demo data, so it's deliberately kept
 * OUT of prisma/seed.ts (which only ever creates role/permission scaffolding + one bootstrap
 * SUPER_ADMIN — see that file's own comments). Run this once, by hand, against your real
 * database when it's up:
 *
 *   npx tsx prisma/real-data/seedRealBranches.ts
 *
 * Source table (exact extraction via python-docx, column order رقم الهاتف / العنوان / اسم الصيدلية):
 *   صيدلية الرسول      | 01450194 79046726        | مبنى مستشفى الرسول
 *   صيدلية يحيى        | 05480480 / 76725839      | اول حي السلم من جهة الموقف القديم
 *   صيدلية فارماكير    | 01469220 / 76799764      | شارع الرويس
 *   صيدلية طالب        | 01545692 / 81012766      | شارع عبد النور
 *   صيدلية الجواد كير  | 08374786 / 71595850      | بعلبك - راس العين - مقابل المستشفى الحكومي
 *   صيدلية العاصي      | 81944168 (لا يوجد خط أرضي)| جسر العاصي – قرب محطة الأمانة - الهرمل
 *   Carelink ديلفري    | 79003663                  | كافة المناطق   ← NOT a branch, see note below
 *
 * `whatsappNumber` below is ONLY the mobile number from each row, in E.164 — per the user's own
 * instruction ("لا تاخذ 01 او 08، فقط أرقام الخليوي... هذه الارقام التي يجب ان يتكلم معها وكيل
 * الذكاء الاصطناعي"). The landline (01/05/08-prefixed) number, where the row had one, is kept in
 * `phone` for reference/display only — the AI agent is never meant to message that number.
 *
 * `isBekaaExclusive: true` on الجواد كير والعاصي backs the routing rule in src/lib/region.ts +
 * src/lib/aiTools.ts's assign_pharmacy/search_inventory (a Bekaa/Baalbek-Hermel-area customer's
 * order searches ONLY these two). Their real addresses (بعلبك، الهرمل) are *why* "البقاع" in the
 * user's instruction is read broadly in region.ts — see that file's top comment.
 *
 * "Carelink ديلفري" (79003663, "كافة المناطق") is deliberately NOT inserted as a Branch row — per
 * the user's confirmed answer this session, it is most likely a plain phone/WhatsApp delivery
 * contact ("كافة المناطق" = serves every area), not a pharmacy branch and not a software
 * platform with an API. It's recorded instead as a commented-out env var in .env.example
 * (CARELINK_CONTACT_WHATSAPP) pending Phase 7's real CareLink integration decision — inserting it
 * here as a Branch would misrepresent what it actually is.
 *
 * `specialDeliveryContactWhatsapp` — the user sent these afterward, one per branch: "ديلفري
 * الجواد كير" 81501394 and "ديلفري العاصي" 76324551 (both real mobile numbers, E.164 below).
 * Same reasoning as CareLink's number: a phone/WhatsApp contact a human calls to arrange
 * delivery, not an in-app `Driver` — see the schema field's own comment and
 * create_delivery's handler in src/lib/aiTools.ts for what this actually changes.
 *
 * Then the user confirmed Beirut's own delivery company: "شركة المختار", 71030940 — ONE
 * shared number across all 4 Beirut branches (الرسول، يحيى، فارماكير، طالب), unlike الجواد
 * كير/العاصي's own separate lines. Same field, same create_delivery behavior; only the label
 * is new (a company name this time, vs. no name for the other two).
 */
const REAL_BRANCHES: Array<{
  name: string;
  address: string;
  phone: string | null;
  whatsappNumber: string;
  isBekaaExclusive: boolean;
  specialDeliveryContactWhatsapp: string | null;
  specialDeliveryContactLabel: string | null;
}> = [
  {
    name: "صيدلية الرسول",
    address: "مبنى مستشفى الرسول",
    phone: "01450194",
    whatsappNumber: "+96179046726",
    isBekaaExclusive: false,
    specialDeliveryContactWhatsapp: "+96171030940",
    specialDeliveryContactLabel: "شركة المختار",
  },
  {
    name: "صيدلية يحيى",
    address: "اول حي السلم من جهة الموقف القديم",
    phone: "05480480",
    whatsappNumber: "+96176725839",
    isBekaaExclusive: false,
    specialDeliveryContactWhatsapp: "+96171030940",
    specialDeliveryContactLabel: "شركة المختار",
  },
  {
    name: "صيدلية فارماكير",
    address: "شارع الرويس",
    phone: "01469220",
    whatsappNumber: "+96176799764",
    isBekaaExclusive: false,
    specialDeliveryContactWhatsapp: "+96171030940",
    specialDeliveryContactLabel: "شركة المختار",
  },
  {
    name: "صيدلية طالب",
    address: "شارع عبد النور",
    phone: "01545692",
    whatsappNumber: "+96181012766",
    isBekaaExclusive: false,
    specialDeliveryContactWhatsapp: "+96171030940",
    specialDeliveryContactLabel: "شركة المختار",
  },
  {
    name: "صيدلية الجواد كير",
    address: "بعلبك - راس العين - مقابل المستشفى الحكومي",
    phone: "08374786",
    whatsappNumber: "+96171595850",
    isBekaaExclusive: true,
    specialDeliveryContactWhatsapp: "+96181501394",
    specialDeliveryContactLabel: null,
  },
  {
    name: "صيدلية العاصي",
    address: "جسر العاصي – قرب محطة الأمانة - الهرمل",
    phone: null,
    whatsappNumber: "+96181944168",
    isBekaaExclusive: true,
    specialDeliveryContactWhatsapp: "+96176324551",
    specialDeliveryContactLabel: null,
  },
];

async function main() {
  for (const branch of REAL_BRANCHES) {
    const existing = await prisma.branch.findUnique({ where: { whatsappNumber: branch.whatsappNumber } });
    if (existing) {
      await prisma.branch.update({
        where: { whatsappNumber: branch.whatsappNumber },
        data: {
          name: branch.name,
          address: branch.address,
          phone: branch.phone,
          isBekaaExclusive: branch.isBekaaExclusive,
          specialDeliveryContactWhatsapp: branch.specialDeliveryContactWhatsapp,
          specialDeliveryContactLabel: branch.specialDeliveryContactLabel,
        },
      });
      console.log(`Updated: ${branch.name} (${branch.whatsappNumber})`);
    } else {
      await prisma.branch.create({ data: branch });
      console.log(`Created: ${branch.name} (${branch.whatsappNumber})`);
    }
  }
  console.log(`Done — ${REAL_BRANCHES.length} real branches upserted.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

import { PrismaClient } from "@prisma/client";

/**
 * One-time (safe to re-run) setup for partner suppliers:
 *   1) creates the two tables "suppliers" and "supplier_inquiries" if they don't exist
 *      (plain idempotent SQL — nothing existing is touched or dropped);
 *   2) adds/updates the real partner "شركة لطافة" (عطور وروائح).
 *
 * Real data, from the user: Latafa's WhatsApp 009613854133 (= +9613854133); delivery goes through
 * شركة المختار (+96171030940, the same number the 4 Beirut branches already use); no stock is
 * imported ("لا داعي للمخزون منهم"); payment is settled later ("ونتحاسب لاحقا").
 *
 *   npx tsx prisma/real-data/setupSuppliers.ts
 */
const prisma = new PrismaClient();

const SQL = [
  `CREATE TABLE IF NOT EXISTS "suppliers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "whatsappNumber" TEXT NOT NULL,
    "specialty" TEXT,
    "deliveryContactWhatsapp" TEXT,
    "deliveryContactLabel" TEXT,
    "paymentTerms" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "suppliers_whatsappNumber_key" ON "suppliers"("whatsappNumber")`,
  `CREATE TABLE IF NOT EXISTS "supplier_inquiries" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "referenceCode" TEXT NOT NULL,
    "productText" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "quotedPrice" DECIMAL(10,2),
    "rawReply" TEXT,
    "deliveryAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),
    "deliveryNotifiedAt" TIMESTAMP(3),
    CONSTRAINT "supplier_inquiries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "supplier_inquiries_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "supplier_inquiries_referenceCode_key" ON "supplier_inquiries"("referenceCode")`,
  `CREATE INDEX IF NOT EXISTS "supplier_inquiries_supplierId_status_idx" ON "supplier_inquiries"("supplierId", "status")`,
  `CREATE INDEX IF NOT EXISTS "supplier_inquiries_conversationId_idx" ON "supplier_inquiries"("conversationId")`,
];

const LATAFA = {
  name: "شركة لطافة",
  whatsappNumber: "+9613854133",
  specialty: "عطور وروائح",
  deliveryContactWhatsapp: "+96171030940",
  deliveryContactLabel: "شركة المختار",
  paymentTerms: "الحساب لاحقاً",
  notes: "بدون مخزون في النظام — يُتواصل معها عند عدم توفر الصنف في الصيدليات، ثم يُرسل الديلفري (شركة المختار).",
};

async function main() {
  for (const stmt of SQL) await prisma.$executeRawUnsafe(stmt);
  console.log("الجداول جاهزة.");

  const existing = await prisma.supplier.findUnique({ where: { whatsappNumber: LATAFA.whatsappNumber } });
  if (existing) {
    await prisma.supplier.update({ where: { id: existing.id }, data: LATAFA });
    console.log("تم تحديث بيانات شركة لطافة.");
  } else {
    await prisma.supplier.create({ data: { ...LATAFA, status: "ACTIVE" } });
    console.log("تمت إضافة شركة لطافة.");
  }
  console.log("عدد الشركات الشريكة الآن:", await prisma.supplier.count());
}

main()
  .catch((e) => {
    console.error("فشل:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

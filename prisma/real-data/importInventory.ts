import { PrismaClient } from "@prisma/client";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * One-time import of the pharmacies' REAL stock (from the user's own pharmacy-unit dashboard
 * data: Stock Movement reports of 30 Sep / 1 Oct 2026 + the 19 Sep expiry/cost backup).
 *
 *   npx tsx prisma/real-data/importInventory.ts --dry   # only prints what WOULD happen
 *   npx tsx prisma/real-data/importInventory.ts         # really writes
 *
 * Rules (decided with the user):
 *  - only items with quantity > 0 were exported into inventoryData.json
 *  - price = cost value (usd ÷ qty from the expiry report) — a TEMPORARY price, NOT a selling
 *    price. Items with no known cost get price 0 = "غير مسعّر" (shown as such in the dashboard;
 *    the AI never quotes it).
 *  - safe to re-run: products are matched by normalized name, and an inventory row that already
 *    exists is NEVER overwritten (live quantities/prices are left alone).
 */
const prisma = new PrismaClient();
const DRY = process.argv.includes("--dry");

const BRANCH_WHATSAPP: Record<string, string> = {
  ras: "+96179046726",
  yahya: "+96176725839",
  pharmacare: "+96176799764",
  taleb: "+96181012766",
  jawadcare: "+96171595850",
  assi: "+96181944168",
};

type Row = [number, number, number, string | null, number]; // productIdx, qty, price, expiry, minQty
const data = JSON.parse(readFileSync(join(__dirname, "inventoryData.json"), "utf-8")) as {
  products: string[];
  branches: Record<string, Row[]>;
};

const norm = (n: string) => n.replace(/\s+/g, " ").trim().toUpperCase();
const chunks = <T,>(a: T[], n: number) => {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
};

async function main() {
  console.log(DRY ? "== تجربة فقط (لن يُكتب شيء) ==" : "== استيراد حقيقي ==");

  const branches = await prisma.branch.findMany();
  const branchId: Record<string, string> = {};
  for (const [src, wa] of Object.entries(BRANCH_WHATSAPP)) {
    const b = branches.find((x: { whatsappNumber: string | null }) => x.whatsappNumber === wa);
    if (!b) throw new Error(`الفرع (${src}) برقم ${wa} غير موجود في قاعدة البيانات — شغّل seedRealBranches أولاً.`);
    branchId[src] = b.id;
  }

  // 1) products
  const existing = await prisma.product.findMany({ select: { id: true, name: true } });
  const productId = new Map<string, string>();
  for (const p of existing as { id: string; name: string }[]) productId.set(norm(p.name), p.id);
  const toCreate = data.products.filter((n) => !productId.has(norm(n)));
  console.log(`المنتجات: ${data.products.length} في الملف، ${toCreate.length} جديدة، ${data.products.length - toCreate.length} موجودة مسبقاً`);
  if (!DRY) {
    for (const part of chunks(toCreate, 1000)) {
      await prisma.product.createMany({ data: part.map((name) => ({ name })) });
    }
    const all = await prisma.product.findMany({ select: { id: true, name: true } });
    productId.clear();
    for (const p of all as { id: string; name: string }[]) productId.set(norm(p.name), p.id);
  }

  // 2) inventory rows (+ one STOCK_IN transaction each, as an audit trail).
  // Small batches + automatic retry: the tunnel to the database sometimes drops a big request.
  async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await fn();
      } catch (e) {
        if (attempt >= 5) throw e;
        console.log(`  (${label}: انقطع الاتصال، إعادة المحاولة ${attempt}/4...)`);
        await prisma.$disconnect();
        await new Promise((r) => setTimeout(r, 2000 * attempt));
        await prisma.$connect();
      }
    }
  }

  let created = 0;
  let skipped = 0;
  for (const [src, rows] of Object.entries(data.branches)) {
    const bId = branchId[src];
    if (DRY) {
      created += rows.length;
      console.log(`  ${src}: ${rows.length} صنف`);
      continue;
    }
    const have = new Set(
      (await prisma.inventory.findMany({ where: { branchId: bId }, select: { productId: true } })).map(
        (i: { productId: string }) => i.productId
      )
    );
    const inv: any[] = [];
    for (const [pi, qty, price, expiry, minQty] of rows) {
      const pid = productId.get(norm(data.products[pi]));
      if (!pid) throw new Error("منتج مفقود: " + data.products[pi]);
      if (have.has(pid)) {
        skipped++;
        continue;
      }
      inv.push({
        id: randomUUID(),
        productId: pid,
        branchId: bId,
        qtyOnHand: qty,
        qtyReserved: 0,
        lowStockThreshold: minQty,
        price,
        expiryDate: expiry ? new Date(expiry + "T00:00:00Z") : null,
      });
    }
    for (const part of chunks(inv, 250)) {
      await withRetry(src, () => prisma.inventory.createMany({ data: part, skipDuplicates: true }));
      created += part.length;
    }
    // audit trail: a STOCK_IN transaction for every imported row that doesn't have one yet
    const importedProducts = new Set(rows.map((r) => productId.get(norm(data.products[r[0]]))!));
    const now = await withRetry<any[]>(src, () =>
      prisma.inventory.findMany({ where: { branchId: bId }, select: { id: true, productId: true, qtyOnHand: true } })
    );
    const mine = (now as { id: string; productId: string; qtyOnHand: number }[]).filter((i) => importedProducts.has(i.productId));
    const withTx = new Set(
      (
        await withRetry<any[]>(src, () =>
          prisma.inventoryTransaction.findMany({ where: { inventory: { branchId: bId } }, select: { inventoryId: true } })
        )
      ).map((t: { inventoryId: string }) => t.inventoryId)
    );
    const missing = mine.filter((i) => !withTx.has(i.id));
    for (const part of chunks(missing, 250)) {
      await withRetry(src, () =>
        prisma.inventoryTransaction.createMany({
          data: part.map((i) => ({
            inventoryId: i.id,
            type: "STOCK_IN" as const,
            qty: i.qtyOnHand,
            note: "استيراد أولي من بيانات وحدة الصيدليات (أيلول/تشرين الأول 2026)",
          })),
        })
      );
    }
    console.log(`  ${src}: ${rows.length} صنف في الملف — ${inv.length} جديد`);
  }
  console.log(`النتيجة: ${created} صف مخزون ${DRY ? "سيُنشأ" : "أُنشئ"}${skipped ? `، ${skipped} موجود مسبقاً وتُرك كما هو` : ""}.`);
}

main()
  .catch((e) => {
    console.error("فشل الاستيراد:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

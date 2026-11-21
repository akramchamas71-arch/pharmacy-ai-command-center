import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCustomerSession, unauthorized } from "@/lib/customerAuth";
import { addAppMessage, APP_ORDER_PREFIX, wakeAgent } from "@/lib/shop";
import { getLattafaItem } from "@/lib/lattafa";

const schema = z.object({
  items: z.array(z.object({ productId: z.string().min(1), qty: z.number().int().min(1).max(20) })).max(20).default([]),
  lattafa: z.array(z.object({ id: z.string().min(1), qty: z.number().int().min(1).max(20) })).max(20).default([]),
  area: z.string().trim().min(2).max(80),
  address: z.string().trim().min(3).max(300),
  name: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(500).optional(),
  prescription: z.string().optional(), // data:image/... (resized in the app)
});

export async function POST(req: NextRequest) {
  const s = getCustomerSession(req);
  if (!s) return unauthorized();
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "تحقق من الأصناف والمنطقة والعنوان." }, { status: 400 });
  const { items, lattafa, area, address, name, notes, prescription } = parsed.data;
  if (items.length + lattafa.length === 0) return NextResponse.json({ error: "السلة فارغة." }, { status: 400 });
  const lattafaLines: string[] = [];
  for (const l of lattafa) {
    const it = getLattafaItem(l.id);
    if (!it) return NextResponse.json({ error: "أحد أصناف لطافة لم يعد متوفراً في القائمة." }, { status: 400 });
    lattafaLines.push(`- ${it.brand} ${it.name} ${it.size} × ${l.qty} — سعر الزبون ${it.price}$ للقطعة (رمز ${it.code ?? it.id})`);
  }

  const products = await prisma.product.findMany({
    where: { id: { in: items.map((i) => i.productId) } },
    select: { id: true, name: true, type: true },
  });
  if (products.length !== new Set(items.map((i) => i.productId)).size) {
    return NextResponse.json({ error: "أحد الأصناف غير موجود." }, { status: 400 });
  }
  // Google Play + safety rule: no prescription medicine without a prescription; controlled drugs never online.
  if (products.some((p: { type: string }) => p.type === "CONTROLLED")) {
    return NextResponse.json({ error: "بعض الأصناف أدوية مراقَبة تُصرف حضورياً في الصيدلية فقط." }, { status: 400 });
  }
  if (products.some((p: { type: string }) => p.type === "PRESCRIPTION") && !prescription) {
    return NextResponse.json({ error: "طلبك يتضمن دواءً بوصفة طبية: الرجاء إرفاق صورة الوصفة." }, { status: 400 });
  }

  await prisma.customer.update({
    where: { id: s.customerId },
    data: { address: `${area} - ${address}`, ...(name ? { name } : {}) },
  });

  const lines = items.map((i) => {
    const p = products.find((x: { id: string }) => x.id === i.productId)!;
    return `- ${p.name} × ${i.qty} (productId: ${p.id}${p.type === "PRESCRIPTION" ? "، بوصفة — الصورة مرفقة" : ""})`;
  });
  const text = [
    APP_ORDER_PREFIX,
    `المنطقة: ${area}`,
    `العنوان: ${address}`,
    ...(lines.length ? ["الأصناف (من الصيدلية):", ...lines] : []),
    ...(lattafaLines.length ? ["أصناف شركة لطافة (السعر ثابت ومعروف):", ...lattafaLines] : []),
    notes ? `ملاحظات: ${notes}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const conversation = await addAppMessage(s.customerId, text, prescription ?? null);
    after(() => wakeAgent(conversation.id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "تعذّر إرسال الطلب" }, { status: 400 });
  }
}

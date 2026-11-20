"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "@/lib/apiClient";
import { Modal, Button, FullPageSpinner, Alert } from "@/components/ui";
import { deliveryStatusLabel, toNumber } from "@/components/deliveries/deliveryTypes";
import { paymentMethodLabel } from "@/components/orders/orderTypes";

/** Shape returned by GET /api/deliveries/[id] (see getDelivery() in src/lib/delivery.ts). */
interface InvoiceDelivery {
  id: string;
  status: string;
  amountToCollect: string | number;
  notes: string | null;
  createdAt: string;
  driver: { user: { name: string; phone: string | null } } | null;
  order: {
    orderNumber: string;
    createdAt: string;
    paymentMethod: string;
    deliveryAddress: string | null;
    notes: string | null;
    branch: { name: string; address: string | null; phone: string | null };
    customer: { name: string | null; phone: string; address: string | null };
    items: { id: string; qty: number; price: string | number; product: { name: string; brand: string | null } }[];
  };
}

function esc(s: string | null | undefined): string {
  return (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("ar-LB-u-nu-latn", { year: "numeric", month: "2-digit", day: "2-digit" }) +
    " " + d.toLocaleTimeString("ar-LB-u-nu-latn", { hour: "2-digit", minute: "2-digit" });
}

/** Lebanese numbers typed as 03xxxxxx / 81xxxxxx -> international digits for wa.me. */
function waNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("00")) return digits.slice(2);
  if (digits.startsWith("961")) return digits;
  if (digits.startsWith("0")) return "961" + digits.slice(1);
  return digits.length <= 8 ? "961" + digits : digits;
}

function computeTotals(d: InvoiceDelivery) {
  const lines = d.order.items.map((it) => {
    const price = toNumber(it.price);
    return { name: it.product.name, brand: it.product.brand, qty: it.qty, price, total: price * it.qty };
  });
  const subtotal = lines.reduce((s, l) => s + l.total, 0);
  const toCollect = toNumber(d.amountToCollect);
  // Whatever differs between the items total and the amount to collect is shown honestly
  // as an extra line (delivery fee if positive, discount if negative) — never hidden.
  const diff = Math.round((toCollect - subtotal) * 100) / 100;
  return { lines, subtotal, toCollect, diff };
}

function buildInvoiceHtml(d: InvoiceDelivery): string {
  const { lines, subtotal, toCollect, diff } = computeTotals(d);
  const o = d.order;
  const address = o.deliveryAddress || o.customer.address || "—";
  const rows = lines
    .map(
      (l, i) => `<tr>
        <td class="c">${i + 1}</td>
        <td>${esc(l.name)}${l.brand ? `<div class="sub">${esc(l.brand)}</div>` : ""}</td>
        <td class="c">${l.qty}</td>
        <td class="n">${money(l.price)}</td>
        <td class="n">${money(l.total)}</td>
      </tr>`
    )
    .join("");
  const diffRow =
    Math.abs(diff) >= 0.005
      ? `<tr><td>${diff > 0 ? "رسوم التوصيل / إضافات" : "خصم"}</td><td class="n">${diff > 0 ? "" : "−"}${money(Math.abs(diff))}</td></tr>`
      : "";

  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>فاتورة ${esc(o.orderNumber)}</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;padding:24px;font-family:Tahoma,"Segoe UI",Arial,sans-serif;color:#1d2b4f;background:#fff;font-size:14px;line-height:1.6}
  .sheet{max-width:720px;margin:0 auto}
  .head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;border-bottom:3px solid #1d2b4f;padding-bottom:12px;margin-bottom:14px}
  h1{margin:0;font-size:24px}
  .muted{color:#5b678c;font-size:12px}
  .badge{display:inline-block;border:2px solid #1d2b4f;border-radius:999px;padding:2px 12px;font-weight:700;font-size:12px;background:#ffd84d}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 24px;margin-bottom:16px}
  .box{border:1.5px solid #cfd6e8;border-radius:12px;padding:10px 12px}
  .box b{display:block;font-size:11px;color:#5b678c;margin-bottom:2px}
  table{width:100%;border-collapse:collapse;margin-bottom:12px}
  th{background:#1d2b4f;color:#fff;font-size:12px;padding:7px 8px;text-align:right}
  td{padding:7px 8px;border-bottom:1px solid #e3e8f4;vertical-align:top}
  td.c,th.c{text-align:center;width:48px}
  td.n{text-align:left;white-space:nowrap;font-variant-numeric:tabular-nums}
  .sub{font-size:11px;color:#5b678c}
  .tot{margin-inline-start:auto;width:300px;border-collapse:collapse}
  .tot td{border-bottom:1px solid #e3e8f4}
  .tot tr.grand td{font-size:17px;font-weight:800;border-top:3px solid #1d2b4f;border-bottom:0;background:#fff6cf}
  .foot{margin-top:22px;text-align:center;font-size:12px;color:#5b678c;border-top:2px dashed #cfd6e8;padding-top:10px}
  .sign{display:flex;justify-content:space-between;margin-top:28px;font-size:12px}
  .sign div{width:44%;border-top:1.5px solid #1d2b4f;padding-top:4px;text-align:center}
  @media print{body{padding:0}.sheet{max-width:none}}
</style></head><body><div class="sheet">
  <div class="head">
    <div>
      <h1>CareLink · كارلينك</h1>
      <div class="muted">فاتورة مبيعات — خدمة التوصيل</div>
    </div>
    <div style="text-align:left">
      <div class="badge">رقم الطلب: ${esc(o.orderNumber)}</div>
      <div class="muted" style="margin-top:6px">تاريخ الطلب: ${esc(fmtDate(o.createdAt))}</div>
      <div class="muted">تاريخ الإصدار: ${esc(fmtDate(new Date().toISOString()))}</div>
    </div>
  </div>
  <div class="grid">
    <div class="box"><b>الزبون</b>${esc(o.customer.name) || "—"}<div class="muted">${esc(o.customer.phone)}</div></div>
    <div class="box"><b>عنوان التوصيل</b>${esc(address)}</div>
    <div class="box"><b>السائق</b>${d.driver ? esc(d.driver.user.name) : "لم يُعيَّن بعد"}${d.driver?.user.phone ? `<div class="muted">${esc(d.driver.user.phone)}</div>` : ""}</div>
    <div class="box"><b>طريقة الدفع / حالة التوصيل</b>${esc(paymentMethodLabel(o.paymentMethod))}<div class="muted">${esc(deliveryStatusLabel(d.status))}</div></div>
  </div>
  <table>
    <thead><tr><th class="c">#</th><th>الصنف</th><th class="c">الكمية</th><th>السعر</th><th>المجموع</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="5" class="c">لا توجد أصناف</td></tr>`}</tbody>
  </table>
  <table class="tot">
    <tr><td>مجموع الأصناف</td><td class="n">${money(subtotal)}</td></tr>
    ${diffRow}
    <tr class="grand"><td>المبلغ المطلوب تحصيله</td><td class="n">${money(toCollect)}</td></tr>
  </table>
  ${o.notes || d.notes ? `<div class="box" style="margin-top:12px"><b>ملاحظات</b>${esc([o.notes, d.notes].filter(Boolean).join(" — "))}</div>` : ""}
  <div class="sign"><div>توقيع السائق</div><div>توقيع الزبون (استلمت الطلب)</div></div>
  <div class="foot">شكراً لثقتكم — نتمنى لكم دوام الصحة والعافية</div>
</div></body></html>`;
}

function buildWhatsappText(d: InvoiceDelivery): string {
  const { lines, subtotal, toCollect, diff } = computeTotals(d);
  const out: string[] = [];
  out.push(`🧾 فاتورة طلب ${d.order.orderNumber}`);
  out.push("CareLink · كارلينك");
  out.push("");
  lines.forEach((l) => out.push(`• ${l.name} × ${l.qty} = ${money(l.total)}`));
  out.push("");
  out.push(`مجموع الأصناف: ${money(subtotal)}`);
  if (Math.abs(diff) >= 0.005) out.push(`${diff > 0 ? "رسوم التوصيل / إضافات" : "خصم"}: ${money(Math.abs(diff))}`);
  out.push(`المطلوب تحصيله: ${money(toCollect)}`);
  out.push("");
  out.push("شكراً لثقتكم 💙");
  return out.join("\n");
}

export function DeliveryInvoiceModal({ deliveryId, onClose }: { deliveryId: string | null; onClose: () => void }) {
  const [data, setData] = useState<InvoiceDelivery | null>(null);
  const [error, setError] = useState<string | null>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!deliveryId) return;
    let cancelled = false;
    setData(null);
    setError(null);
    api
      .get<{ delivery: InvoiceDelivery }>(`/api/deliveries/${deliveryId}`)
      .then((r) => {
        if (!cancelled) setData(r.delivery);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof ApiError ? e.message : "تعذّر تحميل بيانات الفاتورة");
      });
    return () => {
      cancelled = true;
    };
  }, [deliveryId]);

  const html = useMemo(() => (data ? buildInvoiceHtml(data) : ""), [data]);

  function handlePrint() {
    const w = frameRef.current?.contentWindow;
    if (!w) return;
    w.focus();
    w.print();
  }

  function handleWhatsapp() {
    if (!data) return;
    const url = `https://wa.me/${waNumber(data.order.customer.phone)}?text=${encodeURIComponent(buildWhatsappText(data))}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <Modal open={!!deliveryId} onClose={onClose} title="فاتورة الزبون" width="max-w-3xl">
      {error ? (
        <Alert tone="danger">{error}</Alert>
      ) : !data ? (
        <FullPageSpinner label="جارِ تجهيز الفاتورة..." />
      ) : (
        <div className="space-y-4">
          <iframe
            ref={frameRef}
            title="معاينة الفاتورة"
            srcDoc={html}
            className="h-[60vh] w-full rounded-2xl border-2 border-slate-300 bg-white"
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              إغلاق
            </Button>
            <Button variant="outline" onClick={handleWhatsapp}>
              إرسال للزبون عبر واتساب
            </Button>
            <Button onClick={handlePrint}>🖨️ طباعة / حفظ PDF</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/apiClient";
import { useCurrentUser } from "@/lib/userContext";
import { Modal, Button, Input, Select, Textarea, Field, Alert, FullPageSpinner } from "@/components/ui";
import { PAYMENT_METHOD_LABELS_AR } from "@/components/orders/orderTypes";

interface InventoryRow {
  id: string;
  productId: string;
  branchId: string;
  qtyOnHand: number;
  qtyReserved: number;
  /** Prisma Decimal serializes as a string. */
  price: string | number;
  product: { id: string; name: string; brand: string | null; barcode: string | null };
}

interface BranchRow {
  id: string;
  name: string;
}

interface CartLine {
  productId: string;
  name: string;
  price: number;
  available: number;
  qty: number;
}

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

/**
 * Lets a pharmacy employee register an order by hand (phone call / customer at the counter)
 * — the same POST /api/orders the AI uses, so stock is reserved and prices are locked in
 * server-side. The prices shown here are only a preview; the server re-reads them.
 */
export function NewOrderModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: () => void }) {
  const user = useCurrentUser();
  const router = useRouter();

  const [branches, setBranches] = useState<BranchRow[] | null>(null);
  const [branchId, setBranchId] = useState<string>(user.branch?.id ?? "");
  const [inventory, setInventory] = useState<InventoryRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("CASH_ON_DELIVERY");
  const [notes, setNotes] = useState("");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Reset the form every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setPhone("");
    setName("");
    setAddress("");
    setPaymentMethod("CASH_ON_DELIVERY");
    setNotes("");
    setSearch("");
    setCart([]);
    setSaveError(null);
    setBranchId(user.branch?.id ?? "");
  }, [open, user.branch?.id]);

  // Network-wide roles pick a branch; branch-scoped roles are fixed to theirs.
  useEffect(() => {
    if (!open || user.branch) return;
    let cancelled = false;
    api
      .get<{ branches: BranchRow[] }>("/api/branches")
      .then((r) => {
        if (!cancelled) setBranches(r.branches);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof ApiError ? e.message : "تعذّر تحميل الفروع");
      });
    return () => {
      cancelled = true;
    };
  }, [open, user.branch]);

  // Load that branch's stock (with prices) once; searching is then instant and local.
  useEffect(() => {
    if (!open || !branchId) {
      setInventory(null);
      return;
    }
    let cancelled = false;
    setInventory(null);
    setLoadError(null);
    setCart([]);
    api
      .get<{ inventory: InventoryRow[] }>(`/api/inventory?branchId=${encodeURIComponent(branchId)}`)
      .then((r) => {
        if (!cancelled) setInventory(r.inventory);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof ApiError ? e.message : "تعذّر تحميل أصناف الفرع");
      });
    return () => {
      cancelled = true;
    };
  }, [open, branchId]);

  const results = useMemo(() => {
    if (!inventory) return [];
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return inventory
      .filter(
        (r) =>
          r.product.name.toLowerCase().includes(q) ||
          (r.product.brand ?? "").toLowerCase().includes(q) ||
          (r.product.barcode ?? "").toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [inventory, search]);

  const total = cart.reduce((s, l) => s + l.price * l.qty, 0);
  const phoneOk = phone.replace(/\D/g, "").length >= 3;
  const canSave = !!branchId && phoneOk && cart.length > 0 && !saving;

  function addToCart(row: InventoryRow) {
    const available = row.qtyOnHand - row.qtyReserved;
    setCart((prev) => {
      const existing = prev.find((l) => l.productId === row.productId);
      if (existing) {
        return prev.map((l) => (l.productId === row.productId ? { ...l, qty: Math.min(l.qty + 1, Math.max(available, 1)) } : l));
      }
      return [...prev, { productId: row.productId, name: row.product.name, price: Number(row.price), available, qty: 1 }];
    });
    setSearch("");
  }

  function setQty(productId: string, qty: number) {
    setCart((prev) => prev.map((l) => (l.productId === productId ? { ...l, qty: Math.max(1, Math.floor(qty) || 1) } : l)));
  }

  function removeLine(productId: string) {
    setCart((prev) => prev.filter((l) => l.productId !== productId));
  }

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await api.post<{ order: { id: string } }>("/api/orders", {
        branchId,
        customerPhone: phone.trim(),
        ...(name.trim() ? { customerName: name.trim() } : {}),
        ...(address.trim() ? { deliveryAddress: address.trim() } : {}),
        paymentMethod,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        items: cart.map((l) => ({ productId: l.productId, qty: l.qty })),
      });
      onCreated?.();
      onClose();
      router.push(`/dashboard/orders/${res.order.id}`);
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : "تعذّر حفظ الطلب");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="طلب جديد" width="max-w-2xl">
      <div className="space-y-4">
        {loadError && <Alert tone="danger">{loadError}</Alert>}

        {!user.branch && (
          <Field label="الفرع">
            <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">اختر الفرع</option>
              {(branches ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="رقم هاتف الزبون *">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="مثال: 03123456" dir="ltr" />
          </Field>
          <Field label="اسم الزبون">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="اختياري" />
          </Field>
        </div>

        <Field label="عنوان التوصيل" hint="إن تُرك فارغاً يُستعمل عنوان الزبون المحفوظ سابقاً">
          <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="المنطقة، الشارع، البناية" />
        </Field>

        <div>
          <span className="mb-1.5 block text-xs font-bold text-slate-700">الأصناف *</span>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={branchId ? "ابحث بالاسم أو الباركود ثم اضغط على الصنف لإضافته" : "اختر الفرع أولاً"}
            disabled={!branchId || !inventory}
          />
          {branchId && !inventory && !loadError && <FullPageSpinner label="جارِ تحميل أصناف الفرع..." />}
          {search.trim() && inventory && (
            <div className="mt-2 overflow-hidden rounded-2xl border-2 border-slate-300 bg-white">
              {results.length === 0 ? (
                <div className="px-3.5 py-3 text-sm text-slate-500">لا يوجد صنف بهذا الاسم في مخزون الفرع</div>
              ) : (
                results.map((r) => {
                  const available = r.qtyOnHand - r.qtyReserved;
                  const out = available <= 0;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      disabled={out}
                      onClick={() => addToCart(r)}
                      className="flex w-full items-center justify-between gap-3 border-b border-slate-200 px-3.5 py-2 text-right text-sm last:border-b-0 hover:bg-sun/30 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span>
                        <span className="font-semibold text-slate-900">{r.product.name}</span>
                        {r.product.brand && <span className="mr-2 text-xs text-slate-500">{r.product.brand}</span>}
                      </span>
                      <span className="whitespace-nowrap text-xs text-slate-600">
                        {money(Number(r.price))} · {out ? "نفد من المخزون" : `المتوفر ${available}`}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>

        {cart.length > 0 && (
          <div className="overflow-x-auto rounded-2xl border-2 border-slate-300">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-100 text-xs text-slate-600">
                  <th className="px-3 py-2 text-right">الصنف</th>
                  <th className="px-3 py-2 text-center">الكمية</th>
                  <th className="px-3 py-2 text-left">السعر</th>
                  <th className="px-3 py-2 text-left">المجموع</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {cart.map((l) => (
                  <tr key={l.productId} className="border-t border-slate-200">
                    <td className="px-3 py-2 font-semibold">
                      {l.name}
                      {l.qty > l.available && <div className="text-xs font-normal text-rose-600">المتوفر {l.available} فقط</div>}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="number"
                        min={1}
                        value={l.qty}
                        onChange={(e) => setQty(l.productId, Number(e.target.value))}
                        aria-label={`كمية ${l.name}`}
                        className="w-16 rounded-xl border-2 border-slate-300 px-2 py-1 text-center"
                      />
                    </td>
                    <td className="px-3 py-2 text-left tabular-nums">{money(l.price)}</td>
                    <td className="px-3 py-2 text-left font-bold tabular-nums">{money(l.price * l.qty)}</td>
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        onClick={() => removeLine(l.productId)}
                        aria-label={`حذف ${l.name}`}
                        className="rounded-full px-2 py-1 text-slate-500 hover:bg-rose-50 hover:text-rose-600"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-ink bg-sun/40">
                  <td colSpan={3} className="px-3 py-2 font-bold">
                    المجموع التقريبي
                  </td>
                  <td className="px-3 py-2 text-left font-extrabold tabular-nums">{money(total)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="طريقة الدفع">
            <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
              {Object.entries(PAYMENT_METHOD_LABELS_AR).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="ملاحظات">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={1} placeholder="اختياري" />
          </Field>
        </div>

        {saveError && <Alert tone="danger">{saveError}</Alert>}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-slate-500">عند الحفظ يُحجز الصنف من المخزون ويبدأ الطلب بحالة «بانتظار التأكيد».</span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              إلغاء
            </Button>
            <Button onClick={handleSave} loading={saving} disabled={!canSave}>
              حفظ الطلب
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

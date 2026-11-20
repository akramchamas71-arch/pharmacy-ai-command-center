"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/apiClient";
import { Modal, Field, Input, Button, Alert } from "@/components/ui";
import type { InventoryItem } from "./types";

/**
 * POST /api/inventory sets price / lowStockThreshold / expiryDate for an existing
 * product-at-branch row (it never touches qtyOnHand — see AdjustQtyModal for that). The
 * route's zod schema requires `price` on every call, even when only the threshold or expiry
 * is actually changing, so this form always resubmits the current price alongside whichever
 * field was edited.
 *
 * A price CHANGE on an existing row additionally requires PRICING_WRITE server-side (on top
 * of INVENTORY_WRITE) — see src/app/api/inventory/route.ts's POST handler. Both permissions
 * fail with the same generic 403 message, so the only way to tell them apart client-side is
 * to know, before calling, whether the price actually changed.
 */
export function EditMetaModal({
  open,
  onClose,
  item,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  item: InventoryItem | null;
  onSaved: (item: InventoryItem) => void;
}) {
  const [price, setPrice] = useState("");
  const [threshold, setThreshold] = useState("");
  const [expiry, setExpiry] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !item) return;
    setPrice(String(Number(item.price)));
    setThreshold(String(item.lowStockThreshold));
    setExpiry(item.expiryDate ? item.expiryDate.slice(0, 10) : "");
    setError(null);
  }, [open, item]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!item) return;

    const priceNum = Number(price);
    if (!price.trim() || Number.isNaN(priceNum) || priceNum < 0) {
      setError("أدخل سعرًا صالحًا (رقم أكبر من أو يساوي الصفر)");
      return;
    }
    const thresholdNum = threshold.trim() ? Number(threshold) : undefined;
    if (thresholdNum !== undefined && (!Number.isInteger(thresholdNum) || thresholdNum < 0)) {
      setError("حد التنبيه يجب أن يكون عددًا صحيحًا أكبر من أو يساوي الصفر");
      return;
    }

    const priceChanged = priceNum !== Number(item.price);

    setSaving(true);
    setError(null);
    try {
      const result = await api.post<{ inventory: InventoryItem }>("/api/inventory", {
        productId: item.productId,
        branchId: item.branchId,
        price: priceNum,
        lowStockThreshold: thresholdNum,
        expiryDate: expiry ? new Date(`${expiry}T00:00:00.000Z`).toISOString() : null,
      });
      onSaved({ ...item, ...result.inventory });
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 403 && priceChanged) {
        setError("تغيير السعر يحتاج صلاحية إضافية (PRICING_WRITE) غير متوفرة لحسابك");
      } else {
        setError(e instanceof ApiError ? e.message : "حدث خطأ غير متوقع");
      }
    } finally {
      setSaving(false);
    }
  }

  if (!item) return null;

  return (
    <Modal open={open} onClose={onClose} title={`تعديل السعر / الحد / الانتهاء — ${item.product.name}`} width="max-w-md">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="السعر" htmlFor="meta-price">
          <Input id="meta-price" type="number" step="0.01" min="0" value={price} onChange={(e) => setPrice(e.target.value)} required />
        </Field>
        <Field label="حد التنبيه (الكمية المنخفضة)" htmlFor="meta-threshold">
          <Input
            id="meta-threshold"
            type="number"
            step="1"
            min="0"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
          />
        </Field>
        <Field label="تاريخ الانتهاء (اختياري)" htmlFor="meta-expiry" hint="اتركه فارغًا لإزالة تاريخ الانتهاء">
          <Input id="meta-expiry" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            إلغاء
          </Button>
          <Button type="submit" loading={saving}>
            حفظ
          </Button>
        </div>
      </form>
    </Modal>
  );
}

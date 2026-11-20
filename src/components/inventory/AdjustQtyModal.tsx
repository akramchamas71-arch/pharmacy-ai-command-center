"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/apiClient";
import { Modal, Field, Input, Select, Textarea, Button, Alert } from "@/components/ui";
import type { InventoryItem, ManualInventoryTxType } from "./types";
import { MANUAL_TX_TYPES, INVENTORY_TX_TYPE_LABELS_AR } from "./types";

/**
 * POST /api/inventory/adjust is the only route that ever changes qtyOnHand — see
 * src/lib/inventory.ts's adjustInventory(). `deltaQty` is a signed integer the caller enters
 * directly (positive adds stock, negative removes it); the `type` is just the audit-trail
 * label for *why*, so a human can e.g. pick STOCK_OUT with a negative deltaQty for a loss, or
 * ADJUSTMENT with either sign for a manual recount correction.
 */
export function AdjustQtyModal({
  open,
  onClose,
  item,
  onAdjusted,
}: {
  open: boolean;
  onClose: () => void;
  item: InventoryItem | null;
  onAdjusted: (item: InventoryItem) => void;
}) {
  const [type, setType] = useState<ManualInventoryTxType>("STOCK_IN");
  const [deltaQty, setDeltaQty] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setType("STOCK_IN");
    setDeltaQty("");
    setNote("");
    setError(null);
  }, [open, item]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!item) return;
    const delta = Number(deltaQty);
    if (!deltaQty.trim() || !Number.isInteger(delta) || delta === 0) {
      setError("أدخل كمية صحيحة (عدد صحيح) ومختلفة عن الصفر — استخدم رقمًا سالبًا للإنقاص");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await api.post<{ inventory: InventoryItem }>("/api/inventory/adjust", {
        inventoryId: item.id,
        type,
        deltaQty: delta,
        note: note.trim() || undefined,
      });
      onAdjusted({ ...item, ...result.inventory });
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "حدث خطأ غير متوقع");
    } finally {
      setSaving(false);
    }
  }

  if (!item) return null;

  return (
    <Modal open={open} onClose={onClose} title={`تعديل الكمية — ${item.product.name}`} width="max-w-md">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <p className="text-xs text-slate-400">
          الكمية الحالية: <span className="font-semibold text-slate-600">{item.qtyOnHand}</span> ({item.branch.name})
        </p>
        <Field label="نوع العملية" htmlFor="adjust-type">
          <Select id="adjust-type" value={type} onChange={(e) => setType(e.target.value as ManualInventoryTxType)}>
            {MANUAL_TX_TYPES.map((t) => (
              <option key={t} value={t}>
                {INVENTORY_TX_TYPE_LABELS_AR[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="الكمية (+ للزيادة، - للإنقاص)" htmlFor="adjust-delta" hint="مثال: 20 لإضافة 20 وحدة، أو -5 لإنقاص 5 وحدات">
          <Input
            id="adjust-delta"
            type="number"
            step="1"
            value={deltaQty}
            onChange={(e) => setDeltaQty(e.target.value)}
            placeholder="0"
            required
          />
        </Field>
        <Field label="ملاحظة (اختياري)" htmlFor="adjust-note">
          <Textarea id="adjust-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            إلغاء
          </Button>
          <Button type="submit" loading={saving}>
            تأكيد التعديل
          </Button>
        </div>
      </form>
    </Modal>
  );
}

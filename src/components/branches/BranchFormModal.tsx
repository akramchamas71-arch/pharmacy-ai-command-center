"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/apiClient";
import { Modal, Field, Input, Button, Alert } from "@/components/ui";
import type { Branch } from "./types";

export interface BranchFormValues {
  name: string;
  address: string;
  phone: string;
  whatsappNumber: string;
  workingHours: string;
}

const EMPTY_FORM: BranchFormValues = {
  name: "",
  address: "",
  phone: "",
  whatsappNumber: "",
  workingHours: "",
};

/**
 * Create/edit modal for a branch. Only exposes the fields POST/PATCH /api/branches actually
 * accept (name/address/phone/whatsappNumber/workingHours). `isBekaaExclusive` and the
 * specialDeliveryContact* fields are deliberately NOT editable here — neither the create nor
 * the update zod schema on the server accepts them, so this page only ever displays them
 * (see the badges in page.tsx); there is currently no backend route to change them from the UI.
 */
export function BranchFormModal({
  open,
  onClose,
  branch,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  branch: Branch | null;
  onSaved: (branch: Branch) => void;
}) {
  const [form, setForm] = useState<BranchFormValues>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(
      branch
        ? {
            name: branch.name,
            address: branch.address ?? "",
            phone: branch.phone ?? "",
            whatsappNumber: branch.whatsappNumber ?? "",
            workingHours: branch.workingHours ?? "",
          }
        : EMPTY_FORM
    );
  }, [open, branch]);

  function setField<K extends keyof BranchFormValues>(key: K, value: BranchFormValues[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError("اسم الفرع مطلوب");
      return;
    }
    setSaving(true);
    setError(null);
    const payload = {
      name: form.name.trim(),
      address: form.address.trim() || null,
      phone: form.phone.trim() || null,
      whatsappNumber: form.whatsappNumber.trim() || null,
      workingHours: form.workingHours.trim() || null,
    };
    try {
      const result = branch
        ? await api.patch<{ branch: Branch }>(`/api/branches/${branch.id}`, payload)
        : await api.post<{ branch: Branch }>("/api/branches", payload);
      onSaved(result.branch);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "حدث خطأ غير متوقع");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={branch ? "تعديل بيانات الفرع" : "فرع جديد"}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="اسم الفرع" htmlFor="branch-name">
          <Input
            id="branch-name"
            value={form.name}
            onChange={(e) => setField("name", e.target.value)}
            placeholder="مثال: صيدلية الرسول"
            required
          />
        </Field>
        <Field label="العنوان" htmlFor="branch-address">
          <Input
            id="branch-address"
            value={form.address}
            onChange={(e) => setField("address", e.target.value)}
            placeholder="العنوان الكامل للفرع"
          />
        </Field>
        <Field label="رقم الهاتف" htmlFor="branch-phone">
          <Input
            id="branch-phone"
            value={form.phone}
            onChange={(e) => setField("phone", e.target.value)}
            placeholder="مثال: 01234567"
          />
        </Field>
        <Field label="رقم واتساب" htmlFor="branch-whatsapp" hint="رقم واتساب الفرع الرسمي">
          <Input
            id="branch-whatsapp"
            value={form.whatsappNumber}
            onChange={(e) => setField("whatsappNumber", e.target.value)}
            placeholder="مثال: 96170123456"
          />
        </Field>
        <Field label="ساعات العمل" htmlFor="branch-hours">
          <Input
            id="branch-hours"
            value={form.workingHours}
            onChange={(e) => setField("workingHours", e.target.value)}
            placeholder="مثال: يوميًا من 8 صباحًا حتى 10 مساءً"
          />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            إلغاء
          </Button>
          <Button type="submit" loading={saving}>
            {branch ? "حفظ التعديلات" : "إضافة الفرع"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

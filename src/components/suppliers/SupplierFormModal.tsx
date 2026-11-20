"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/apiClient";
import { Modal, Field, Input, Textarea, Button, Alert } from "@/components/ui";
import type { Supplier } from "./types";

interface FormValues {
  name: string;
  whatsappNumber: string;
  specialty: string;
  deliveryContactWhatsapp: string;
  deliveryContactLabel: string;
  paymentTerms: string;
  notes: string;
}

const EMPTY: FormValues = {
  name: "",
  whatsappNumber: "",
  specialty: "",
  deliveryContactWhatsapp: "",
  deliveryContactLabel: "",
  paymentTerms: "",
  notes: "",
};

export function SupplierFormModal({
  open,
  onClose,
  supplier,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  supplier: Supplier | null;
  onSaved: (supplier: Supplier) => void;
}) {
  const [form, setForm] = useState<FormValues>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(
      supplier
        ? {
            name: supplier.name,
            whatsappNumber: supplier.whatsappNumber,
            specialty: supplier.specialty ?? "",
            deliveryContactWhatsapp: supplier.deliveryContactWhatsapp ?? "",
            deliveryContactLabel: supplier.deliveryContactLabel ?? "",
            paymentTerms: supplier.paymentTerms ?? "",
            notes: supplier.notes ?? "",
          }
        : EMPTY
    );
  }, [open, supplier]);

  function setField<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.whatsappNumber.trim()) {
      setError("اسم الشركة ورقم واتساب مطلوبان");
      return;
    }
    setSaving(true);
    setError(null);
    const payload = {
      name: form.name.trim(),
      whatsappNumber: form.whatsappNumber.trim(),
      specialty: form.specialty.trim() || null,
      deliveryContactWhatsapp: form.deliveryContactWhatsapp.trim() || null,
      deliveryContactLabel: form.deliveryContactLabel.trim() || null,
      paymentTerms: form.paymentTerms.trim() || null,
      notes: form.notes.trim() || null,
    };
    try {
      const result = supplier
        ? await api.patch<{ supplier: Supplier }>(`/api/suppliers/${supplier.id}`, payload)
        : await api.post<{ supplier: Supplier }>("/api/suppliers", payload);
      onSaved(result.supplier);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "حدث خطأ غير متوقع");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={supplier ? "تعديل بيانات الشركة" : "شركة شريكة جديدة"}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="اسم الشركة" htmlFor="sup-name">
          <Input id="sup-name" value={form.name} onChange={(e) => setField("name", e.target.value)} required />
        </Field>
        <Field label="رقم واتساب الشركة" htmlFor="sup-wa" hint="يمكن كتابته بأي صيغة، مثل 009613854133">
          <Input id="sup-wa" value={form.whatsappNumber} onChange={(e) => setField("whatsappNumber", e.target.value)} required />
        </Field>
        <Field label="ماذا تبيع الشركة؟" htmlFor="sup-spec" hint="يقرؤها الذكاء الاصطناعي ليعرف متى يسألها (مثال: عطور وروائح)">
          <Input id="sup-spec" value={form.specialty} onChange={(e) => setField("specialty", e.target.value)} />
        </Field>
        <Field label="رقم واتساب شركة التوصيل" htmlFor="sup-del">
          <Input id="sup-del" value={form.deliveryContactWhatsapp} onChange={(e) => setField("deliveryContactWhatsapp", e.target.value)} />
        </Field>
        <Field label="اسم شركة التوصيل" htmlFor="sup-dellabel">
          <Input id="sup-dellabel" value={form.deliveryContactLabel} onChange={(e) => setField("deliveryContactLabel", e.target.value)} placeholder="مثال: شركة المختار" />
        </Field>
        <Field label="شروط الدفع" htmlFor="sup-pay">
          <Input id="sup-pay" value={form.paymentTerms} onChange={(e) => setField("paymentTerms", e.target.value)} placeholder="مثال: الحساب لاحقاً" />
        </Field>
        <Field label="ملاحظات" htmlFor="sup-notes">
          <Textarea id="sup-notes" rows={3} value={form.notes} onChange={(e) => setField("notes", e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            إلغاء
          </Button>
          <Button type="submit" loading={saving}>
            {supplier ? "حفظ التعديلات" : "إضافة الشركة"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

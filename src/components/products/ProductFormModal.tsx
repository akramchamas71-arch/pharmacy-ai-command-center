"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/apiClient";
import { Modal, Field, Input, Select, Button, Alert } from "@/components/ui";
import type { Product, ProductType } from "./types";
import { PRODUCT_TYPE_LABELS_AR } from "./types";

interface FormValues {
  name: string;
  brand: string;
  barcode: string;
  genericName: string;
  activeIngredient: string;
  category: string;
  type: ProductType;
  imageUrl: string;
}

const EMPTY_FORM: FormValues = {
  name: "",
  brand: "",
  barcode: "",
  genericName: "",
  activeIngredient: "",
  category: "",
  type: "OTC",
  imageUrl: "",
};

const PRODUCT_TYPES: ProductType[] = ["OTC", "PRESCRIPTION", "CONTROLLED", "COSMETIC"];

export function ProductFormModal({
  open,
  onClose,
  product,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  product: Product | null;
  onSaved: (product: Product) => void;
}) {
  const [form, setForm] = useState<FormValues>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(
      product
        ? {
            name: product.name,
            brand: product.brand ?? "",
            barcode: product.barcode ?? "",
            genericName: product.genericName ?? "",
            activeIngredient: product.activeIngredient ?? "",
            category: product.category ?? "",
            type: product.type,
            imageUrl: product.imageUrl ?? "",
          }
        : EMPTY_FORM
    );
  }, [open, product]);

  function setField<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError("اسم المنتج مطلوب");
      return;
    }
    setSaving(true);
    setError(null);
    const payload = {
      name: form.name.trim(),
      brand: form.brand.trim() || null,
      barcode: form.barcode.trim() || null,
      genericName: form.genericName.trim() || null,
      activeIngredient: form.activeIngredient.trim() || null,
      category: form.category.trim() || null,
      type: form.type,
      imageUrl: form.imageUrl.trim() || null,
    };
    try {
      const result = product
        ? await api.patch<{ product: Product }>(`/api/products/${product.id}`, payload)
        : await api.post<{ product: Product }>("/api/products", payload);
      onSaved(result.product);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "حدث خطأ غير متوقع");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={product ? "تعديل منتج" : "منتج جديد"}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="اسم المنتج" htmlFor="product-name">
          <Input
            id="product-name"
            value={form.name}
            onChange={(e) => setField("name", e.target.value)}
            placeholder="مثال: بندول أدفانس"
            required
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="الماركة" htmlFor="product-brand">
            <Input id="product-brand" value={form.brand} onChange={(e) => setField("brand", e.target.value)} />
          </Field>
          <Field label="الباركود" htmlFor="product-barcode">
            <Input id="product-barcode" value={form.barcode} onChange={(e) => setField("barcode", e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="الاسم العلمي (Generic)" htmlFor="product-generic">
            <Input
              id="product-generic"
              value={form.genericName}
              onChange={(e) => setField("genericName", e.target.value)}
            />
          </Field>
          <Field label="المادة الفعالة" htmlFor="product-active">
            <Input
              id="product-active"
              value={form.activeIngredient}
              onChange={(e) => setField("activeIngredient", e.target.value)}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="الفئة / التصنيف الحر" htmlFor="product-category">
            <Input id="product-category" value={form.category} onChange={(e) => setField("category", e.target.value)} />
          </Field>
          <Field label="نوع المنتج" htmlFor="product-type">
            <Select
              id="product-type"
              value={form.type}
              onChange={(e) => setField("type", e.target.value as ProductType)}
            >
              {PRODUCT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {PRODUCT_TYPE_LABELS_AR[t]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="رابط صورة المنتج (اختياري)" htmlFor="product-image">
          <Input id="product-image" value={form.imageUrl} onChange={(e) => setField("imageUrl", e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            إلغاء
          </Button>
          <Button type="submit" loading={saving}>
            {product ? "حفظ التعديلات" : "إضافة المنتج"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

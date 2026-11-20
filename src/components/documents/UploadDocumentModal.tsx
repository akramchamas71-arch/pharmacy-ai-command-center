"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/apiClient";
import { Modal, Button, Field, Input, Select, Alert } from "@/components/ui";
import { OWNER_TYPES, ownerTypeLabel, type DocumentRow } from "./types";

/** Reads a File into a base64 string (no "data:...;base64," prefix), entirely client-side —
 * the upload route takes `contentBase64` in the JSON body since there's no multipart form
 * handling on the server (see src/app/api/documents/route.ts's own comment). */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("فشل قراءة الملف"));
        return;
      }
      const commaIndex = result.indexOf(",");
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("فشل قراءة الملف"));
    reader.readAsDataURL(file);
  });
}

export function UploadDocumentModal({
  open,
  onClose,
  onUploaded,
}: {
  open: boolean;
  onClose: () => void;
  onUploaded: (doc: DocumentRow) => void;
}) {
  const [ownerType, setOwnerType] = useState<string>("general");
  const [ownerId, setOwnerId] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setOwnerType("general");
    setOwnerId("");
    setTagsText("");
    setFile(null);
    setError(null);
  }

  function handleClose() {
    if (submitting) return;
    reset();
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("الرجاء اختيار ملف للرفع");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const contentBase64 = await fileToBase64(file);
      const tags = tagsText
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      const res = await api.post<{ document: DocumentRow }>("/api/documents", {
        ownerType,
        ownerId: ownerId.trim() ? ownerId.trim() : null,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        contentBase64,
        tags: tags.length > 0 ? tags : undefined,
      });
      onUploaded(res.document);
      reset();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "حدث خطأ غير متوقع أثناء رفع المستند");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="رفع مستند جديد">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}

        <Field label="نوع المالك">
          <Select value={ownerType} onChange={(e) => setOwnerType(e.target.value)} disabled={submitting}>
            {OWNER_TYPES.map((t) => (
              <option key={t} value={t}>
                {ownerTypeLabel(t)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="معرّف المالك (اختياري)" hint="مثال: رقم الطلب أو معرّف العميل — اتركه فارغاً للمستندات العامة">
          <Input value={ownerId} onChange={(e) => setOwnerId(e.target.value)} disabled={submitting} />
        </Field>

        <Field label="الملف">
          <input
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            disabled={submitting}
            className="block w-full text-sm text-slate-600 file:ml-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-brand-700 hover:file:bg-brand-100"
          />
        </Field>

        <Field label="كلمات مفتاحية (اختياري)" hint="اكتب عدة كلمات مفصولة بفاصلة , مثال: عاجل, فرع المعادي">
          <Input value={tagsText} onChange={(e) => setTagsText(e.target.value)} disabled={submitting} />
        </Field>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={handleClose} disabled={submitting}>
            إلغاء
          </Button>
          <Button type="submit" loading={submitting} disabled={submitting}>
            رفع المستند
          </Button>
        </div>
      </form>
    </Modal>
  );
}

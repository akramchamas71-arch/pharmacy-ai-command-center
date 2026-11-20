"use client";

import { Modal, Badge } from "@/components/ui";
import { categoryLabel, type DocumentRow } from "./types";

export function AnalyzeResultModal({
  open,
  onClose,
  document,
}: {
  open: boolean;
  onClose: () => void;
  document: DocumentRow | null;
}) {
  const metadata = (document?.metadata ?? {}) as Record<string, unknown>;
  const category = typeof metadata.category === "string" ? metadata.category : null;
  const extractedText = typeof metadata.extractedText === "string" ? metadata.extractedText : "";
  const confidence = typeof metadata.ocrConfidence === "number" ? metadata.ocrConfidence : null;

  return (
    <Modal open={open} onClose={onClose} title="نتيجة التحليل بالذكاء الاصطناعي (OCR)" width="max-w-2xl">
      {!document ? (
        <p className="text-sm text-slate-400">لا توجد نتيجة لعرضها</p>
      ) : (
        <div className="space-y-4">
          <p className="text-sm font-semibold text-slate-700">{document.fileName}</p>

          <div className="flex flex-wrap items-center gap-2">
            {category && <Badge tone="brand">{categoryLabel(category) ?? category}</Badge>}
            {confidence !== null && (
              <Badge tone={confidence >= 0.7 ? "success" : confidence >= 0.4 ? "warning" : "danger"}>
                نسبة الثقة: {(confidence * 100).toFixed(0)}٪
              </Badge>
            )}
          </div>

          <div>
            <p className="mb-1.5 text-xs font-semibold text-slate-600">النص المستخرج</p>
            <div className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-2xl border-2 border-slate-300 bg-slate-50 p-3 text-sm text-slate-700">
              {extractedText || "لم يتم استخراج أي نص"}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

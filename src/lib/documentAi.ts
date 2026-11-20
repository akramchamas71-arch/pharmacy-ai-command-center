import { prisma } from "@/lib/prisma";
import { BusinessRuleError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { getDocument } from "@/lib/documents";
import { getStorageAdapter } from "@/lib/storage";
import { callMessagesApi, AnthropicContentBlock } from "@/lib/anthropic";
import { Prisma } from "@prisma/client";

/**
 * The "OCR عند الحاجة" (OCR when needed) + "تصنيف" (classification) half of Phase 8. The
 * plan doc names Document AI's job but not an OCR vendor — unlike file storage, this was
 * never listed as its own open decision, so rather than inventing a new one (a dedicated
 * OCR API this project has no budget/account for), this reuses the Anthropic integration
 * Phase 5 already identified as the project's one LLM provider (src/lib/anthropic.ts) via
 * its vision/document input support. That's an interpretation call, flagged here exactly
 * like reserve_product/assign_pharmacy/create_delivery were flagged in the Phase 5 prep —
 * if you'd rather use a dedicated OCR service, this is the one function to swap.
 *
 * UNTESTED, same as everything else that calls src/lib/anthropic.ts: there is no
 * ANTHROPIC_API_KEY in this sandbox. Treat this as reviewed scaffolding until it's run
 * once for real.
 */

export const DOCUMENT_CATEGORIES = [
  "PRESCRIPTION",
  "INVOICE",
  "ID_DOCUMENT",
  "INSURANCE",
  "LAB_RESULT",
  "OTHER",
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

// Anthropic's documented vision input formats as of this writing — re-verify against
// https://docs.claude.com before relying on this list, since it's exactly the kind of
// detail that changes between model/API versions and this has never run for real here.
const SUPPORTED_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"];

const CLASSIFY_SYSTEM_PROMPT = `أنت نظام تصنيف واستخراج نص لمستندات صيدلية. يصلك مستند واحد (صورة أو PDF).
أعد رداً بصيغة JSON فقط (بلا أي نص إضافي قبله أو بعده)، بالشكل التالي بالضبط:
{"category": "PRESCRIPTION|INVOICE|ID_DOCUMENT|INSURANCE|LAB_RESULT|OTHER", "extractedText": "كل النص المقروء في المستند", "confidence": 0.0 to 1.0}
اختر "OTHER" إن لم ينطبق أي تصنيف آخر بوضوح. استخرج النص كما هو دون ترجمة أو تلخيص.`;

export interface ClassifyResult {
  category: DocumentCategory;
  extractedText: string;
  confidence: number;
}

function blockTypeForMime(mimeType: string): "image" | "document" {
  return mimeType === "application/pdf" ? "document" : "image";
}

function extractJson(text: string): unknown {
  // Models sometimes wrap JSON in a ```json fence even when told not to — strip it rather
  // than fail on the first attempt.
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(stripped);
}

/**
 * One call to the Messages API with the document as an image/document content block —
 * `tools: []` since this needs plain text generation, not Tool Calling.
 */
export async function classifyAndExtractText(input: { base64Data: string; mimeType: string }): Promise<ClassifyResult> {
  const { base64Data, mimeType } = input;

  const contentBlock: AnthropicContentBlock = {
    type: blockTypeForMime(mimeType),
    source: { type: "base64", media_type: mimeType, data: base64Data },
  };

  const response = await callMessagesApi({
    system: CLASSIFY_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [contentBlock, { type: "text", text: "صنّف هذا المستند واستخرج نصّه الآن." }],
      },
    ],
    tools: [],
    maxTokens: 4096,
  });

  const textBlock = response.content.find((b) => b.type === "text") as { text?: string } | undefined;
  if (!textBlock?.text) {
    throw new Error("استجابة Anthropic لا تحتوي على نص — تعذّر تحليل نتيجة التصنيف.");
  }

  let parsed: unknown;
  try {
    parsed = extractJson(textBlock.text);
  } catch {
    throw new Error(`استجابة Anthropic ليست JSON صالحاً: ${textBlock.text.slice(0, 200)}`);
  }

  const { category, extractedText, confidence } = parsed as Partial<ClassifyResult>;
  const safeCategory: DocumentCategory = DOCUMENT_CATEGORIES.includes(category as DocumentCategory)
    ? (category as DocumentCategory)
    : "OTHER";

  return {
    category: safeCategory,
    extractedText: typeof extractedText === "string" ? extractedText : "",
    confidence: typeof confidence === "number" ? confidence : 0,
  };
}

/**
 * The on-demand orchestration: fetch the stored bytes, classify/OCR them, persist the
 * result onto the Document row (adds the category to `tags`, stashes the rest in
 * `metadata`), and audit-log it. Deliberately NOT automatic on every upload — "OCR عند
 * الحاجة" (when needed), so a caller explicitly asks for it via POST
 * /api/documents/[id]/analyze rather than every upload paying for a model call whether it
 * needs one or not.
 */
export async function runDocumentAi(documentId: string, userId: string | null = null) {
  const doc = await getDocument(documentId);
  // doc.mimeType is nullable in the schema (some rows predate mandatory mime-type capture) —
  // treat a missing mime type the same as an unsupported one rather than letting `null` reach
  // SUPPORTED_MIME_TYPES.includes()/classifyAndExtractText() (both expect `string`).
  if (!doc.mimeType || !SUPPORTED_MIME_TYPES.includes(doc.mimeType)) {
    throw new BusinessRuleError(
      `نوع الملف (${doc.mimeType ?? "غير معروف"}) غير مدعوم للتصنيف/OCR حالياً — الأنواع المدعومة: ${SUPPORTED_MIME_TYPES.join(", ")}.`
    );
  }

  const adapter = getStorageAdapter();
  const buffer = await adapter.download(doc.fileUrl);
  const result = await classifyAndExtractText({ base64Data: buffer.toString("base64"), mimeType: doc.mimeType });

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const existingMetadata = (doc.metadata as Record<string, unknown> | null) ?? {};
    const updated = await tx.document.update({
      where: { id: documentId },
      data: {
        tags: Array.from(new Set([...doc.tags, result.category])),
        metadata: {
          ...existingMetadata,
          extractedText: result.extractedText,
          category: result.category,
          ocrConfidence: result.confidence,
          ocrRanAt: new Date().toISOString(),
        },
      },
    });

    await logAudit(
      { userId, action: "document.analyze", entity: `Document:${documentId}`, newValue: { category: result.category, confidence: result.confidence } },
      tx
    );

    return updated;
  });
}

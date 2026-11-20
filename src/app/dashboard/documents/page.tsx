"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/apiClient";
import { useHasPermission } from "@/lib/userContext";
import { PERMISSION_KEYS } from "@/lib/permissionKeys";
import {
  PageHeader,
  Card,
  CardBody,
  Button,
  Input,
  Select,
  Field,
  Badge,
  Alert,
  EmptyState,
  FullPageSpinner,
} from "@/components/ui";
import { UploadDocumentModal } from "@/components/documents/UploadDocumentModal";
import { AnalyzeResultModal } from "@/components/documents/AnalyzeResultModal";
import { OWNER_TYPES, categoryLabel, ownerTypeLabel, type DocumentRow } from "@/components/documents/types";

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export default function DocumentsPage() {
  const canRead = useHasPermission(PERMISSION_KEYS.DOCUMENTS_READ);
  const canWrite = useHasPermission(PERMISSION_KEYS.DOCUMENTS_WRITE);
  const canDelete = useHasPermission(PERMISSION_KEYS.DOCUMENTS_DELETE);

  const [loading, setLoading] = useState(true);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [queryInput, setQueryInput] = useState("");
  const [ownerTypeFilter, setOwnerTypeFilter] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [appliedOwnerType, setAppliedOwnerType] = useState("");

  const [uploadOpen, setUploadOpen] = useState(false);
  const [analyzeTarget, setAnalyzeTarget] = useState<DocumentRow | null>(null);
  const [analyzeModalOpen, setAnalyzeModalOpen] = useState(false);

  const [actionError, setActionError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadDocuments = useCallback(async () => {
    if (!canRead) return;
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams();
      if (appliedQuery.trim()) params.set("query", appliedQuery.trim());
      if (appliedOwnerType) params.set("ownerType", appliedOwnerType);
      params.set("limit", "100");
      const res = await api.get<{ documents: DocumentRow[] }>(`/api/documents?${params.toString()}`);
      setDocuments(res.documents);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "حدث خطأ غير متوقع أثناء تحميل المستندات");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead, appliedQuery, appliedOwnerType]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAppliedQuery(queryInput);
    setAppliedOwnerType(ownerTypeFilter);
  }

  function handleUploaded(doc: DocumentRow) {
    setDocuments((prev) => [doc, ...prev]);
  }

  async function handleDownload(doc: DocumentRow) {
    setActionError(null);
    setDownloadingId(doc.id);
    try {
      const res = await api.get<{ url: string }>(`/api/documents/${doc.id}/download`);
      window.open(res.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "حدث خطأ غير متوقع أثناء التنزيل");
    } finally {
      setDownloadingId(null);
    }
  }

  async function handleAnalyze(doc: DocumentRow) {
    setActionError(null);
    setAnalyzingId(doc.id);
    try {
      const res = await api.post<{ document: DocumentRow }>(`/api/documents/${doc.id}/analyze`);
      setDocuments((prev) => prev.map((d) => (d.id === res.document.id ? res.document : d)));
      setAnalyzeTarget(res.document);
      setAnalyzeModalOpen(true);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "حدث خطأ غير متوقع أثناء التحليل");
    } finally {
      setAnalyzingId(null);
    }
  }

  async function handleDelete(doc: DocumentRow) {
    if (!window.confirm(`هل تريد حذف المستند "${doc.fileName}"؟ لا يمكن التراجع عن هذا الإجراء.`)) return;
    setActionError(null);
    setDeletingId(doc.id);
    try {
      await api.delete<{ ok: true }>(`/api/documents/${doc.id}`);
      setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "حدث خطأ غير متوقع أثناء الحذف");
    } finally {
      setDeletingId(null);
    }
  }

  if (!canRead) {
    return (
      <div>
        <PageHeader title="المستندات" description="أرشيف مستندات الصيدلية" />
        <Card>
          <CardBody>
            <EmptyState
              title="لا تملك صلاحية الوصول إلى هذه الصفحة"
              description="صلاحياتك الحالية لا تشمل عرض المستندات. تواصل مع مدير النظام إذا كنت تحتاج هذا الوصول."
            />
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="المستندات"
        description="أرشيف مستندات الصيدلية — روشتات، فواتير، وثائق هوية، وغيرها"
        action={
          canWrite && (
            <Button onClick={() => setUploadOpen(true)}>
              <span>+</span> رفع مستند
            </Button>
          )
        }
      />

      <Card className="mb-4">
        <CardBody>
          <form onSubmit={handleSearchSubmit} className="flex flex-wrap items-end gap-3">
            <div className="min-w-[220px] flex-1">
              <Field label="بحث" hint="بحث باسم الملف أو كلمة مفتاحية">
                <Input
                  value={queryInput}
                  onChange={(e) => setQueryInput(e.target.value)}
                  placeholder="مثال: روشتة، فاتورة، اسم الملف..."
                />
              </Field>
            </div>
            <div className="min-w-[180px]">
              <Field label="نوع المالك">
                <Select value={ownerTypeFilter} onChange={(e) => setOwnerTypeFilter(e.target.value)}>
                  <option value="">— الكل —</option>
                  {OWNER_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {ownerTypeLabel(t)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Button type="submit" variant="outline">
              بحث
            </Button>
          </form>
        </CardBody>
      </Card>

      {loadError && (
        <div className="mb-4">
          <Alert tone="danger">{loadError}</Alert>
        </div>
      )}
      {actionError && (
        <div className="mb-4">
          <Alert tone="danger">{actionError}</Alert>
        </div>
      )}

      <Card>
        {loading ? (
          <CardBody>
            <FullPageSpinner label="جارِ تحميل المستندات..." />
          </CardBody>
        ) : documents.length === 0 ? (
          <CardBody>
            <EmptyState title="لا توجد مستندات" description="لم يتم رفع أي مستندات مطابقة لمعايير البحث حتى الآن." />
          </CardBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="pacc-table">
              <thead>
                <tr>
                  <th>اسم الملف</th>
                  <th>الكلمات المفتاحية</th>
                  <th>نوع الملف</th>
                  <th>المالك</th>
                  <th>تاريخ الرفع</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => (
                  <tr key={doc.id}>
                    <td className="font-medium text-slate-700">{doc.fileName}</td>
                    <td>
                      <div className="flex flex-wrap gap-1.5">
                        {doc.tags.length === 0 ? (
                          <span className="text-xs text-slate-400">—</span>
                        ) : (
                          doc.tags.map((tag) => {
                            const label = categoryLabel(tag);
                            return (
                              <Badge key={tag} tone={label ? "brand" : "neutral"}>
                                {label ?? tag}
                              </Badge>
                            );
                          })
                        )}
                      </div>
                    </td>
                    <td className="text-xs text-slate-500">{doc.mimeType ?? "غير معروف"}</td>
                    <td className="text-xs text-slate-500">
                      {ownerTypeLabel(doc.ownerType)}
                      {doc.ownerId ? ` · ${doc.ownerId}` : ""}
                    </td>
                    <td className="whitespace-nowrap text-xs text-slate-500">{formatDate(doc.createdAt)}</td>
                    <td>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleDownload(doc)}
                          disabled={downloadingId === doc.id}
                          loading={downloadingId === doc.id}
                        >
                          تنزيل
                        </Button>
                        {canWrite && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => handleAnalyze(doc)}
                            disabled={analyzingId === doc.id}
                            loading={analyzingId === doc.id}
                          >
                            تحليل بالذكاء الاصطناعي (OCR)
                          </Button>
                        )}
                        {doc.metadata && typeof (doc.metadata as Record<string, unknown>).extractedText === "string" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setAnalyzeTarget(doc);
                              setAnalyzeModalOpen(true);
                            }}
                          >
                            عرض نتيجة التحليل
                          </Button>
                        )}
                        {canDelete && (
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => handleDelete(doc)}
                            disabled={deletingId === doc.id}
                            loading={deletingId === doc.id}
                          >
                            حذف
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <UploadDocumentModal open={uploadOpen} onClose={() => setUploadOpen(false)} onUploaded={handleUploaded} />
      <AnalyzeResultModal
        open={analyzeModalOpen}
        onClose={() => setAnalyzeModalOpen(false)}
        document={analyzeTarget}
      />
    </div>
  );
}

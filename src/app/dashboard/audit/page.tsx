"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/apiClient";
import { useHasPermission } from "@/lib/userContext";
import { PERMISSION_KEYS } from "@/lib/permissionKeys";
import { PageHeader, Card, CardBody, Button, Spinner, EmptyState, Alert, Input, Field, Modal } from "@/components/ui";

/**
 * Mirrors prisma/schema.prisma's AuditLog model (oldValue/newValue are raw Json — shown
 * verbatim in the details modal, not reshaped into something they're not) plus the `user`
 * relation src/lib/reports.ts's listAuditLog() includes. Not imported from "@prisma/client"
 * — see the note on the reports page for why.
 */
interface AuditLogUser {
  id: string;
  name: string;
  email: string | null;
  phone?: string | null;
}
interface AuditLogRow {
  id: string;
  userId: string | null;
  action: string;
  entity: string;
  oldValue?: unknown;
  newValue?: unknown;
  createdAt: string;
  user: AuditLogUser | null;
}

function buildQuery(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}
function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : "حدث خطأ غير متوقع، حاول مرة أخرى";
}
function startOfDayIso(dateInput: string): string {
  return new Date(`${dateInput}T00:00:00`).toISOString();
}
function endOfDayIso(dateInput: string): string {
  return new Date(`${dateInput}T23:59:59.999`).toISOString();
}
function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" });
}
function formatJson(value: unknown): string {
  if (value === null || value === undefined) return "— لا توجد قيمة —";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function AuditPage() {
  const canRead = useHasPermission(PERMISSION_KEYS.AUDIT_READ);

  const [userId, setUserId] = useState("");
  const [action, setAction] = useState("");
  const [entity, setEntity] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [limit, setLimit] = useState("100");

  const [logs, setLogs] = useState<AuditLogRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailsLog, setDetailsLog] = useState<AuditLogRow | null>(null);

  const dateRangeInvalid = Boolean(from && to && from > to);
  const limitNumber = Number(limit);
  const limitInvalid = limit !== "" && (!Number.isFinite(limitNumber) || limitNumber <= 0);

  async function fetchLogs() {
    setLoading(true);
    setError(null);
    try {
      const q = buildQuery({
        userId: userId.trim() || undefined,
        action: action.trim() || undefined,
        entity: entity.trim() || undefined,
        from: from ? startOfDayIso(from) : undefined,
        to: to ? endOfDayIso(to) : undefined,
        limit: limit.trim() || undefined,
      });
      const data = await api.get<{ logs: AuditLogRow[] }>(`/api/audit${q}`);
      setLogs(data.logs);
    } catch (e) {
      setError(errorMessage(e));
      setLogs(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!canRead) {
      setLoading(false);
      return;
    }
    fetchLogs();
    // Initial load only — subsequent fetches are explicit via the "تصفية" button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead]);

  function handleFilterSubmit() {
    if (dateRangeInvalid || limitInvalid) return;
    fetchLogs();
  }

  if (!canRead) {
    return (
      <div>
        <PageHeader title="سجل التدقيق" />
        <Card>
          <CardBody>
            <EmptyState
              title="ليست لديك صلاحية الوصول إلى سجل التدقيق"
              description="يحتاج هذا القسم صلاحية «عرض سجل التدقيق». تواصل مع مسؤول النظام إذا كنت تحتاج هذا الوصول."
            />
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="سجل التدقيق" description="كل الإجراءات الحساسة المسجَّلة في النظام، على مستوى الشبكة بالكامل" />

      <Card className="mb-5">
        <CardBody>
          <div className="flex flex-wrap items-end gap-4">
            <div className="w-48">
              <Field label="المستخدم (ID)">
                <Input
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  placeholder="مثال: usr_123"
                  onKeyDown={(e) => e.key === "Enter" && handleFilterSubmit()}
                />
              </Field>
            </div>
            <div className="w-48">
              <Field label="الإجراء">
                <Input
                  value={action}
                  onChange={(e) => setAction(e.target.value)}
                  placeholder="مثال: order.cancel"
                  onKeyDown={(e) => e.key === "Enter" && handleFilterSubmit()}
                />
              </Field>
            </div>
            <div className="w-48">
              <Field label="الكائن (Entity)">
                <Input
                  value={entity}
                  onChange={(e) => setEntity(e.target.value)}
                  placeholder="مثال: Order:ord_123"
                  onKeyDown={(e) => e.key === "Enter" && handleFilterSubmit()}
                />
              </Field>
            </div>
            <div className="w-40">
              <Field label="من تاريخ">
                <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
              </Field>
            </div>
            <div className="w-40">
              <Field label="إلى تاريخ">
                <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
              </Field>
            </div>
            <div className="w-28">
              <Field label="الحد الأقصى" error={limitInvalid ? "رقم غير صالح" : undefined}>
                <Input
                  type="number"
                  min={1}
                  max={500}
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleFilterSubmit()}
                />
              </Field>
            </div>
            <Button onClick={handleFilterSubmit} disabled={loading}>
              {loading && <Spinner className="h-3.5 w-3.5" />}
              تصفية
            </Button>
          </div>
        </CardBody>
      </Card>

      {dateRangeInvalid && (
        <div className="mb-5">
          <Alert tone="warning">تاريخ البداية يجب أن يكون قبل تاريخ النهاية أو مساوياً له.</Alert>
        </div>
      )}
      {error && (
        <div className="mb-5">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}

      <Card>
        <CardBody className="p-0">
          {loading && !logs ? (
            <div className="flex items-center justify-center gap-2 py-14 text-sm text-slate-400">
              <Spinner className="h-4 w-4" /> جارِ تحميل السجل...
            </div>
          ) : !logs || logs.length === 0 ? (
            <div className="py-6">
              <EmptyState title="لا توجد نتائج" description="لا توجد إجراءات مطابقة لعوامل التصفية المحددة." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="pacc-table">
                <thead>
                  <tr>
                    <th>التاريخ والوقت</th>
                    <th>المستخدم</th>
                    <th>الإجراء</th>
                    <th>الكائن</th>
                    <th>التفاصيل</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id}>
                      <td className="whitespace-nowrap tabular-nums">{formatTimestamp(log.createdAt)}</td>
                      <td className="font-medium text-slate-700">
                        {log.user ? log.user.name : log.userId ? "مستخدم محذوف" : "النظام"}
                      </td>
                      <td className="font-mono text-xs text-slate-600">{log.action}</td>
                      <td className="font-mono text-xs text-slate-600">{log.entity}</td>
                      <td>
                        <Button variant="outline" size="sm" onClick={() => setDetailsLog(log)}>
                          عرض التفاصيل
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <Modal
        open={detailsLog !== null}
        onClose={() => setDetailsLog(null)}
        title="تفاصيل الإجراء"
        width="max-w-2xl"
      >
        {detailsLog && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs font-semibold text-slate-400">التاريخ والوقت</p>
                <p className="tabular-nums text-slate-700">{formatTimestamp(detailsLog.createdAt)}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-400">المستخدم</p>
                <p className="text-slate-700">{detailsLog.user ? detailsLog.user.name : detailsLog.userId ? "مستخدم محذوف" : "النظام"}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-400">الإجراء</p>
                <p className="font-mono text-xs text-slate-700">{detailsLog.action}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-400">الكائن</p>
                <p className="font-mono text-xs text-slate-700">{detailsLog.entity}</p>
              </div>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold text-slate-400">القيمة قبل التغيير</p>
              <pre className="max-h-56 overflow-auto rounded-2xl bg-slate-50 p-3 text-xs text-slate-600" dir="ltr">
                {formatJson(detailsLog.oldValue)}
              </pre>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold text-slate-400">القيمة بعد التغيير</p>
              <pre className="max-h-56 overflow-auto rounded-2xl bg-slate-50 p-3 text-xs text-slate-600" dir="ltr">
                {formatJson(detailsLog.newValue)}
              </pre>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

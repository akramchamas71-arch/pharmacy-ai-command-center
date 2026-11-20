"use client";

/**
 * /dashboard/suppliers — partner companies (e.g. شركة لطافة): not pharmacies, no stock here.
 * When no pharmacy has an item the AI asks the company over WhatsApp, then notifies the
 * delivery company. Management requires BRANCHES_MANAGE (same as branches); the inquiry log
 * shows every such request and its state.
 */

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/apiClient";
import { useHasPermission } from "@/lib/userContext";
import { PERMISSION_KEYS } from "@/lib/permissionKeys";
import { PageHeader, Card, CardHeader, CardBody, Button, Badge, FullPageSpinner, EmptyState, Alert } from "@/components/ui";
import { SupplierFormModal } from "@/components/suppliers/SupplierFormModal";
import type { Supplier, SupplierInquiry } from "@/components/suppliers/types";

const STATUS_LABEL: Record<SupplierInquiry["status"], { text: string; tone: "warning" | "info" | "danger" | "success" | "neutral" }> = {
  PENDING: { text: "بانتظار رد الشركة", tone: "warning" },
  ANSWERED: { text: "ردّت بالسعر", tone: "info" },
  NEEDS_REVIEW: { text: "يحتاج مراجعة", tone: "danger" },
  CONFIRMED: { text: "تم تأكيد التوصيل", tone: "success" },
  CANCELLED: { text: "ملغى", tone: "neutral" },
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("ar-LB", { dateStyle: "short", timeStyle: "short" });
}

export default function SuppliersPage() {
  const canManage = useHasPermission(PERMISSION_KEYS.BRANCHES_MANAGE);

  const [suppliers, setSuppliers] = useState<Supplier[] | null>(null);
  const [inquiries, setInquiries] = useState<SupplierInquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const s = await api.get<{ suppliers: Supplier[] }>("/api/suppliers");
      setSuppliers(s.suppliers);
      try {
        const i = await api.get<{ inquiries: SupplierInquiry[] }>("/api/supplier-inquiries");
        setInquiries(i.inquiries);
      } catch {
        setInquiries([]);
      }
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : "تعذّر تحميل الشركات — تأكد من تشغيل خطوة إنشاء الجداول (run-latafa.ps1)"
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!canManage) {
      setLoading(false);
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage]);

  if (!canManage) {
    return (
      <div>
        <PageHeader title="الشركات الشريكة" />
        <Card>
          <CardBody>
            <EmptyState title="لا تملك صلاحية الوصول لهذه الصفحة" description="إدارة الشركات الشريكة تتطلب صلاحية خاصة." />
          </CardBody>
        </Card>
      </div>
    );
  }

  if (loading) return <FullPageSpinner label="جارِ تحميل الشركات..." />;

  function handleSaved(s: Supplier) {
    setSuppliers((prev) => {
      if (!prev) return [s];
      return prev.some((x) => x.id === s.id) ? prev.map((x) => (x.id === s.id ? s : x)) : [...prev, s];
    });
  }

  async function toggleStatus(s: Supplier) {
    setBusyId(s.id);
    setError(null);
    try {
      const r = await api.patch<{ supplier: Supplier }>(`/api/suppliers/${s.id}`, {
        status: s.status === "ACTIVE" ? "DISABLED" : "ACTIVE",
      });
      handleSaved(r.supplier);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "تعذّر تغيير الحالة");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="الشركات الشريكة"
        description="شركات ليست صيدليات ولا مخزون لها هنا. إذا لم يتوفر الصنف في الصيدليات يسألها الذكاء الاصطناعي على واتساب ثم يُبلّغ شركة التوصيل."
        action={
          <Button
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
          >
            + شركة جديدة
          </Button>
        }
      />

      {error && <Alert tone="danger">{error}</Alert>}

      <Card>
        {!suppliers || suppliers.length === 0 ? (
          <CardBody>
            <EmptyState title="لا توجد شركات شريكة بعد" description="أضف شركة (مثل لطافة) للبدء." />
          </CardBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="pacc-table">
              <thead>
                <tr>
                  <th>الشركة</th>
                  <th>واتساب</th>
                  <th>تخصصها</th>
                  <th>التوصيل</th>
                  <th>الدفع</th>
                  <th>الحالة</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((s) => (
                  <tr key={s.id}>
                    <td className="font-medium text-slate-800">{s.name}</td>
                    <td className="text-slate-500" dir="ltr">{s.whatsappNumber}</td>
                    <td className="text-slate-500">{s.specialty || "—"}</td>
                    <td className="text-slate-500">
                      <div>{s.deliveryContactLabel || "—"}</div>
                      {s.deliveryContactWhatsapp && <div className="text-xs text-slate-400" dir="ltr">{s.deliveryContactWhatsapp}</div>}
                    </td>
                    <td className="text-slate-500">{s.paymentTerms || "—"}</td>
                    <td>
                      <Badge tone={s.status === "ACTIVE" ? "success" : "neutral"}>{s.status === "ACTIVE" ? "فعّالة" : "معطّلة"}</Badge>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditing(s);
                            setModalOpen(true);
                          }}
                        >
                          تعديل
                        </Button>
                        <Button size="sm" variant="secondary" loading={busyId === s.id} onClick={() => toggleStatus(s)}>
                          {s.status === "ACTIVE" ? "تعطيل" : "تفعيل"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="طلبات الحجز من الشركات" subtitle="كل طلب أرسله الذكاء الاصطناعي لشركة شريكة وحالته" />
        {inquiries.length === 0 ? (
          <CardBody>
            <p className="py-6 text-center text-sm text-slate-400">لا توجد طلبات حجز بعد</p>
          </CardBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="pacc-table">
              <thead>
                <tr>
                  <th>الرمز</th>
                  <th>الشركة</th>
                  <th>الصنف</th>
                  <th>الكمية</th>
                  <th>السعر المعروض</th>
                  <th>العنوان</th>
                  <th>الحالة</th>
                  <th>التاريخ</th>
                </tr>
              </thead>
              <tbody>
                {inquiries.map((q) => (
                  <tr key={q.id}>
                    <td className="font-mono text-xs text-slate-600">{q.referenceCode}</td>
                    <td className="text-slate-700">{q.supplier.name}</td>
                    <td className="text-slate-700">{q.productText}</td>
                    <td className="tabular-nums text-slate-500">{q.qty}</td>
                    <td className="tabular-nums text-slate-500">{q.quotedPrice !== null ? `$${Number(q.quotedPrice).toFixed(2)}` : "—"}</td>
                    <td className="text-slate-500">{q.deliveryAddress || "—"}</td>
                    <td>
                      <Badge tone={STATUS_LABEL[q.status]?.tone ?? "neutral"}>{STATUS_LABEL[q.status]?.text ?? q.status}</Badge>
                    </td>
                    <td className="text-xs text-slate-400">{formatDate(q.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <SupplierFormModal open={modalOpen} onClose={() => setModalOpen(false)} supplier={editing} onSaved={handleSaved} />
    </div>
  );
}

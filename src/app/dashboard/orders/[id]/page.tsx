"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, ApiError } from "@/lib/apiClient";
import { useHasPermission } from "@/lib/userContext";
import { PERMISSION_KEYS } from "@/lib/permissionKeys";
import {
  PageHeader,
  Card,
  CardHeader,
  CardBody,
  FullPageSpinner,
  EmptyState,
  Alert,
  Button,
  Modal,
  Textarea,
  Select,
  Field,
} from "@/components/ui";
import { OrderStatusBadge } from "@/components/orders/OrderStatusBadge";
import {
  ORDER_ADVANCE_TRANSITIONS,
  ORDER_CANCELLABLE_FROM,
  formatMoney,
  formatDateTimeAr,
  orderTotal,
  orderStatusLabel,
  paymentMethodLabel,
  orderSourceLabel,
  type OrderDetail,
} from "@/components/orders/orderTypes";

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const orderId = params.id;

  const canRead = useHasPermission(PERMISSION_KEYS.ORDERS_READ);
  const canWrite = useHasPermission(PERMISSION_KEYS.ORDERS_WRITE);
  const canCancel = useHasPermission(PERMISSION_KEYS.ORDERS_CANCEL);

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const [advanceTarget, setAdvanceTarget] = useState<string>("");

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const loadOrder = useCallback(async () => {
    if (!canRead) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.get<{ order: OrderDetail }>(`/api/orders/${orderId}`);
      setOrder(data.order);
      const nextOptions = ORDER_ADVANCE_TRANSITIONS[data.order.status] ?? [];
      setAdvanceTarget(nextOptions[0] ?? "");
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "تعذّر تحميل بيانات الطلب");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, canRead]);

  useEffect(() => {
    loadOrder();
  }, [loadOrder]);

  async function handleConfirm() {
    setActionLoading(true);
    setActionError(null);
    try {
      await api.post(`/api/orders/${orderId}/confirm`);
      await loadOrder();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "تعذّر تأكيد الطلب");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleAdvance() {
    if (!advanceTarget) return;
    setActionLoading(true);
    setActionError(null);
    try {
      await api.post(`/api/orders/${orderId}/advance`, { status: advanceTarget });
      await loadOrder();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "تعذّر تحديث حالة الطلب");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleCancel() {
    setActionLoading(true);
    setActionError(null);
    try {
      await api.post(`/api/orders/${orderId}/cancel`, cancelReason ? { reason: cancelReason } : undefined);
      setCancelOpen(false);
      setCancelReason("");
      await loadOrder();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "تعذّر إلغاء الطلب");
    } finally {
      setActionLoading(false);
    }
  }

  if (!canRead) {
    return (
      <div>
        <PageHeader title="تفاصيل الطلب" />
        <Card>
          <CardBody>
            <EmptyState title="لا تملك صلاحية الاطلاع على هذا الطلب" />
          </CardBody>
        </Card>
      </div>
    );
  }

  if (loading) return <FullPageSpinner label="جارِ تحميل تفاصيل الطلب..." />;

  if (loadError || !order) {
    return (
      <div>
        <PageHeader title="تفاصيل الطلب" action={<Link href="/dashboard/orders" className="text-xs font-semibold text-brand-600 hover:underline">← العودة إلى الطلبات</Link>} />
        <Alert tone="danger">{loadError ?? "لم يتم العثور على الطلب"}</Alert>
      </div>
    );
  }

  const nextStatuses = ORDER_ADVANCE_TRANSITIONS[order.status] ?? [];
  const canShowConfirm = canWrite && order.status === "PENDING_CONFIRMATION";
  const canShowAdvance = canWrite && nextStatuses.length > 0;
  const isPastPending = order.status !== "PENDING_CONFIRMATION";
  const canShowCancel =
    canWrite && ORDER_CANCELLABLE_FROM.includes(order.status) && (!isPastPending || canCancel);

  const total = orderTotal(order);

  return (
    <div>
      <PageHeader
        title={order.orderNumber}
        description={`فرع ${order.branch?.name ?? "—"} · ${formatDateTimeAr(order.createdAt)}`}
        action={<Link href="/dashboard/orders" className="text-xs font-semibold text-brand-600 hover:underline">← العودة إلى الطلبات</Link>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <OrderStatusBadge status={order.status} />
        {order.delivery && (
          <span className="text-xs text-slate-400">
            حالة التوصيل المرتبط: <span className="font-semibold text-slate-600">{order.delivery.status}</span>
          </span>
        )}
      </div>

      {actionError && (
        <div className="mb-4">
          <Alert tone="danger">{actionError}</Alert>
        </div>
      )}

      {(canShowConfirm || canShowAdvance || canShowCancel) && (
        <Card className="mb-4">
          <CardHeader title="إجراءات على الطلب" />
          <CardBody className="flex flex-wrap items-end gap-3">
            {canShowConfirm && (
              <Button onClick={handleConfirm} loading={actionLoading} disabled={actionLoading}>
                تأكيد الطلب
              </Button>
            )}

            {canShowAdvance && (
              <div className="flex items-end gap-2">
                <Field label="تقديم إلى الحالة التالية">
                  <Select value={advanceTarget} onChange={(e) => setAdvanceTarget(e.target.value)} disabled={actionLoading}>
                    {nextStatuses.map((s) => (
                      <option key={s} value={s}>
                        {orderStatusLabel(s)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Button variant="secondary" onClick={handleAdvance} loading={actionLoading} disabled={actionLoading || !advanceTarget}>
                  تقديم
                </Button>
              </div>
            )}

            {canShowCancel && (
              <Button variant="danger" onClick={() => setCancelOpen(true)} disabled={actionLoading}>
                إلغاء الطلب
              </Button>
            )}
          </CardBody>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="بيانات العميل" />
          <CardBody className="space-y-1.5 text-sm">
            <p>
              <span className="text-slate-400">الاسم: </span>
              <span className="font-medium text-slate-700">{order.customer?.name || "—"}</span>
            </p>
            <p>
              <span className="text-slate-400">الهاتف: </span>
              <span className="font-medium text-slate-700">{order.customer?.phone ?? "—"}</span>
            </p>
            <p>
              <span className="text-slate-400">عنوان التوصيل: </span>
              <span className="font-medium text-slate-700">{order.deliveryAddress || order.customer?.address || "—"}</span>
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="بيانات الطلب" />
          <CardBody className="space-y-1.5 text-sm">
            <p>
              <span className="text-slate-400">الفرع: </span>
              <span className="font-medium text-slate-700">{order.branch?.name ?? "—"}</span>
            </p>
            <p>
              <span className="text-slate-400">طريقة الدفع: </span>
              <span className="font-medium text-slate-700">{paymentMethodLabel(order.paymentMethod)}</span>
            </p>
            <p>
              <span className="text-slate-400">مصدر الطلب: </span>
              <span className="font-medium text-slate-700">{orderSourceLabel(order.source)}</span>
            </p>
            {order.notes && (
              <p>
                <span className="text-slate-400">ملاحظات: </span>
                <span className="font-medium text-slate-700 whitespace-pre-line">{order.notes}</span>
              </p>
            )}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="أصناف الطلب" />
        <CardBody>
          <div className="overflow-x-auto">
            <table className="pacc-table">
              <thead>
                <tr>
                  <th>المنتج</th>
                  <th>الكمية</th>
                  <th>السعر</th>
                  <th>الإجمالي</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.product?.name ?? item.productId}</td>
                    <td>{item.qty}</td>
                    <td>{formatMoney(item.price)}</td>
                    <td className="font-semibold text-slate-700">{formatMoney(Number(item.price) * item.qty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex justify-end">
            <p className="text-sm font-bold text-slate-800">
              الإجمالي الكلي: <span className="text-brand-700">{formatMoney(total)}</span>
            </p>
          </div>
        </CardBody>
      </Card>

      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title="إلغاء الطلب">
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            هل أنت متأكد من إلغاء هذا الطلب؟ يمكنك ذكر سبب الإلغاء (اختياري).
          </p>
          <Field label="سبب الإلغاء (اختياري)">
            <Textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              rows={3}
              placeholder="مثال: طلب العميل الإلغاء هاتفياً"
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCancelOpen(false)} disabled={actionLoading}>
              تراجع
            </Button>
            <Button variant="danger" onClick={handleCancel} loading={actionLoading} disabled={actionLoading}>
              تأكيد الإلغاء
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

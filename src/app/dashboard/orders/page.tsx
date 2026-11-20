"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/apiClient";
import { useCurrentUser, useHasPermission } from "@/lib/userContext";
import { PERMISSION_KEYS } from "@/lib/permissionKeys";
import { PageHeader, Card, CardBody, FullPageSpinner, EmptyState, Alert, Button } from "@/components/ui";
import { NewOrderModal } from "@/components/orders/NewOrderModal";
import { OrderStatusBadge } from "@/components/orders/OrderStatusBadge";
import { ORDER_STATUSES, orderStatusLabel, formatDateTimeAr, type OrderSummary, type OrderStatus } from "@/components/orders/orderTypes";

export default function OrdersListPage() {
  const user = useCurrentUser();
  const canRead = useHasPermission(PERMISSION_KEYS.ORDERS_READ);
  const canWrite = useHasPermission(PERMISSION_KEYS.ORDERS_WRITE);
  const [newOrderOpen, setNewOrderOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [orders, setOrders] = useState<OrderSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "ALL">("ALL");

  const isNetworkWide = user.branch === null;

  useEffect(() => {
    if (!canRead) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams();
        if (statusFilter !== "ALL") qs.set("status", statusFilter);
        qs.set("limit", "200");
        const data = await api.get<{ orders: OrderSummary[] }>(`/api/orders?${qs.toString()}`);
        if (!cancelled) setOrders(data.orders);
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError ? e.message : "تعذّر تحميل الطلبات");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, canRead, reloadKey]);

  const tabs = useMemo(() => ["ALL" as const, ...ORDER_STATUSES], []);

  if (!canRead) {
    return (
      <div>
        <PageHeader title="الطلبات" />
        <Card>
          <CardBody>
            <EmptyState title="لا تملك صلاحية الاطلاع على الطلبات" description="تواصل مع مدير النظام إذا كنت تحتاج هذه الصلاحية." />
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="الطلبات"
        description={isNetworkWide ? "جميع الفروع" : `فرع ${user.branch?.name ?? ""}`}
        action={canWrite ? <Button onClick={() => setNewOrderOpen(true)}>➕ طلب جديد</Button> : undefined}
      />
      <NewOrderModal open={newOrderOpen} onClose={() => setNewOrderOpen(false)} onCreated={() => setReloadKey((k) => k + 1)} />

      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded-full border-2 px-3.5 py-1.5 text-xs font-bold transition-all ${
              statusFilter === s ? "border-ink bg-sun text-ink shadow-pop-sm" : "border-slate-300 bg-white text-slate-600 hover:border-ink hover:bg-slate-50"
            }`}
          >
            {s === "ALL" ? "الكل" : orderStatusLabel(s)}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}

      <Card>
        {loading ? (
          <CardBody>
            <FullPageSpinner label="جارِ تحميل الطلبات..." />
          </CardBody>
        ) : !orders || orders.length === 0 ? (
          <CardBody>
            <EmptyState title="لا توجد طلبات" description="لا توجد طلبات مطابقة لهذا الفلتر حالياً." />
          </CardBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="pacc-table">
              <thead>
                <tr>
                  <th>رقم الطلب</th>
                  <th>العميل</th>
                  {isNetworkWide && <th>الفرع</th>}
                  <th>الحالة</th>
                  <th>تاريخ الإنشاء</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="cursor-pointer">
                    <td>
                      <Link href={`/dashboard/orders/${o.id}`} className="font-semibold text-brand-700 hover:underline">
                        {o.orderNumber}
                      </Link>
                    </td>
                    <td>{o.customer?.name || o.customer?.phone || "—"}</td>
                    {isNetworkWide && <td>{o.branch?.name ?? "—"}</td>}
                    <td>
                      <OrderStatusBadge status={o.status} />
                    </td>
                    <td className="text-slate-500">{formatDateTimeAr(o.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

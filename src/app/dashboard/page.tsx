"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/apiClient";
import { useCurrentUser } from "@/lib/userContext";
import { PERMISSION_KEYS } from "@/lib/permissionKeys";
import { PageHeader, StatCard, Card, CardHeader, CardBody, FullPageSpinner, Badge, EmptyState } from "@/components/ui";
import { roleLabel } from "@/lib/roleLabels";

interface InventoryItem {
  id: string;
  qtyOnHand: number;
  qtyReserved: number;
  product: { id: string; name: string };
  branch: { id: string; name: string };
}
interface AlertsResponse {
  outOfStock: InventoryItem[];
  lowStock: InventoryItem[];
  nearExpiry: InventoryItem[];
}
interface OrderSummary {
  id: string;
  orderNumber: string;
  status: string;
  createdAt: string;
  customer?: { name: string | null; phone: string } | null;
}
interface ConversationSummary {
  id: string;
  status: string;
  assignedAgent: "AI" | "HUMAN";
  channel: string;
}
interface SalesReport {
  revenue: number;
  orderCount: number;
}

function todayRangeIso() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return { from: start.toISOString(), to: end.toISOString() };
}

export default function DashboardHomePage() {
  const user = useCurrentUser();
  const [loading, setLoading] = useState(true);
  const [alerts, setAlerts] = useState<AlertsResponse | null>(null);
  const [pendingOrders, setPendingOrders] = useState<OrderSummary[] | null>(null);
  const [readyOrders, setReadyOrders] = useState<OrderSummary[] | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [sales, setSales] = useState<SalesReport | null>(null);

  const can = (p: string) => user.permissions.includes(p as never);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const tasks: Promise<void>[] = [];

      if (can(PERMISSION_KEYS.INVENTORY_READ)) {
        tasks.push(
          api.get<AlertsResponse>("/api/inventory/alerts").then((d) => {
            if (!cancelled) setAlerts(d);
          }).catch(() => {})
        );
      }
      if (can(PERMISSION_KEYS.ORDERS_READ)) {
        tasks.push(
          api.get<{ orders: OrderSummary[] }>("/api/orders?status=PENDING_CONFIRMATION&limit=50").then((d) => {
            if (!cancelled) setPendingOrders(d.orders);
          }).catch(() => {})
        );
        tasks.push(
          api.get<{ orders: OrderSummary[] }>("/api/orders?status=READY_FOR_DELIVERY&limit=50").then((d) => {
            if (!cancelled) setReadyOrders(d.orders);
          }).catch(() => {})
        );
      }
      if (can(PERMISSION_KEYS.WHATSAPP_SEND)) {
        tasks.push(
          api.get<{ conversations: ConversationSummary[] }>("/api/whatsapp/conversations?status=OPEN&limit=100").then((d) => {
            if (!cancelled) setConversations(d.conversations);
          }).catch(() => {})
        );
      }
      if (can(PERMISSION_KEYS.REPORTS_READ)) {
        const { from, to } = todayRangeIso();
        tasks.push(
          // The route replies `{ report: {...} }`, not the bare report object.
          api.get<{ report: SalesReport }>(`/api/reports/sales?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`).then((d) => {
            if (!cancelled && d && d.report) setSales(d.report);
          }).catch(() => {})
        );
      }

      await Promise.all(tasks);
      if (!cancelled) setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return <FullPageSpinner label="جارِ تحميل نظرة عامة..." />;

  const noWidgets =
    !can(PERMISSION_KEYS.INVENTORY_READ) &&
    !can(PERMISSION_KEYS.ORDERS_READ) &&
    !can(PERMISSION_KEYS.WHATSAPP_SEND) &&
    !can(PERMISSION_KEYS.REPORTS_READ);

  return (
    <div>
      <PageHeader
        title={`أهلاً، ${user.name.split(" ")[0]} 👋`}
        description={`${roleLabel(user.role)}${user.branch ? ` — فرع ${user.branch.name}` : " — كل الفروع"}`}
      />

      {noWidgets && (
        <Card>
          <CardBody>
            <EmptyState
              title="لا توجد بيانات لعرضها هنا"
              description="صلاحياتك الحالية لا تشمل أياً من ملخصات هذه الصفحة. استخدم القائمة الجانبية للوصول إلى ما يخصّك."
            />
          </CardBody>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {can(PERMISSION_KEYS.REPORTS_READ) && sales && (
          <>
            <StatCard label="مبيعات اليوم" value={`$${sales.revenue.toFixed(2)}`} tone="brand" />
            <StatCard label="عدد الطلبات المحتسبة اليوم" value={sales.orderCount} />
          </>
        )}
        {can(PERMISSION_KEYS.ORDERS_READ) && (
          <>
            <StatCard
              label="بانتظار التأكيد"
              value={pendingOrders?.length ?? 0}
              tone={pendingOrders && pendingOrders.length > 0 ? "warning" : "neutral"}
            />
            <StatCard label="جاهزة للتوصيل" value={readyOrders?.length ?? 0} tone="info" />
          </>
        )}
        {can(PERMISSION_KEYS.INVENTORY_READ) && alerts && (
          <>
            <StatCard
              label="نفدت من المخزون"
              value={alerts.outOfStock.length}
              tone={alerts.outOfStock.length > 0 ? "danger" : "success"}
            />
            <StatCard
              label="مخزون منخفض"
              value={alerts.lowStock.length}
              tone={alerts.lowStock.length > 0 ? "warning" : "success"}
            />
          </>
        )}
        {can(PERMISSION_KEYS.WHATSAPP_SEND) && conversations && (
          <>
            <StatCard label="محادثات واتساب مفتوحة" value={conversations.length} tone="brand" />
            <StatCard
              label="بحاجة لتدخل بشري"
              value={conversations.filter((c) => c.assignedAgent === "HUMAN").length}
              tone="warning"
            />
          </>
        )}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {can(PERMISSION_KEYS.INVENTORY_READ) && alerts && (
          <Card>
            <CardHeader title="تنبيهات المخزون" subtitle="أهم الأصناف التي تحتاج متابعة" action={<Link href="/dashboard/inventory" className="text-xs font-semibold text-brand-600 hover:underline">عرض الكل ←</Link>} />
            <CardBody className="space-y-2">
              {alerts.outOfStock.length === 0 && alerts.lowStock.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-400">لا توجد تنبيهات حالياً — كل شيء على ما يرام ✓</p>
              ) : (
                [...alerts.outOfStock.slice(0, 4), ...alerts.lowStock.slice(0, 4)].slice(0, 6).map((item) => (
                  <div key={item.id} className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2 text-sm">
                    <div>
                      <p className="font-medium text-slate-700">{item.product.name}</p>
                      <p className="text-xs text-slate-400">{item.branch.name}</p>
                    </div>
                    <Badge tone={item.qtyOnHand - item.qtyReserved <= 0 ? "danger" : "warning"}>
                      {item.qtyOnHand - item.qtyReserved <= 0 ? "نفد" : `متبقي ${item.qtyOnHand - item.qtyReserved}`}
                    </Badge>
                  </div>
                ))
              )}
            </CardBody>
          </Card>
        )}

        {can(PERMISSION_KEYS.ORDERS_READ) && (
          <Card>
            <CardHeader title="طلبات بانتظار التأكيد" action={<Link href="/dashboard/orders" className="text-xs font-semibold text-brand-600 hover:underline">عرض الكل ←</Link>} />
            <CardBody className="space-y-2">
              {!pendingOrders || pendingOrders.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-400">لا توجد طلبات بانتظار التأكيد</p>
              ) : (
                pendingOrders.slice(0, 6).map((o) => (
                  <Link
                    key={o.id}
                    href={`/dashboard/orders/${o.id}`}
                    className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2 text-sm hover:bg-slate-100"
                  >
                    <span className="font-medium text-slate-700">{o.orderNumber}</span>
                    <span className="text-xs text-slate-400">{o.customer?.name || o.customer?.phone || ""}</span>
                  </Link>
                ))
              )}
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}

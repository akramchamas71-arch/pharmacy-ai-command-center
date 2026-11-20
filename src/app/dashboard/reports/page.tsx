"use client";

import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/apiClient";
import { useCurrentUser } from "@/lib/userContext";
import { PERMISSION_KEYS } from "@/lib/permissionKeys";
import {
  PageHeader,
  StatCard,
  Card,
  CardHeader,
  CardBody,
  Spinner,
  Badge,
  EmptyState,
  Alert,
  Input,
  Select,
  Field,
} from "@/components/ui";
import { VerticalBarChart, type VerticalBarDatum } from "@/components/reports/VerticalBarChart";
import { HorizontalBarList, type HorizontalBarDatum } from "@/components/reports/HorizontalBarList";
import { CategoryBarChart, type CategoryBarDatum } from "@/components/reports/CategoryBarChart";

/**
 * Prisma's generated client is a known-broken stub in this sandbox (missing most enum
 * exports), so these mirror the real string literals in prisma/schema.prisma's OrderStatus /
 * DeliveryStatus enums by hand instead of importing from "@prisma/client".
 */
type OrderStatus =
  | "PENDING_CONFIRMATION"
  | "CONFIRMED"
  | "PREPARING"
  | "READY_FOR_DELIVERY"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "CANCELLED";

type DeliveryStatus = "ASSIGNED" | "ACCEPTED" | "PICKED_UP" | "ON_THE_WAY" | "DELIVERED" | "FAILED";

// ===================== Report shapes (mirrors src/lib/reports.ts return values) =====================

interface SalesReport {
  branchId: string | null;
  from: string | null;
  to: string | null;
  orderCount: number;
  revenue: number;
  avgOrderValue: number;
  revenueByDay: { date: string; revenue: number }[];
  topProducts: { productId: string; name: string; qty: number; revenue: number }[];
}

interface InventoryValuationReport {
  branchId: string | null;
  byBranch: { branchId: string; branchName: string; totalUnits: number; totalValue: number; productCount: number }[];
  totalValue: number;
  alerts: { outOfStockCount: number; lowStockCount: number; nearExpiryCount: number };
}

interface OrdersOperationsReport {
  branchId: string | null;
  from: string | null;
  to: string | null;
  totalOrders: number;
  statusCounts: Record<OrderStatus, number>;
  cancellationRate: number;
  avgFulfillmentTimeHours: number | null;
  avgFulfillmentTimeIsApproximate?: boolean;
}

interface DeliveryPerformanceReport {
  branchId: string | null;
  from: string | null;
  to: string | null;
  totalDeliveries: number;
  statusCounts: Record<DeliveryStatus, number>;
  failureRate: number;
  avgDeliveryTimeHours: number | null;
  avgDeliveryTimeIsApproximate?: boolean;
  driverBreakdown: {
    driverId: string;
    driverName: string;
    delivered: number;
    failed: number;
    avgDeliveryTimeHours: number | null;
  }[];
}

interface BranchOption {
  id: string;
  name: string;
}

type ReportTab = "sales" | "inventory" | "orders" | "delivery";

const ORDER_STATUS_META: Record<OrderStatus, { label: string; color: string }> = {
  PENDING_CONFIRMATION: { label: "بانتظار التأكيد", color: "bg-slate-400" },
  CONFIRMED: { label: "مؤكَّد", color: "bg-sky-500" },
  PREPARING: { label: "قيد التحضير", color: "bg-amber-500" },
  READY_FOR_DELIVERY: { label: "جاهز للتوصيل", color: "bg-violet-500" },
  OUT_FOR_DELIVERY: { label: "في طريق التوصيل", color: "bg-indigo-500" },
  DELIVERED: { label: "تم التوصيل", color: "bg-emerald-500" },
  CANCELLED: { label: "ملغى", color: "bg-rose-500" },
};

const DELIVERY_STATUS_META: Record<DeliveryStatus, { label: string; color: string }> = {
  ASSIGNED: { label: "تم التعيين", color: "bg-slate-400" },
  ACCEPTED: { label: "مقبول من السائق", color: "bg-sky-500" },
  PICKED_UP: { label: "تم الاستلام", color: "bg-amber-500" },
  ON_THE_WAY: { label: "في الطريق", color: "bg-indigo-500" },
  DELIVERED: { label: "تم التوصيل", color: "bg-emerald-500" },
  FAILED: { label: "فشل التوصيل", color: "bg-rose-500" },
};

const ORDER_STATUS_ORDER: OrderStatus[] = [
  "PENDING_CONFIRMATION",
  "CONFIRMED",
  "PREPARING",
  "READY_FOR_DELIVERY",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "CANCELLED",
];
const DELIVERY_STATUS_ORDER: DeliveryStatus[] = ["ASSIGNED", "ACCEPTED", "PICKED_UP", "ON_THE_WAY", "DELIVERED", "FAILED"];

const TAB_LABELS: Record<ReportTab, string> = {
  sales: "المبيعات",
  inventory: "تقييم المخزون",
  orders: "عمليات الطلبات",
  delivery: "أداء التوصيل",
};

function money(v: number): string {
  return `$${Math.round(v).toLocaleString("en-US")}`;
}
function moneyPrecise(v: number): string {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function count(v: number): string {
  return v.toLocaleString("en-US");
}
function percent(v: number): string {
  return `${(v * 100).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}٪`;
}
function hours(v: number | null): string {
  if (v === null) return "—";
  return `${v.toLocaleString("en-US", { maximumFractionDigits: 1 })} ساعة`;
}
// Short day label for the x-axis (e.g. "2026-09-18" -> "18/09"), full date stays in the title.
function dayLabel(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

function isoDateInput(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}
function startOfDayIso(dateInput: string): string {
  return new Date(`${dateInput}T00:00:00`).toISOString();
}
function endOfDayIso(dateInput: string): string {
  return new Date(`${dateInput}T23:59:59.999`).toISOString();
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

// StatCard's `label` prop is a plain string (see src/components/ui/PageHeader.tsx), so an
// "approximate" metric that needs a tooltip explaining why gets this look-alike instead of
// a variant of StatCard — same markup/classes, plus a `title` attribute and a muted
// "تقريبي" marker next to the label.
function ApproxStatCard({ label, value, approxTitle }: { label: string; value: string; approxTitle: string }) {
  return (
    <div className="rounded-3xl border-[2.5px] border-ink bg-white p-4 shadow-pop" title={approxTitle}>
      <p className="flex items-center gap-1 text-xs font-medium text-slate-400">
        {label}
        <span className="cursor-help text-[10px] font-semibold text-slate-400 underline decoration-dotted">تقريبي</span>
      </p>
      <p className="mt-1.5 text-2xl font-extrabold tabular-nums text-slate-900">{value}</p>
    </div>
  );
}

export default function ReportsPage() {
  const user = useCurrentUser();
  const has = (p: string) => user.permissions.includes(p as never);

  const canSales = has(PERMISSION_KEYS.REPORTS_READ);
  const canInventory = has(PERMISSION_KEYS.REPORTS_READ) && has(PERMISSION_KEYS.INVENTORY_READ);
  const canOrders = has(PERMISSION_KEYS.REPORTS_READ) && has(PERMISSION_KEYS.ORDERS_READ);
  const canDelivery = has(PERMISSION_KEYS.REPORTS_READ) && has(PERMISSION_KEYS.DELIVERY_MANAGE);

  const availableTabs = useMemo(
    () =>
      (
        [
          ["sales", canSales],
          ["inventory", canInventory],
          ["orders", canOrders],
          ["delivery", canDelivery],
        ] as [ReportTab, boolean][]
      )
        .filter(([, allowed]) => allowed)
        .map(([key]) => key),
    [canSales, canInventory, canOrders, canDelivery]
  );
  const missingTabs = (["inventory", "orders", "delivery"] as ReportTab[]).filter((t) => !availableTabs.includes(t));

  const [activeTab, setActiveTab] = useState<ReportTab | null>(null);
  useEffect(() => {
    if (activeTab === null && availableTabs.length > 0) setActiveTab(availableTabs[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableTabs]);

  // ----- shared filters -----
  const [branches, setBranches] = useState<BranchOption[] | null>(null);
  const [branchId, setBranchId] = useState<string>("");
  const [from, setFrom] = useState<string>(isoDateInput(30));
  const [to, setTo] = useState<string>(isoDateInput(0));
  const dateRangeInvalid = Boolean(from && to && from > to);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ branches: BranchOption[] }>("/api/branches")
      .then((d) => {
        if (!cancelled) setBranches(d.branches);
      })
      .catch(() => {
        // Branch reference data couldn't be loaded (e.g. not reachable for this session) —
        // omit the branch filter rather than breaking the page; reports default to the
        // user's own branch / network-wide server-side regardless.
        if (!cancelled) setBranches(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ----- per-tab report state -----
  const [sales, setSales] = useState<SalesReport | null>(null);
  const [inventory, setInventory] = useState<InventoryValuationReport | null>(null);
  const [orders, setOrders] = useState<OrdersOperationsReport | null>(null);
  const [delivery, setDelivery] = useState<DeliveryPerformanceReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (activeTab !== "sales" || !canSales) return;
    if (dateRangeInvalid) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const q = buildQuery({
      branchId: branchId || undefined,
      from: from ? startOfDayIso(from) : undefined,
      to: to ? endOfDayIso(to) : undefined,
    });
    api
      .get<{ report: SalesReport }>(`/api/reports/sales${q}`)
      .then((d) => {
        if (!cancelled) setSales(d.report);
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, canSales, branchId, from, to, dateRangeInvalid]);

  useEffect(() => {
    if (activeTab !== "inventory" || !canInventory) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const q = buildQuery({ branchId: branchId || undefined });
    api
      .get<{ report: InventoryValuationReport }>(`/api/reports/inventory-valuation${q}`)
      .then((d) => {
        if (!cancelled) setInventory(d.report);
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, canInventory, branchId]);

  useEffect(() => {
    if (activeTab !== "orders" || !canOrders) return;
    if (dateRangeInvalid) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const q = buildQuery({
      branchId: branchId || undefined,
      from: from ? startOfDayIso(from) : undefined,
      to: to ? endOfDayIso(to) : undefined,
    });
    api
      .get<{ report: OrdersOperationsReport }>(`/api/reports/orders${q}`)
      .then((d) => {
        if (!cancelled) setOrders(d.report);
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, canOrders, branchId, from, to, dateRangeInvalid]);

  useEffect(() => {
    if (activeTab !== "delivery" || !canDelivery) return;
    if (dateRangeInvalid) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const q = buildQuery({
      branchId: branchId || undefined,
      from: from ? startOfDayIso(from) : undefined,
      to: to ? endOfDayIso(to) : undefined,
    });
    api
      .get<{ report: DeliveryPerformanceReport }>(`/api/reports/delivery${q}`)
      .then((d) => {
        if (!cancelled) setDelivery(d.report);
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, canDelivery, branchId, from, to, dateRangeInvalid]);

  if (!canSales) {
    return (
      <div>
        <PageHeader title="التقارير" />
        <Card>
          <CardBody>
            <EmptyState
              title="ليست لديك صلاحية الوصول إلى التقارير"
              description="يحتاج هذا القسم صلاحية «عرض التقارير». تواصل مع مسؤول النظام إذا كنت تحتاج هذا الوصول."
            />
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="التقارير" description="أرقام المبيعات والمخزون والطلبات والتوصيل حسب الفرع والفترة الزمنية" />

      {missingTabs.length > 0 && (
        <div className="mb-4">
          <Alert tone="info">
            بعض التقارير غير متاحة لصلاحياتك الحالية: {missingTabs.map((t) => TAB_LABELS[t]).join("، ")}. تواصل مع مسؤول
            النظام إذا كنت تحتاج الوصول إليها.
          </Alert>
        </div>
      )}

      <div className="mb-5 flex flex-wrap gap-2">
        {availableTabs.map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`rounded-full border-2 px-4 py-2 text-sm font-bold transition-all ${
              activeTab === t ? "border-ink bg-sun text-ink shadow-pop-sm" : "border-slate-300 bg-white text-slate-600 hover:border-ink"
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      <Card className="mb-5">
        <CardBody className="flex flex-wrap items-end gap-4">
          {activeTab !== "inventory" && (
            <>
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
            </>
          )}
          {branches && branches.length > 0 && (
            <div className="w-56">
              <Field label="الفرع">
                <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                  <option value="">كل الفروع</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          )}
          {loading && (
            <span className="flex items-center gap-2 text-xs text-slate-400">
              <Spinner className="h-3.5 w-3.5" /> جارِ التحميل...
            </span>
          )}
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

      {activeTab === "sales" && canSales && <SalesTab report={sales} loading={loading} />}
      {activeTab === "inventory" && canInventory && <InventoryTab report={inventory} loading={loading} />}
      {activeTab === "orders" && canOrders && <OrdersTab report={orders} loading={loading} />}
      {activeTab === "delivery" && canDelivery && <DeliveryTab report={delivery} loading={loading} />}
    </div>
  );
}

// ===================== Sales =====================

function SalesTab({ report, loading }: { report: SalesReport | null; loading: boolean }) {
  if (!report) {
    return loading ? null : (
      <Card>
        <CardBody>
          <EmptyState title="لا توجد بيانات" description="لم يتم تحميل تقرير المبيعات بعد." />
        </CardBody>
      </Card>
    );
  }

  const revenueByDay: VerticalBarDatum[] = report.revenueByDay.map((d) => ({
    key: d.date,
    label: dayLabel(d.date),
    value: d.revenue,
    title: `${d.date}: ${moneyPrecise(d.revenue)}`,
  }));
  const topProducts: HorizontalBarDatum[] = report.topProducts.map((p) => ({
    key: p.productId,
    label: p.name,
    value: p.revenue,
    sublabel: `${count(p.qty)} وحدة`,
  }));

  return (
    <div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <StatCard label="الإيرادات" value={moneyPrecise(report.revenue)} tone="brand" />
        <StatCard label="عدد الطلبات" value={count(report.orderCount)} />
        <StatCard label="متوسط قيمة الطلب" value={moneyPrecise(report.avgOrderValue)} />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="الإيرادات حسب اليوم" />
          <CardBody>
            {revenueByDay.length === 0 ? (
              <EmptyState title="لا توجد مبيعات في هذه الفترة" />
            ) : (
              <VerticalBarChart data={revenueByDay} formatValue={money} />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="المنتجات الأكثر مبيعاً" subtitle="حسب الإيراد" />
          <CardBody>
            {topProducts.length === 0 ? (
              <EmptyState title="لا توجد منتجات مباعة في هذه الفترة" />
            ) : (
              <HorizontalBarList data={topProducts} formatValue={money} />
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

// ===================== Inventory valuation =====================

function InventoryTab({ report, loading }: { report: InventoryValuationReport | null; loading: boolean }) {
  if (!report) {
    return loading ? null : (
      <Card>
        <CardBody>
          <EmptyState title="لا توجد بيانات" description="لم يتم تحميل تقرير تقييم المخزون بعد." />
        </CardBody>
      </Card>
    );
  }

  const byBranch: HorizontalBarDatum[] = report.byBranch.map((b) => ({
    key: b.branchId,
    label: b.branchName,
    value: b.totalValue,
    sublabel: `${count(b.productCount)} صنف، ${count(b.totalUnits)} وحدة`,
  }));

  return (
    <div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="القيمة الإجمالية للمخزون" value={moneyPrecise(report.totalValue)} tone="brand" />
        <StatCard
          label="أصناف نافدة"
          value={count(report.alerts.outOfStockCount)}
          tone={report.alerts.outOfStockCount > 0 ? "danger" : "success"}
        />
        <StatCard
          label="مخزون منخفض"
          value={count(report.alerts.lowStockCount)}
          tone={report.alerts.lowStockCount > 0 ? "warning" : "success"}
        />
        <StatCard
          label="قريب من انتهاء الصلاحية"
          value={count(report.alerts.nearExpiryCount)}
          tone={report.alerts.nearExpiryCount > 0 ? "warning" : "success"}
        />
      </div>

      <div className="mt-5">
        <Card>
          <CardHeader title="قيمة المخزون حسب الفرع" />
          <CardBody>
            {byBranch.length === 0 ? (
              <EmptyState title="لا توجد بيانات مخزون لعرضها" />
            ) : (
              <HorizontalBarList data={byBranch} formatValue={money} />
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

// ===================== Orders operations =====================

function OrdersTab({ report, loading }: { report: OrdersOperationsReport | null; loading: boolean }) {
  if (!report) {
    return loading ? null : (
      <Card>
        <CardBody>
          <EmptyState title="لا توجد بيانات" description="لم يتم تحميل تقرير عمليات الطلبات بعد." />
        </CardBody>
      </Card>
    );
  }

  const statusData: CategoryBarDatum[] = ORDER_STATUS_ORDER.map((s) => ({
    key: s,
    label: ORDER_STATUS_META[s].label,
    value: report.statusCounts[s] ?? 0,
    color: ORDER_STATUS_META[s].color,
  }));

  return (
    <div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <StatCard label="عدد الطلبات" value={count(report.totalOrders)} tone="brand" />
        <StatCard
          label="نسبة الإلغاء"
          value={percent(report.cancellationRate)}
          tone={report.cancellationRate > 0.1 ? "danger" : "neutral"}
        />
        {report.avgFulfillmentTimeIsApproximate ? (
          <ApproxStatCard
            label="متوسط وقت إتمام الطلب"
            value={hours(report.avgFulfillmentTimeHours)}
            approxTitle="يُحتسب تقريبياً من وقت آخر تحديث على الطلب، إذ لا يوجد في قاعدة البيانات وقت مخصص لحظة التسليم الفعلي."
          />
        ) : (
          <StatCard label="متوسط وقت إتمام الطلب" value={hours(report.avgFulfillmentTimeHours)} />
        )}
      </div>

      <div className="mt-5">
        <Card>
          <CardHeader title="توزيع الطلبات حسب الحالة" />
          <CardBody>
            {report.totalOrders === 0 ? (
              <EmptyState title="لا توجد طلبات في هذه الفترة" />
            ) : (
              <CategoryBarChart data={statusData} formatValue={count} />
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

// ===================== Delivery performance =====================

function DeliveryTab({ report, loading }: { report: DeliveryPerformanceReport | null; loading: boolean }) {
  if (!report) {
    return loading ? null : (
      <Card>
        <CardBody>
          <EmptyState title="لا توجد بيانات" description="لم يتم تحميل تقرير أداء التوصيل بعد." />
        </CardBody>
      </Card>
    );
  }

  const statusData: CategoryBarDatum[] = DELIVERY_STATUS_ORDER.map((s) => ({
    key: s,
    label: DELIVERY_STATUS_META[s].label,
    value: report.statusCounts[s] ?? 0,
    color: DELIVERY_STATUS_META[s].color,
  }));

  return (
    <div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <StatCard label="عدد عمليات التوصيل" value={count(report.totalDeliveries)} tone="brand" />
        <StatCard
          label="نسبة الفشل"
          value={percent(report.failureRate)}
          tone={report.failureRate > 0.1 ? "danger" : "neutral"}
        />
        {report.avgDeliveryTimeIsApproximate ? (
          <ApproxStatCard
            label="متوسط وقت التوصيل"
            value={hours(report.avgDeliveryTimeHours)}
            approxTitle="يُحتسب تقريبياً من وقت آخر تحديث على عملية التوصيل، إذ لا يوجد في قاعدة البيانات وقت مخصص لكل حالة توصيل."
          />
        ) : (
          <StatCard label="متوسط وقت التوصيل" value={hours(report.avgDeliveryTimeHours)} />
        )}
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="توزيع عمليات التوصيل حسب الحالة" />
          <CardBody>
            {report.totalDeliveries === 0 ? (
              <EmptyState title="لا توجد عمليات توصيل في هذه الفترة" />
            ) : (
              <CategoryBarChart data={statusData} formatValue={count} />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="أداء السائقين" />
          <CardBody>
            {report.driverBreakdown.length === 0 ? (
              <EmptyState title="لا توجد بيانات سائقين في هذه الفترة" />
            ) : (
              <div className="overflow-x-auto">
                <table className="pacc-table">
                  <thead>
                    <tr>
                      <th>السائق</th>
                      <th>تم التوصيل</th>
                      <th>فشل</th>
                      <th>متوسط وقت التوصيل</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.driverBreakdown.map((d) => (
                      <tr key={d.driverId}>
                        <td className="font-medium text-slate-700">{d.driverName}</td>
                        <td className="tabular-nums">{count(d.delivered)}</td>
                        <td className="tabular-nums">
                          {d.failed > 0 ? <Badge tone="danger">{count(d.failed)}</Badge> : count(d.failed)}
                        </td>
                        <td className="tabular-nums">{hours(d.avgDeliveryTimeHours)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

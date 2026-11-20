"use client";

/**
 * /dashboard/inventory — stock levels, pricing, thresholds and expiry across branches.
 * Viewing requires PERMISSION_KEYS.INVENTORY_READ; adjusting quantity or editing
 * price/threshold/expiry additionally requires PERMISSION_KEYS.INVENTORY_WRITE (checked via
 * useHasPermission and used to hide those controls — the server re-checks regardless).
 *
 * NOTE: never import anything from "@prisma/client" here — see ../branches/page.tsx's note
 * for why. InventoryTxType is a plain string-literal union in
 * ../../components/inventory/types.ts instead.
 */

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/apiClient";
import { useCurrentUser, useHasPermission } from "@/lib/userContext";
import { PERMISSION_KEYS } from "@/lib/permissionKeys";
import {
  PageHeader,
  StatCard,
  Card,
  CardBody,
  Button,
  Badge,
  Select,
  FullPageSpinner,
  EmptyState,
  Alert,
} from "@/components/ui";
import { AdjustQtyModal } from "@/components/inventory/AdjustQtyModal";
import { EditMetaModal } from "@/components/inventory/EditMetaModal";
import type { BranchRef, InventoryAlerts, InventoryItem } from "@/components/inventory/types";

const NEAR_EXPIRY_DAYS = 60;

function daysUntil(dateIso: string): number {
  const ms = new Date(dateIso).getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

function ExpiryBadge({ expiryDate }: { expiryDate: string | null }) {
  if (!expiryDate) return <span className="text-slate-300">—</span>;
  const days = daysUntil(expiryDate);
  const label = new Date(expiryDate).toLocaleDateString("ar");
  if (days < 0) return <Badge tone="danger">{label} (منتهي)</Badge>;
  if (days <= NEAR_EXPIRY_DAYS) return <Badge tone="warning">{label} (باقي {days} يوم)</Badge>;
  return <span className="text-slate-600">{label}</span>;
}

export default function InventoryPage() {
  const user = useCurrentUser();
  const canRead = useHasPermission(PERMISSION_KEYS.INVENTORY_READ);
  const canWrite = useHasPermission(PERMISSION_KEYS.INVENTORY_WRITE);

  const isNetworkWide = user.branch === null;

  const [branchOptions, setBranchOptions] = useState<BranchRef[] | null>(null);
  const [selectedBranchId, setSelectedBranchId] = useState<string>("");

  const [inventory, setInventory] = useState<InventoryItem[] | null>(null);
  const [alerts, setAlerts] = useState<InventoryAlerts | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [adjustItem, setAdjustItem] = useState<InventoryItem | null>(null);
  const [editItem, setEditItem] = useState<InventoryItem | null>(null);

  async function loadBranchOptions() {
    try {
      const data = await api.get<{ branches: BranchRef[] }>("/api/branches");
      setBranchOptions(data.branches);
    } catch {
      // Defensive fallback per the task spec: if listing branches is ever unavailable for
      // this role, just show inventory for every branch (grouped by the "الفرع" column)
      // with no picker, instead of breaking the page.
      setBranchOptions(null);
    }
  }

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const branchQuery = isNetworkWide && selectedBranchId ? `?branchId=${encodeURIComponent(selectedBranchId)}` : "";
      const [inventoryData, alertsData] = await Promise.all([
        api.get<{ inventory: InventoryItem[] }>(`/api/inventory${branchQuery}`),
        api.get<InventoryAlerts>(`/api/inventory/alerts${branchQuery}`),
      ]);
      setInventory(inventoryData.inventory);
      setAlerts(alertsData);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "تعذّر تحميل المخزون");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!canRead) {
      setLoading(false);
      return;
    }
    if (isNetworkWide) loadBranchOptions();
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead]);

  useEffect(() => {
    if (!canRead || !isNetworkWide) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBranchId]);

  if (!canRead) {
    return (
      <div>
        <PageHeader title="المخزون" />
        <Card>
          <CardBody>
            <EmptyState
              title="لا تملك صلاحية الوصول لهذه الصفحة"
              description="عرض المخزون يتطلب صلاحية خاصة غير متوفرة لحسابك الحالي."
            />
          </CardBody>
        </Card>
      </div>
    );
  }

  if (loading) return <FullPageSpinner label="جارِ تحميل المخزون..." />;

  const outOfStockIds = new Set((alerts?.outOfStock ?? []).map((i) => i.id));
  const lowStockIds = new Set((alerts?.lowStock ?? []).map((i) => i.id));
  const nearExpiryIds = new Set((alerts?.nearExpiry ?? []).map((i) => i.id));

  function handleUpdated(updated: InventoryItem) {
    setInventory((prev) => (prev ? prev.map((i) => (i.id === updated.id ? { ...i, ...updated } : i)) : prev));
    // Refresh the alert strip too so the counts stay accurate after a change.
    load();
  }

  return (
    <div>
      <PageHeader
        title="المخزون"
        description={
          isNetworkWide
            ? "عرض وإدارة المخزون على مستوى كل الفروع."
            : `مخزون فرع ${user.branch?.name ?? ""}`
        }
      />

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

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="نفدت من المخزون"
          value={alerts?.outOfStock.length ?? 0}
          tone={(alerts?.outOfStock.length ?? 0) > 0 ? "danger" : "success"}
        />
        <StatCard
          label="مخزون منخفض"
          value={alerts?.lowStock.length ?? 0}
          tone={(alerts?.lowStock.length ?? 0) > 0 ? "warning" : "success"}
        />
        <StatCard
          label="قريبة من الانتهاء"
          value={alerts?.nearExpiry.length ?? 0}
          tone={(alerts?.nearExpiry.length ?? 0) > 0 ? "warning" : "success"}
          hint={`خلال ${NEAR_EXPIRY_DAYS} يومًا`}
        />
      </div>

      {isNetworkWide && branchOptions && (
        <div className="mb-4 max-w-xs">
          <Select value={selectedBranchId} onChange={(e) => setSelectedBranchId(e.target.value)}>
            <option value="">كل الفروع</option>
            {branchOptions.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </div>
      )}

      <Card>
        {!inventory || inventory.length === 0 ? (
          <CardBody>
            <EmptyState title="لا توجد أصناف في المخزون" description="لم يتم تسجيل أي منتج في هذا المخزون بعد." />
          </CardBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="pacc-table">
              <thead>
                <tr>
                  <th>المنتج</th>
                  {isNetworkWide && <th>الفرع</th>}
                  <th>كمية متوفرة</th>
                  <th>الكمية الكلية</th>
                  <th>محجوز</th>
                  <th>السعر</th>
                  <th>حد التنبيه</th>
                  <th>تاريخ الانتهاء</th>
                  <th>تنبيه</th>
                  {canWrite && <th>إجراءات</th>}
                </tr>
              </thead>
              <tbody>
                {inventory.map((item) => {
                  const available = item.qtyOnHand - item.qtyReserved;
                  return (
                    <tr key={item.id}>
                      <td className="font-medium text-slate-800">{item.product.name}</td>
                      {isNetworkWide && <td className="text-slate-500">{item.branch.name}</td>}
                      <td className={available <= 0 ? "font-semibold text-rose-600" : "text-slate-700"}>{available}</td>
                      <td className="text-slate-500">{item.qtyOnHand}</td>
                      <td className="text-slate-500">{item.qtyReserved}</td>
                      <td className="text-slate-500">{Number(item.price) > 0 ? `$${Number(item.price).toFixed(2)}` : <Badge tone="warning">غير مسعّر</Badge>}</td>
                      <td className="text-slate-500">{item.lowStockThreshold}</td>
                      <td>
                        <ExpiryBadge expiryDate={item.expiryDate} />
                      </td>
                      <td>
                        {outOfStockIds.has(item.id) && <Badge tone="danger">نفد</Badge>}
                        {!outOfStockIds.has(item.id) && lowStockIds.has(item.id) && <Badge tone="warning">منخفض</Badge>}
                        {!outOfStockIds.has(item.id) && !lowStockIds.has(item.id) && nearExpiryIds.has(item.id) && (
                          <Badge tone="warning">قرب الانتهاء</Badge>
                        )}
                        {!outOfStockIds.has(item.id) && !lowStockIds.has(item.id) && !nearExpiryIds.has(item.id) && (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      {canWrite && (
                        <td>
                          <div className="flex flex-wrap gap-1.5">
                            <Button size="sm" variant="outline" onClick={() => setAdjustItem(item)}>
                              تعديل الكمية
                            </Button>
                            <Button size="sm" variant="secondary" onClick={() => setEditItem(item)}>
                              السعر/الحد/الانتهاء
                            </Button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {canWrite && (
        <>
          <AdjustQtyModal
            open={adjustItem !== null}
            onClose={() => setAdjustItem(null)}
            item={adjustItem}
            onAdjusted={handleUpdated}
          />
          <EditMetaModal
            open={editItem !== null}
            onClose={() => setEditItem(null)}
            item={editItem}
            onSaved={handleUpdated}
          />
        </>
      )}
    </div>
  );
}

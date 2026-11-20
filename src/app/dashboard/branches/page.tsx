"use client";

/**
 * /dashboard/branches — branch management (plan doc §3: "branch management without code
 * changes"). Requires PERMISSION_KEYS.BRANCHES_MANAGE; the sidebar already hides the nav
 * link for roles without it, but this page still checks defensively in case it's reached
 * directly by URL.
 *
 * NOTE: never import anything from "@prisma/client" here — this sandbox's local generated
 * Prisma client is a known-broken stub. Status/enum-like values coming back in API JSON are
 * typed with plain string-literal unions instead (see ./[...]/types.ts and BranchStatus
 * below), which is correct against the real backend regardless of this sandbox limitation.
 */

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/apiClient";
import { useHasPermission } from "@/lib/userContext";
import { PERMISSION_KEYS } from "@/lib/permissionKeys";
import {
  PageHeader,
  Card,
  CardBody,
  Button,
  Badge,
  FullPageSpinner,
  EmptyState,
  Alert,
} from "@/components/ui";
import { BranchFormModal } from "@/components/branches/BranchFormModal";
import type { Branch } from "@/components/branches/types";

export default function BranchesPage() {
  const canManage = useHasPermission(PERMISSION_KEYS.BRANCHES_MANAGE);

  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.get<{ branches: Branch[] }>("/api/branches?includeDisabled=true");
      setBranches(data.branches);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "تعذّر تحميل الفروع");
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
        <PageHeader title="الفروع" />
        <Card>
          <CardBody>
            <EmptyState
              title="لا تملك صلاحية الوصول لهذه الصفحة"
              description="إدارة الفروع تتطلب صلاحية خاصة غير متوفرة لحسابك الحالي."
            />
          </CardBody>
        </Card>
      </div>
    );
  }

  if (loading) return <FullPageSpinner label="جارِ تحميل الفروع..." />;

  function openCreate() {
    setEditingBranch(null);
    setActionError(null);
    setModalOpen(true);
  }

  function openEdit(branch: Branch) {
    setEditingBranch(branch);
    setActionError(null);
    setModalOpen(true);
  }

  function handleSaved(branch: Branch) {
    setBranches((prev) => {
      if (!prev) return [branch];
      const exists = prev.some((b) => b.id === branch.id);
      return exists ? prev.map((b) => (b.id === branch.id ? branch : b)) : [...prev, branch];
    });
  }

  async function toggleStatus(branch: Branch) {
    setActionError(null);
    setBusyId(branch.id);
    try {
      const nextStatus = branch.status === "ACTIVE" ? "DISABLED" : "ACTIVE";
      const result = await api.patch<{ branch: Branch }>(`/api/branches/${branch.id}`, { status: nextStatus });
      handleSaved(result.branch);
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "تعذّر تغيير حالة الفرع");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(branch: Branch) {
    if (!window.confirm(`هل أنت متأكد من حذف فرع "${branch.name}" بشكل نهائي؟ لا يمكن التراجع عن هذا الإجراء.`)) {
      return;
    }
    setActionError(null);
    setBusyId(branch.id);
    try {
      await api.delete(`/api/branches/${branch.id}`);
      setBranches((prev) => (prev ? prev.filter((b) => b.id !== branch.id) : prev));
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "تعذّر حذف الفرع");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="الفروع"
        description="إدارة فروع الصيدلية — الإضافة، التعديل، التعطيل، والحذف."
        action={<Button onClick={openCreate}>+ فرع جديد</Button>}
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

      <Card>
        {!branches || branches.length === 0 ? (
          <CardBody>
            <EmptyState
              title="لا توجد فروع بعد"
              description="أضف أول فرع للصيدلية للبدء."
              action={<Button onClick={openCreate}>+ فرع جديد</Button>}
            />
          </CardBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="pacc-table">
              <thead>
                <tr>
                  <th>الاسم</th>
                  <th>العنوان / الهاتف</th>
                  <th>واتساب</th>
                  <th>الحالة</th>
                  <th>ملاحظات</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {branches.map((branch) => (
                  <tr key={branch.id}>
                    <td className="font-medium text-slate-800">{branch.name}</td>
                    <td className="text-slate-500">
                      <div>{branch.address || "—"}</div>
                      {branch.phone && <div className="text-xs text-slate-400">{branch.phone}</div>}
                    </td>
                    <td className="text-slate-500">{branch.whatsappNumber || "—"}</td>
                    <td>
                      <Badge tone={branch.status === "ACTIVE" ? "success" : "neutral"}>
                        {branch.status === "ACTIVE" ? "فعّال" : "معطّل"}
                      </Badge>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1.5">
                        {branch.isBekaaExclusive && (
                          <Badge tone="info">حصري لمنطقة البقاع</Badge>
                        )}
                        {branch.specialDeliveryContactWhatsapp && (
                          <Badge tone="brand">
                            توصيل خاص{branch.specialDeliveryContactLabel ? `: ${branch.specialDeliveryContactLabel}` : ""} (
                            {branch.specialDeliveryContactWhatsapp})
                          </Badge>
                        )}
                        {!branch.isBekaaExclusive && !branch.specialDeliveryContactWhatsapp && (
                          <span className="text-xs text-slate-300">—</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1.5">
                        <Button size="sm" variant="outline" onClick={() => openEdit(branch)}>
                          تعديل
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={busyId === branch.id}
                          onClick={() => toggleStatus(branch)}
                        >
                          {branch.status === "ACTIVE" ? "تعطيل" : "تفعيل"}
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          loading={busyId === branch.id}
                          onClick={() => handleDelete(branch)}
                        >
                          حذف
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

      <BranchFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        branch={editingBranch}
        onSaved={handleSaved}
      />
    </div>
  );
}

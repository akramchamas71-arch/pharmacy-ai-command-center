"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/apiClient";
import { useHasPermission } from "@/lib/userContext";
import { PERMISSION_KEYS } from "@/lib/permissionKeys";
import {
  PageHeader,
  Card,
  CardBody,
  FullPageSpinner,
  EmptyState,
  Alert,
  Button,
  Modal,
  Input,
  Field,
} from "@/components/ui";
import { DriverAvailabilityBadge } from "@/components/drivers/DriverAvailabilityBadge";
import type { Driver } from "@/components/drivers/driverTypes";

export default function DriversPage() {
  const canView = useHasPermission(PERMISSION_KEYS.DELIVERY_MANAGE);
  const canCreate = useHasPermission(PERMISSION_KEYS.USERS_MANAGE);

  const [drivers, setDrivers] = useState<Driver[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createLoading, setCreateLoading] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "", vehicle: "" });

  const loadDrivers = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.get<{ drivers: Driver[] }>("/api/drivers");
      setDrivers(data.drivers);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "تعذّر تحميل قائمة السائقين");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView]);

  useEffect(() => {
    loadDrivers();
  }, [loadDrivers]);

  function openCreateModal() {
    setForm({ name: "", email: "", phone: "", password: "", vehicle: "" });
    setCreateError(null);
    setCreateOpen(true);
  }

  async function handleCreate() {
    if (!form.name.trim() || !form.password.trim() || (!form.email.trim() && !form.phone.trim())) {
      setCreateError("الاسم وكلمة المرور مطلوبان، ويجب إدخال بريد إلكتروني أو رقم هاتف على الأقل.");
      return;
    }
    setCreateLoading(true);
    setCreateError(null);
    try {
      await api.post("/api/drivers", {
        name: form.name.trim(),
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        password: form.password,
        vehicle: form.vehicle.trim() || undefined,
      });
      setCreateOpen(false);
      await loadDrivers();
    } catch (e) {
      setCreateError(e instanceof ApiError ? e.message : "تعذّر إنشاء حساب السائق");
    } finally {
      setCreateLoading(false);
    }
  }

  if (!canView) {
    return (
      <div>
        <PageHeader title="السائقون" />
        <Card>
          <CardBody>
            <EmptyState title="لا تملك صلاحية الاطلاع على قائمة السائقين" />
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="السائقون"
        description="قائمة سائقي التوصيل الداخليين المسجّلين في النظام"
        action={canCreate ? <Button onClick={openCreateModal}>+ سائق جديد</Button> : undefined}
      />

      <Card>
        {loading ? (
          <CardBody>
            <FullPageSpinner label="جارِ تحميل السائقين..." />
          </CardBody>
        ) : loadError ? (
          <CardBody>
            <Alert tone="danger">{loadError}</Alert>
          </CardBody>
        ) : !drivers || drivers.length === 0 ? (
          <CardBody>
            <EmptyState
              title="لا يوجد سائقون مسجّلون بعد"
              description="يمكنك إضافة سائق جديد، أو أن التوصيل يتم حالياً عبر خطوط خارجية (كير لينك، شركات التوصيل) غير مدارة من هنا."
              action={
                canCreate ? (
                  <Button className="mt-3" onClick={openCreateModal}>
                    + سائق جديد
                  </Button>
                ) : undefined
              }
            />
          </CardBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="pacc-table">
              <thead>
                <tr>
                  <th>الاسم</th>
                  <th>الهاتف / البريد الإلكتروني</th>
                  <th>المركبة</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {drivers.map((d) => (
                  <tr key={d.id}>
                    <td className="font-semibold text-slate-700">{d.user.name}</td>
                    <td>{d.user.phone || d.user.email || "—"}</td>
                    <td>{d.vehicle || "—"}</td>
                    <td>
                      <DriverAvailabilityBadge availability={d.availability} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="إضافة سائق جديد">
        <div className="space-y-4">
          {createError && <Alert tone="danger">{createError}</Alert>}
          <Field label="الاسم الكامل">
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="مثال: محمد علي" />
          </Field>
          <Field label="رقم الهاتف" hint="أدخل رقم الهاتف أو البريد الإلكتروني على الأقل">
            <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="مثال: 03123456" />
          </Field>
          <Field label="البريد الإلكتروني">
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="example@mail.com"
            />
          </Field>
          <Field label="كلمة المرور" hint="8 أحرف على الأقل">
            <Input
              type="password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            />
          </Field>
          <Field label="نوع المركبة (اختياري)">
            <Input value={form.vehicle} onChange={(e) => setForm((f) => ({ ...f, vehicle: e.target.value }))} placeholder="مثال: دراجة نارية" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={createLoading}>
              إلغاء
            </Button>
            <Button onClick={handleCreate} loading={createLoading} disabled={createLoading}>
              إضافة السائق
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

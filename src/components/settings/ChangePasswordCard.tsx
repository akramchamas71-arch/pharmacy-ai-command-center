"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/apiClient";
import { Card, CardHeader, CardBody, Button, Input, Field, Alert } from "@/components/ui";

export function ChangePasswordCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    if (next.length < 10) {
      setError("كلمة السر الجديدة يجب ألا تقل عن 10 أحرف");
      return;
    }
    if (next !== confirm) {
      setError("تأكيد كلمة السر غير مطابق");
      return;
    }
    setLoading(true);
    try {
      await api.post("/api/auth/change-password", { currentPassword: current, newPassword: next });
      setSuccess(true);
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "حدث خطأ غير متوقع");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader title="تغيير كلمة السر" subtitle="اختر كلمة قوية من 10 أحرف على الأقل، ولا تشاركها مع أحد" />
      <CardBody>
        <form onSubmit={handleSubmit} className="max-w-md space-y-4">
          {success && <Alert tone="success">تم تغيير كلمة السر بنجاح ✓ استخدم الجديدة في الدخول القادم.</Alert>}
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="كلمة السر الحالية" htmlFor="pw-current">
            <Input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
          </Field>
          <Field label="كلمة السر الجديدة" htmlFor="pw-new">
            <Input id="pw-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
          </Field>
          <Field label="تأكيد كلمة السر الجديدة" htmlFor="pw-confirm">
            <Input id="pw-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </Field>
          <Button type="submit" loading={loading}>
            حفظ كلمة السر
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/apiClient";
import { useCurrentUser } from "@/lib/userContext";
import { ChangePasswordCard } from "@/components/settings/ChangePasswordCard";
import { PageHeader, Card, CardHeader, CardBody, Button, Input, Field, Alert } from "@/components/ui";

const PRIVILEGED_ROLES = ["ADMIN", "SUPER_ADMIN"];

interface SetupResponse {
  base32Secret: string;
  enrollmentUri: string;
  note: string;
}

export default function SecuritySettingsPage() {
  const user = useCurrentUser();
  const router = useRouter();
  const isPrivileged = PRIVILEGED_ROLES.includes(user.role);

  // Local override of the enabled/disabled view: the layout fetched `user` once server-side,
  // so after a successful enable/disable we flip this locally (and call router.refresh() to
  // re-fetch the server-side session for everywhere else, e.g. the sidebar) rather than
  // waiting on a context value that won't update itself on this page.
  const [enabledOverride, setEnabledOverride] = useState<boolean | null>(null);
  const twoFactorEnabled = enabledOverride ?? Boolean(user.twoFactorEnabled);

  const [setupLoading, setSetupLoading] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupData, setSetupData] = useState<SetupResponse | null>(null);

  const [enableToken, setEnableToken] = useState("");
  const [enableLoading, setEnableLoading] = useState(false);
  const [enableError, setEnableError] = useState<string | null>(null);
  const [enableSuccess, setEnableSuccess] = useState(false);

  const [disableToken, setDisableToken] = useState("");
  const [disableLoading, setDisableLoading] = useState(false);
  const [disableError, setDisableError] = useState<string | null>(null);
  const [disableSuccess, setDisableSuccess] = useState(false);

  async function handleStartSetup() {
    setSetupLoading(true);
    setSetupError(null);
    try {
      const res = await api.post<SetupResponse>("/api/auth/2fa/setup");
      setSetupData(res);
    } catch (err) {
      setSetupError(err instanceof ApiError ? err.message : "حدث خطأ غير متوقع أثناء بدء التفعيل");
    } finally {
      setSetupLoading(false);
    }
  }

  async function handleConfirmEnable(e: React.FormEvent) {
    e.preventDefault();
    setEnableLoading(true);
    setEnableError(null);
    try {
      await api.post<{ twoFactorEnabled: true }>("/api/auth/2fa/enable", { token: enableToken.trim() });
      setEnableSuccess(true);
      setEnabledOverride(true);
      setSetupData(null);
      setEnableToken("");
      router.refresh();
    } catch (err) {
      setEnableError(err instanceof ApiError ? err.message : "حدث خطأ غير متوقع أثناء التفعيل");
    } finally {
      setEnableLoading(false);
    }
  }

  async function handleConfirmDisable(e: React.FormEvent) {
    e.preventDefault();
    setDisableLoading(true);
    setDisableError(null);
    try {
      await api.post<{ twoFactorEnabled: false }>("/api/auth/2fa/disable", { token: disableToken.trim() });
      setDisableSuccess(true);
      setEnabledOverride(false);
      setDisableToken("");
      router.refresh();
    } catch (err) {
      setDisableError(err instanceof ApiError ? err.message : "حدث خطأ غير متوقع أثناء التعطيل");
    } finally {
      setDisableLoading(false);
    }
  }

  if (!isPrivileged) {
    return (
      <div>
        <PageHeader title="الأمان" description="التحقق الثنائي (2FA)" />
        <Card>
          <CardBody>
            <Alert tone="info">
              التحقق الثنائي متاح حالياً فقط لحسابات مدير النظام (Admin / Super Admin)، حسب خطة المشروع الحالية. لا
              توجد إجراءات متاحة لدورك الحالي في هذه الصفحة.
            </Alert>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="الأمان" description="كلمة السر والتحقق الثنائي (2FA) لحسابك" />

      <div className="mb-6">
        <ChangePasswordCard />
      </div>

      {!twoFactorEnabled ? (
        <Card>
          <CardHeader
            title="تفعيل التحقق الثنائي"
            subtitle="أضف حماية إضافية لحسابك عبر تطبيق مصادقة على هاتفك"
          />
          <CardBody className="space-y-5">
            {enableSuccess && <Alert tone="success">تم تفعيل التحقق الثنائي على حسابك بنجاح ✓</Alert>}
            {setupError && <Alert tone="danger">{setupError}</Alert>}

            {!setupData ? (
              <Button onClick={handleStartSetup} loading={setupLoading} disabled={setupLoading}>
                تفعيل التحقق الثنائي
              </Button>
            ) : (
              <div className="space-y-4">
                <Alert tone="info">
                  أضف هذا المفتاح يدوياً في تطبيق مصادقة مثل Google Authenticator أو Authy، ثم أدخل الرمز المكوّن من 6
                  أرقام الذي يظهر في التطبيق لتأكيد التفعيل.
                </Alert>

                <div>
                  <p className="mb-1.5 text-xs font-semibold text-slate-600">المفتاح السري (Secret)</p>
                  <div
                    dir="ltr"
                    className="select-all break-all rounded-2xl border-2 border-slate-300 bg-slate-50 p-3 text-left font-mono text-sm text-slate-700"
                  >
                    {setupData.base32Secret}
                  </div>
                </div>

                <div>
                  <p className="mb-1.5 text-xs font-semibold text-slate-600">رابط التفعيل (Enrollment URI)</p>
                  <div
                    dir="ltr"
                    className="select-all break-all rounded-2xl border-2 border-slate-300 bg-slate-50 p-3 text-left font-mono text-xs text-slate-700"
                  >
                    {setupData.enrollmentUri}
                  </div>
                </div>

                <form onSubmit={handleConfirmEnable} className="space-y-3 border-t-2 border-dashed border-slate-300 pt-4">
                  {enableError && <Alert tone="danger">{enableError}</Alert>}
                  <Field label="رمز التحقق المكوّن من 6 أرقام" hint="من تطبيق المصادقة الذي أضفت إليه المفتاح أعلاه">
                    <Input
                      dir="ltr"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={8}
                      value={enableToken}
                      onChange={(e) => setEnableToken(e.target.value)}
                      placeholder="000000"
                      className="text-center font-mono tracking-widest"
                    />
                  </Field>
                  <Button type="submit" loading={enableLoading} disabled={enableLoading || enableToken.trim().length < 6}>
                    تأكيد التفعيل
                  </Button>
                </form>
              </div>
            )}
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-4">
          <Card>
            <CardBody>
              <Alert tone="success">التحقق الثنائي مُفعّل ✓</Alert>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="تعطيل التحقق الثنائي" subtitle="يتطلب إدخال رمز تحقق حالي من تطبيق المصادقة" />
            <CardBody className="space-y-4">
              {disableSuccess && <Alert tone="success">تم تعطيل التحقق الثنائي على حسابك.</Alert>}
              <Alert tone="warning">تعطيل هذه الميزة يقلل من حماية حسابك.</Alert>
              {disableError && <Alert tone="danger">{disableError}</Alert>}

              <form onSubmit={handleConfirmDisable} className="space-y-3">
                <Field label="رمز التحقق المكوّن من 6 أرقام">
                  <Input
                    dir="ltr"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={8}
                    value={disableToken}
                    onChange={(e) => setDisableToken(e.target.value)}
                    placeholder="000000"
                    className="text-center font-mono tracking-widest"
                  />
                </Field>
                <Button
                  type="submit"
                  variant="danger"
                  loading={disableLoading}
                  disabled={disableLoading || disableToken.trim().length < 6}
                >
                  تعطيل التحقق الثنائي
                </Button>
              </form>
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}

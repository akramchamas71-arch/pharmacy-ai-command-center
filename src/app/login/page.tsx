"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/apiClient";
import { Button, Field, Input, Alert, Card } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [totpToken, setTotpToken] = useState("");
  const [needsTwoFactor, setNeedsTwoFactor] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.post("/api/auth/login", {
        identifier,
        password,
        ...(needsTwoFactor && totpToken ? { totpToken } : {}),
      });
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.requiresTwoFactor) {
          setNeedsTwoFactor(true);
          setError(null);
        } else {
          setError(err.message);
        }
      } else {
        setError("تعذّر الاتصال بالخادم. حاول مرة أخرى.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 -rotate-[8deg] items-center justify-center rounded-full border-[2.5px] border-ink bg-brand-600 font-display text-3xl text-white shadow-pop-sm">
            ص
          </div>
          <h1 className="font-display text-xl font-extrabold text-slate-900">PHARMACY AI COMMAND CENTER</h1>
          <p className="mt-1 text-sm text-slate-600">مركز قيادة الصيدلية الذكي — تسجيل الدخول</p>
        </div>

        <Card className="p-6">
          <form onSubmit={onSubmit} className="space-y-4">
            <Field label="البريد الإلكتروني أو رقم الهاتف" htmlFor="identifier">
              <Input
                id="identifier"
                autoComplete="username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="example@domain.com"
                required
                disabled={needsTwoFactor}
              />
            </Field>
            <Field label="كلمة المرور" htmlFor="password">
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={needsTwoFactor}
              />
            </Field>

            {needsTwoFactor && (
              <Field
                label="رمز التحقق الثنائي (2FA)"
                htmlFor="totp"
                hint="افتح تطبيق المصادقة على هاتفك وأدخل الرمز المكوّن من 6 أرقام"
              >
                <Input
                  id="totp"
                  inputMode="numeric"
                  autoFocus
                  maxLength={6}
                  value={totpToken}
                  onChange={(e) => setTotpToken(e.target.value.replace(/\D/g, ""))}
                  placeholder="000000"
                  required
                />
              </Field>
            )}

            {error && <Alert tone="danger">{error}</Alert>}

            <Button type="submit" className="w-full" loading={loading}>
              {needsTwoFactor ? "تأكيد الدخول" : "تسجيل الدخول"}
            </Button>

            {needsTwoFactor && (
              <button
                type="button"
                onClick={() => {
                  setNeedsTwoFactor(false);
                  setTotpToken("");
                  setError(null);
                }}
                className="w-full text-center text-xs text-slate-400 hover:text-slate-600"
              >
                رجوع لتعديل بيانات الدخول
              </button>
            )}
          </form>
        </Card>
      </div>
    </main>
  );
}

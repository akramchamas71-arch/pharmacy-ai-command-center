"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { btn, input, shopFetch } from "../api";

export default function ShopLogin() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode() {
    setBusy(true);
    setError(null);
    try {
      await shopFetch("/api/shop/auth/request-code", { body: { phone } });
      setStep("code");
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطأ");
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      await shopFetch("/api/shop/auth/verify", { body: { phone, code } });
      router.replace("/shop");
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطأ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex flex-1 flex-col justify-center gap-6 p-6">
      <div className="text-center">
        <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full border-[2.5px] border-ink bg-teal-700 text-3xl text-white shadow-pop-sm">✚</div>
        <h1 className="font-display text-2xl font-extrabold text-slate-900">Carelink</h1>
        <p className="mt-1 text-sm text-slate-600">اطلب من الصيدليات الشريكة وتوصيل إلى بيتك</p>
      </div>

      {step === "phone" ? (
        <div className="space-y-3">
          <label className="block text-sm font-bold text-slate-700">رقم هاتفك (عليه واتساب)</label>
          <input className={input} inputMode="tel" dir="ltr" placeholder="70 123 456" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <button className={`${btn} w-full bg-teal-700 text-white`} disabled={busy || phone.replace(/\D/g, "").length < 7} onClick={sendCode}>
            {busy ? "جارٍ الإرسال..." : "أرسل رمز الدخول على واتساب"}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <label className="block text-sm font-bold text-slate-700">أدخل الرمز الذي وصلك على واتساب</label>
          <input className={`${input} text-center text-2xl tracking-[0.4em]`} inputMode="numeric" dir="ltr" maxLength={6} autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
          <button className={`${btn} w-full bg-teal-700 text-white`} disabled={busy || code.length !== 6} onClick={verify}>
            {busy ? "جارٍ التحقق..." : "دخول"}
          </button>
          <button className="w-full text-sm font-bold text-slate-500 underline" onClick={() => { setStep("phone"); setCode(""); }}>
            تغيير الرقم
          </button>
        </div>
      )}

      {error && <p className="rounded-2xl border-2 border-red-300 bg-red-50 p-3 text-center text-sm font-bold text-red-700">{error}</p>}

      <p className="text-center text-xs text-slate-500">
        باستخدامك التطبيق توافق على <a className="underline" href="/privacy">سياسة الخصوصية</a>. هذا التطبيق لا يقدّم استشارة طبية — استشر طبيبك أو الصيدلي.
      </p>
    </main>
  );
}

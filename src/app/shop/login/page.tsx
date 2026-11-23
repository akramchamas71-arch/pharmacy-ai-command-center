"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { btn, shopFetch } from "../api";

/**
 * Login = send one ready-made WhatsApp message to Carelink. No password, no SMS, no template:
 * the message itself proves the customer owns the number. This page waits for it and logs in.
 */
export default function ShopLogin() {
  const router = useRouter();
  const [link, setLink] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Coming back from WhatsApp may reload this page: resume waiting if a login is in progress.
    shopFetch<{ done: boolean; expired?: boolean }>("/api/shop/auth/wa-poll")
      .then((r) => { if (r.done) router.replace("/shop"); else if (!r.expired) startPolling(); })
      .catch(() => {});
    return () => { if (poll.current) clearInterval(poll.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startPolling() {
    if (poll.current) clearInterval(poll.current);
    setWaiting(true);
    const startedAt = Date.now();
    poll.current = setInterval(async () => {
      try {
        const r = await shopFetch<{ done: boolean; expired?: boolean }>("/api/shop/auth/wa-poll");
        if (r.done) {
          if (poll.current) clearInterval(poll.current);
          router.replace("/shop");
        } else if (r.expired || Date.now() - startedAt > 14 * 60 * 1000) {
          if (poll.current) clearInterval(poll.current);
          setWaiting(false);
          setLink(null);
          setError("انتهت مهلة الدخول. اضغط الزر مرة أخرى.");
        }
      } catch {}
    }, 2000);
  }

  async function begin() {
    setBusy(true);
    setError(null);
    try {
      const r = await shopFetch<{ token: string; waLink: string }>("/api/shop/auth/wa-start", { body: {} });
      setLink(r.waLink);
      setToken(r.token);
      startPolling();
      // Opens WhatsApp with the message ready to send; this page keeps waiting in the background.
      if (!window.open(r.waLink, "_blank")) window.location.href = r.waLink;
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطأ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex flex-1 flex-col justify-center gap-6 p-6">
      <div className="text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/logo.jpg" alt="Carelink — Beauty · Care · Confidence" className="mx-auto mb-2 w-56 rounded-3xl" />
        <p className="mt-1 text-sm text-slate-600">اطلب من الصيدليات الشريكة وتوصيل إلى بيتك</p>
      </div>

      {!waiting ? (
        <div className="space-y-3">
          <button className={`${btn} w-full bg-[#25D366] text-ink`} disabled={busy} onClick={begin}>
            {busy ? "لحظة..." : "الدخول عبر واتساب"}
          </button>
          <p className="text-center text-xs text-slate-500">سيفتح واتساب وفيه رسالة جاهزة — اضغط «إرسال» ثم ارجع إلى هنا.</p>
        </div>
      ) : (
        <div className="space-y-3 rounded-3xl border-2 border-ink bg-white p-5 text-center">
          <p className="font-bold text-slate-800">بانتظار رسالتك على واتساب...</p>
          <p className="text-sm text-slate-600">أرسل الرسالة الجاهزة في واتساب، وسيتم دخولك هنا تلقائياً.</p>
          {token && <p className="font-mono text-lg font-extrabold tracking-widest text-[#9e5f69]" dir="ltr">{token}</p>}
          {link && (
            <a href={link} className={`${btn} block w-full bg-[#25D366] text-ink`}>افتح واتساب مرة أخرى</a>
          )}
        </div>
      )}

      {error && <p className="rounded-2xl border-2 border-red-300 bg-red-50 p-3 text-center text-sm font-bold text-red-700">{error}</p>}

      <p className="text-center text-xs text-slate-500">
        باستخدامك التطبيق توافق على <a className="underline" href="/privacy">سياسة الخصوصية</a>. هذا التطبيق لا يقدّم استشارة طبية — استشر طبيبك أو الصيدلي.
      </p>
    </main>
  );
}

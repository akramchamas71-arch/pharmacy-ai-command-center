"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { btn, shopFetch } from "../api";
import { LangToggle, useLang } from "../i18n";

/**
 * Login = send one ready-made WhatsApp message to Carelink. No password, no SMS, no template:
 * the message itself proves the customer owns the number. This page waits for it and logs in.
 */
export default function ShopLogin() {
  const router = useRouter();
  const { t: tr } = useLang();
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
          setError(tr("انتهت مهلة الدخول. اضغط الزر مرة أخرى.", "Login timed out. Press the button again."));
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
      setError(e instanceof Error ? e.message : tr("خطأ", "Error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex flex-1 flex-col justify-center gap-5 p-4">
      <div className="flex justify-end"><LangToggle className="border-ink text-ink" /></div>
      <div className="text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/promo-delivery.jpg" alt="Carelink — طلبك يوصل إلى باب بيتك: منتجات العناية والجمال والمكملات ومستلزمات الأطفال" className="mx-auto w-full rounded-3xl border-2 border-ink shadow-pop-sm" />
      </div>

      {!waiting ? (
        <div className="space-y-3">
          <button className={`${btn} w-full bg-[#25D366] text-ink`} disabled={busy} onClick={begin}>
            {busy ? tr("لحظة...", "One moment...") : tr("الدخول عبر واتساب", "Sign in with WhatsApp")}
          </button>
          <p className="text-center text-xs text-slate-500">{tr("سيفتح واتساب وفيه رسالة جاهزة — اضغط «إرسال» ثم ارجع إلى هنا.", "WhatsApp will open with a ready message — tap «Send», then come back here.")}</p>
        </div>
      ) : (
        <div className="space-y-3 rounded-3xl border-2 border-ink bg-white p-5 text-center">
          <p className="font-bold text-slate-800">{tr("بانتظار رسالتك على واتساب...", "Waiting for your WhatsApp message...")}</p>
          <p className="text-sm text-slate-600">{tr("أرسل الرسالة الجاهزة في واتساب، وسيتم دخولك هنا تلقائياً.", "Send the ready message in WhatsApp and you will be signed in here automatically.")}</p>
          {token && <p className="font-mono text-lg font-extrabold tracking-widest text-[#9e5f69]" dir="ltr">{token}</p>}
          {link && (
            <a href={link} className={`${btn} block w-full bg-[#25D366] text-ink`}>{tr("افتح واتساب مرة أخرى", "Open WhatsApp again")}</a>
          )}
        </div>
      )}

      {error && <p className="rounded-2xl border-2 border-red-300 bg-red-50 p-3 text-center text-sm font-bold text-red-700">{error}</p>}

      <p className="text-center text-xs text-slate-500">
        {tr("باستخدامك التطبيق توافق على", "By using the app you agree to the")} <a className="underline" href="/privacy">{tr("سياسة الخصوصية", "privacy policy")}</a>. {tr("المعلومات الصحية في التطبيق عامة ولا تغني عن الطبيب.", "Health information in the app is general and does not replace a doctor.")}
      </p>
    </main>
  );
}

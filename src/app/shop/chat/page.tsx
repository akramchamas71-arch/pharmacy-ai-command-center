"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { btn, resizeImage, shopFetch } from "../api";

interface Msg { id: string; fromCustomer: boolean; text: string; at: string }

export default function ShopChat() {
  const [messages, setMessages] = useState<Msg[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const d = await shopFetch<{ messages: Msg[] }>("/api/shop/thread");
      setMessages((prev) => (prev && prev.length === d.messages.length ? prev : d.messages));
    } catch {}
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [messages?.length]);

  async function send(image?: string) {
    if (!text.trim() && !image) return;
    setBusy(true);
    setError(null);
    try {
      await shopFetch("/api/shop/message", { body: { text, image } });
      setText("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطأ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="sticky top-0 z-10 flex items-center justify-between border-b-2 border-ink bg-teal-700 px-4 py-3 text-white">
        <Link href="/shop" className="rounded-full border-2 border-white px-3 py-1.5 text-sm font-bold">→ المتجر</Link>
        <p className="font-display text-lg font-extrabold">طلباتي ومحادثتي</p>
      </header>

      <main className="flex-1 space-y-2 overflow-y-auto p-4 pb-32">
        {messages === null && <p className="text-center text-sm text-slate-500">جارٍ التحميل...</p>}
        {messages?.length === 0 && <p className="text-center text-sm text-slate-500">لا توجد طلبات بعد. اطلب من المتجر أو اكتب لنا هنا.</p>}
        {messages?.map((m) => (
          <div key={m.id} className={`flex ${m.fromCustomer ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-3xl border-2 border-ink px-4 py-2.5 text-sm shadow-[0_2px_0_#1d2b4f] ${m.fromCustomer ? "bg-white" : "bg-teal-700 text-white"}`}>
              <p className="whitespace-pre-wrap break-words" dir="auto">{m.text}</p>
              <p className={`mt-1 text-[10px] ${m.fromCustomer ? "text-slate-400" : "text-teal-100"}`}>
                {new Date(m.at).toLocaleString("ar-LB", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}
              </p>
            </div>
          </div>
        ))}
        {busy && <p className="text-center text-xs text-slate-500">جارٍ الإرسال...</p>}
        <div ref={bottom} />
      </main>

      <div className="fixed inset-x-0 bottom-0 z-10 mx-auto max-w-md border-t-2 border-ink bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {error && <p className="mb-2 text-center text-xs font-bold text-red-700">{error}</p>}
        <div className="flex items-end gap-2">
          <label className="flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-2xl border-2 border-ink text-xl" title="أرفق صورة وصفة">
            📎
            <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) { const img = await resizeImage(f).catch(() => null); if (img) send(img); }
              e.target.value = "";
            }} />
          </label>
          <textarea rows={1} className="min-h-12 flex-1 resize-none rounded-2xl border-2 border-slate-300 px-3 py-3 text-base focus:border-ink focus:outline-none" placeholder="اكتب رسالتك..." value={text} onChange={(e) => setText(e.target.value)} />
          <button className={`${btn} shrink-0 bg-teal-700 px-4 text-white`} disabled={busy || !text.trim()} onClick={() => send()}>إرسال</button>
        </div>
      </div>
    </>
  );
}

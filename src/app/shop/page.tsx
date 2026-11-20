"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { btn, input, resizeImage, shopFetch } from "./api";

interface Product { id: string; name: string; brand: string | null; type: string; available: boolean }
interface CartLine { product: Product; qty: number }
interface Me { name: string | null; phone: string; address: string | null }

const RX = (t: string) => t === "PRESCRIPTION";
const CTRL = (t: string) => t === "CONTROLLED";

export default function ShopHome() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [searching, setSearching] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [step, setStep] = useState<"browse" | "checkout">("browse");
  const [area, setArea] = useState("");
  const [address, setAddress] = useState("");
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [rxImage, setRxImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    shopFetch<{ customer: Me }>("/api/shop/me")
      .then(({ customer }) => {
        setMe(customer);
        setName(customer.name ?? "");
        if (customer.address) {
          const [a, ...rest] = customer.address.split(" - ");
          setArea(a);
          setAddress(rest.join(" - "));
        }
      })
      .catch(() => {});
    try {
      const saved = localStorage.getItem("carelink-cart");
      if (saved) setCart(JSON.parse(saved));
    } catch {}
  }, []);

  useEffect(() => {
    try { localStorage.setItem("carelink-cart", JSON.stringify(cart)); } catch {}
  }, [cart]);

  function onSearch(v: string) {
    setQ(v);
    if (timer.current) clearTimeout(timer.current);
    if (v.trim().length < 2) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const d = await shopFetch<{ products: Product[] }>(`/api/shop/products?q=${encodeURIComponent(v.trim())}`);
        setResults(d.products);
      } catch {} finally { setSearching(false); }
    }, 350);
  }

  function add(p: Product) {
    setCart((c) => {
      const ex = c.find((l) => l.product.id === p.id);
      return ex ? c.map((l) => (l.product.id === p.id ? { ...l, qty: Math.min(20, l.qty + 1) } : l)) : [...c, { product: p, qty: 1 }];
    });
  }
  function setQty(id: string, qty: number) {
    setCart((c) => (qty <= 0 ? c.filter((l) => l.product.id !== id) : c.map((l) => (l.product.id === id ? { ...l, qty: Math.min(20, qty) } : l))));
  }

  const needsRx = cart.some((l) => RX(l.product.type));
  const count = cart.reduce((s, l) => s + l.qty, 0);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await shopFetch("/api/shop/order", {
        body: {
          items: cart.map((l) => ({ productId: l.product.id, qty: l.qty })),
          area, address, name: name || undefined, notes: notes || undefined,
          prescription: needsRx ? rxImage : undefined,
        },
      });
      setCart([]);
      router.push("/shop/chat");
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطأ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="sticky top-0 z-10 flex items-center justify-between border-b-2 border-ink bg-teal-700 px-4 py-3 text-white">
        <div>
          <p className="font-display text-xl font-extrabold">Carelink</p>
          <p className="text-[11px] opacity-90">{me ? `أهلاً ${me.name ?? ""}` : "..."}</p>
        </div>
        <Link href="/shop/chat" className="rounded-full border-2 border-white px-3 py-1.5 text-sm font-bold">طلباتي 💬</Link>
      </header>

      {step === "browse" ? (
        <main className="flex-1 space-y-3 p-4 pb-28">
          <input className={input} placeholder="ابحث عن دواء أو منتج..." value={q} onChange={(e) => onSearch(e.target.value)} />
          {searching && <p className="text-center text-sm text-slate-500">جارٍ البحث...</p>}
          {!searching && q.trim().length >= 2 && results.length === 0 && (
            <p className="rounded-2xl bg-white p-4 text-center text-sm text-slate-600">
              لم نجده في القائمة. <Link href="/shop/chat" className="font-bold text-teal-700 underline">اكتب لنا اسمه</Link> ونبحث لك عنه.
            </p>
          )}
          <ul className="space-y-2">
            {results.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 rounded-2xl border-2 border-slate-200 bg-white p-3">
                <div className="min-w-0">
                  <p className="truncate font-bold text-slate-900" dir="auto">{p.name}</p>
                  <p className="text-xs text-slate-500">
                    {p.brand ? `${p.brand} · ` : ""}
                    {p.available ? <span className="text-teal-700">متوفر</span> : <span className="text-amber-700">نتحقق من توفره</span>}
                    {RX(p.type) && <span className="mr-1 rounded-full bg-amber-100 px-2 text-amber-800">بوصفة</span>}
                  </p>
                </div>
                {CTRL(p.type) ? (
                  <span className="shrink-0 text-xs text-slate-500">حضورياً فقط</span>
                ) : (
                  <button className={`${btn} shrink-0 bg-sun px-3 py-2 text-sm text-ink`} onClick={() => add(p)}>+ أضف</button>
                )}
              </li>
            ))}
          </ul>

          {cart.length > 0 && (
            <section className="space-y-2 rounded-3xl border-2 border-ink bg-white p-4">
              <p className="font-extrabold">سلّتك</p>
              {cart.map((l) => (
                <div key={l.product.id} className="flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-sm" dir="auto">{l.product.name}</p>
                  <div className="flex shrink-0 items-center gap-2">
                    <button className="h-8 w-8 rounded-full border-2 border-ink font-bold" onClick={() => setQty(l.product.id, l.qty - 1)}>−</button>
                    <span className="w-5 text-center font-bold">{l.qty}</span>
                    <button className="h-8 w-8 rounded-full border-2 border-ink font-bold" onClick={() => setQty(l.product.id, l.qty + 1)}>+</button>
                  </div>
                </div>
              ))}
            </section>
          )}
          <p className="pt-2 text-center text-xs text-slate-500">السعر النهائي تؤكده الصيدلية قبل التوصيل. لا يقدّم التطبيق استشارة طبية.</p>
        </main>
      ) : (
        <main className="flex-1 space-y-3 p-4 pb-28">
          <button className="text-sm font-bold text-slate-600" onClick={() => setStep("browse")}>→ رجوع</button>
          <label className="block text-sm font-bold">الاسم</label>
          <input className={input} value={name} onChange={(e) => setName(e.target.value)} />
          <label className="block text-sm font-bold">المنطقة</label>
          <input className={input} placeholder="مثال: بعلبك، زحلة، الضاحية، بيروت" value={area} onChange={(e) => setArea(e.target.value)} />
          <label className="block text-sm font-bold">العنوان بالتفصيل</label>
          <textarea className={input} rows={2} placeholder="الشارع، البناية، الطابق، علامة مميزة" value={address} onChange={(e) => setAddress(e.target.value)} />
          <label className="block text-sm font-bold">ملاحظات (اختياري)</label>
          <textarea className={input} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          {needsRx && (
            <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-3">
              <p className="mb-2 text-sm font-bold text-amber-900">طلبك فيه دواء بوصفة طبية — صوّر الوصفة:</p>
              <input type="file" accept="image/*" capture="environment" onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) setRxImage(await resizeImage(f).catch(() => null));
              }} />
              {rxImage && <p className="mt-2 text-xs font-bold text-teal-700">✓ تم إرفاق الوصفة</p>}
            </div>
          )}
          {error && <p className="rounded-2xl border-2 border-red-300 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p>}
        </main>
      )}

      {cart.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-10 mx-auto max-w-md border-t-2 border-ink bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {step === "browse" ? (
            <button className={`${btn} w-full bg-teal-700 text-white`} onClick={() => setStep("checkout")}>متابعة الطلب ({count})</button>
          ) : (
            <button className={`${btn} w-full bg-teal-700 text-white`}
              disabled={busy || area.trim().length < 2 || address.trim().length < 3 || (needsRx && !rxImage)} onClick={submit}>
              {busy ? "جارٍ الإرسال..." : "أرسل الطلب"}
            </button>
          )}
        </div>
      )}
    </>
  );
}

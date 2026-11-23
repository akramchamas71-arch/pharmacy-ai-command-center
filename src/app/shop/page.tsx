"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { btn, input, resizeImage, shopFetch } from "./api";

interface Product { id: string; name: string; brand: string | null; type: string; available: boolean; price?: number | null }
interface DItem { id: string; name: string; cat: string; price: number; image: string }
interface CItem { id: string; name: string; type: string; price: number | null; image: string | null; available: boolean }
interface LItem { id: string; brand: string; brandKey: string; name: string; size: string; price: number; isNew: boolean; image: string | null }
type CartLine =
  | { kind: "pharmacy"; key: string; product: Product; qty: number }
  | { kind: "lattafa"; key: string; item: LItem; qty: number }
  | { kind: "deborah"; key: string; item: DItem; qty: number };
interface Me { name: string | null; phone: string; address: string | null }

const RX = (t: string) => t === "PRESCRIPTION";
const CTRL = (t: string) => t === "CONTROLLED";
const CART_KEY = "carelink-cart-v2";
const usd = (n: number) => `${Math.round(n)}$`;

export default function ShopHome() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<"pharmacy" | "cosmetics" | "lattafa" | "deborah">("pharmacy");
  const [step, setStep] = useState<"browse" | "checkout">("browse");
  const [cart, setCart] = useState<CartLine[]>([]);

  // pharmacy search
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // lattafa catalog
  const [catalog, setCatalog] = useState<LItem[] | null>(null);
  const [brand, setBrand] = useState<string>("NEW");
  const [lq, setLq] = useState("");
  const [shown, setShown] = useState(40);

  // DEBORAH catalog
  const [dcat, setDcat] = useState<{ key: string; label: string }[]>([]);
  const [ditems, setDitems] = useState<DItem[] | null>(null);
  const [dsel, setDsel] = useState("ALL");

  // drug browse (before searching)
  const [letter, setLetter] = useState("");
  const [drugs, setDrugs] = useState<Product[] | null>(null);
  const [dnext, setDnext] = useState<number | null>(null);
  const [dloading, setDloading] = useState(false);

  // cosmetics catalog
  const [cats, setCats] = useState<{ key: string; label: string }[]>([]);
  const [cat, setCat] = useState("skin");
  const [cq, setCq] = useState("");
  const [citems, setCitems] = useState<CItem[] | null>(null);
  const [cnext, setCnext] = useState<number | null>(null);
  const [cloading, setCloading] = useState(false);
  const ctimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // checkout
  const [area, setArea] = useState("");
  const [address, setAddress] = useState("");
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [rxImage, setRxImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const saved = localStorage.getItem(CART_KEY);
      if (saved) setCart(JSON.parse(saved));
    } catch {}
  }, []);

  useEffect(() => {
    try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch {}
  }, [cart]);

  useEffect(() => {
    if (tab === "lattafa" && !catalog) {
      shopFetch<{ items: LItem[] }>("/api/shop/lattafa").then((d) => setCatalog(d.items)).catch(() => setCatalog([]));
    }
  }, [tab, catalog]);

  useEffect(() => {
    if (tab === "deborah" && !ditems) {
      shopFetch<{ categories: { key: string; label: string }[]; items: DItem[] }>("/api/shop/deborah")
        .then((d) => { setDcat(d.categories); setDitems(d.items); })
        .catch(() => setDitems([]));
    }
  }, [tab, ditems]);

  async function loadDrugs(l: string, offset: number) {
    setDloading(true);
    try {
      const d = await shopFetch<{ products: Product[]; nextOffset: number | null }>(
        `/api/shop/products?letter=${encodeURIComponent(l)}&offset=${offset}`
      );
      setDrugs((prev) => (offset > 0 && prev ? [...prev, ...d.products] : d.products));
      setDnext(d.nextOffset);
    } catch {
      if (offset === 0) setDrugs([]);
    } finally {
      setDloading(false);
    }
  }

  useEffect(() => {
    if (tab === "pharmacy" && drugs === null) loadDrugs("", 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function loadCosmetics(c: string, term: string, offset: number) {
    setCloading(true);
    try {
      const d = await shopFetch<{ categories: { key: string; label: string }[]; items: CItem[]; nextOffset: number | null }>(
        `/api/shop/cosmetics?cat=${encodeURIComponent(c)}&q=${encodeURIComponent(term)}&offset=${offset}`
      );
      setCats(d.categories);
      setCitems((prev) => (offset > 0 && prev ? [...prev, ...d.items] : d.items));
      setCnext(d.nextOffset);
    } catch {
      if (offset === 0) setCitems([]);
    } finally {
      setCloading(false);
    }
  }

  useEffect(() => {
    if (tab === "cosmetics" && citems === null) loadCosmetics(cat, "", 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  function onCosmeticSearch(v: string) {
    setCq(v);
    if (ctimer.current) clearTimeout(ctimer.current);
    ctimer.current = setTimeout(() => loadCosmetics(cat, v.trim().length >= 2 ? v.trim() : "", 0), 350);
  }

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

  function addLine(line: CartLine) {
    setCart((c) => {
      const ex = c.find((l) => l.key === line.key);
      return ex ? c.map((l) => (l.key === line.key ? { ...l, qty: Math.min(20, l.qty + 1) } : l)) : [...c, line];
    });
  }
  function setQty(key: string, qty: number) {
    setCart((c) => (qty <= 0 ? c.filter((l) => l.key !== key) : c.map((l) => (l.key === key ? { ...l, qty: Math.min(20, qty) } : l))));
  }

  const brands = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of catalog ?? []) if (!m.has(i.brandKey)) m.set(i.brandKey, i.brand);
    return [...m.entries()];
  }, [catalog]);

  const lattafaList = useMemo(() => {
    const term = lq.trim().toUpperCase();
    return (catalog ?? []).filter((i) => {
      if (term) return `${i.name} ${i.size} ${i.brand}`.toUpperCase().includes(term);
      if (brand === "NEW") return i.isNew;
      return brand === "ALL" || i.brandKey === brand;
    }).sort((a, b) => Number(!!b.image) - Number(!!a.image));
  }, [catalog, brand, lq]);

  const needsRx = cart.some((l) => l.kind === "pharmacy" && RX(l.product.type));
  const count = cart.reduce((s, l) => s + l.qty, 0);
  const lattafaTotal = cart.reduce((s, l) => s + (l.kind === "lattafa" ? l.item.price * l.qty : 0), 0);
  const deborahTotal = cart.reduce((s, l) => s + (l.kind === "deborah" ? l.item.price * l.qty : 0), 0);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await shopFetch("/api/shop/order", {
        body: {
          items: cart.filter((l) => l.kind === "pharmacy").map((l) => ({ productId: (l as Extract<CartLine, { kind: "pharmacy" }>).product.id, qty: l.qty })),
          lattafa: cart.filter((l) => l.kind === "lattafa").map((l) => ({ id: (l as Extract<CartLine, { kind: "lattafa" }>).item.id, qty: l.qty })),
          deborah: cart.filter((l) => l.kind === "deborah").map((l) => ({ id: (l as Extract<CartLine, { kind: "deborah" }>).item.id, qty: l.qty })),
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

  const chip = (active: boolean) =>
    `shrink-0 rounded-full border-2 px-3 py-1.5 text-sm font-bold ${active ? "border-ink bg-sun text-ink" : "border-slate-300 bg-white text-slate-600"}`;

  return (
    <>
      <header className="sticky top-0 z-10 border-b-2 border-ink bg-teal-700 px-4 pt-3 text-white">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-display text-xl font-extrabold">Carelink</p>
            <p className="text-[11px] opacity-90">{me ? `أهلاً ${me.name ?? ""}` : "..."}</p>
          </div>
          <Link href="/shop/chat" className="rounded-full border-2 border-white px-3 py-1.5 text-sm font-bold">طلباتي 💬</Link>
        </div>
        {step === "browse" && (
          <div className="mt-3 flex gap-1">
            {([["pharmacy", "💊 أدوية"], ["cosmetics", "🧴 كوزماتيك"], ["lattafa", "✨ لطافة"], ["deborah", "💄 Deborah"]] as const).map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)}
                className={`flex-1 whitespace-nowrap rounded-t-2xl px-1.5 py-2 text-[13px] font-extrabold ${tab === k ? "bg-slate-50 text-teal-800" : "bg-teal-800/40 text-white"}`}>
                {label}
              </button>
            ))}
          </div>
        )}
      </header>

      {step === "browse" && tab === "pharmacy" && (
        <main className="flex-1 space-y-3 p-4 pb-28">
          <input className={input} placeholder="ابحث عن دواء بالاسم..." value={q} onChange={(e) => onSearch(e.target.value)} />
          {searching && <p className="text-center text-sm text-slate-500">جارٍ البحث...</p>}
          {!searching && q.trim().length >= 2 && results.length === 0 && (
            <p className="rounded-2xl bg-white p-4 text-center text-sm text-slate-600">
              لم نجده في الأدوية. للكريمات والعناية جرّب تبويب «كوزماتيك»، أو <Link href="/shop/chat" className="font-bold text-teal-700 underline">اكتب لنا اسمه</Link> ونبحث لك عنه.
            </p>
          )}
          {q.trim().length < 2 && (
            <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1" dir="ltr">
              {["", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map((l) => (
                <button key={l || "all"} className={`${chip(letter === l)} px-2.5`} onClick={() => { setLetter(l); setDrugs(null); loadDrugs(l, 0); }}>{l || "الكل"}</button>
              ))}
            </div>
          )}
          {q.trim().length < 2 && drugs === null && <p className="text-center text-sm text-slate-500">جارٍ التحميل...</p>}
          <ul className="space-y-2">
            {(q.trim().length >= 2 ? results : drugs ?? []).map((p) => (
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
                  <button className={`${btn} shrink-0 bg-sun px-3 py-2 text-sm text-ink`} onClick={() => addLine({ kind: "pharmacy", key: `p-${p.id}`, product: p, qty: 1 })}>+ أضف</button>
                )}
              </li>
            ))}
          </ul>
          {q.trim().length < 2 && dnext !== null && drugs && drugs.length > 0 && (
            <button className={`${btn} w-full bg-white text-slate-700`} disabled={dloading} onClick={() => loadDrugs(letter, dnext)}>{dloading ? "..." : "عرض المزيد"}</button>
          )}
          <p className="pt-2 text-center text-xs text-slate-500">سعر أدوية الصيدلية تؤكده الصيدلية قبل التوصيل. لا يقدّم التطبيق استشارة طبية.</p>
        </main>
      )}

      {step === "browse" && tab === "cosmetics" && (
        <main className="flex-1 space-y-3 p-4 pb-28">
          <input className={input} placeholder="ابحث: Avene، La Roche، شامبو، SPF..." value={cq} onChange={(e) => onCosmeticSearch(e.target.value)} />
          {cq.trim().length < 2 && (
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
              {cats.map((c) => (
                <button key={c.key} className={chip(cat === c.key)} onClick={() => { setCat(c.key); setCitems(null); loadCosmetics(c.key, "", 0); }}>{c.label}</button>
              ))}
            </div>
          )}
          {citems === null && <p className="text-center text-sm text-slate-500">جارٍ التحميل...</p>}
          {citems && citems.length === 0 && !cloading && <p className="text-center text-sm text-slate-500">لا نتائج.</p>}
          <div className="grid grid-cols-2 gap-3">
            {(citems ?? []).map((i) => (
              <div key={i.id} className="flex flex-col overflow-hidden rounded-2xl border-2 border-slate-200 bg-white">
                <div className="flex aspect-square items-center justify-center bg-slate-100">
                  {i.image
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={i.image} alt={i.name} loading="lazy" className="h-full w-full object-cover" />
                    : <span className="text-4xl opacity-40">🧴</span>}
                </div>
                <div className="flex flex-1 flex-col gap-1 p-2.5">
                  <p className="line-clamp-3 text-sm font-bold leading-tight text-slate-900" dir="ltr">{i.name}</p>
                  <div className="mt-auto flex items-center justify-between pt-1">
                    {i.price != null
                      ? <span className="font-extrabold text-slate-900">{usd(i.price)}</span>
                      : <span className="text-[11px] text-slate-500">السعر عند التأكيد</span>}
                    <button className="rounded-xl border-2 border-ink bg-sun px-2.5 py-1 text-sm font-extrabold"
                      onClick={() => addLine({ kind: "pharmacy", key: `p-${i.id}`, product: { id: i.id, name: i.name, brand: null, type: i.type, available: true, price: i.price }, qty: 1 })}>+</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {cnext !== null && citems && citems.length > 0 && (
            <button className={`${btn} w-full bg-white text-slate-700`} disabled={cloading}
              onClick={() => loadCosmetics(cat, cq.trim().length >= 2 ? cq.trim() : "", cnext)}>{cloading ? "..." : "عرض المزيد"}</button>
          )}
          <p className="pt-2 text-center text-xs text-slate-500">نؤكد السعر والتوفر قبل التوصيل.</p>
        </main>
      )}

      {step === "browse" && tab === "deborah" && (
        <main className="flex-1 space-y-3 p-4 pb-28">
          <p className="rounded-2xl bg-white p-3 text-center text-sm font-bold text-slate-700">DEBORAH MILANO — مستحضرات تجميل إيطالية</p>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            <button className={chip(dsel === "ALL")} onClick={() => setDsel("ALL")}>الكل</button>
            {dcat.map((c) => (
              <button key={c.key} className={chip(dsel === c.key)} onClick={() => setDsel(c.key)}>{c.label}</button>
            ))}
          </div>
          {ditems === null && <p className="text-center text-sm text-slate-500">جارٍ التحميل...</p>}
          <div className="grid grid-cols-2 gap-3">
            {(ditems ?? []).filter((i) => dsel === "ALL" || i.cat === dsel).map((i) => (
              <div key={i.id} className="flex flex-col overflow-hidden rounded-2xl border-2 border-slate-200 bg-white">
                <div className="flex aspect-square items-center justify-center bg-white">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={i.image} alt={i.name} loading="lazy" className="h-full w-full object-contain" />
                </div>
                <div className="flex flex-1 flex-col gap-1 p-2.5">
                  <p className="text-[11px] font-bold text-teal-700">DEBORAH</p>
                  <p className="line-clamp-2 text-sm font-bold leading-tight text-slate-900" dir="ltr">{i.name}</p>
                  <div className="mt-auto flex items-center justify-between pt-1">
                    <span className="font-extrabold text-slate-900">{usd(i.price)}</span>
                    <button className="rounded-xl border-2 border-ink bg-sun px-2.5 py-1 text-sm font-extrabold" onClick={() => addLine({ kind: "deborah", key: `d-${i.id}`, item: i, qty: 1 })}>+</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="pt-2 text-center text-xs text-slate-500">الألوان والدرجات حسب المتوفر — اذكر اللون المطلوب في الملاحظات. نؤكد التوفر قبل التوصيل.</p>
        </main>
      )}

      {step === "browse" && tab === "lattafa" && (
        <main className="flex-1 space-y-3 p-4 pb-28">
          <input className={input} placeholder="ابحث عن عطر: Yara، Asad، Khamrah..." value={lq} onChange={(e) => { setLq(e.target.value); setShown(40); }} />
          {!lq && (
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
              <button className={chip(brand === "NEW")} onClick={() => { setBrand("NEW"); setShown(40); }}>🆕 وصل حديثاً</button>
              <button className={chip(brand === "ALL")} onClick={() => { setBrand("ALL"); setShown(40); }}>الكل</button>
              {brands.map(([k, label]) => (
                <button key={k} className={chip(brand === k)} onClick={() => { setBrand(k); setShown(40); }}>{label}</button>
              ))}
            </div>
          )}
          {catalog === null && <p className="text-center text-sm text-slate-500">جارٍ التحميل...</p>}
          {catalog && lattafaList.length === 0 && <p className="text-center text-sm text-slate-500">لا نتائج.</p>}
          <div className="grid grid-cols-2 gap-3">
            {lattafaList.slice(0, shown).map((i) => (
              <div key={i.id} className="flex flex-col overflow-hidden rounded-2xl border-2 border-slate-200 bg-white">
                <div className="flex aspect-square items-center justify-center bg-slate-100">
                  {i.image
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={i.image} alt={i.name} loading="lazy" className="h-full w-full object-cover" />
                    : <span className="text-4xl opacity-40">✨</span>}
                </div>
                <div className="flex flex-1 flex-col gap-1 p-2.5">
                  <p className="text-[11px] font-bold text-teal-700">{i.brand}{i.isNew ? " · جديد" : ""}</p>
                  <p className="line-clamp-2 text-sm font-bold leading-tight text-slate-900" dir="ltr">{i.name}</p>
                  <p className="text-[11px] text-slate-500" dir="ltr">{i.size}</p>
                  <div className="mt-auto flex items-center justify-between pt-1">
                    <span className="font-extrabold text-slate-900">{usd(i.price)}</span>
                    <button className="rounded-xl border-2 border-ink bg-sun px-2.5 py-1 text-sm font-extrabold" onClick={() => addLine({ kind: "lattafa", key: `l-${i.id}`, item: i, qty: 1 })}>+</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {lattafaList.length > shown && (
            <button className={`${btn} w-full bg-white text-slate-700`} onClick={() => setShown((s) => s + 40)}>عرض المزيد ({lattafaList.length - shown})</button>
          )}
          <p className="pt-2 text-center text-xs text-slate-500">الأسعار بالدولار شاملة الضريبة. نؤكد التوفر مع الشركة قبل التوصيل.</p>
        </main>
      )}

      {step === "browse" && cart.length > 0 && (
        <section className="mx-4 mb-28 space-y-2 rounded-3xl border-2 border-ink bg-white p-4">
          <p className="font-extrabold">سلّتك</p>
          {cart.map((l) => (
            <div key={l.key} className="flex items-center justify-between gap-2">
              <p className="min-w-0 truncate text-sm" dir="auto">
                {l.kind === "pharmacy" ? `${l.product.name}${l.product.price != null ? ` — ${usd(l.product.price)}` : ""}` : l.kind === "deborah" ? `DEBORAH ${l.item.name} — ${usd(l.item.price)}` : `${l.item.name} ${l.item.size} — ${usd(l.item.price)}`}
              </p>
              <div className="flex shrink-0 items-center gap-2">
                <button className="h-8 w-8 rounded-full border-2 border-ink font-bold" onClick={() => setQty(l.key, l.qty - 1)}>−</button>
                <span className="w-5 text-center font-bold">{l.qty}</span>
                <button className="h-8 w-8 rounded-full border-2 border-ink font-bold" onClick={() => setQty(l.key, l.qty + 1)}>+</button>
              </div>
            </div>
          ))}
          {deborahTotal > 0 && <p className="border-t border-dashed pt-2 text-sm font-bold">مجموع Deborah: {usd(deborahTotal)}</p>}
          {lattafaTotal > 0 && <p className="border-t border-dashed pt-2 text-sm font-bold">مجموع عطور لطافة: {usd(lattafaTotal)}</p>}
        </section>
      )}

      {step === "checkout" && (
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
          {deborahTotal > 0 && <p className="rounded-2xl bg-white p-3 text-sm">مجموع Deborah: <b>{usd(deborahTotal)}</b> + كلفة التوصيل. اكتب الألوان/الدرجات المطلوبة في الملاحظات.</p>}
          {lattafaTotal > 0 && <p className="rounded-2xl bg-white p-3 text-sm">مجموع عطور لطافة: <b>{usd(lattafaTotal)}</b> + كلفة التوصيل تُبلَّغ بها.</p>}
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

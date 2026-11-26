"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { btn, input, resizeImage, shopFetch } from "./api";
import { LangToggle, useLang } from "./i18n";
import album from "@/data/album.json";
import tips from "@/data/health-tips.json";

interface Tip { t: string; x: string; s: string; u: string; te?: string; xe?: string; se?: string }
const TIPS = tips as Tip[];
/** Index of today's tip (Beirut date), one tip per day, cycling. */
function tipIndex(offset = 0) {
  const d = new Date(Date.now() + 2 * 3600 * 1000);
  const day = Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000) - offset;
  return ((day % TIPS.length) + TIPS.length) % TIPS.length;
}

interface AlbumItem { id: string; title: string; image: string; video?: string; w: number; h: number }
const ALBUM = album as AlbumItem[];

interface Product { id: string; name: string; brand: string | null; type: string; available: boolean; price?: number | null }
interface DItem { id: string; name: string; cat: string; price: number; image: string; brand?: string; shades?: string | null; images?: string[] }
interface CItem { id: string; name: string; type: string; price: number | null; image: string | null; available: boolean }
interface LItem { id: string; brand: string; brandKey: string; name: string; size: string; price: number; isNew: boolean; image: string | null }
type CartLine =
  | { kind: "pharmacy"; key: string; product: Product; qty: number }
  | { kind: "lattafa"; key: string; item: LItem; qty: number }
  | { kind: "deborah"; key: string; item: DItem; qty: number }
  | { kind: "clarins"; key: string; item: DItem; qty: number };
interface Me { name: string | null; phone: string; address: string | null }

const RX = (t: string) => t === "PRESCRIPTION";
const CTRL = (t: string) => t === "CONTROLLED";
const CART_KEY = "carelink-cart-v2";
const usd = (n: number) => `${Math.round(n)}$`;

export default function ShopHome() {
  const router = useRouter();
  const { t, lang } = useLang();
  const COS_EN: Record<string, string> = { skin: "🧴 Skin care", makeup: "💄 Makeup", perfume: "🌸 Fragrance & deo", hair: "💇 Hair", baby: "👶 Baby & milk", body: "🛁 Personal care", dental: "🦷 Dental", devices: "🩺 Devices & supplies", food: "🥣 Food" };
  const DEB_EN: Record<string, string> = { face: "Face", eyes: "Eyes", lips: "Lips", nails: "Nails" };
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<"home" | "consult" | "tips" | "pharmacy" | "cosmetics" | "lattafa" | "deborah" | "clarins" | "album">("home");
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

  // consultation
  const [cText, setCText] = useState("");
  const [cImage, setCImage] = useState<string | null>(null);
  const [cBusy, setCBusy] = useState(false);
  const [cErr, setCErr] = useState<string | null>(null);

  async function sendConsult() {
    setCBusy(true);
    setCErr(null);
    try {
      await shopFetch("/api/shop/message", { body: { text: `[استشارة طبية]\n${cText.trim()}`, image: cImage ?? undefined } });
      setCText("");
      setCImage(null);
      router.push("/shop/chat");
    } catch (e) {
      setCErr(e instanceof Error ? e.message : t("تعذّر الإرسال", "Could not send"));
      setCBusy(false);
    }
  }

  // album
  const [photo, setPhoto] = useState<AlbumItem | null>(null);
  const [asking, setAsking] = useState(false);

  async function askAboutPhoto(p: AlbumItem) {
    setAsking(true);
    try {
      await shopFetch("/api/shop/message", { body: { text: `[استفسار من الألبوم] ${p.title}\n${t("أريد معرفة السعر والتوفر لما في هذه الصورة.", "I would like to know the price and availability of the products in this picture.")}\n(الصورة: ${p.image})` } });
      router.push("/shop/chat");
    } catch {
      setAsking(false);
    }
  }

  // DEBORAH catalog
  const [dcat, setDcat] = useState<{ key: string; label: string }[]>([]);
  const [ditems, setDitems] = useState<DItem[] | null>(null);
  const [dsel, setDsel] = useState("ALL");
  const [kitems, setKitems] = useState<DItem[] | null>(null);
  const [kcat, setKcat] = useState<{ key: string; label: string }[]>([]);
  const [ksel, setKsel] = useState("ALL");
  const [kview, setKview] = useState<DItem | null>(null);

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

  useEffect(() => {
    if (tab === "clarins" && !kitems) {
      shopFetch<{ categories: { key: string; label: string }[]; items: DItem[] }>("/api/shop/clarins")
        .then((d) => { setKcat(d.categories); setKitems(d.items); })
        .catch(() => setKitems([]));
    }
  }, [tab, kitems]);

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
  const clarinsTotal = cart.reduce((s, l) => s + (l.kind === "clarins" ? l.item.price * l.qty : 0), 0);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await shopFetch("/api/shop/order", {
        body: {
          items: cart.filter((l) => l.kind === "pharmacy").map((l) => ({ productId: (l as Extract<CartLine, { kind: "pharmacy" }>).product.id, qty: l.qty })),
          lattafa: cart.filter((l) => l.kind === "lattafa").map((l) => ({ id: (l as Extract<CartLine, { kind: "lattafa" }>).item.id, qty: l.qty })),
          clarins: cart.filter((l) => l.kind === "clarins").map((l) => ({ id: (l as Extract<CartLine, { kind: "clarins" }>).item.id, qty: l.qty })),
          deborah: cart.filter((l) => l.kind === "deborah").map((l) => ({ id: (l as Extract<CartLine, { kind: "deborah" }>).item.id, qty: l.qty })),
          area, address, name: name || undefined, notes: notes || undefined,
          prescription: needsRx ? rxImage : undefined,
        },
      });
      setCart([]);
      router.push("/shop/chat");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("خطأ", "Error"));
    } finally {
      setBusy(false);
    }
  }

  const chip = (active: boolean) =>
    `shrink-0 rounded-full border-2 px-3 py-1.5 text-sm font-bold ${active ? "border-ink bg-sun text-ink" : "border-slate-300 bg-white text-slate-600"}`;

  return (
    <>
      <header className="sticky top-0 z-10 border-b-2 border-ink bg-[#9e5f69] px-4 pt-3 text-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-192.png" alt="" className="h-10 w-10 rounded-xl border-2 border-white/70" />
            <div>
            <p className="font-display text-xl font-extrabold">Carelink</p>
            <p className="text-[11px] opacity-90">{me ? `${t("أهلاً", "Hello")} ${me.name ?? ""}` : "..."}</p>
            </div>
          </div>
          <div className="flex items-center gap-2"><LangToggle /><Link href="/shop/chat" className="rounded-full border-2 border-white px-3 py-1.5 text-sm font-bold">{t("طلباتي", "My orders")} 💬</Link></div>
        </div>
        {step === "browse" && (
          <div className="-mx-4 mt-3 flex gap-1 overflow-x-auto px-4">
            {([["home", "🏠"], ["consult", t("🩺 استشارة", "🩺 Ask")], ["tips", t("💡 معلومة اليوم", "💡 Daily tip")], ["pharmacy", t("💊 صيدلية", "💊 Pharmacy")], ["cosmetics", t("🧴 كوزماتيك", "🧴 Cosmetics")], ["lattafa", t("✨ لطافة", "✨ Lattafa")], ["deborah", "💄 Deborah"], ["clarins", "🌹 Clarins · Clinique"], ["album", t("🖼️ ألبوم", "🖼️ Gallery")]] as const).map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)}
                className={`shrink-0 whitespace-nowrap rounded-t-2xl px-3 py-2 text-[13px] font-extrabold ${tab === k ? "bg-slate-50 text-[#7d4650]" : "bg-[#7d4650]/40 text-white"}`}>
                {label}
              </button>
            ))}
          </div>
        )}
      </header>

      {step === "browse" && tab === "pharmacy" && (
        <main className="flex-1 space-y-3 p-4 pb-28">
          <input className={input} placeholder={t("ابحث في الصيدلية بالاسم...", "Search the pharmacy by name...")} value={q} onChange={(e) => onSearch(e.target.value)} />
          {searching && <p className="text-center text-sm text-slate-500">{t("جارٍ البحث...", "Searching...")}</p>}
          {!searching && q.trim().length >= 2 && results.length === 0 && (
            <p className="rounded-2xl bg-white p-4 text-center text-sm text-slate-600">
              {t("لم نجده في الصيدلية. للكريمات والعناية جرّب تبويب «كوزماتيك»، أو", "Not found in the pharmacy. For creams and care try the «Cosmetics» tab, or")} <Link href="/shop/chat" className="font-bold text-[#9e5f69] underline">{t("اكتب لنا اسمه", "write us its name")}</Link> {t("ونبحث لك عنه.", "and we will look for it.")}
            </p>
          )}
          {q.trim().length < 2 && (
            <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1" dir="ltr">
              {["", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map((l) => (
                <button key={l || "all"} className={`${chip(letter === l)} px-2.5`} onClick={() => { setLetter(l); setDrugs(null); loadDrugs(l, 0); }}>{l || t("الكل", "All")}</button>
              ))}
            </div>
          )}
          {q.trim().length < 2 && drugs === null && <p className="text-center text-sm text-slate-500">{t("جارٍ التحميل...", "Loading...")}</p>}
          <ul className="space-y-2">
            {(q.trim().length >= 2 ? results : drugs ?? []).map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 rounded-2xl border-2 border-slate-200 bg-white p-3">
                <div className="min-w-0">
                  <p className="truncate font-bold text-slate-900" dir="auto">{p.name}</p>
                  <p className="text-xs text-slate-500">
                    {p.brand ? `${p.brand} · ` : ""}
                    {p.available ? <span className="text-[#9e5f69]">{t("متوفر", "Available")}</span> : <span className="text-amber-700">{t("نتحقق من توفره", "Checking availability")}</span>}
                    {RX(p.type) && <span className="mr-1 rounded-full bg-amber-100 px-2 text-amber-800">{t("بوصفة", "Rx")}</span>}
                  </p>
                </div>
                {CTRL(p.type) ? (
                  <span className="shrink-0 text-xs text-slate-500">{t("حضورياً فقط", "In store only")}</span>
                ) : (
                  <button className={`${btn} shrink-0 bg-sun px-3 py-2 text-sm text-ink`} onClick={() => addLine({ kind: "pharmacy", key: `p-${p.id}`, product: p, qty: 1 })}>{t("+ أضف", "+ Add")}</button>
                )}
              </li>
            ))}
          </ul>
          {q.trim().length < 2 && dnext !== null && drugs && drugs.length > 0 && (
            <button className={`${btn} w-full bg-white text-slate-700`} disabled={dloading} onClick={() => loadDrugs(letter, dnext)}>{dloading ? "..." : t("عرض المزيد", "Show more")}</button>
          )}
          <p className="pt-2 text-center text-xs text-slate-500">{t("سعر أصناف الصيدلية تؤكده الصيدلية قبل التوصيل.", "Pharmacy prices are confirmed by the pharmacy before delivery.")}</p>
        </main>
      )}

      {step === "browse" && tab === "cosmetics" && (
        <main className="flex-1 space-y-3 p-4 pb-28">
          <input className={input} placeholder={t("ابحث: Avene، La Roche، شامبو، SPF...", "Search: Avene, La Roche, shampoo, SPF...")} value={cq} onChange={(e) => onCosmeticSearch(e.target.value)} />
          {cq.trim().length < 2 && (
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
              {cats.map((c) => (
                <button key={c.key} className={chip(cat === c.key)} onClick={() => { setCat(c.key); setCitems(null); loadCosmetics(c.key, "", 0); }}>{lang === "en" ? COS_EN[c.key] ?? c.label : c.label}</button>
              ))}
            </div>
          )}
          {citems === null && <p className="text-center text-sm text-slate-500">{t("جارٍ التحميل...", "Loading...")}</p>}
          {citems && citems.length === 0 && !cloading && <p className="text-center text-sm text-slate-500">{t("لا نتائج.", "No results.")}</p>}
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
                      : <span className="text-[11px] text-slate-500">{t("السعر عند التأكيد", "Price on confirmation")}</span>}
                    <button className="rounded-xl border-2 border-ink bg-sun px-2.5 py-1 text-sm font-extrabold"
                      onClick={() => addLine({ kind: "pharmacy", key: `p-${i.id}`, product: { id: i.id, name: i.name, brand: null, type: i.type, available: true, price: i.price }, qty: 1 })}>+</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {cnext !== null && citems && citems.length > 0 && (
            <button className={`${btn} w-full bg-white text-slate-700`} disabled={cloading}
              onClick={() => loadCosmetics(cat, cq.trim().length >= 2 ? cq.trim() : "", cnext)}>{cloading ? "..." : t("عرض المزيد", "Show more")}</button>
          )}
          <p className="pt-2 text-center text-xs text-slate-500">{t("نؤكد السعر والتوفر قبل التوصيل.", "We confirm price and availability before delivery.")}</p>
        </main>
      )}

      {step === "browse" && tab === "home" && (
        <main className="flex-1 space-y-4 p-4 pb-28">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/promo-delivery.jpg" alt="Carelink — طلبك يوصل إلى باب بيتك" className="block w-full rounded-3xl border-2 border-ink shadow-pop-sm" />
          <button onClick={() => setTab("album")} className="block w-full overflow-hidden rounded-3xl border-2 border-ink shadow-pop-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/collage.jpg" alt="Carelink — كل ما تحتاجينه للعناية بك وبعائلتك في مكان واحد" className="w-full" />
          </button>
          <p className="text-center text-sm font-bold text-slate-700">{t("حدّك وين ما كنت 💗 — كل ما تحتاجينه للعناية بك وبعائلتك في مكان واحد", "By your side wherever you are 💗 — everything you need to care for you and your family, in one place")}</p>
          <button onClick={() => setTab("tips")} className="block w-full rounded-3xl border-2 border-ink bg-[#f7ecee] p-4 text-right shadow-pop-sm">
            <p className="text-xs font-bold text-[#9e5f69]">{t("💡 معلومة صحية اليوم", "💡 Today's health tip")}</p>
            <p className="mt-1 font-extrabold">{lang === "en" ? TIPS[tipIndex()].te : TIPS[tipIndex()].t}</p>
            <p className="mt-1 line-clamp-2 text-sm text-slate-700">{lang === "en" ? TIPS[tipIndex()].xe : TIPS[tipIndex()].x}</p>
          </button>
          {([
            ["/brand/banner-skin.jpg", t("العناية بالبشرة", "Skin care"), () => { setTab("cosmetics"); setCat("skin"); setCitems(null); loadCosmetics("skin", "", 0); }],
            ["/brand/banner-makeup.jpg", t("المكياج — Deborah", "Makeup — Deborah"), () => setTab("deborah")],
            ["/brand/banner-body.jpg", t("العناية بالجسم ومزيلات العرق", "Body care & deodorants"), () => { setTab("cosmetics"); setCat("body"); setCitems(null); loadCosmetics("body", "", 0); }],
          ] as const).map(([src, label, go]) => (
            <button key={src} onClick={go} className="block w-full overflow-hidden rounded-3xl border-2 border-ink shadow-pop-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={label} className="w-full" />
            </button>
          ))}
          <div className="grid grid-cols-2 gap-3">
            {([
              ["consult", "🩺", t("استشارة مجانية", "Free consultation"), t("اسأل عن دواء أو عناية", "Ask about medicine or care")],
              ["pharmacy", "💊", t("الصيدلية", "Pharmacy"), t("ابحث بالاسم", "Search by name")],
              ["cosmetics", "🧴", t("كوزماتيك", "Cosmetics"), t("بشرة، شعر، أطفال...", "Skin, hair, baby...")],
              ["lattafa", "✨", t("عطور لطافة", "Lattafa perfumes"), t("بالأسعار", "With prices")],
              ["album", "🖼️", t("الألبوم", "Gallery"), t("اسأل عن أي صورة", "Ask about any photo")],
            ] as const).map(([k, icon, title, sub]) => (
              <button key={k} onClick={() => setTab(k)} className="rounded-3xl border-2 border-ink bg-white p-4 text-right shadow-pop-sm">
                <span className="text-2xl">{icon}</span>
                <p className="mt-1 font-extrabold">{title}</p>
                <p className="text-xs text-slate-500">{sub}</p>
              </button>
            ))}
          </div>
        </main>
      )}

      {step === "browse" && tab === "tips" && (
        <main className="flex-1 space-y-3 p-4 pb-28">
          {[0, 1, 2, 3, 4, 5, 6].map((o) => {
            const tip = TIPS[tipIndex(o)];
            return (
              <div key={o} className={`rounded-3xl border-2 bg-white p-4 ${o === 0 ? "border-ink shadow-pop-sm" : "border-slate-200"}`}>
                <p className="text-xs font-bold text-[#9e5f69]">{o === 0 ? t("💡 معلومة اليوم", "💡 Today's tip") : o === 1 ? t("أمس", "Yesterday") : t(`قبل ${o} أيام`, `${o} days ago`)}</p>
                <p className={`mt-1 font-extrabold ${o === 0 ? "text-lg" : ""}`}>{lang === "en" ? tip.te : tip.t}</p>
                <p className="mt-1 text-sm leading-relaxed text-slate-700">{lang === "en" ? tip.xe : tip.x}</p>
                <a href={tip.u} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs font-bold text-[#9e5f69] underline">{t("المصدر", "Source")}: {lang === "en" ? tip.se ?? tip.s : tip.s} ↗</a>
              </div>
            );
          })}
          <p className="text-center text-xs text-slate-500">{t("معلومات عامة للتوعية لا تغني عن استشارة الطبيب. عندك سؤال؟", "General awareness information, not a substitute for a doctor. Have a question?")} <button className="font-bold text-[#9e5f69] underline" onClick={() => setTab("consult")}>{t("اسألي في الاستشارة المجانية", "Ask in the free consultation")}</button></p>
        </main>
      )}

      {step === "browse" && tab === "consult" && (
        <main className="flex-1 space-y-3 p-4 pb-28">
          <div className="rounded-3xl border-2 border-ink bg-white p-4">
            <p className="text-lg font-extrabold">{t("🩺 استشارة مجانية", "🩺 Free consultation")}</p>
            <p className="mt-1 text-sm text-slate-700">{t("اسألي عن أي دواء أو منتج عناية: طريقة الاستعمال، البديل، الروتين المناسب لبشرتك... يجيبك مساعد Carelink فوراً، وإذا احتاج سؤالك صيدلياً أو طبيباً مختصاً نحوّله لفريقنا ويصلك الرد في «طلباتي» بعد بعض الوقت.", "Ask about any medicine or care product: how to use it, alternatives, the right routine for your skin... The Carelink assistant answers right away, and if your question needs a pharmacist or a specialist doctor we refer it to our team and the reply reaches you in «My orders» after some time.")}</p>
          </div>
          <textarea className={input} rows={5} placeholder={t("اكتبي سؤالك هنا... (اذكري العمر والأدوية التي تأخذينها إن وُجدت)", "Write your question here... (mention age and any medicines you take)")} value={cText} onChange={(e) => setCText(e.target.value)} />
          <label className="flex cursor-pointer items-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 bg-white p-3 text-sm font-bold text-slate-600">
            📷 {cImage ? t("✓ أُرفقت صورة (اضغطي للتغيير)", "✓ Photo attached (tap to change)") : t("أرفقي صورة (علبة دواء، وصفة، مشكلة بالبشرة) — اختياري", "Attach a photo (medicine box, prescription, skin issue) — optional")}
            <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) setCImage(await resizeImage(f).catch(() => null));
            }} />
          </label>
          {cErr && <p className="rounded-2xl border-2 border-red-300 bg-red-50 p-3 text-sm font-bold text-red-700">{cErr}</p>}
          <button className={`${btn} w-full bg-[#9e5f69] text-white`} disabled={cBusy || cText.trim().length < 3} onClick={sendConsult}>
            {cBusy ? t("جارٍ الإرسال...", "Sending...") : t("أرسلي الاستشارة", "Send consultation")}
          </button>
          <p className="rounded-2xl bg-amber-50 p-3 text-xs text-amber-900">⚠️ {t("المعلومات المقدّمة عامة ولا تغني عن استشارة الطبيب. في الحالات الطارئة (ضيق نفس، ألم في الصدر، نزيف...) توجّهي فوراً إلى أقرب طوارئ أو اتصلي بالصليب الأحمر 140.", "Information is general and does not replace a doctor. In an emergency (shortness of breath, chest pain, bleeding...) go to the nearest emergency room or call the Red Cross on 140.")}</p>
        </main>
      )}

      {step === "browse" && tab === "album" && (
        <main className="flex-1 space-y-3 p-4 pb-28">
          <p className="rounded-2xl bg-white p-3 text-center text-sm text-slate-700">{t("اضغطي على أي صورة أو فيديو لتسألي عن منتجاتها وسعرها — نجيبك في «طلباتي».", "Tap any photo or video to ask about its products and price — we reply in «My orders».")}</p>
          <div className="columns-2 gap-3 [&>*]:mb-3">
            {ALBUM.map((p) => (
              <button key={p.id} onClick={() => setPhoto(p)} className="block w-full break-inside-avoid overflow-hidden rounded-2xl border-2 border-slate-200 bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <span className="relative block">
                  <img src={p.image} alt={p.title} loading="lazy" className="w-full" />
                  {p.video && <span className="absolute inset-0 flex items-center justify-center"><span className="rounded-full bg-black/50 px-3 py-2 text-xl text-white">▶</span></span>}
                </span>
              </button>
            ))}
          </div>
          {photo && (
            <div className="fixed inset-0 z-30 flex flex-col bg-black/85 p-4" onClick={() => setPhoto(null)}>
              <div className="flex flex-1 items-center justify-center overflow-auto">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {photo.video
                  ? <video src={photo.video} poster={photo.image} controls autoPlay playsInline className="max-h-full max-w-full rounded-2xl" onClick={(e) => e.stopPropagation()} />
                  : <img src={photo.image} alt={photo.title} className="max-h-full max-w-full rounded-2xl" />}
              </div>
              <div className="mx-auto w-full max-w-md space-y-2 pt-3" onClick={(e) => e.stopPropagation()}>
                <p className="text-center text-sm font-bold text-white">{photo.title}</p>
                <button className={`${btn} w-full bg-sun text-ink`} disabled={asking} onClick={() => askAboutPhoto(photo)}>
                  {asking ? t("جارٍ الإرسال...", "Sending...") : t("اسألي عن السعر والتوفر 💬", "Ask about price & availability 💬")}
                </button>
                <button className="w-full py-2 text-sm font-bold text-white/80" onClick={() => setPhoto(null)}>{t("إغلاق", "Close")}</button>
              </div>
            </div>
          )}
        </main>
      )}

      {step === "browse" && tab === "deborah" && (
        <main className="flex-1 space-y-3 p-4 pb-28">
          <p className="rounded-2xl bg-white p-3 text-center text-sm font-bold text-slate-700">DEBORAH MILANO — {t("مستحضرات تجميل إيطالية", "Italian makeup")}</p>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            <button className={chip(dsel === "ALL")} onClick={() => setDsel("ALL")}>{t("الكل", "All")}</button>
            {dcat.map((c) => (
              <button key={c.key} className={chip(dsel === c.key)} onClick={() => setDsel(c.key)}>{lang === "en" ? DEB_EN[c.key] ?? c.label : c.label}</button>
            ))}
          </div>
          {ditems === null && <p className="text-center text-sm text-slate-500">{t("جارٍ التحميل...", "Loading...")}</p>}
          <div className="grid grid-cols-2 gap-3">
            {(ditems ?? []).filter((i) => dsel === "ALL" || i.cat === dsel).map((i) => (
              <div key={i.id} className="flex flex-col overflow-hidden rounded-2xl border-2 border-slate-200 bg-white">
                <div className="flex aspect-square items-center justify-center bg-white">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={i.image} alt={i.name} loading="lazy" className="h-full w-full object-contain" />
                </div>
                <div className="flex flex-1 flex-col gap-1 p-2.5">
                  <p className="text-[11px] font-bold text-[#9e5f69]">DEBORAH</p>
                  <p className="line-clamp-2 text-sm font-bold leading-tight text-slate-900" dir="ltr">{i.name}</p>
                  <div className="mt-auto flex items-center justify-between pt-1">
                    <span className="font-extrabold text-slate-900">{usd(i.price)}</span>
                    <button className="rounded-xl border-2 border-ink bg-sun px-2.5 py-1 text-sm font-extrabold" onClick={() => addLine({ kind: "deborah", key: `d-${i.id}`, item: i, qty: 1 })}>+</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="pt-2 text-center text-xs text-slate-500">{t("الألوان والدرجات حسب المتوفر — اذكر اللون المطلوب في الملاحظات. نؤكد التوفر قبل التوصيل.", "Colors and shades as available — write the shade you want in the notes. We confirm availability before delivery.")}</p>
        </main>
      )}

      {step === "browse" && tab === "clarins" && (
        <main className="flex-1 space-y-3 p-4 pb-28">
          <p className="rounded-2xl bg-white p-3 text-center text-sm font-bold text-slate-700">CLARINS PARIS · CLINIQUE — {t("من صيدلية فارماكير", "from Pharmacare pharmacy")}</p>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            <button className={chip(ksel === "ALL")} onClick={() => setKsel("ALL")}>{t("الكل", "All")}</button>
            <button className={chip(ksel === "b:CLARINS")} onClick={() => setKsel("b:CLARINS")}>Clarins</button>
            <button className={chip(ksel === "b:CLINIQUE")} onClick={() => setKsel("b:CLINIQUE")}>Clinique</button>
            {kcat.map((c) => (
              <button key={c.key} className={chip(ksel === c.key)} onClick={() => setKsel(c.key)}>{lang === "en" ? ({ face: "Face", eyes: "Eyes", lips: "Lips", cleanse: "Cleanse", treat: "Treat" } as Record<string, string>)[c.key] ?? c.label : c.label}</button>
            ))}
          </div>
          {kitems === null && <p className="text-center text-sm text-slate-500">{t("جارٍ التحميل...", "Loading...")}</p>}
          <div className="grid grid-cols-2 gap-3">
            {(kitems ?? []).filter((i) => ksel === "ALL" || (ksel.startsWith("b:") ? i.brand === ksel.slice(2) : i.cat === ksel)).map((i) => (
              <div key={i.id} className="flex flex-col overflow-hidden rounded-2xl border-2 border-slate-200 bg-white">
                <button className="relative flex aspect-square items-center justify-center bg-white" onClick={() => setKview(i)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={i.image} alt={i.name} loading="lazy" className="h-full w-full object-cover" />
                  {(i.images?.length ?? 0) > 1 && <span className="absolute bottom-1 left-1 rounded-full bg-black/50 px-2 text-[11px] text-white">+{(i.images?.length ?? 1) - 1} 📷</span>}
                </button>
                <div className="flex flex-1 flex-col gap-1 p-2.5">
                  <p className="text-[11px] font-bold text-[#9e5f69]">{i.brand}</p>
                  <p className="line-clamp-2 text-sm font-bold leading-tight text-slate-900" dir="ltr">{i.name}</p>
                  {i.shades && <p className="text-[11px] text-slate-500" dir="ltr">{t("الدرجات", "Shades")}: {i.shades}</p>}
                  <div className="mt-auto flex items-center justify-between pt-1">
                    <span className="font-extrabold text-slate-900">{usd(i.price)}</span>
                    <button className="rounded-xl border-2 border-ink bg-sun px-2.5 py-1 text-sm font-extrabold" onClick={() => addLine({ kind: "clarins", key: `k-${i.id}`, item: i, qty: 1 })}>+</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {kview && (
            <div className="fixed inset-0 z-30 flex flex-col bg-black/90 p-4" onClick={() => setKview(null)}>
              <div className="flex-1 space-y-3 overflow-auto">
                {(kview.images?.length ? kview.images : [kview.image]).map((src) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={src} src={src} alt={kview.name} className="mx-auto max-w-full rounded-2xl" />
                ))}
              </div>
              <div className="mx-auto w-full max-w-md space-y-2 pt-3" onClick={(e) => e.stopPropagation()}>
                <p className="text-center text-sm font-bold text-white" dir="ltr">{kview.brand} {kview.name} — {usd(kview.price)}</p>
                <button className={`${btn} w-full bg-sun text-ink`} onClick={() => { addLine({ kind: "clarins", key: `k-${kview.id}`, item: kview, qty: 1 }); setKview(null); }}>{t("+ أضف إلى السلة", "+ Add to cart")}</button>
                <button className="w-full py-2 text-sm font-bold text-white/80" onClick={() => setKview(null)}>{t("إغلاق", "Close")}</button>
              </div>
            </div>
          )}
          <p className="pt-2 text-center text-xs text-slate-500">{t("الدرجات حسب المتوفر في الصيدلية — اكتبي الدرجة المطلوبة (مثل 105N أو 03) في الملاحظات. نؤكد التوفر قبل التوصيل.", "Shades as available — write the shade you want (e.g. 105N or 03) in the notes. We confirm availability before delivery.")}</p>
        </main>
      )}

      {step === "browse" && tab === "lattafa" && (
        <main className="flex-1 space-y-3 p-4 pb-28">
          <input className={input} placeholder={t("ابحث عن عطر: Yara، Asad، Khamrah...", "Search a perfume: Yara, Asad, Khamrah...")} value={lq} onChange={(e) => { setLq(e.target.value); setShown(40); }} />
          {!lq && (
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
              <button className={chip(brand === "NEW")} onClick={() => { setBrand("NEW"); setShown(40); }}>{t("🆕 وصل حديثاً", "🆕 New arrivals")}</button>
              <button className={chip(brand === "ALL")} onClick={() => { setBrand("ALL"); setShown(40); }}>{t("الكل", "All")}</button>
              {brands.map(([k, label]) => (
                <button key={k} className={chip(brand === k)} onClick={() => { setBrand(k); setShown(40); }}>{label}</button>
              ))}
            </div>
          )}
          {catalog === null && <p className="text-center text-sm text-slate-500">{t("جارٍ التحميل...", "Loading...")}</p>}
          {catalog && lattafaList.length === 0 && <p className="text-center text-sm text-slate-500">{t("لا نتائج.", "No results.")}</p>}
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
                  <p className="text-[11px] font-bold text-[#9e5f69]">{i.brand}{i.isNew ? t(" · جديد", " · New") : ""}</p>
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
            <button className={`${btn} w-full bg-white text-slate-700`} onClick={() => setShown((s) => s + 40)}>{t("عرض المزيد", "Show more")} ({lattafaList.length - shown})</button>
          )}
          <p className="pt-2 text-center text-xs text-slate-500">{t("الأسعار بالدولار شاملة الضريبة. نؤكد التوفر مع الشركة قبل التوصيل.", "Prices in USD including VAT. We confirm availability before delivery.")}</p>
        </main>
      )}

      {step === "browse" && cart.length > 0 && (
        <section className="mx-4 mb-28 space-y-2 rounded-3xl border-2 border-ink bg-white p-4">
          <p className="font-extrabold">{t("سلّتك", "Your cart")}</p>
          {cart.map((l) => (
            <div key={l.key} className="flex items-center justify-between gap-2">
              <p className="min-w-0 truncate text-sm" dir="auto">
                {l.kind === "pharmacy" ? `${l.product.name}${l.product.price != null ? ` — ${usd(l.product.price)}` : ""}` : l.kind === "deborah" ? `DEBORAH ${l.item.name} — ${usd(l.item.price)}` : l.kind === "clarins" ? `${l.item.brand ?? "CLARINS"} ${l.item.name} — ${usd(l.item.price)}` : `${l.item.name} ${l.item.size} — ${usd(l.item.price)}`}
              </p>
              <div className="flex shrink-0 items-center gap-2">
                <button className="h-8 w-8 rounded-full border-2 border-ink font-bold" onClick={() => setQty(l.key, l.qty - 1)}>−</button>
                <span className="w-5 text-center font-bold">{l.qty}</span>
                <button className="h-8 w-8 rounded-full border-2 border-ink font-bold" onClick={() => setQty(l.key, l.qty + 1)}>+</button>
              </div>
            </div>
          ))}
          {clarinsTotal > 0 && <p className="border-t border-dashed pt-2 text-sm font-bold">{t("مجموع Clarins", "Clarins total")}: {usd(clarinsTotal)}</p>}
          {deborahTotal > 0 && <p className="border-t border-dashed pt-2 text-sm font-bold">{t("مجموع Deborah", "Deborah total")}: {usd(deborahTotal)}</p>}
          {lattafaTotal > 0 && <p className="border-t border-dashed pt-2 text-sm font-bold">{t("مجموع عطور لطافة", "Lattafa total")}: {usd(lattafaTotal)}</p>}
        </section>
      )}

      {step === "checkout" && (
        <main className="flex-1 space-y-3 p-4 pb-28">
          <button className="text-sm font-bold text-slate-600" onClick={() => setStep("browse")}>{t("→ رجوع", "← Back")}</button>
          <label className="block text-sm font-bold">{t("الاسم", "Name")}</label>
          <input className={input} value={name} onChange={(e) => setName(e.target.value)} />
          <label className="block text-sm font-bold">{t("المنطقة", "Area")}</label>
          <input className={input} placeholder={t("مثال: بعلبك، زحلة، الضاحية، بيروت", "e.g. Baalbek, Zahle, Dahieh, Beirut")} value={area} onChange={(e) => setArea(e.target.value)} />
          <label className="block text-sm font-bold">{t("العنوان بالتفصيل", "Full address")}</label>
          <textarea className={input} rows={2} placeholder={t("الشارع، البناية، الطابق، علامة مميزة", "Street, building, floor, landmark")} value={address} onChange={(e) => setAddress(e.target.value)} />
          <label className="block text-sm font-bold">{t("ملاحظات (اختياري)", "Notes (optional)")}</label>
          <textarea className={input} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          {needsRx && (
            <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-3">
              <p className="mb-2 text-sm font-bold text-amber-900">{t("طلبك فيه دواء بوصفة طبية — صوّر الوصفة:", "Your order has a prescription medicine — take a photo of the prescription:")}</p>
              <input type="file" accept="image/*" capture="environment" onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) setRxImage(await resizeImage(f).catch(() => null));
              }} />
              {rxImage && <p className="mt-2 text-xs font-bold text-[#9e5f69]">{t("✓ تم إرفاق الوصفة", "✓ Prescription attached")}</p>}
            </div>
          )}
          {clarinsTotal > 0 && <p className="rounded-2xl bg-white p-3 text-sm">{t("مجموع Clarins", "Clarins total")}: <b>{usd(clarinsTotal)}</b> {t("+ كلفة التوصيل. اكتبي الدرجة المطلوبة في الملاحظات.", "+ delivery. Write the shade you want in the notes.")}</p>}
          {deborahTotal > 0 && <p className="rounded-2xl bg-white p-3 text-sm">{t("مجموع Deborah", "Deborah total")}: <b>{usd(deborahTotal)}</b> {t("+ كلفة التوصيل. اكتب الألوان/الدرجات المطلوبة في الملاحظات.", "+ delivery. Write the shades you want in the notes.")}</p>}
          {lattafaTotal > 0 && <p className="rounded-2xl bg-white p-3 text-sm">{t("مجموع عطور لطافة", "Lattafa total")}: <b>{usd(lattafaTotal)}</b> {t("+ كلفة التوصيل تُبلَّغ بها.", "+ delivery cost (we will tell you).")}</p>}
          {error && <p className="rounded-2xl border-2 border-red-300 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p>}
        </main>
      )}

      {cart.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-10 mx-auto max-w-md border-t-2 border-ink bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {step === "browse" ? (
            <button className={`${btn} w-full bg-[#9e5f69] text-white`} onClick={() => setStep("checkout")}>{t("متابعة الطلب", "Checkout")} ({count})</button>
          ) : (
            <button className={`${btn} w-full bg-[#9e5f69] text-white`}
              disabled={busy || area.trim().length < 2 || address.trim().length < 3 || (needsRx && !rxImage)} onClick={submit}>
              {busy ? t("جارٍ الإرسال...", "Sending...") : t("أرسل الطلب", "Send order")}
            </button>
          )}
        </div>
      )}
    </>
  );
}

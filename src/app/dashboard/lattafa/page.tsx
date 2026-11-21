"use client";

import { useMemo, useState } from "react";
import catalog from "@/data/lattafa-catalog.json";
import { PageHeader } from "@/components/ui";

interface LItem { id: string; brand: string; brandKey: string; name: string; size: string; code: string | null; barcode: string | null; price: number; isNew: boolean; image: string | null }
const ITEMS = catalog as LItem[];

/** Staff view of the Lattafa catalog shown to customers in the app's «عطور لطافة» tab. */
export default function LattafaCatalogPage() {
  const [brand, setBrand] = useState("ALL");
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(60);

  const brands = useMemo(() => {
    const m = new Map<string, { label: string; n: number }>();
    for (const i of ITEMS) m.set(i.brandKey, { label: i.brand, n: (m.get(i.brandKey)?.n ?? 0) + 1 });
    return [...m.entries()];
  }, []);

  const list = useMemo(() => {
    const t = q.trim().toUpperCase();
    return ITEMS.filter((i) =>
      (brand === "ALL" || i.brandKey === brand) &&
      (!t || `${i.name} ${i.size} ${i.code ?? ""} ${i.barcode ?? ""}`.toUpperCase().includes(t))
    );
  }, [brand, q]);

  const chip = (a: boolean) =>
    `shrink-0 rounded-full border-2 px-3 py-1.5 text-sm font-bold ${a ? "border-ink bg-sun text-ink shadow-pop-sm" : "border-slate-300 bg-white text-slate-600"}`;

  return (
    <div className="space-y-4">
      <PageHeader
        title="عطور لطافة"
        description={`${ITEMS.length} صنفاً كما يراها الزبون في تطبيق Carelink (تبويب «عطور لطافة»). السعر بالدولار شامل الضريبة، مدوَّر لأقرب دولار.`}
        action={
          <a href="/shop" target="_blank" rel="noreferrer" className="rounded-full border-2 border-ink bg-white px-4 py-2 text-sm font-bold shadow-pop-sm">
            فتح تطبيق الزبون ↗
          </a>
        }
      />
      <input
        className="w-full rounded-2xl border-2 border-slate-300 bg-white px-4 py-3 focus:border-ink focus:outline-none"
        placeholder="ابحث بالاسم أو الرمز أو الباركود..."
        value={q}
        onChange={(e) => { setQ(e.target.value); setShown(60); }}
      />
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        <button className={chip(brand === "ALL")} onClick={() => { setBrand("ALL"); setShown(60); }}>الكل ({ITEMS.length})</button>
        {brands.map(([k, v]) => (
          <button key={k} className={chip(brand === k)} onClick={() => { setBrand(k); setShown(60); }}>{v.label} ({v.n})</button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {list.slice(0, shown).map((i) => (
          <div key={i.id} className="flex flex-col overflow-hidden rounded-2xl border-2 border-slate-200 bg-white">
            <div className="flex aspect-square items-center justify-center bg-slate-100">
              {i.image
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={i.image} alt={i.name} loading="lazy" className="h-full w-full object-cover" />
                : <span className="text-4xl opacity-40">✨</span>}
            </div>
            <div className="space-y-0.5 p-2.5">
              <p className="text-[11px] font-bold text-teal-700">{i.brand}</p>
              <p className="line-clamp-2 text-sm font-bold leading-tight" dir="ltr">{i.name}</p>
              <p className="text-[11px] text-slate-500" dir="ltr">{i.size}{i.code ? ` · #${i.code}` : ""}</p>
              <p className="pt-1 text-lg font-extrabold">{i.price}$</p>
            </div>
          </div>
        ))}
      </div>
      {list.length > shown && (
        <button className="w-full rounded-2xl border-2 border-ink bg-white py-3 font-bold" onClick={() => setShown((s) => s + 60)}>
          عرض المزيد ({list.length - shown})
        </button>
      )}
    </div>
  );
}

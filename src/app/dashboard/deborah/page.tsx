"use client";

import { useState } from "react";
import catalog from "@/data/deborah-catalog.json";
import { PageHeader } from "@/components/ui";

interface DItem { id: string; name: string; cat: string; price: number; listPrice: number; image: string }
const ITEMS = catalog as DItem[];
const CATS = [["ALL", "الكل"], ["face", "الوجه"], ["eyes", "العيون"], ["lips", "الشفاه"], ["nails", "الأظافر"]] as const;

/** Staff view of the DEBORAH MILANO tab customers see in the Carelink app (handled by الجواد كير only). */
export default function DeborahPage() {
  const [cat, setCat] = useState<string>("ALL");
  const chip = (a: boolean) =>
    `shrink-0 rounded-full border-2 px-3 py-1.5 text-sm font-bold ${a ? "border-ink bg-sun text-ink shadow-pop-sm" : "border-slate-300 bg-white text-slate-600"}`;
  const list = ITEMS.filter((i) => cat === "ALL" || i.cat === cat);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Deborah Milano"
        description={`${ITEMS.length} صنفاً كما يراها الزبون في تطبيق Carelink. الطلبات تُرسل حصراً إلى صيدلية الجواد كير. السعر للزبون بالدولار الصحيح (السعر الأصلي بين قوسين).`}
        action={
          <a href="/shop" target="_blank" rel="noreferrer" className="rounded-full border-2 border-ink bg-white px-4 py-2 text-sm font-bold shadow-pop-sm">
            فتح تطبيق الزبون ↗
          </a>
        }
      />
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {CATS.map(([k, l]) => (
          <button key={k} className={chip(cat === k)} onClick={() => setCat(k)}>{l}</button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {list.map((i) => (
          <div key={i.id} className="flex flex-col overflow-hidden rounded-2xl border-2 border-slate-200 bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={i.image} alt={i.name} loading="lazy" className="aspect-square w-full object-contain" />
            <div className="space-y-0.5 p-2.5">
              <p className="line-clamp-2 text-sm font-bold leading-tight" dir="ltr">{i.name}</p>
              <p className="pt-1 text-lg font-extrabold">{i.price}$ <span className="text-xs font-normal text-slate-500">({i.listPrice}$)</span></p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

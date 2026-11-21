import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui/PageHeader";
import { COSMETICS, COSMETIC_CATEGORIES } from "@/lib/cosmetics";
import { getCurrentUser } from "@/lib/authServer";

export const dynamic = "force-dynamic";
const PAGE = 60;

interface Row {
  name: string;
  inventory: { qtyOnHand: number; branch: { name: string } }[];
}

/** Staff view of the «كوزماتيك» tab customers see in the Carelink app (with stock per pharmacy). */
export default async function CosmeticsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  // Server-rendered page: /dashboard pages aren't covered by proxy.ts, so check the staff session here.
  if (!(await getCurrentUser())) {
    return <p className="p-6 text-center font-bold">الرجاء <Link href="/login" className="underline">تسجيل الدخول</Link>.</p>;
  }
  const sp = await searchParams;
  const cat = sp.cat ?? "ALL";
  const q = (sp.q ?? "").trim().toUpperCase();
  const page = Math.max(1, Number(sp.page) || 1);

  const counts = new Map<string, number>();
  for (const i of COSMETICS) counts.set(i.cat, (counts.get(i.cat) ?? 0) + 1);

  const terms = q.split(/\s+/).filter(Boolean);
  const list = COSMETICS.filter((i) =>
    (cat === "ALL" || i.cat === cat) && terms.every((t) => i.name.toUpperCase().includes(t))
  );
  const slice = list.slice(0, page * PAGE);

  const rows: Row[] = slice.length
    ? await prisma.product.findMany({
        where: { name: { in: slice.map((i) => i.raw) } },
        select: { name: true, inventory: { where: { qtyOnHand: { gt: 0 } }, select: { qtyOnHand: true, branch: { select: { name: true } } } } },
      })
    : [];
  const byName = new Map<string, Row>(rows.map((r: Row) => [r.name, r]));
  const label = new Map(COSMETIC_CATEGORIES.map((c) => [c.key, c.label]));

  const href = (o: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    const v = { cat, q: sp.q, ...o };
    for (const [k, x] of Object.entries(v)) if (x !== undefined && x !== "" && !(k === "cat" && x === "ALL")) p.set(k, String(x));
    return `/dashboard/cosmetics${p.size ? `?${p}` : ""}`;
  };
  const chip = (a: boolean) =>
    `shrink-0 rounded-full border-2 px-3 py-1.5 text-sm font-bold ${a ? "border-ink bg-sun text-ink shadow-pop-sm" : "border-slate-300 bg-white text-slate-600"}`;

  return (
    <div className="space-y-4">
      <PageHeader
        title="كوزماتيك"
        description={`${COSMETICS.length} صنف بارا/كوزماتيك كما يراها الزبون في تطبيق Carelink (تبويب «كوزماتيك»). السعر للزبون: «عند التأكيد» حتى تصل أسعار البيع من السوفت فارم.`}
        action={
          <a href="/shop" target="_blank" rel="noreferrer" className="rounded-full border-2 border-ink bg-white px-4 py-2 text-sm font-bold shadow-pop-sm">
            فتح تطبيق الزبون ↗
          </a>
        }
      />
      <form className="flex gap-2" action="/dashboard/cosmetics">
        {cat !== "ALL" && <input type="hidden" name="cat" value={cat} />}
        <input name="q" defaultValue={sp.q ?? ""} placeholder="ابحث بالاسم: AVENE، SPF، SHAMPOO..."
          className="w-full rounded-2xl border-2 border-slate-300 bg-white px-4 py-3 focus:border-ink focus:outline-none" />
        <button className="rounded-2xl border-2 border-ink bg-sun px-5 font-bold">بحث</button>
      </form>
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        <Link className={chip(cat === "ALL")} href={href({ cat: "ALL", page: undefined })}>الكل ({COSMETICS.length})</Link>
        {COSMETIC_CATEGORIES.map((c) => (
          <Link key={c.key} className={chip(cat === c.key)} href={href({ cat: c.key, page: undefined })}>{c.label} ({counts.get(c.key) ?? 0})</Link>
        ))}
      </div>
      <p className="text-sm text-slate-500">{list.length} صنف</p>
      <div className="overflow-hidden rounded-2xl border-2 border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-right text-xs text-slate-500">
            <tr><th className="p-2">الصنف</th><th className="p-2">القسم</th><th className="p-2">المخزون في الصيدليات</th></tr>
          </thead>
          <tbody>
            {slice.map((i) => {
              const inv = byName.get(i.raw)?.inventory ?? [];
              return (
                <tr key={i.id} className="border-t border-slate-100">
                  <td className="p-2 font-bold" dir="ltr">{i.name}</td>
                  <td className="whitespace-nowrap p-2 text-xs">{label.get(i.cat)}</td>
                  <td className="p-2 text-xs text-slate-600">
                    {inv.length ? inv.map((r) => `${r.branch.name} (${r.qtyOnHand})`).join("، ") : <span className="text-amber-700">نفد</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {list.length > slice.length && (
        <Link href={href({ page: page + 1 })} scroll={false} className="block w-full rounded-2xl border-2 border-ink bg-white py-3 text-center font-bold">
          عرض المزيد ({list.length - slice.length})
        </Link>
      )}
    </div>
  );
}

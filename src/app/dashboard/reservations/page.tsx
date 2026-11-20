"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/apiClient";
import { Alert, Badge, Card, CardBody, FullPageSpinner, PageHeader } from "@/components/ui";

type Status = "WAITING" | "ANSWERED" | "UNAVAILABLE" | "UNCLEAR" | "NO_REPLY" | "UNDELIVERED" | "CANCELLED";
interface Row {
  id: string; kind: "pharmacy" | "supplier"; code: string; place: string; item: string; qty: number; customer: string | null;
  status: Status; price: string | null; reply: string | null; sentAt: string; remindedAt: string | null; answeredAt: string | null; minutesToAnswer: number | null;
}
interface Stat { place: string; sent: number; answered: number; noReply: number; waiting: number; undelivered: number; replyRate: number | null; medianMinutes: number | null }

const STATUS: Record<Status, { label: string; tone: "neutral" | "success" | "warning" | "danger" | "info" | "brand" }> = {
  WAITING: { label: "بانتظار الرد", tone: "warning" },
  ANSWERED: { label: "ردّت بسعر", tone: "success" },
  UNAVAILABLE: { label: "غير متوفر", tone: "info" },
  UNCLEAR: { label: "رد غير واضح", tone: "brand" },
  NO_REPLY: { label: "لم تردّ", tone: "danger" },
  UNDELIVERED: { label: "لم تصلها الرسالة", tone: "danger" },
  CANCELLED: { label: "أُلغي", tone: "neutral" },
};

const time = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("ar-LB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

export default function ReservationsPage() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState<{ stats: Stat[]; rows: Row[] } | null>(null);
  const [filter, setFilter] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<{ stats: Stat[]; rows: Row[] }>(`/api/carelink/inquiries?days=${days}`)
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : "فشل التحميل"));
  }, [days]);

  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [load]);

  const rows = data?.rows.filter((r) => !filter || r.place === filter) ?? [];

  return (
    <div className="space-y-4">
      <PageHeader title="طلبات الحجز للصيدليات" description="كل طلب أُرسل لصيدلية أو شركة شريكة: هل ردّت، ومتى، وبكم — لتعرف من لا يردّ" />
      {error && <Alert tone="danger">{error}</Alert>}

      <div className="flex flex-wrap items-center gap-2">
        {[1, 7, 30].map((d) => (
          <button key={d} onClick={() => setDays(d)}
            className={`rounded-full border-2 px-4 py-1.5 text-sm font-bold ${days === d ? "border-ink bg-sun text-ink shadow-pop-sm" : "border-slate-300 bg-white text-slate-600"}`}>
            {d === 1 ? "اليوم" : `آخر ${d} أيام`}
          </button>
        ))}
        {filter && (
          <button onClick={() => setFilter("")} className="rounded-full border-2 border-ink bg-white px-4 py-1.5 text-sm font-bold">
            ✕ {filter}
          </button>
        )}
      </div>

      {!data ? (
        <FullPageSpinner label="جارِ التحميل..." />
      ) : (
        <>
          <Card>
            <CardBody>
              <p className="mb-3 font-extrabold text-slate-900">من يردّ ومن لا يردّ</p>
              {data.stats.length === 0 && <p className="text-sm text-slate-500">لا طلبات في هذه الفترة.</p>}
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {data.stats.map((s) => (
                  <button key={s.place} onClick={() => setFilter(s.place)}
                    className={`rounded-2xl border-2 p-3 text-right ${s.replyRate !== null && s.replyRate < 50 ? "border-rose-500 bg-rose-50" : "border-slate-200 bg-white"} hover:border-ink`}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate font-bold text-slate-900">{s.place}</p>
                      <span className={`text-lg font-extrabold ${s.replyRate === null ? "text-slate-400" : s.replyRate < 50 ? "text-rose-600" : s.replyRate < 80 ? "text-amber-600" : "text-emerald-700"}`}>
                        {s.replyRate === null ? "—" : `${s.replyRate}%`}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-600">
                      أُرسل {s.sent} · ردّت {s.answered} · <b className="text-rose-600">لم تردّ {s.noReply}</b>
                      {s.waiting ? ` · بانتظار ${s.waiting}` : ""}{s.undelivered ? ` · لم تصل ${s.undelivered}` : ""}
                    </p>
                    <p className="text-xs text-slate-500">متوسط وقت الرد: {s.medianMinutes === null ? "—" : `${s.medianMinutes} دقيقة`}</p>
                  </button>
                ))}
              </div>
            </CardBody>
          </Card>

          <div className="space-y-2">
            {rows.map((r) => (
              <Card key={`${r.kind}-${r.id}`}>
                <CardBody>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-slate-900">{r.place} <span className="font-mono text-xs text-slate-400" dir="ltr">{r.code}</span></p>
                      <p className="text-sm text-slate-700" dir="auto">{r.item} × {r.qty}{r.customer ? ` — للزبون ${r.customer}` : ""}</p>
                    </div>
                    <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    أُرسل {time(r.sentAt)}{r.remindedAt ? ` · تذكير ${time(r.remindedAt)}` : ""}
                    {r.answeredAt ? ` · ردّت ${time(r.answeredAt)} (بعد ${r.minutesToAnswer} دقيقة)` : ""}
                    {r.price ? ` · السعر ${Number(r.price).toLocaleString("en")}` : ""}
                  </p>
                  {r.reply && <p className="mt-1 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-700" dir="auto">ردّها: «{r.reply}»</p>}
                </CardBody>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/apiClient";
import { Alert, FullPageSpinner, PageHeader } from "@/components/ui";

interface Item {
  id: string;
  conversationId: string;
  customer: { name: string | null; phone: string; address: string | null } | null;
  question: string;
  summary: string;
  specialist: string;
  urgent: boolean;
  createdAt: string;
  resolvedAt: string | null;
}

/** Medical consultations from the Carelink app that the AI referred to a pharmacist/doctor. */
export default function ConsultationsPage() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState<"open" | "all">("open");

  const load = useCallback(() => {
    api.get<{ items: Item[] }>("/api/consultations?days=60").then((d) => setItems(d.items)).catch((e) => setError(e instanceof Error ? e.message : "خطأ"));
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  async function resolve(id: string) {
    await api.post("/api/consultations", { id }).catch(() => {});
    load();
  }

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!items) return <FullPageSpinner />;
  const list = items.filter((i) => show === "all" || !i.resolvedAt);
  const open = items.filter((i) => !i.resolvedAt).length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="الاستشارات الطبية"
        description="استشارات مجانية من تبويب «استشارة» في تطبيق Carelink أحالها الذكاء الاصطناعي لأنها تحتاج صيدلياً أو طبيباً. تابِع مع المختص ثم ردّ على الزبون من صفحة المحادثة، وبعدها اضغط «تمّ الرد»."
      />
      <div className="flex gap-2">
        <button onClick={() => setShow("open")} className={`rounded-full border-2 px-4 py-1.5 text-sm font-bold ${show === "open" ? "border-ink bg-sun" : "border-slate-300 bg-white"}`}>بانتظار الرد ({open})</button>
        <button onClick={() => setShow("all")} className={`rounded-full border-2 px-4 py-1.5 text-sm font-bold ${show === "all" ? "border-ink bg-sun" : "border-slate-300 bg-white"}`}>الكل ({items.length})</button>
      </div>
      {list.length === 0 && <p className="rounded-2xl bg-white p-6 text-center text-slate-500">لا توجد استشارات بانتظار الرد.</p>}
      <div className="space-y-3">
        {list.map((i) => (
          <div key={i.id} className={`rounded-2xl border-2 bg-white p-4 ${i.urgent ? "border-red-400" : "border-slate-200"}`}>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {i.urgent && <span className="rounded-full bg-red-100 px-2 py-0.5 font-bold text-red-700">عاجل</span>}
              <span className="rounded-full bg-slate-100 px-2 py-0.5 font-bold">{i.specialist === "doctor" ? "🩺 طبيب" : "💊 صيدلي"}</span>
              <span className="text-slate-500">{new Date(i.createdAt).toLocaleString("ar-LB")}</span>
              {i.resolvedAt && <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-bold text-emerald-700">تمّ الرد</span>}
            </div>
            <p className="mt-2 font-bold">{i.customer?.name ?? "زبون"} <span className="font-normal text-slate-500" dir="ltr">{i.customer?.phone}</span></p>
            <p className="mt-1 whitespace-pre-wrap text-sm"><b>السؤال:</b> {i.question}</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600"><b>ملخص:</b> {i.summary}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href={`/dashboard/whatsapp?c=${i.conversationId}`} className="rounded-full border-2 border-ink bg-white px-4 py-1.5 text-sm font-bold">فتح المحادثة والرد</Link>
              {!i.resolvedAt && <button onClick={() => resolve(i.id)} className="rounded-full border-2 border-ink bg-sun px-4 py-1.5 text-sm font-bold">تمّ الرد ✓</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

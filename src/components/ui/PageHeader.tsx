export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="inline-block rounded-full border-2 border-ink bg-sun px-5 py-1 font-display text-xl font-extrabold text-ink shadow-pop-sm">{title}</h1>
        {description && <p className="mt-3 text-sm text-slate-600">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function StatCard({
  label,
  value,
  tone = "neutral",
  hint,
}: {
  label: string;
  value: string | number;
  tone?: "neutral" | "brand" | "warning" | "danger" | "success" | "info";
  hint?: string;
}) {
  const toneClass = {
    neutral: "text-slate-900",
    brand: "text-brand-700",
    warning: "text-amber-700",
    danger: "text-rose-600",
    success: "text-emerald-700",
    info: "text-sky-700",
  }[tone];
  const bgClass = {
    neutral: "bg-white",
    brand: "bg-brand-100",
    warning: "bg-amber-100",
    danger: "bg-rose-100",
    success: "bg-emerald-100",
    info: "bg-sky-100",
  }[tone];
  return (
    <div className={`rounded-3xl border-[2.5px] border-ink p-4 shadow-pop ${bgClass}`}>
      <p className="text-xs font-bold text-slate-600">{label}</p>
      <p className={`mt-1.5 font-display text-3xl font-extrabold tabular-nums ${toneClass}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

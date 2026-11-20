export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <div className="flex h-14 w-14 -rotate-6 items-center justify-center rounded-full border-2 border-ink bg-sun text-xl text-ink shadow-pop-sm">
        ∅
      </div>
      <h4 className="font-display text-base font-bold text-slate-800">{title}</h4>
      {description && <p className="max-w-sm text-xs text-slate-500">{description}</p>}
      {action}
    </div>
  );
}

export function Alert({
  tone = "danger",
  children,
}: {
  tone?: "danger" | "success" | "warning" | "info";
  children: React.ReactNode;
}) {
  const classes = {
    danger: "bg-rose-50 text-rose-700 border-rose-500",
    success: "bg-emerald-50 text-emerald-800 border-emerald-600",
    warning: "bg-amber-50 text-amber-800 border-amber-600",
    info: "bg-sky-50 text-sky-800 border-sky-600",
  }[tone];
  return <div className={`rounded-2xl border-2 border-dashed px-4 py-3 text-sm font-medium ${classes}`}>{children}</div>;
}

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "brand";

const TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-600 border-slate-300",
  success: "bg-emerald-100 text-emerald-800 border-emerald-700",
  warning: "bg-amber-100 text-amber-800 border-amber-700",
  danger: "bg-rose-100 text-rose-700 border-rose-600",
  info: "bg-sky-100 text-sky-800 border-sky-700",
  brand: "bg-brand-100 text-brand-700 border-brand-600",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border-2 px-2.5 py-0.5 text-xs font-bold ${TONE_CLASSES[tone]}`}>
      {children}
    </span>
  );
}

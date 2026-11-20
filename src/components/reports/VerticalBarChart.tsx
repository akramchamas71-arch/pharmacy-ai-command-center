/**
 * Hand-built single-series vertical bar chart (no charting library — see reports page notes).
 * One color, one scale: every bar uses the same `color` class and height is a simple
 * percentage of the max value in the series. Always renders a real numeric label above each
 * bar (tabular-nums) — these are real revenue/count numbers the owner needs to read, not
 * decoration. Many bars (e.g. 30 days) scroll horizontally rather than shrinking to
 * illegibility.
 */
export interface VerticalBarDatum {
  key: string;
  label: string;
  value: number;
  title?: string;
}

export function VerticalBarChart({
  data,
  formatValue = (v: number) => v.toLocaleString("en-US"),
  color = "bg-brand-500",
  heightClassName = "h-44",
}: {
  data: VerticalBarDatum[];
  formatValue?: (value: number) => string;
  color?: string;
  heightClassName?: string;
}) {
  const max = Math.max(1, ...data.map((d) => Math.abs(d.value)));

  return (
    // dir="ltr" keeps a time axis flowing chronologically left-to-right even inside the
    // app's RTL shell — a deliberate exception for this one axis, not a mistake.
    <div className="flex items-end gap-2 overflow-x-auto pb-1" dir="ltr">
      {data.map((d) => {
        const pct = Math.max(2, Math.round((Math.abs(d.value) / max) * 100));
        return (
          <div
            key={d.key}
            className={`flex min-w-[48px] flex-1 flex-col items-center justify-end ${heightClassName}`}
            title={d.title ?? `${d.label}: ${formatValue(d.value)}`}
          >
            <span className="mb-1 whitespace-nowrap text-[11px] font-semibold tabular-nums text-slate-700">
              {formatValue(d.value)}
            </span>
            <div className={`w-full rounded-t-lg border-2 border-b-0 border-ink ${color}`} style={{ height: `${pct}%` }} />
            <span dir="rtl" className="mt-1.5 max-w-[48px] truncate text-[10px] text-slate-400">
              {d.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

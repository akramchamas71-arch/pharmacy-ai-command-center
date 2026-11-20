/**
 * Hand-built horizontal bar list — good for ranked lists like "top products by revenue".
 * Single color, single scale (percentage of the max value in the list); always shows the
 * real numeric value next to its bar.
 */
export interface HorizontalBarDatum {
  key: string;
  label: string;
  value: number;
  sublabel?: string;
}

export function HorizontalBarList({
  data,
  formatValue = (v: number) => v.toLocaleString("en-US"),
  color = "bg-brand-500",
}: {
  data: HorizontalBarDatum[];
  formatValue?: (value: number) => string;
  color?: string;
}) {
  const max = Math.max(1, ...data.map((d) => Math.abs(d.value)));

  return (
    <div className="space-y-3">
      {data.map((d) => {
        const pct = Math.max(2, Math.round((Math.abs(d.value) / max) * 100));
        return (
          <div key={d.key}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
              <span className="truncate font-medium text-slate-700">
                {d.label}
                {d.sublabel && <span className="ms-2 font-normal text-slate-400">{d.sublabel}</span>}
              </span>
              <span className="shrink-0 font-semibold tabular-nums text-slate-600">{formatValue(d.value)}</span>
            </div>
            <div className="h-3 w-full rounded-full bg-slate-100">
              <div className={`h-full rounded-full border-2 border-ink ${color}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

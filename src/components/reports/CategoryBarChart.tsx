/**
 * Hand-built vertical bar chart where each bar is a DIFFERENT category (e.g. an order status
 * breakdown) — color here legitimately encodes category, not decoration, so each datum carries
 * its own fixed color. One scale still: every bar's height is relative to the same max. A
 * legend below repeats each category's color so it reads on its own without the chart.
 */
export interface CategoryBarDatum {
  key: string;
  label: string;
  value: number;
  color: string; // a Tailwind bg-* class, kept consistent for this category wherever it appears
}

export function CategoryBarChart({
  data,
  formatValue = (v: number) => v.toLocaleString("en-US"),
  heightClassName = "h-40",
}: {
  data: CategoryBarDatum[];
  formatValue?: (value: number) => string;
  heightClassName?: string;
}) {
  const max = Math.max(1, ...data.map((d) => Math.abs(d.value)));

  return (
    <div>
      <div className={`flex items-end gap-3 overflow-x-auto pb-1`}>
        {data.map((d) => {
          const pct = Math.max(2, Math.round((Math.abs(d.value) / max) * 100));
          return (
            <div
              key={d.key}
              className={`flex min-w-[64px] flex-1 flex-col items-center justify-end ${heightClassName}`}
              title={`${d.label}: ${formatValue(d.value)}`}
            >
              <span className="mb-1 whitespace-nowrap text-[11px] font-semibold tabular-nums text-slate-700">
                {formatValue(d.value)}
              </span>
              <div className={`w-full rounded-t-lg border-2 border-b-0 border-ink ${d.color}`} style={{ height: `${pct}%` }} />
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {data.map((d) => (
          <span key={d.key} className="inline-flex items-center gap-1.5 text-xs text-slate-500">
            <span className={`h-2.5 w-2.5 rounded-full ${d.color}`} />
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}

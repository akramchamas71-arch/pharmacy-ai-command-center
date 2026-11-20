import { HTMLAttributes } from "react";

export function Card({ className = "", children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`rounded-3xl border-[2.5px] border-ink bg-white shadow-pop ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-dashed border-slate-300 px-5 py-4">
      <div>
        <h3 className="font-display text-base font-bold text-slate-900">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function CardBody({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return <div className={`p-5 ${className}`}>{children}</div>;
}

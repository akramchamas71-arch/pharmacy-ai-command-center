export function Spinner({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={`pacc-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.2" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function FullPageSpinner({ label = "جارِ التحميل..." }: { label?: string }) {
  return (
    <div className="flex h-64 flex-col items-center justify-center gap-3 text-slate-400">
      <Spinner className="h-8 w-8 text-brand-500" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

"use client";

import { useEffect } from "react";

export function Modal({
  open,
  onClose,
  title,
  children,
  width = "max-w-lg",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-950/55 backdrop-blur-[3px]" onClick={onClose} />
      <div className={`relative z-10 w-full ${width} rounded-[28px] border-[2.5px] border-ink bg-white shadow-pop-lg`}>
        <div className="flex items-center justify-between border-b-2 border-dashed border-slate-300 px-5 py-4">
          <h3 className="font-display text-base font-bold text-slate-900">{title}</h3>
          <button
            onClick={onClose}
            aria-label="إغلاق"
            className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-transparent text-slate-500 hover:border-ink hover:bg-slate-100 hover:text-slate-900"
          >
            ✕
          </button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

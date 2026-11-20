"use client";

import { ButtonHTMLAttributes, forwardRef } from "react";
import { Spinner } from "./Spinner";

type Variant = "primary" | "secondary" | "danger" | "ghost" | "outline";
type Size = "sm" | "md";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:brightness-105 disabled:bg-brand-300 disabled:border-brand-300 disabled:shadow-none",
  secondary: "bg-white text-slate-900 hover:bg-slate-100 disabled:text-slate-400 disabled:border-slate-300 disabled:shadow-none",
  danger: "bg-white text-rose-600 hover:bg-rose-50 disabled:text-rose-300 disabled:border-rose-200 disabled:shadow-none",
  ghost: "bg-transparent text-slate-600 border-transparent !shadow-none hover:!shadow-none hover:bg-white hover:border-ink hover:text-slate-900 disabled:text-slate-300",
  outline: "bg-sun text-ink hover:brightness-105 disabled:text-slate-300 disabled:bg-white disabled:border-slate-300 disabled:shadow-none",
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: "text-xs px-3 py-1.5 gap-1.5 shadow-[0_2px_0_#1d2b4f] hover:shadow-[0_4px_0_#1d2b4f]",
  md: "text-sm px-4 py-2 gap-2 shadow-pop-sm hover:shadow-[0_5px_0_#1d2b4f]",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, disabled, className = "", children, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center rounded-full border-2 border-ink font-bold transition-all hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-none disabled:translate-y-0 disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      {...rest}
    >
      {loading && <Spinner className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
});

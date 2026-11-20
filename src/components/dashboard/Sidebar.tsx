"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "./navConfig";
import { useCurrentUser } from "@/lib/userContext";

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const user = useCurrentUser();

  const visibleItems = NAV_ITEMS.filter((item) => {
    if (!item.anyOf) return true;
    return item.anyOf.some((p) => user.permissions.includes(p));
  });

  return (
    <aside className="flex h-full w-64 flex-col rounded-[28px] border-[2.5px] border-ink bg-white shadow-[0_6px_0_#1d2b4f]">
      <div className="flex items-center gap-3 border-b-2 border-dashed border-slate-300 px-5 py-4">
        <div className="flex h-12 w-12 shrink-0 -rotate-[8deg] items-center justify-center rounded-full border-[2.5px] border-ink bg-brand-600 font-display text-xl text-white shadow-pop-sm">ص</div>
        <div>
          <p className="font-display text-lg font-extrabold leading-tight text-slate-900">مركز القيادة</p>
          <p className="text-[11px] font-semibold leading-snug text-slate-500">PHARMACY AI</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {visibleItems.map((item) => {
          const active = item.href === "/dashboard" ? pathname === item.href : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={`pop-nav flex items-center gap-2.5 rounded-2xl border-2 px-3.5 py-2.5 text-sm ${
                active
                  ? "border-ink bg-sun font-extrabold text-ink shadow-pop-sm"
                  : "border-transparent font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              <span className="text-base leading-none">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t-2 border-dashed border-slate-300 p-4">
        <div className="rounded-2xl border-2 border-slate-300 bg-slate-50 px-3 py-2.5">
          <p className="truncate text-xs font-bold text-slate-800">{user.name}</p>
          <p className="truncate text-[11px] text-slate-500">{user.branch?.name ?? "كل الفروع"}</p>
        </div>
      </div>
    </aside>
  );
}

"use client";

import { useState } from "react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-screen gap-4 overflow-hidden p-3 md:p-4">
      {/* Desktop sidebar */}
      <div className="hidden md:block md:shrink-0">
        <Sidebar />
      </div>

      {/* Mobile sidebar drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-slate-950/55 backdrop-blur-[3px]" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 right-0 p-3">
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenuClick={() => setMobileOpen(true)} />
        <main className="flex-1 overflow-y-auto px-1 pb-6 pt-4 md:px-2 md:pt-5">{children}</main>
      </div>
    </div>
  );
}

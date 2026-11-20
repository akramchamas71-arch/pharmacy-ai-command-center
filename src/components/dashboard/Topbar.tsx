"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useCurrentUser } from "@/lib/userContext";
import { roleLabel } from "@/lib/roleLabels";
import { Button } from "@/components/ui";
import { DigitalExtras } from "./DigitalExtras";

export function Topbar({ onMenuClick }: { onMenuClick?: () => void }) {
  const user = useCurrentUser();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  async function logout() {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <header className="flex items-center justify-between rounded-full border-[2.5px] border-ink bg-white px-4 py-2 shadow-pop-sm md:px-6">
      <button
        onClick={onMenuClick}
        className="rounded-full border-2 border-ink px-3 py-1 text-slate-700 shadow-[0_2px_0_#1d2b4f] hover:bg-slate-100 md:hidden"
        aria-label="القائمة"
      >
        ☰
      </button>
      <div className="hidden md:block">
        <DigitalExtras />
      </div>
      <div className="flex items-center gap-3">
        <div className="text-left">
          <p className="text-xs font-bold text-slate-800">{user.name}</p>
          <p className="text-[11px] text-slate-500">{roleLabel(user.role)}</p>
        </div>
        <Button variant="secondary" size="sm" loading={loggingOut} onClick={logout}>
          تسجيل الخروج
        </Button>
      </div>
    </header>
  );
}

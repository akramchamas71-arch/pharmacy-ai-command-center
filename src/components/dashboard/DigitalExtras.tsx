"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui";

const DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const MONTHS = [
  "كانون الثاني", "شباط", "آذار", "نيسان", "أيار", "حزيران",
  "تموز", "آب", "أيلول", "تشرين الأول", "تشرين الثاني", "كانون الأول",
];

type Mode = "digital" | "night" | "classic";
const NEXT: Record<Mode, Mode> = { digital: "night", night: "classic", classic: "digital" };
const LABEL: Record<Mode, string> = {
  digital: "🌙 الشكل الليلي",
  night: "🎨 الشكل الكلاسيكي",
  classic: "🖥️ الشكل الرقمي",
};

function readMode(): Mode {
  const c = document.documentElement.classList;
  if (!c.contains("digital")) return "classic";
  return c.contains("night") ? "night" : "digital";
}

function applyMode(m: Mode) {
  const c = document.documentElement.classList;
  if (m === "classic") {
    c.remove("digital", "night");
  } else {
    c.add("digital");
    if (m === "night") c.add("night");
    else c.remove("night");
  }
}

function p2(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

/** ساعة حيّة + حالة الاتصال + أزرار تبديل الشكل وملء الشاشة. شكلية فقط. */
export function DigitalExtras() {
  const [now, setNow] = useState<Date | null>(null);
  const [mode, setMode] = useState<"digital" | "night" | "classic">("digital");
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const root = document.documentElement;
    setMode(readMode());
    setNow(new Date());
    setOnline(navigator.onLine);
    const timer = setInterval(() => setNow(new Date()), 1000);
    const goOn = () => setOnline(true);
    const goOff = () => setOnline(false);
    // الطباعة بالشكل الكلاسيكي دائماً (ورق أبيض)
    let before: Mode | null = null;
    const beforePrint = () => {
      before = readMode();
      applyMode("classic");
    };
    const afterPrint = () => {
      if (before) applyMode(before);
    };
    window.addEventListener("online", goOn);
    window.addEventListener("offline", goOff);
    window.addEventListener("beforeprint", beforePrint);
    window.addEventListener("afterprint", afterPrint);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", goOn);
      window.removeEventListener("offline", goOff);
      window.removeEventListener("beforeprint", beforePrint);
      window.removeEventListener("afterprint", afterPrint);
    };
  }, []);

  function toggleUI() {
    const next = NEXT[mode];
    applyMode(next);
    try {
      localStorage.setItem("pharm-ui", next);
    } catch {
      /* التخزين غير متاح: يبقى التبديل للجلسة الحالية فقط */
    }
    setMode(next);
  }

  function toggleFullscreen() {
    try {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen();
    } catch {
      /* المتصفح لا يدعم ملء الشاشة */
    }
  }

  return (
    <div className="flex items-center gap-3">
      <div className="dx-clock">
        <span className="dx-time">
          {now ? `${p2(now.getHours())}:${p2(now.getMinutes())}:${p2(now.getSeconds())}` : "--:--:--"}
        </span>
        <span className="dx-date">
          {now ? (
            <>
              {DAYS[now.getDay()]}
              <br />
              {now.getDate()} {MONTHS[now.getMonth()]} {now.getFullYear()}
            </>
          ) : null}
        </span>
        <span className="dx-live" style={online ? undefined : { color: "#ffc447" }}>
          <i />
          {online ? "متصل" : "بلا اتصال"}
        </span>
      </div>
      <Button variant="secondary" size="sm" onClick={toggleUI}>
        {LABEL[mode]}
      </Button>
      <Button variant="secondary" size="sm" onClick={toggleFullscreen}>
        ⛶ ملء الشاشة
      </Button>
    </div>
  );
}

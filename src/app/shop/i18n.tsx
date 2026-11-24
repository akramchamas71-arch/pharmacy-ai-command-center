"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type Lang = "ar" | "en";
const KEY = "carelink-lang";
const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({ lang: "ar", setLang: () => {} });

/** App language (Arabic default, English optional), remembered on the device. */
export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("ar");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === "en" || saved === "ar") setLangState(saved);
    } catch {}
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "en" ? "ltr" : "rtl";
  }, [lang]);
  const setLang = (l: Lang) => {
    setLangState(l);
    try { localStorage.setItem(KEY, l); } catch {}
  };
  return (
    <Ctx.Provider value={{ lang, setLang }}>
      <div dir={lang === "en" ? "ltr" : "rtl"} lang={lang} className="contents">{children}</div>
    </Ctx.Provider>
  );
}

export function useLang() {
  const { lang, setLang } = useContext(Ctx);
  const t = (ar: string, en: string) => (lang === "en" ? en : ar);
  return { lang, setLang, t };
}

/** Small AR / EN switch. */
export function LangToggle({ className = "" }: { className?: string }) {
  const { lang, setLang } = useLang();
  return (
    <button
      onClick={() => setLang(lang === "en" ? "ar" : "en")}
      className={`rounded-full border-2 border-white px-2.5 py-1 text-xs font-extrabold ${className}`}
      aria-label={lang === "en" ? "التبديل إلى العربية" : "Switch to English"}
    >
      {lang === "en" ? "عربي" : "EN"}
    </button>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { useLang } from "./i18n";

/** Opening video «حدك وين ما كنت» — shown once per app session, skippable. */
export function Splash() {
  const [show, setShow] = useState(false);
  const [muted, setMuted] = useState(true);
  const ref = useRef<HTMLVideoElement>(null);
  const { t: tr } = useLang();

  useEffect(() => {
    try {
      if (!sessionStorage.getItem("carelink-splash")) setShow(true);
    } catch {
      setShow(true);
    }
  }, []);

  function close() {
    try { sessionStorage.setItem("carelink-splash", "1"); } catch {}
    setShow(false);
  }

  if (!show) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#f0e4df]">
      <video
        ref={ref}
        src="/video/intro.mp4"
        poster="/video/intro.jpg"
        autoPlay
        muted={muted}
        playsInline
        onEnded={close}
        onError={close}
        className="h-full w-full max-w-md object-cover"
      />
      <div className="absolute inset-x-0 bottom-0 mx-auto flex max-w-md items-center justify-between gap-3 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <button
          className="rounded-full border-2 border-white bg-black/30 px-4 py-2 text-sm font-bold text-white"
          onClick={() => { setMuted((m) => !m); ref.current?.play().catch(() => {}); }}
        >
          {muted ? tr("🔇 الصوت", "🔇 Sound") : tr("🔊 الصوت", "🔊 Sound")}
        </button>
        <button className="rounded-full border-2 border-ink bg-[#9e5f69] px-6 py-2.5 text-base font-extrabold text-white shadow-pop-sm" onClick={close}>
          {tr("دخول ←", "Enter →")}
        </button>
      </div>
    </div>
  );
}

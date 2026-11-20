"use client";
import { useEffect } from "react";

/** Registers the service worker that makes /shop installable (and packageable for Google Play). */
export function ShopSW() {
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js", { scope: "/shop" }).catch(() => {});
  }, []);
  return null;
}

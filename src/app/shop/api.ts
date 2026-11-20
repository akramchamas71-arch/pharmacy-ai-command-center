"use client";

export async function shopFetch<T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(url, {
    method: init?.method ?? (init?.body ? "POST" : "GET"),
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
    credentials: "include",
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && typeof window !== "undefined" && !location.pathname.startsWith("/shop/login")) {
    location.href = "/shop/login";
  }
  if (!res.ok) throw new Error((data as { error?: string }).error || "حدث خطأ");
  return data as T;
}

/** Shrinks a photo in the browser (max 1280px, JPEG) so it uploads fast on mobile data. */
export function resizeImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = () => reject(new Error("تعذّر قراءة الصورة"));
    img.src = url;
  });
}

export const btn =
  "rounded-2xl border-2 border-ink px-4 py-3 text-base font-extrabold shadow-pop-sm active:translate-y-0.5 disabled:opacity-50";
export const input = "w-full rounded-2xl border-2 border-slate-300 bg-white px-4 py-3 text-base focus:border-ink focus:outline-none";

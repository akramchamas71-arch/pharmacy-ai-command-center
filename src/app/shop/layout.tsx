import type { Metadata, Viewport } from "next";
import { ShopSW } from "./ShopSW";

export const metadata: Metadata = {
  title: "Carelink — اطلب من صيدليتك",
  description: "اطلب أدويتك ومستلزماتك من الصيدليات الشريكة وتوصيل إلى البيت",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Carelink", statusBarStyle: "default" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-192.png" },
};

export const viewport: Viewport = {
  themeColor: "#0f766e",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-slate-50">
      <ShopSW />
      <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col">{children}</div>
    </div>
  );
}

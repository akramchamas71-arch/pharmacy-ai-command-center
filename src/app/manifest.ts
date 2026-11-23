import type { MetadataRoute } from "next";

// Web-app manifest for the CareLink customer app (/shop). Makes it installable on phones and is
// what the Google Play package (Trusted Web Activity) is generated from.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/shop",
    name: "Carelink — اطلب من صيدليتك",
    short_name: "Carelink",
    description: "اطلب أدويتك ومستلزماتك من الصيدليات الشريكة وتوصيل إلى البيت",
    start_url: "/shop",
    scope: "/shop",
    display: "standalone",
    orientation: "portrait",
    dir: "rtl",
    lang: "ar",
    background_color: "#f0e4df",
    theme_color: "#9e5f69",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

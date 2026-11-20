import type { Metadata } from "next";
import { Tajawal, Baloo_Bhaijaan_2, Rajdhani } from "next/font/google";
import "./globals.css";
import "./digital.css";

const tajawal = Tajawal({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "700", "800"],
  variable: "--font-tajawal",
  display: "swap",
});

const baloo = Baloo_Bhaijaan_2({
  subsets: ["arabic", "latin"],
  weight: ["600", "700", "800"],
  variable: "--font-baloo",
  display: "swap",
});

// خط الأرقام الرقمية (الشكل الرقمي)
const rajdhani = Rajdhani({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-rajdhani",
  display: "block",
});

export const metadata: Metadata = {
  title: "PHARMACY AI COMMAND CENTER",
  description: "مركز قيادة الصيدلية الذكي — لوحة التحكم",
};

// الشكل الرقمي الفاتح هو الافتراضي؛ يُطبَّق اختيار المستخدم (ليلي/كلاسيكي) قبل الرسم لتجنّب الوميض.
const UI_SCRIPT =
  "try{var u=localStorage.getItem('pharm-ui'),c=document.documentElement.classList;if(u==='classic'){c.remove('digital')}else if(u==='night'){c.add('night')}}catch(e){}";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="ar"
      dir="rtl"
      className={`${tajawal.variable} ${baloo.variable} ${rajdhani.variable} digital`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: UI_SCRIPT }} />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import { Noto_Sans_Thai, Inter } from "next/font/google";
import "./globals.css";
import { SessionProvider } from "next-auth/react";
import { auth } from "@/lib/auth";
import { ThemeProvider } from "@/context/ThemeProvider";
import { TabAuthProvider } from "@/context/TabAuthContext";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Analytics } from "@vercel/analytics/next";

const notoSansThai = Noto_Sans_Thai({
  subsets: ["thai", "latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-thai",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Stockify — ระบบจัดการสต็อกสินค้าและตำแหน่งจัดเก็บ",
  description: "ระบบจัดการคลังสินค้าอัจฉริยะ ติดตามสต็อก ตำแหน่งจัดเก็บ และการเคลื่อนไหวสินค้าแบบเรียลไทม์",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  return (
    <html lang="th" className={`${notoSansThai.variable} ${inter.variable} light`} data-theme="light">
      <body className="font-thai antialiased">
        <SessionProvider session={session}>
          <TabAuthProvider>
            <ThemeProvider>
              {children}
            </ThemeProvider>
          </TabAuthProvider>
        </SessionProvider>
        <SpeedInsights />
        <Analytics />
      </body>
    </html>
  );
}

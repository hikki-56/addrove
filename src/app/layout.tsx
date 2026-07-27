import type { Metadata } from "next";
import { Noto_Sans_Thai, Inter } from "next/font/google";
import "./globals.css";
import { SessionProvider } from "next-auth/react";
import { auth } from "@/lib/auth";
import { ThemeProvider } from "@/context/ThemeContext";

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
    <html lang="th" className={`${notoSansThai.variable} ${inter.variable}`}>
      <body className="font-thai antialiased bg-gray-950 text-white">
        <SessionProvider session={session}>
          <ThemeProvider>
            {children}
          </ThemeProvider>
        </SessionProvider>
      </body>
    </html>
  );
}

// ฟอนต์หลักของ Minimal UI v3b — โหลดผ่าน next/font/google (ดาวน์โหลดตอน build แล้ว self-host อัตโนมัติ
// ไม่เรียก Google Fonts จากเบราว์เซอร์ผู้ใช้) และเปิดเป็น CSS variable ให้ globals.css อ้างอิง
//   --font-public-sans  ตัวอักษรละติน/ตัวเลขทั่วไป
//   --font-barlow       หัวข้อ/ตัวเลขใหญ่ (KPI)
//   --font-noto-thai    อักษรไทย (fallback ต่ออักขระหลัง Public Sans/Barlow ซึ่งไม่มีอักษรไทย)
// ไฟล์ Sarabun เดิมยังอยู่ใน public/fonts เผื่อ rollback (globals.css ยังประกาศ @font-face ไว้แต่ไม่ได้ใช้)
import { Barlow, Noto_Sans_Thai, Public_Sans } from "next/font/google";

export const publicSans = Public_Sans({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--font-public-sans",
});

export const barlow = Barlow({
  subsets: ["latin", "latin-ext"],
  weight: ["500", "600", "700", "800"],
  display: "swap",
  variable: "--font-barlow",
});

export const notoSansThai = Noto_Sans_Thai({
  subsets: ["thai", "latin"],
  display: "swap",
  variable: "--font-noto-thai",
});

export const fontVariables = `${publicSans.variable} ${barlow.variable} ${notoSansThai.variable}`;

"use client";

// TEMPORARY design-preview route — สาธิตหน้า "สินค้าทั้งหมด" นอกสาย auth ด้วยข้อมูลตัวอย่าง
// (mock fetch ก่อน render) ใช้เฉพาะการตรวจภาพ จะลบออกหลังยืนยัน

import { useEffect, useState } from "react";
import Sidebar from "@/components/layout/Sidebar";
import DashboardHeader from "@/components/layout/Navbar";
import ProductsPage from "@/app/(dashboard)/products/page";

const WAREHOUSES = [
  { warehouse_id: "wh-01", warehouse_code: "HQ", warehouse_name: "สำนักงานใหญ่", address: "-", active: true, created_at: "", updated_at: "" },
  { warehouse_id: "wh-02", warehouse_code: "G1", warehouse_name: "โกดัง 1", address: "-", active: true, created_at: "", updated_at: "" },
  { warehouse_id: "wh-03", warehouse_code: "G2", warehouse_name: "โกดัง 2", address: "-", active: true, created_at: "", updated_at: "" },
];

const LOCATIONS = Array.from({ length: 24 }, (_, i) => ({
  location_id: `loc-${i + 1}`,
  warehouse_id: `wh-0${(i % 3) + 1}`,
  location_code: `${(i % 3) + 1}K14-${i + 1}A`,
  active: true,
}));

type MockProduct = {
  product_id: string; sku: string; barcode: string; product_name: string; category: string;
  base_unit: string; minimum_stock: number; total_quantity: number;
  stock_status: "NORMAL" | "LOW" | "OUT" | "NEGATIVE";
  locations_breakdown: { warehouse_id: string; warehouse_name: string; location: string; quantity: number }[];
  description: string; active: boolean; created_at: string; updated_at: string;
};

const RAW: Array<[string, string, string, string, number, number, Array<[number, number]>]> = [
  // sku, barcode, name, category, min, total, [[whIdx, qty]...]
  ["PROD-STL-24", "8850001101001", "สายถัก STL 24 นิ้ว", "วัสดุพิมพ์ 3มิติ", 100, 640, [[0, 240], [1, 400]]],
  ["PROD-STL-12", "8850001101002", "สายถัก STL 12 นิ้ว", "วัสดุพิมพ์ 3มิติ", 100, 80, [[1, 80]]],
  ["PROD-NGK-05", "8850001101003", "หัวฉีด NGK 0.5mm", "อะไหล่เครื่องจักร", 30, 210, [[0, 60], [2, 150]]],
  ["PROD-BRG-608", "8850001101004", "ลูกปืน 608ZZ", "อะไหล่เครื่องจักร", 200, 1450, [[1, 1450]]],
  ["PROD-WRE-16", "8850001101005", "สกรูหัวกลม 16mm", "ฮาร์ดแวร์", 500, 320, [[2, 320]]],
  ["PROD-TPE-1K", "8850001101006", "ฟิลเมนต์ TPE 1Kg", "วัสดุพิมพ์ 3มิติ", 40, 0, []],
  ["PROD-GLV-M", "8850001101007", "ถุงมือนิรภัย ขนาด M", "อุปกรณ์ความปลอดภัย", 60, 95, [[0, 95]]],
  ["PROD-TAP-48", "8850001101008", "เทปกาวยูริเทน 48mm", "วัสดุสิ้นเปลือง", 80, 1240, [[1, 640], [2, 600]]],
  ["PROD-OIL-400", "8850001101009", "น้ำมันหล่อลื่น 400ml", "วัสดุสิ้นเปลือง", 24, 18, [[1, 18]]],
  ["PROD-BOX-30", "8850001101010", "กล่องลูกฟูก 30x20x15", "บรรจุภัณฑ์", 300, 2600, [[0, 800], [1, 900], [2, 900]]],
  ["PROD-LBL-100", "8850001101011", "ฉลากบาร์โค้ด 100 แผ่น", "บรรจุภัณฑ์", 50, -12, [[2, -12]]],
  ["PROD-CTL-5", "8850001101012", "คัตเตอร์ 5 ด้าน", "เครื่องเขียน", 20, 66, [[0, 66]]],
];

const statusOf = (qty: number, min: number) =>
  qty < 0 ? "NEGATIVE" : qty === 0 ? "OUT" : qty <= min ? "LOW" : "NORMAL";

const PRODUCTS: MockProduct[] = RAW.map(([sku, barcode, name, category, min, total, whs], i) => ({
  product_id: `p-${i + 1}`,
  sku,
  barcode,
  product_name: name,
  category,
  base_unit: "ชิ้น",
  minimum_stock: min,
  total_quantity: total,
  stock_status: statusOf(total, min),
  locations_breakdown: whs.map(([w, q]) => ({
    warehouse_id: WAREHOUSES[w].warehouse_id,
    warehouse_name: WAREHOUSES[w].warehouse_name,
    location: `${w + 1}K14-${(i % 12) + 1}A`,
    quantity: q,
  })),
  description: "",
  active: true,
  created_at: "",
  updated_at: "",
}));

function installMockFetch() {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    const path = url.pathname;
    await new Promise((r) => setTimeout(r, 250)); // จำลอง latency ให้เห็น skeleton

    if (path === "/api/warehouses") {
      return new Response(JSON.stringify({ success: true, data: WAREHOUSES }), { headers: { "Content-Type": "application/json" } });
    }
    if (path === "/api/locations") {
      return new Response(JSON.stringify({ success: true, data: LOCATIONS }), { headers: { "Content-Type": "application/json" } });
    }
    if (path === "/api/products") {
      const page = Number(url.searchParams.get("page") || 1);
      const limitParam = url.searchParams.get("limit");
      const search = (url.searchParams.get("search") || "").toLowerCase();
      const category = url.searchParams.get("category") || "";
      const status = url.searchParams.get("status") || "";

      let items = PRODUCTS;
      if (search) {
        items = items.filter((p) =>
          [p.sku, p.barcode, p.product_name].some((f) => (f || "").toLowerCase().includes(search))
        );
      }
      if (category) items = items.filter((p) => p.category === category);
      if (status) items = items.filter((p) => p.stock_status === status);

      const total = items.length;
      const limit = limitParam === "1000" || !limitParam ? total : Number(limitParam);
      const pageSize = limit >= 100000 ? total : limit;
      const totalPages = Math.max(1, Math.ceil(total / (pageSize || total)));
      const start = (page - 1) * (pageSize || total);
      return new Response(
        JSON.stringify({ success: true, data: { items: items.slice(start, start + (pageSize || total)), total, totalPages, page } }),
        { headers: { "Content-Type": "application/json" } }
      );
    }
    return realFetch(input as RequestInfo);
  };
}

export default function DevPreviewProductsPage() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    installMockFetch();
    setReady(true);
  }, []);

  // สถานะทดสอบผ่าน URL: ?q= (ค้นหา), ?expand=1 (ขยายแถวแรก), ?dropdown=N (เปิด dropdown ตัวที่ N)
  useEffect(() => {
    if (!ready) return;
    const params = new URLSearchParams(window.location.search);
    const q = params.get("q");
    if (q !== null) {
      const input = document.getElementById("product-search") as HTMLInputElement | null;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      if (input && setter) {
        setter.call(input, q);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
    const timers: number[] = [];
    if (params.get("expand")) {
      timers.push(window.setTimeout(() => {
        document.querySelector<HTMLButtonElement>("table tbody td button[aria-expanded]")?.click();
      }, 1500));
    }
    const dd = params.get("dropdown");
    if (dd) {
      timers.push(window.setTimeout(() => {
        const triggers = document.querySelectorAll<HTMLButtonElement>('[aria-haspopup="listbox"]');
        triggers[Number(dd) - 1 || 0]?.click();
      }, 1500));
    }
    return () => timers.forEach((t) => clearTimeout(t));
  }, [ready]);

  return (
    <div className="flex h-[100dvh] max-h-[100dvh] bg-[#EFF3F1] text-[#111827] overflow-hidden w-full max-w-full">
      <Sidebar role="ADMIN" userName="ผู้ดูแลระบบ" />
      <div className="flex flex-1 flex-col min-w-0 min-h-0 overflow-hidden w-full max-w-full">
        <DashboardHeader
          user={{ name: "ผู้ดูแลระบบ", email: "admin@stockify.local", role: "ADMIN" }}
        />
        <main className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain overflow-x-hidden w-full max-w-full bg-[#EFF3F1]">
          <div className="mx-auto w-full px-4 py-6 md:px-6 md:py-8 xl:px-8">
            {ready ? <ProductsPage /> : null}
          </div>
        </main>
      </div>
    </div>
  );
}

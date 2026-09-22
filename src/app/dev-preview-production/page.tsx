"use client";

// TEMPORARY design-preview route — สธิตหน้า "ผลิตสินค้า" (ระบบโต๊ะผลิต 1–5) นอกสาย auth
// ใช้เฉพาะการตรวจภาพ จะลบออกหลังยืนยัน
// ?view=cart → หน้าตะกร้าผลิต, ?view=history → หน้าใบผลิต/การ์ดโต๊ะ (mock ใบผลิต), ค่าอื่น → หน้าผลิต

import { useEffect, useState } from "react";
import Sidebar from "@/components/layout/Sidebar";
import DashboardHeader from "@/components/layout/Navbar";
import ProductionPage from "@/app/(dashboard)/production/page";
import ProductionCartPage from "@/app/(dashboard)/production/cart/page";
import ProductionHistoryPage from "@/app/(dashboard)/production/history/page";

type MockBom = {
  bom_id: string;
  fg_sku: string;
  fg_barcode: string;
  fg_name: string;
  fg_unit: string;
  base_qty: number;
  active: boolean;
  image: string;
  maxProducible: number;
  fg_wh2_stock: number;
  item_count: number;
};

const MOCK_BOMS: MockBom[] = [
  { bom_id: "b1", fg_sku: "FG-001", fg_barcode: "8850001000011", fg_name: "กะเพราหมูสับแช่แข็ง 200g", fg_unit: "ถาด", base_qty: 1, active: true, image: "/products/A002.jpg", maxProducible: 120, fg_wh2_stock: 35, item_count: 6 },
  { bom_id: "b2", fg_sku: "FG-002", fg_barcode: "8850001000028", fg_name: "ราดหน้าทะเลแช่แข็ง 250g", fg_unit: "ถาด", base_qty: 1, active: true, image: "/products/A002.jpg", maxProducible: 80, fg_wh2_stock: 12, item_count: 7 },
  { bom_id: "b3", fg_sku: "FG-003", fg_barcode: "8850001000035", fg_name: "ข้าวผัดกุ้งแช่แข็ง 220g", fg_unit: "ถาด", base_qty: 1, active: true, image: "/products/A002.jpg", maxProducible: 0, fg_wh2_stock: 4, item_count: 5 },
];

// ใบผลิตตัวอย่างสำหรับหน้า history — มีทั้งใบกำลังผลิต (PENDING/IN_PROGRESS) และใบเสร็จ (COMPLETED)
const MOCK_ORDERS = [
  {
    id: "doc-prd-1",
    order_no: "PRD-20260922-1001",
    document_id: "doc-prd-1",
    reference_no: "PRD-20260922-1001",
    status: "PENDING" as const,
    items: [
      { fg_sku: "FG-001", fg_barcode: "8850001000011", fg_name: "กะเพราหมูสับแช่แข็ง 200g", fg_unit: "ถาด", table_no: 2, quantity: 50, produced_qty: 0, defect_qty: 0, image: "/products/A002.jpg", target_warehouse_id: "wh-02", target_warehouse_name: "โกดัง 2 (สินค้าสำเร็จรูป)", materials: [] },
      { fg_sku: "FG-002", fg_barcode: "8850001000028", fg_name: "ราดหน้าทะเลแช่แข็ง 250g", fg_unit: "ถาด", table_no: 3, quantity: 30, produced_qty: 0, defect_qty: 0, image: "/products/A002.jpg", target_warehouse_id: "wh-02", target_warehouse_name: "โกดัง 2 (สินค้าสำเร็จรูป)", materials: [] },
    ],
    total_fg_qty: 80,
    total_materials_count: 13,
    created_by: "admin",
    created_by_name: "ผู้ดูแลระบบ (Admin)",
    created_at: new Date(Date.now() - 3600_000).toISOString(),
    document_date: new Date().toISOString().slice(0, 10),
    inspections: [],
    materials_summary: [],
  },
  {
    id: "doc-prd-2",
    order_no: "PRD-20260921-2002",
    document_id: "doc-prd-2",
    reference_no: "PRD-20260921-2002",
    status: "IN_PROGRESS" as const,
    items: [
      { fg_sku: "FG-003", fg_barcode: "8850001000035", fg_name: "ข้าวผัดกุ้งแช่แข็ง 220g", fg_unit: "ถาด", table_no: 2, quantity: 40, produced_qty: 25, defect_qty: 3, image: "/products/A002.jpg", target_warehouse_id: "wh-02", target_warehouse_name: "โกดัง 2 (สินค้าสำเร็จรูป)", materials: [] },
    ],
    total_fg_qty: 40,
    total_materials_count: 5,
    created_by: "admin",
    created_by_name: "ผู้ดูแลระบบ (Admin)",
    created_at: new Date(Date.now() - 86400_000).toISOString(),
    document_date: new Date().toISOString().slice(0, 10),
    inspections: [],
    materials_summary: [],
  },
  {
    id: "doc-prd-3",
    order_no: "PRD-20260920-3003",
    document_id: "doc-prd-3",
    reference_no: "PRD-20260920-3003",
    status: "COMPLETED" as const,
    items: [
      { fg_sku: "FG-001", fg_barcode: "8850001000011", fg_name: "กะเพราหมูสับแช่แข็ง 200g", fg_unit: "ถาด", table_no: 5, quantity: 60, produced_qty: 58, defect_qty: 2, image: "/products/A002.jpg", target_warehouse_id: "wh-02", target_warehouse_name: "โกดัง 2 (สินค้าสำเร็จรูป)", materials: [] },
    ],
    total_fg_qty: 60,
    total_materials_count: 6,
    created_by: "admin",
    created_by_name: "ผู้ดูแลระบบ (Admin)",
    created_at: new Date(Date.now() - 2 * 86400_000).toISOString(),
    document_date: new Date().toISOString().slice(0, 10),
    inspections: [],
    materials_summary: [],
  },
];

const json = (data: unknown) =>
  new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });

export default function DevPreviewProductionPage() {
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<"list" | "cart" | "history">("list");

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("view");
    setView(q === "cart" ? "cart" : q === "history" ? "history" : "list");

    // session แอดมินจำลอง — ให้หน้า history เปิดช่องกรอกผลผลิตได้ (canReport)
    try {
      localStorage.setItem(
        "stockify_tab_session",
        JSON.stringify({
          user: {
            id: "preview-admin",
            email: "admin@stockify.local",
            name: "ผู้ดูแลระบบ (Admin)",
            role: "ADMIN",
            warehouse_access: ["wh-02"],
          },
          token: "preview-token",
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
        })
      );
    } catch {}

    // mock fetch — BOM list/single + รายการใบผลิต + รายงานผลผลิต (review)
    const original = window.fetch.bind(window);
    (window as any).fetch = async (input: any, init?: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/api/production/bom")) {
        const skuParam = new URL(url, "http://x").searchParams.get("sku");
        const data = skuParam
          ? { ...MOCK_BOMS.find((b) => b.fg_sku === skuParam), items: [] }
          : MOCK_BOMS;
        return json({ success: true, data });
      }
      if (url.includes("/api/production/orders/") && url.includes("/review")) {
        return json({ success: true, data: { order_no: "PRD-MOCK", round_no: 1, total_good: 1, total_defect: 0, message: "preview" } });
      }
      if (url.match(/\/api\/production\/orders(\?|$)/)) {
        return json({ success: true, data: MOCK_ORDERS, total: MOCK_ORDERS.length });
      }
      return original(input, init);
    };
    setReady(true);
    return () => {
      (window as any).fetch = original;
    };
  }, []);

  return (
    <div className="flex h-[100dvh] max-h-[100dvh] bg-[#EFF3F1] text-[#111827] overflow-hidden w-full max-w-full">
      <Sidebar role="ADMIN" userName="ผู้ดูแลระบบ" />
      <div className="flex flex-1 flex-col min-w-0 min-h-0 overflow-hidden w-full max-w-full">
        <DashboardHeader user={{ name: "ผู้ดูแลระบบ", email: "admin@stockify.local", role: "ADMIN" }} />
        <main className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain w-full max-w-full bg-[#EFF3F1]">
          <div className="mx-auto w-full px-4 py-6 md:px-6 md:py-8 xl:px-8">
            <div className="mb-4 rounded-xl bg-amber-100 border border-amber-300 px-4 py-2 text-sm font-bold text-amber-900">
              DEV PREVIEW — หน้าผลิตสินค้า + ระบบโต๊ะผลิต 1–5 (ข้อมูลตัวอย่าง)
            </div>
            {ready &&
              (view === "cart" ? (
                <ProductionCartPage />
              ) : view === "history" ? (
                <ProductionHistoryPage />
              ) : (
                <ProductionPage />
              ))}
          </div>
        </main>
      </div>
    </div>
  );
}

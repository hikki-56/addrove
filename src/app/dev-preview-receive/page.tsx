"use client";

// TEMPORARY preview route สำหรับดูหน้า "รับสินค้าเข้าโกดัง" (Receive Goods) นอกสาย auth
import React, { useState } from "react";
import Sidebar from "@/components/layout/Sidebar";
import DashboardHeader from "@/components/layout/Navbar";
import BarcodeScanInput from "@/components/scanner/BarcodeScanInput";
import ReceiveLinesTable from "@/app/(dashboard)/movements/receive/_components/ReceiveLinesTable";
import { useForm } from "react-hook-form";
import type { ReceiveDocumentInput } from "@/types/api";

const mockProducts = [
  {
    product_id: "prod-stl24",
    sku: "STL-24",
    barcode: "8859123456789",
    product_name: "สายถักสแตนเลส STL 24 นิ้ว",
    category: "อะไหล่",
    base_unit: "ชิ้น",
    minimum_stock: 50,
    quantity: 1500,
    total_quantity: 1500,
    location: "1K14-1A",
    active: true,
    created_at: "",
    updated_at: "",
  }
];

const mockLocations = [
  { location_id: "loc-1", location_code: "1K14-1A", shelf_code: "1K14-1A", warehouse_id: "wh-02", active: true },
  { location_id: "loc-2", location_code: "1K14-1B", shelf_code: "1K14-1B", warehouse_id: "wh-02", active: true },
];

export default function DevPreviewReceivePage() {
  const form = useForm<ReceiveDocumentInput>({
    defaultValues: {
      warehouse_id: "wh-02",
      lines: [
        { product_id: "prod-stl24", boxes: 5, qty: 250, location_id: "1K14-1A" }
      ]
    }
  });

  const [barcodeInput, setBarcodeInput] = useState("8859123456789");
  const [confirmedLines, setConfirmedLines] = useState<Record<number, boolean>>({});

  return (
    <div className="flex h-[100dvh] max-h-[100dvh] bg-[#EFF3F1] text-[#111827] overflow-hidden w-full max-w-full">
      <Sidebar role="ADMIN" userName="ผู้ดูแลระบบ" />
      <div className="flex flex-1 flex-col min-w-0 min-h-0 overflow-hidden w-full max-w-full">
        <DashboardHeader user={{ name: "ผู้ดูแลระบบ", email: "admin@stockify.local", role: "ADMIN" }} />
        <main className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain overflow-x-hidden w-full max-w-full bg-[#EFF3F1]">
          <div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-6 md:py-8 space-y-4">
            {/* Header info */}
            <div className="bg-white rounded-2xl border border-[#E8ECEA] p-4 flex items-center justify-between shadow-xs">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#0F5C3F]" />
                <span className="bg-[#EAF2EE] px-3.5 py-1.5 rounded-full border border-[#DFEDE6] text-sm font-bold text-[#052B1F]">
                  โกดัง 1 (WH-02) — รับสินค้าเข้า
                </span>
              </div>
              <button className="px-3.5 py-2 bg-slate-100 rounded-xl text-sm font-bold text-slate-700">⟳ รีเฟรช</button>
            </div>

            {/* Scan input */}
            <BarcodeScanInput
              value={barcodeInput}
              onChange={setBarcodeInput}
              onScanSubmit={() => {}}
              placeholder="สแกนบาร์โค้ดสินค้า หรือพิมพ์รหัส..."
            />

            {/* Lines Table */}
            <ReceiveLinesTable
              form={form}
              fields={[{ id: "line-1", product_id: "prod-stl24", boxes: 5, qty: 250, location_id: "1K14-1A" }]}
              locations={mockLocations as any}
              products={mockProducts as any}
              activeWhId="wh-02"
              confirmedLines={confirmedLines}
              onToggleConfirm={(idx) => setConfirmedLines(prev => ({ ...prev, [idx]: !prev[idx] }))}
              onAddLocationForProduct={() => {}}
              onRemove={() => {}}
              onScanLocation={() => {}}
              onOpenConfirmModal={() => {}}
            />
          </div>
        </main>
      </div>
    </div>
  );
}

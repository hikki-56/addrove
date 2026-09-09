"use client";

// TEMPORARY preview route สำหรับดูหน้าเบิกสินค้า (เมนู transfer) นอกสาย auth
// ข้อมูลทั้งหมดเป็นตัวอย่างจาก docs/ux/issue-menu-ux-spec.md — จะลบออกเมื่อตรวจภาพเสร็จ
// ?view=staff|admin (ค่าเริ่มต้น admin) · ?modal=step1|step3|step4

import React, { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useSearchParams } from "next/navigation";
import type { Product, Warehouse } from "@/types/models";
import type { TransferNotification } from "@/lib/transfer-notification-utils";
import type { TransferFormInput } from "@/app/(dashboard)/movements/transfer/_hooks/use-transfer-movement";
import TransferForm from "@/app/(dashboard)/movements/transfer/_components/TransferForm";
import TransferNotificationList from "@/app/(dashboard)/movements/transfer/_components/TransferNotificationList";
import TransferStaffWorkflowModal from "@/app/(dashboard)/movements/transfer/_components/TransferStaffWorkflowModal";

const baseProduct = {
  category: "อุปกรณ์ประกอบรถ",
  base_unit: "ชิ้น",
  minimum_stock: 50,
  description: "ตัวอย่างสินค้าสำหรับพรีวิว",
  active: true,
  created_at: "2026-09-01T09:00:00+07:00",
  updated_at: "2026-09-01T09:00:00+07:00",
  created_by: "admin-001",
  created_by_name: "อารีย์ แก้วใส",
};

const products: Product[] = [
  {
    ...baseProduct,
    product_id: "prod-stl24",
    sku: "STL-24",
    barcode: "8859123456789",
    product_name: "สายถัก STL 24 นิ้ว",
    quantity: 1500,
    total_quantity: 1500,
    location: "1K14-1A, 1K14-1B",
    supplier: "ตัวอย่างซัพพลายเออร์",
  },
  {
    ...baseProduct,
    product_id: "prod-hose5",
    sku: "HOSE-5M",
    barcode: "8859876543210",
    product_name: "ท่อลม 5 เมตร",
    quantity: 320,
    total_quantity: 320,
    location: "1K07-2C",
  },
];

const warehouses: Warehouse[] = [
  { warehouse_id: "wh-01", warehouse_code: "WH01", warehouse_name: "สำนักงานใหญ่", address: "", active: true, created_at: "", updated_at: "" },
  { warehouse_id: "wh-02", warehouse_code: "WH02", warehouse_name: "โกดัง 1", address: "", active: true, created_at: "", updated_at: "" },
  { warehouse_id: "wh-03", warehouse_code: "WH03", warehouse_name: "โกดัง 2", address: "", active: true, created_at: "", updated_at: "" },
];

function makeTask(over: Partial<TransferNotification>): TransferNotification {
  return {
    id: "task-1",
    doc_no: "TRF-20260904-0001",
    product_id: "prod-stl24",
    product_name: "สายถัก STL 24 นิ้ว",
    sku: "STL-24",
    barcode: "8859123456789",
    from_warehouse_id: "wh-02",
    from_warehouse_name: "โกดัง 1",
    to_warehouse_id: "wh-03",
    to_warehouse_name: "โกดัง 2",
    qty: 400,
    moved_by: "สมชาย ใจดี",
    created_at: "2026-09-04T09:12:00+07:00",
    created_by: "admin-001",
    created_by_name: "อารีย์ แก้วใส",
    status: "PENDING",
    current_step: 0,
    ...over,
  } as TransferNotification;
}

const pendingTasks: TransferNotification[] = [
  makeTask({}),
  makeTask({
    id: "task-2",
    doc_no: "TRF-20260904-0002",
    product_name: "ท่อลม 5 เมตร",
    sku: "HOSE-5M",
    barcode: "8859876543210",
    qty: 60,
    current_step: 1,
    status: "ACKNOWLEDGED",
  }),
  makeTask({
    id: "task-3",
    doc_no: "TRF-20260904-0003",
    qty: 1250,
    current_step: 3,
    status: "ACKNOWLEDGED",
    from_location_id: "1K14-1A",
    to_location_id: "B1-C3",
    source_allocations: [{ location_id: "1K14-1A", location_name: "1K14-1A", qty: 1250 }],
  }),
];

const waitingTasks: TransferNotification[] = [
  makeTask({
    id: "task-4",
    status: "WAITING_APPROVAL",
    current_step: 4,
    last_active_at: "2026-09-04T09:58:00+07:00",
    to_location_id: "B1-C3",
    source_allocations: [{ location_id: "1K14-1A", location_name: "1K14-1A", qty: 400 }],
  }),
  makeTask({
    id: "task-5",
    doc_no: "TRF-20260904-0005",
    product_name: "ท่อลม 5 เมตร",
    sku: "HOSE-5M",
    barcode: "8859876543210",
    qty: 25,
    status: "WAITING_APPROVAL",
    current_step: 4,
    last_active_at: "2026-09-04T10:20:00+07:00",
    to_location_id: "B1-C1",
    source_allocations: [{ location_id: "1K07-2C", location_name: "1K07-2C", qty: 25 }],
  }),
];

// useSearchParams ต้องอยู่ใน Suspense boundary ไม่งั้น static prerender
// ของหน้านี้พังทั้ง build (missing-suspense-with-csr-bailout)
export default function DevPreviewTransferPage() {
  return (
    <React.Suspense fallback={null}>
      <DevPreviewTransferContent />
    </React.Suspense>
  );
}

function DevPreviewTransferContent() {
  const searchParams = useSearchParams();
  const view = searchParams?.get("view") || "admin";
  const modal = searchParams?.get("modal");

  const [selectedTask, setSelectedTask] = useState<TransferNotification | null>(null);
  const [staffStep, setStaffStep] = useState<number>(1);
  const [scanProduct, setScanProduct] = useState("");
  const [scanDest, setScanDest] = useState("");
  const [scannedToLocation, setScannedToLocation] = useState("");
  const productInputRef = React.useRef<HTMLInputElement | null>(null);
  const sourceInputRef = React.useRef<HTMLInputElement | null>(null);
  const destInputRef = React.useRef<HTMLInputElement | null>(null);

  const form = useForm<TransferFormInput>({
    defaultValues: {
      from_warehouse_id: "wh-02",
      to_warehouse_id: "wh-03",
      product_id: "",
      qty: 1,
      document_date: "",
      moved_by: "",
      reference_no: "",
      note: "",
      idempotency_key: "",
    },
  });
  const [items, setItems] = useState(
    products.map((p) => ({ product_id: p.product_id as string, sku: p.sku, barcode: p.barcode, product_name: p.product_name, qty: p.product_id === "prod-stl24" ? 400 : 60, stock_qty: p.quantity ?? 0 }))
  );

  const activeTask = modal === "step3" ? makeTask({ current_step: 3 }) : modal === "step4" ? makeTask({ current_step: 4 }) : makeTask({ current_step: 1 });

  const modalElement = modal ? (
    <TransferStaffWorkflowModal
      selectedTask={activeTask}
      products={products}
      onClose={() => {}}
      staffStep={modal === "step3" ? 3 : modal === "step4" ? 4 : 1}
      setStaffStep={setStaffStep}
      staffScanProductInput={scanProduct}
      setStaffScanProductInput={setScanProduct}
      staffScanSourceLocationInput=""
      setStaffScanSourceLocationInput={() => {}}
      staffScanDestLocationInput={scanDest}
      setStaffScanDestLocationInput={setScanDest}
      scannedToLocation={modal === "step3" ? "B1-C3" : ""}
      setScannedToLocation={setScannedToLocation}
      isSubmittingTransfer={false}
      onSubmitTransfer={() => {}}
      sourceAllocations={[]}
      onUpdateSourceAllocationQty={() => {}}
      onRemoveSourceAllocation={() => {}}
      onProceedToDestStep={() => {}}
      staffError={modal === "step1" ? 'บาร์โค้ดไม่ตรงกับสินค้าที่ต้องย้าย! (ที่สแกน: "8850000001111" / ต้องการ: "8859123456789 / STL-24")' : ""}
      staffSuccess=""
      staffProductInputRef={productInputRef}
      staffSourceLocationInputRef={sourceInputRef}
      staffDestLocationInputRef={destInputRef}
      onVerifyProductBarcode={() => {}}
      onVerifySourceLocationBarcode={() => {}}
      onVerifyDestinationLocationBarcode={() => {}}
    />
  ) : null;

  if (modal) {
    return (
      <div className="bg-[#F4F6F3] min-h-[100dvh] p-6">
        <p className="text-xs text-slate-400 mb-2">dev-preview · modal={modal} (ข้อมูลตัวอย่าง)</p>
        {modalElement}
      </div>
    );
  }

  if (view === "staff") {
    return (
      <div className="bg-[#F4F6F3] min-h-[100dvh] py-6">
        <div className="max-w-2xl mx-auto w-full px-2 sm:px-4 pb-20 sm:pb-8 space-y-4">
          <p className="text-xs text-slate-400">dev-preview · staff view (ข้อมูลตัวอย่าง)</p>
          <div className="bg-white rounded-[20px] p-5 border border-[#E8ECEA] shadow-[0_1px_2px_rgba(16,24,40,0.05)] flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-[#06402B]" />
                <h1 className="font-extrabold text-slate-900 text-lg sm:text-xl tracking-tight">รายการที่ต้องไปเบิกสินค้า</h1>
              </div>
              <p className="text-sm text-slate-600 font-medium mt-1">
                พนักงาน: <span className="font-bold text-slate-900">สมชาย ใจดี</span> • <span className="font-extrabold text-[#053425]">โกดัง 1</span>
              </p>
            </div>
            <button type="button" className="px-4 min-h-[44px] bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-sm rounded-xl transition-colors cursor-pointer flex items-center gap-2 shadow-2xs shrink-0">
              <span>รีเฟรช</span>
            </button>
          </div>
          <TransferNotificationList
            notifications={[...pendingTasks, ...waitingTasks]}
            isAdmin={false}
            products={products}
            onSelectTask={setSelectedTask}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#F4F6F3] min-h-[100dvh] py-6">
      <div className="max-w-4xl lg:max-w-5xl mx-auto w-full px-3 sm:px-6 pt-2 pb-20 sm:pt-4 sm:pb-8 space-y-4">
        <p className="text-xs text-slate-400">dev-preview · admin view (ข้อมูลตัวอย่าง)</p>
        <div className="grid grid-cols-3 p-1.5 bg-slate-100 border border-[#E8ECEA] rounded-2xl gap-1.5 sm:gap-2 shadow-xs items-stretch">
          {["สร้างใบเบิกสินค้า", "รายการที่ต้องไปเบิก", "รออนุมัติ"].map((label, i) => (
            <button
              key={label}
              type="button"
              className={`relative w-full h-full min-h-[58px] sm:min-h-[46px] py-2 sm:py-2.5 px-2 sm:px-3 rounded-xl font-bold text-sm cursor-pointer border text-center ${
                i === 0 ? "bg-white text-slate-900 shadow-xs border-[#E8ECEA]" : "text-slate-600 border-transparent hover:bg-white/60"
              }`}
            >
              <span className="leading-tight">{label}</span>
              {i === 1 && <span className="absolute top-1.5 right-1.5 px-2 py-0.5 rounded-full text-[13px] font-black bg-rose-600 text-white shadow-xs">3</span>}
              {i === 2 && <span className="absolute top-1.5 right-1.5 px-2 py-0.5 rounded-full text-[13px] font-black bg-amber-500 text-slate-950 shadow-xs">2</span>}
            </button>
          ))}
        </div>
        <TransferForm
          form={form}
          warehouses={warehouses}
          products={products}
          selectedProduct={null}
          watchProduct=""
          watchFromWh="wh-02"
          watchToWh="wh-03"
          error=""
          onSubmit={() => {}}
          onErrorPrompt={() => {}}
          selectedItems={items as never}
          addTransferItem={() => {}}
          updateItemQty={(idx, qty) => setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, qty } : it)))}
          removeItem={(idx) => setItems((prev) => prev.filter((_, i) => i !== idx))}
          clearItems={() => setItems([])}
        />
        <div className="pt-6" />
        <TransferNotificationList
          notifications={pendingTasks}
          isAdmin
          products={products}
          onSelectTask={setSelectedTask}
          onCancelTask={() => {}}
          onApproveTask={() => {}}
          onRejectTask={() => {}}
        />
        <div className="pt-6" />
        <TransferNotificationList
          notifications={waitingTasks}
          isAdmin
          products={products}
          onSelectTask={setSelectedTask}
          onCancelTask={() => {}}
          onApproveTask={() => {}}
          onRejectTask={() => {}}
        />
      </div>
    </div>
  );
}

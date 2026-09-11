"use client";

import { useState } from "react";
import type { Product, Warehouse } from "@/types/models";
import ProductSearchInput from "@/components/ui/ProductSearchInput";
import type { ReceivingPlanCreatePayload } from "../_hooks/use-receiving-plans";

const cardClass =
  "bg-white rounded-[20px] border border-[#E8ECEA] shadow-[0_1px_2px_rgba(16,24,40,0.05)]";

interface PlanLineDraft {
  product: Product;
  expectedQty: string;
  expectedBoxes: string;
  note: string;
}

interface ReceivingPlanCreateFormProps {
  warehouses: Warehouse[];
  products: Product[];
  defaultWarehouseId: string;
  isSubmitting: boolean;
  onSubmit: (payload: ReceivingPlanCreatePayload) => Promise<boolean>;
  onCreated?: () => void;
}

export default function ReceivingPlanCreateForm({
  warehouses,
  products,
  defaultWarehouseId,
  isSubmitting,
  onSubmit,
  onCreated,
}: ReceivingPlanCreateFormProps) {
  const [warehouseId, setWarehouseId] = useState(defaultWarehouseId || "");
  const [referenceNo, setReferenceNo] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<PlanLineDraft[]>([]);
  const [formError, setFormError] = useState("");

  const addProduct = (product: Product) => {
    if (lines.some((l) => l.product.product_id === product.product_id)) {
      setFormError(`สินค้า "${product.product_name}" อยู่ในแผนแล้ว`);
      return;
    }
    setFormError("");
    setLines((prev) => [...prev, { product, expectedQty: "", expectedBoxes: "", note: "" }]);
  };

  const updateLine = (index: number, patch: Partial<PlanLineDraft>) => {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  };

  const removeLine = (index: number) => {
    setLines((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    setFormError("");
    if (!warehouseId) {
      setFormError("กรุณาเลือกโกดังปลายทาง");
      return;
    }
    if (lines.length === 0) {
      setFormError("กรุณาเพิ่มสินค้าอย่างน้อย 1 รายการ");
      return;
    }

    const payloadLines: ReceivingPlanCreatePayload["lines"] = [];
    for (const line of lines) {
      const expectedQty = line.expectedQty.trim() === "" ? undefined : Number(line.expectedQty);
      const expectedBoxes = line.expectedBoxes.trim() === "" ? undefined : Number(line.expectedBoxes);
      if (expectedQty !== undefined && (!Number.isInteger(expectedQty) || expectedQty <= 0)) {
        setFormError(`จำนวนที่คาดหวังของ "${line.product.product_name}" ต้องเป็นจำนวนเต็มบวก (เว้นว่างได้ถ้าไม่ตั้งเป้า)`);
        return;
      }
      if (expectedBoxes !== undefined && (!Number.isInteger(expectedBoxes) || expectedBoxes <= 0)) {
        setFormError(`จำนวนกล่องของ "${line.product.product_name}" ต้องเป็นจำนวนเต็มบวก`);
        return;
      }
      payloadLines.push({
        product_id: line.product.product_id || line.product.sku,
        ...(expectedQty !== undefined ? { expected_qty: expectedQty } : {}),
        ...(expectedBoxes !== undefined ? { expected_boxes: expectedBoxes } : {}),
        note: line.note.trim(),
      });
    }

    const ok = await onSubmit({
      warehouse_id: warehouseId,
      reference_no: referenceNo.trim(),
      expected_date: expectedDate,
      note: note.trim(),
      lines: payloadLines,
    });

    if (ok) {
      setLines([]);
      setReferenceNo("");
      setExpectedDate("");
      setNote("");
      onCreated?.();
    }
  };

  return (
    <div className="space-y-4">
      <div className={`${cardClass} p-4 sm:p-6 space-y-4 sm:space-y-5`}>
        <div className="flex items-center justify-between gap-3 pb-3 border-b border-[#EEF1EF]">
          <div>
            <h3 className="font-extrabold text-slate-900 text-base sm:text-lg">สร้างแผนรับสินค้า</h3>
            <p className="text-sm text-slate-500 font-semibold mt-0.5">
              กำหนดรายการสินค้าที่คาดว่าจะมาถึงโกดัง — พนักงานจะเห็นในแท็บ “รายการที่ต้องรับ”
              และรับได้เฉพาะสินค้าในแผน
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
          <div className="space-y-1.5">
            <label htmlFor="plan-warehouse" className="block text-sm font-extrabold text-slate-800">
              รับเข้าโกดัง <span className="text-rose-600">*</span>
            </label>
            <div className="relative">
              <select
                id="plan-warehouse"
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
                className="w-full px-4 py-3.5 rounded-2xl bg-white border-2 border-[#D5DDD9] text-slate-900 text-base font-bold focus:outline-none focus:border-[#0F5C3F] focus:ring-4 focus:ring-[#0F5C3F]/20 shadow-sm transition-colors cursor-pointer appearance-none pr-10"
              >
                {warehouses.map((w) => (
                  <option key={w.warehouse_id} value={w.warehouse_id}>
                    {w.warehouse_name}
                  </option>
                ))}
              </select>
              <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="plan-reference" className="block text-sm font-extrabold text-slate-800">
              เลขที่อ้างอิง (เช่น PO)
            </label>
            <input
              id="plan-reference"
              type="text"
              value={referenceNo}
              onChange={(e) => setReferenceNo(e.target.value)}
              maxLength={100}
              placeholder="เลขที่ใบสั่งซื้อ / ใบกำกับ"
              className="w-full px-4 py-3.5 rounded-2xl bg-white border-2 border-[#D5DDD9] text-slate-900 text-base font-bold focus:outline-none focus:border-[#0F5C3F] focus:ring-4 focus:ring-[#0F5C3F]/20 shadow-sm transition-colors"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="plan-expected-date" className="block text-sm font-extrabold text-slate-800">
              คาดว่าจะมาถึง
            </label>
            <input
              id="plan-expected-date"
              type="date"
              value={expectedDate}
              onChange={(e) => setExpectedDate(e.target.value)}
              className="w-full px-4 py-3.5 rounded-2xl bg-white border-2 border-[#D5DDD9] text-slate-900 text-base font-bold focus:outline-none focus:border-[#0F5C3F] focus:ring-4 focus:ring-[#0F5C3F]/20 shadow-sm transition-colors"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="plan-note" className="block text-sm font-extrabold text-slate-800">
            หมายเหตุ
          </label>
          <input
            id="plan-note"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder="เช่น รถบรรทุกทะเบียน… / ผู้ส่ง…"
            className="w-full px-4 py-3.5 rounded-2xl bg-white border-2 border-[#D5DDD9] text-slate-900 text-base font-bold focus:outline-none focus:border-[#0F5C3F] focus:ring-4 focus:ring-[#0F5C3F]/20 shadow-sm transition-colors"
          />
        </div>
      </div>

      <div className={`${cardClass} p-4 sm:p-6 space-y-4`}>
        <div className="space-y-1.5">
          <label className="block text-sm font-extrabold text-slate-800">เพิ่มสินค้าเข้าแผน</label>
          <ProductSearchInput
            products={products}
            onSelectProduct={addProduct}
            selectedProductIds={lines.map((l) => l.product.product_id)}
            placeholder="พิมพ์ SKU / ชื่อสินค้า / บาร์โค้ด แล้วเลือกจากรายการ…"
          />
        </div>

        {formError && (
          <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-sm font-semibold">
            {formError}
          </div>
        )}

        {lines.length > 0 && (
          <ul className="space-y-2">
            {lines.map((line, index) => (
              <li
                key={line.product.product_id}
                className="p-3.5 rounded-2xl bg-[#F7F9F8] border border-[#EEF1EF] space-y-2.5"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold text-slate-900 text-sm truncate">{line.product.product_name}</p>
                    <p className="text-xs font-mono text-slate-500">
                      {line.product.sku}
                      {line.product.barcode && line.product.barcode !== "-" ? ` • ${line.product.barcode}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeLine(index)}
                    className="shrink-0 p-2 rounded-xl text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                    aria-label={`ลบ ${line.product.product_name} ออกจากแผน`}
                  >
                    <svg className="w-4.5 h-4.5 w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  <div className="space-y-1">
                    <label className="block text-xs font-bold text-slate-600">
                      จำนวนที่คาดหวัง ({line.product.base_unit || "ชิ้น"})
                    </label>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={line.expectedQty}
                      onChange={(e) => updateLine(index, { expectedQty: e.target.value })}
                      placeholder="ไม่ตั้งเป้า"
                      className="w-full px-3 py-2.5 rounded-xl bg-white border border-[#D5DDD9] text-slate-900 text-sm font-bold focus:outline-none focus:border-[#0F5C3F] focus:ring-2 focus:ring-[#0F5C3F]/20 transition-colors"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-xs font-bold text-slate-600">จำนวนกล่องที่คาดหวัง</label>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={line.expectedBoxes}
                      onChange={(e) => updateLine(index, { expectedBoxes: e.target.value })}
                      placeholder="ไม่ระบุ"
                      className="w-full px-3 py-2.5 rounded-xl bg-white border border-[#D5DDD9] text-slate-900 text-sm font-bold focus:outline-none focus:border-[#0F5C3F] focus:ring-2 focus:ring-[#0F5C3F]/20 transition-colors"
                    />
                  </div>
                  <div className="space-y-1 col-span-2 sm:col-span-1">
                    <label className="block text-xs font-bold text-slate-600">หมายเหตุรายการ</label>
                    <input
                      type="text"
                      value={line.note}
                      onChange={(e) => updateLine(index, { note: e.target.value })}
                      maxLength={200}
                      placeholder="เช่น แยกโซน A"
                      className="w-full px-3 py-2.5 rounded-xl bg-white border border-[#D5DDD9] text-slate-900 text-sm font-bold focus:outline-none focus:border-[#0F5C3F] focus:ring-2 focus:ring-[#0F5C3F]/20 transition-colors"
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="text-xs text-slate-500 font-semibold">
            เว้นว่างจำนวนที่คาดหวัง = รายการเช็คลิสต์อย่างเดียว (ไม่นับในการปิดแผนอัตโนมัติ)
          </p>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="shrink-0 min-h-12 px-5 rounded-xl bg-[#0F5C3F] hover:bg-[#0B4A31] disabled:opacity-60 text-white font-extrabold text-sm transition-colors cursor-pointer"
          >
            {isSubmitting ? "กำลังบันทึก…" : `สร้างแผน (${lines.length} รายการ)`}
          </button>
        </div>
      </div>
    </div>
  );
}

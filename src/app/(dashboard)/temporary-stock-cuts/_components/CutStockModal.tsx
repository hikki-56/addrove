"use client";

import { useEffect, useMemo, useState } from "react";
import { useEscapeKey } from "@/hooks/use-escape-key";
import {
  REASON_OPTIONS,
  TARGET_WAREHOUSE_NAME,
  directionForReason,
  displayProductName,
  formatQty,
  type CutDirection,
  type WhProduct,
} from "./types";

export interface CutStockFormPayload {
  product: WhProduct;
  quantity: number;
  reason: string;
  note: string;
  direction: CutDirection;
}

interface CutStockModalProps {
  product: WhProduct | null;
  /** สต็อกสูงสุดที่ตัดได้จริง (คิดจากรายการอื่นในคิวแล้ว) */
  stockLimit?: number;
  /** ค่าเริ่มต้นตอนแก้ไขรายการ */
  initial?: { quantity: number; reason: string; note: string } | null;
  submitLabel?: string;
  onClose: () => void;
  onSubmit: (payload: CutStockFormPayload) => void;
}

export default function CutStockModal({
  product,
  stockLimit,
  initial,
  submitLabel = "เพิ่มรายการ",
  onClose,
  onSubmit,
}: CutStockModalProps) {
  const [qtyText, setQtyText] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");

  const open = product !== null;

  useEscapeKey(open, onClose);

  // รีเซ็ตฟอร์มทุกครั้งที่เปิดสินค้าใหม่ หรือใส่ค่าเดิมตอนแก้ไข
  useEffect(() => {
    if (product) {
      setQtyText(initial ? String(initial.quantity) : "");
      setReason(initial?.reason || "");
      setNote(initial?.note || "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product]);

  // ทิศทาง เพิ่ม/ลด มาจากเหตุผลที่เลือก
  const reasonChosen = reason !== "";
  const isAdd = directionForReason(reason) === "ADD";

  const stock = useMemo(() => {
    if (!product) return 0;
    return stockLimit !== undefined ? stockLimit : product.quantity;
  }, [product, stockLimit]);

  const qtyNum = parseFloat(qtyText);
  const isValidNumber = qtyText.trim() !== "" && Number.isFinite(qtyNum);

  const remaining = useMemo(() => {
    if (!isValidNumber || !reasonChosen) return stock;
    return isAdd ? stock + qtyNum : stock - qtyNum;
  }, [stock, qtyNum, isValidNumber, reasonChosen, isAdd]);

  let error: string | null = null;
  if (isValidNumber && qtyNum < 0) error = "ห้ามกรอกจำนวนติดลบ";
  else if (isValidNumber && qtyNum === 0) error = "จำนวนต้องมากกว่า 0";
  else if (isValidNumber && reasonChosen && !isAdd && qtyNum > stock)
    error = `ลดเกินจำนวนสินค้าที่มีอยู่ (ลดได้อีก ${formatQty(stock)} ชิ้น)`;

  const canSubmit = isValidNumber && !error && reasonChosen;

  if (!product) return null;

  const stepQty = (delta: number) => {
    const base = isValidNumber ? qtyNum : 0;
    const next = Math.max(0, Math.round((base + delta) * 100) / 100);
    setQtyText(String(next));
  };

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit({ product, quantity: qtyNum, reason, note, direction: isAdd ? "ADD" : "CUT" });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-m3-grey-800/50 "
        onClick={onClose}
      />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="ตัดสต็อกชั่วคราว"
        className="relative w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-xl border border-[rgba(145,158,171,0.2)] shadow-m3-dropdown max-h-[92dvh] flex flex-col animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="px-6 pt-5 pb-4 border-b border-[rgba(145,158,171,0.2)]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-bold text-m3-primary-dark leading-snug line-clamp-2">
                {displayProductName(product)}
              </h2>
              <p className="mt-1 text-xs text-m3-grey-600 font-medium">
                รหัส {product.sku}
                {product.barcode && product.barcode !== product.sku ? ` • บาร์โค้ด ${product.barcode}` : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="ปิด"
              className="shrink-0 grid place-items-center size-8 rounded-lg text-m3-grey-500 hover:text-m3-grey-600 hover:bg-m3-grey-200 transition-colors cursor-pointer"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* โกดัง + สต็อก */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-m3-grey-100 border border-[rgba(145,158,171,0.2)] px-4 py-3">
              <p className="text-[11px] font-semibold text-m3-grey-600 uppercase tracking-wide">โกดัง</p>
              <p className="mt-0.5 text-sm font-bold text-m3-primary-dark">{TARGET_WAREHOUSE_NAME}</p>
            </div>
            <div className="rounded-xl bg-m3-grey-100 border border-[rgba(145,158,171,0.2)] px-4 py-3">
              <p className="text-[11px] font-semibold text-m3-grey-600 uppercase tracking-wide">สต็อกปัจจุบัน</p>
              <p className="mt-0.5 text-sm font-bold text-m3-primary-dark">
                {formatQty(product.quantity)}{" "}
                <span className="text-xs font-semibold text-m3-grey-600">{product.base_unit || "ชิ้น"}</span>
              </p>
            </div>
          </div>

          {/* เหตุผล — กำหนดทิศทาง เพิ่ม/ลด */}
          <div>
            <label className="block text-sm font-semibold text-m3-grey-700 mb-1.5">
              เหตุผล <span className="text-m3-error-dark">*</span>
            </label>
            <div className="space-y-2">
              {REASON_OPTIONS.map((opt) => {
                const selected = reason === opt.value;
                const optIsAdd = opt.direction === "ADD";
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setReason(opt.value)}
                    className={`w-full flex items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm font-semibold transition-all cursor-pointer ${
                      selected
                        ? optIsAdd
                          ? "border-[rgba(0,167,111,0.24)] bg-[rgba(0,167,111,0.08)] text-m3-primary-dark"
                          : "border-[rgba(255,86,48,0.24)] bg-[rgba(255,86,48,0.08)] text-m3-error-dark"
                        : "border-[rgba(145,158,171,0.2)] bg-m3-grey-100 text-m3-grey-600 hover:bg-white hover:border-[rgba(0,167,111,0.24)]"
                    }`}
                  >
                    <span
                      className={`shrink-0 size-6 rounded-lg grid place-items-center text-xs font-bold ${
                        selected
                          ? optIsAdd
                            ? "bg-m3-primary-dark text-white"
                            : "bg-m3-error text-white"
                          : "bg-white border border-[rgba(145,158,171,0.2)] text-m3-grey-500"
                      }`}
                    >
                      {optIsAdd ? "+" : "−"}
                    </span>
                    {opt.label}
                    {selected && (
                      <svg
                        className="ml-auto w-4 h-4 shrink-0"
                        viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
                      >
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* จำนวน */}
          <div>
            <label htmlFor="cut-qty" className="block text-sm font-semibold text-m3-grey-700 mb-1.5">
              {reasonChosen
                ? isAdd
                  ? "จำนวนที่ต้องการเพิ่ม"
                  : "จำนวนที่ต้องการลด"
                : "จำนวนที่ต้องการทำรายการ"}
            </label>
            <div className="flex items-stretch gap-2">
              <button
                type="button"
                onClick={() => stepQty(-1)}
                aria-label="ลดจำนวน"
                className="w-12 shrink-0 grid place-items-center rounded-xl border border-[rgba(145,158,171,0.2)] bg-white text-m3-grey-600 hover:bg-m3-grey-100 hover:text-m3-grey-800 active:scale-95 transition-all cursor-pointer"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
                  <path d="M5 12h14" />
                </svg>
              </button>
              <input
                id="cut-qty"
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={qtyText}
                onChange={(e) => setQtyText(e.target.value)}
                placeholder="0"
                className={`flex-1 min-w-0 text-center text-lg font-bold rounded-xl border px-3 py-2.5 transition-all outline-none focus:ring-2 ${
                  error
                    ? "border-m3-error bg-[rgba(255,86,48,0.08)] focus:ring-m3-error/20"
                    : "border-[rgba(145,158,171,0.2)] bg-m3-grey-100 text-m3-grey-800 focus:bg-white focus:border-m3-grey-800 focus:ring-m3-primary/20"
                }`}
              />
              <button
                type="button"
                onClick={() => stepQty(1)}
                aria-label="เพิ่มจำนวน"
                className="w-12 shrink-0 grid place-items-center rounded-xl border border-[rgba(145,158,171,0.2)] bg-white text-m3-grey-600 hover:bg-m3-grey-100 hover:text-m3-grey-800 active:scale-95 transition-all cursor-pointer"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
                  <path d="M12 5v14" />
                  <path d="M5 12h14" />
                </svg>
              </button>
            </div>
            {error && (
              <p className="mt-1.5 text-xs font-semibold text-m3-error-dark flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 8v4" />
                  <path d="M12 16h.01" />
                </svg>
                {error}
              </p>
            )}
          </div>

          {/* คงเหลือหลังทำรายการ */}
          <div
            className={`flex items-center justify-between rounded-xl border px-4 py-3 transition-colors ${
              error ? "bg-[rgba(255,86,48,0.08)] border-[rgba(255,86,48,0.24)]" : "bg-[rgba(0,167,111,0.08)] border-[rgba(0,167,111,0.24)]"
            }`}
          >
            <span className="text-sm font-semibold text-m3-grey-600">
              {reasonChosen ? (isAdd ? "คงเหลือหลังเพิ่ม" : "คงเหลือหลังลด") : "คงเหลือหลังทำรายการ"}
            </span>
            <span
              className={`text-lg font-bold num ${
                error || !reasonChosen ? "text-m3-grey-500" : isAdd ? "text-m3-primary-dark" : "text-m3-primary-dark"
              } ${!error && reasonChosen && !isAdd && remaining === 0 ? "!text-m3-warning-dark" : ""}`}
            >
              {!reasonChosen ? "—" : error ? "—" : formatQty(remaining)}{" "}
              <span className="text-xs font-semibold opacity-70">{product.base_unit || "ชิ้น"}</span>
            </span>
          </div>

          {/* หมายเหตุ */}
          <div>
            <label htmlFor="cut-note" className="block text-sm font-semibold text-m3-grey-700 mb-1.5">
              หมายเหตุเพิ่มเติม
            </label>
            <textarea
              id="cut-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="รายละเอียดเพิ่มเติม (ถ้ามี)"
              className="w-full rounded-xl border border-[rgba(145,158,171,0.2)] bg-m3-grey-100 px-3.5 py-2.5 text-sm text-m3-grey-800 placeholder:text-m3-grey-500 resize-none transition-all outline-none focus:bg-white focus:border-m3-grey-800 focus:ring-2 focus:ring-m3-primary/20"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2.5 px-6 py-4 border-t border-[rgba(145,158,171,0.2)]">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-[rgba(145,158,171,0.2)] bg-white text-sm font-semibold text-m3-grey-600 hover:bg-m3-grey-100 transition-colors cursor-pointer"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={`flex-[1.4] py-2.5 rounded-xl text-sm font-semibold text-white active:scale-[0.98] transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
              isAdd ? "bg-m3-primary-dark hover:bg-m3-primary-dark" : "bg-m3-primary hover:bg-m3-primary-dark"
            }`}
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

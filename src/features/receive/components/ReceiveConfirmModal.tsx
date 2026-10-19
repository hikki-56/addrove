"use client";

import React from "react";
import { useEscapeKey } from "@/hooks/use-escape-key";
import type { UseFormReturn } from "react-hook-form";
import type { ReceiveDocumentInput } from "@/types/api";
import type { Location, Product } from "@/types/models";
import { m3Cls } from "@/components/ui/m3";
import { SolarClose, SolarHome, SolarMapPoint } from "@/components/icons";

export interface ReceiveConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  form: UseFormReturn<ReceiveDocumentInput, any, any>;
  locations: Location[];
  products: Product[];
  activeWhName: string;
  onSubmit: (data: ReceiveDocumentInput) => void;
  /** เลขแผนที่กำลังรับ (แสดงผลเท่านั้น) */
  planNo?: string;
}

export default function ReceiveConfirmModal({
  isOpen,
  onClose,
  form,
  locations,
  products,
  activeWhName,
  onSubmit,
  planNo,
}: ReceiveConfirmModalProps) {
  useEscapeKey(isOpen, onClose);

  if (!isOpen) return null;

  const { watch, handleSubmit, formState: { isSubmitting } } = form;
  const watchLines = watch("lines") || [];
  const totalQty = watchLines.reduce((acc, curr) => acc + (Number(curr.qty) || 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div className={m3Cls.overlay} />
      <div role="dialog" aria-modal="true" aria-label="ยืนยันการรับสินค้าเข้า" className={`${m3Cls.sheet} max-h-[92dvh] sm:max-w-[560px]`}>
        <div className="flex shrink-0 items-start justify-between gap-3 px-5 pt-6 sm:px-7 sm:pt-7">
          <h2 className="min-w-0 text-xl font-bold text-m3-grey-800">ยืนยันการรับสินค้าเข้า</h2>
          <button
            type="button"
            aria-label="ปิดหน้าต่าง"
            onClick={onClose}
            className="-mt-1 -mr-2 flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-m3-grey-500 transition-colors hover:bg-[rgba(145,158,171,0.08)] hover:text-m3-grey-800"
          >
            <SolarClose size={22} />
          </button>
        </div>

        <div
          className="flex-1 space-y-4 overflow-y-auto overscroll-y-contain px-5 pt-5 pb-2 sm:px-7"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          <div className="flex items-center justify-between gap-3 rounded-xl bg-m3-grey-100 px-4 py-3.5">
            <span className="shrink-0 text-sm whitespace-nowrap text-m3-grey-600">โกดังปลายทาง</span>
            <span className="flex flex-wrap items-center justify-end gap-2">
              <span className="m3-label m3-label-primary gap-1.5 text-sm">
                <SolarHome size={14} />
                {activeWhName}
              </span>
              {planNo ? <span className="m3-label m3-label-info tabular-nums">{planNo}</span> : null}
            </span>
          </div>

          <div className="space-y-2.5">
            {watchLines.map((line, idx) => {
              const matched = products.find(
                (p) =>
                  p.product_id.toLowerCase() === line.product_id.toLowerCase() ||
                  p.sku.toLowerCase() === line.product_id.toLowerCase()
              );
              const loc = locations.find(
                (l) =>
                  ((l as any).shelf_code || "").toLowerCase() === (line.location_id || "").toLowerCase() ||
                  (l.location_code || "").toLowerCase() === (line.location_id || "").toLowerCase() ||
                  (l.location_id || "").toLowerCase() === (line.location_id || "").toLowerCase()
              );
              const locDisplay =
                ((loc as any)?.shelf_code && (loc as any).shelf_code.toLowerCase() === (line.location_id || "").toLowerCase())
                  ? (loc as any).shelf_code
                  : (loc?.location_code && loc.location_code.toLowerCase() === (line.location_id || "").toLowerCase())
                  ? loc.location_code
                  : line.location_id || loc?.location_code || "ตำแหน่งเริ่มต้น";

              const extraLocs: string[] = Array.isArray((line as any).extra_locations)
                ? (line as any).extra_locations.filter((x: string) => Boolean(x && x.trim()))
                : [];
              const extraQtys: number[] = Array.isArray((line as any).extra_qtys) ? (line as any).extra_qtys : [];
              const primaryQty = typeof (line as any).primary_qty === "number"
                ? (line as any).primary_qty
                : extraLocs.length > 0
                ? Math.max(0, (Number(line.qty) || 0) - extraQtys.reduce((sum, q) => sum + (Number(q) || 1), 0))
                : Number(line.qty) || 0;

              const locBreakdowns: string[] = [];
              if (extraLocs.length > 0) {
                locBreakdowns.push(`${locDisplay} (${primaryQty.toLocaleString()} ชิ้น)`);
                for (let i = 0; i < extraLocs.length; i++) {
                  const eloc = extraLocs[i];
                  const eqty = extraQtys[i] || 1;
                  const matchedExtra = locations.find(
                    (l) =>
                      ((l as any).shelf_code || "").toLowerCase() === eloc.toLowerCase() ||
                      (l.location_code || "").toLowerCase() === eloc.toLowerCase()
                  );
                  const elocDisplay = (matchedExtra as any)?.shelf_code && (matchedExtra as any).shelf_code.toLowerCase() === eloc.toLowerCase()
                    ? (matchedExtra as any).shelf_code
                    : matchedExtra?.location_code && matchedExtra.location_code.toLowerCase() === eloc.toLowerCase()
                    ? matchedExtra.location_code
                    : eloc;
                  locBreakdowns.push(`${elocDisplay} (${eqty.toLocaleString()} ชิ้น)`);
                }
              } else {
                locBreakdowns.push(locDisplay);
              }

              return (
                <div key={`confirm-row-${idx}`} className="flex items-start justify-between gap-3 rounded-xl border border-[rgba(145,158,171,0.2)] p-4">
                  <div className="space-y-1.5 min-w-0 flex-1">
                    <div className="text-sm font-bold text-m3-grey-800 sm:text-base">{matched?.product_name || "สินค้า"}</div>
                    <div className="flex flex-wrap items-center gap-x-1.5">
                      {(matched?.barcode && matched.barcode.trim() !== "-") ? (
                        <span className="text-xs tabular-nums text-m3-grey-500">
                          {matched.barcode}
                        </span>
                      ) : (line as any).barcode ? (
                        <span className="text-xs tabular-nums text-m3-grey-500">
                          {(line as any).barcode}
                        </span>
                      ) : null}
                      <span className="truncate text-xs tabular-nums text-m3-grey-500">
                        {matched?.sku || line.product_id}
                      </span>
                    </div>
                    <div className="flex items-start gap-1.5 flex-wrap">
                      {locBreakdowns.map((bd, bdIdx) => (
                        <span
                          key={`loc-${idx}-${bdIdx}`}
                          className="m3-label m3-label-default gap-1 tabular-nums"
                        >
                          <SolarMapPoint size={14} className="shrink-0" />
                          <span>{bd}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="flex items-baseline gap-1 justify-end">
                      <span className="font-m3-disp text-xl font-bold tabular-nums text-m3-grey-800">{(Number(line.qty) || 0).toLocaleString()}</span>
                      <span className="text-sm text-m3-grey-600">ชิ้น</span>
                    </div>
                    <div className="text-xs text-m3-grey-500">{(Number(line.boxes) || 1).toLocaleString()} กล่อง</div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between border-t border-dashed border-[rgba(145,158,171,0.32)] pt-4">
            <span className="text-base font-bold text-m3-grey-800">รวมทั้งหมด</span>
            <span className="flex items-baseline gap-1.5">
              <span className="font-m3-disp text-2xl font-bold tabular-nums text-m3-primary-dark">{(totalQty || 0).toLocaleString()}</span>
              <span className="text-base text-m3-grey-600">ชิ้น</span>
            </span>
          </div>
        </div>

        <div className="flex shrink-0 flex-col-reverse gap-3 px-5 pt-4 pb-5 sm:flex-row sm:justify-end sm:px-7 sm:pb-7">
          <button type="button" onClick={onClose} disabled={isSubmitting} className={`${m3Cls.btnCancel} disabled:opacity-48`}>
            ปิดหน้าต่าง
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => handleSubmit(onSubmit)()}
            className={`${m3Cls.btnPrimary} gap-2`}
          >
            {isSubmitting ? (
              <>
                <span className={m3Cls.spinner} />
                <span>กำลังบันทึก...</span>
              </>
            ) : (
              <span>ยืนยันและสร้างเอกสาร</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import React from "react";
import type { UseFormReturn } from "react-hook-form";
import type { ReceiveDocumentInput } from "@/types/api";
import type { Location, Product } from "@/types/models";
import ReceiveLineItem from "./ReceiveLineItem";
import type { ScanFeedback } from "@/components/scanner/ScanFeedbackBanner";
import { M3Banner, M3Empty } from "@/components/ui/m3";
import { SolarBox, SolarCheckCircle } from "@/components/icons";

export interface ReceiveLinesTableProps {
  form: UseFormReturn<ReceiveDocumentInput, any, any>;
  fields: { id: string; product_id: string; location_id?: string; boxes?: number; qty?: number }[];
  locations: Location[];
  products: Product[];
  activeWhId: string;
  confirmedLines: Record<number, boolean>;
  onToggleConfirm: (index: number) => void;
  onAddLocationForProduct: (index: number) => void;
  onRemove: (index: number) => void;
  onScanLocation: (index: number, code: string, playSound?: boolean) => void | Promise<void>;
  onScanFeedback?: (feedback: ScanFeedback | null, playSound?: boolean) => void;
  onOpenConfirmModal: () => void;
}

const cardClass = "m3-card";

/** ยอดสรุปรอบนี้ (คำนวณจากฟอร์มเพื่อแสดงผลเท่านั้น — สูตรเดียวกับรายการด้านล่าง) */
function useReceiveTotals(
  form: ReceiveLinesTableProps["form"],
  fields: ReceiveLinesTableProps["fields"],
  confirmedLines: Record<number, boolean>
) {
  const watchLines = form.watch("lines") || [];
  const totalLines = fields.length;
  const totalBoxes = watchLines.reduce((acc, curr) => acc + (Number(curr.boxes) || 1), 0);
  const totalQty = watchLines.reduce((acc, curr) => acc + (Number(curr.qty) || 0), 0);
  const confirmedCount = fields.filter((_, idx) => Boolean(confirmedLines[idx])).length;
  const hasZeroQty = watchLines.some((l) => (Number(l.qty) || 0) <= 0);
  const allConfirmed = totalLines > 0 && confirmedCount === totalLines && !hasZeroQty;
  return { totalLines, totalBoxes, totalQty, confirmedCount, hasZeroQty, allConfirmed };
}

function SummaryStats({ totalLines, totalBoxes, totalQty }: { totalLines: number; totalBoxes: number; totalQty: number }) {
  const tile = "rounded-lg bg-m3-grey-100 px-3 py-2.5 text-center";
  return (
    <div className="grid grid-cols-3 gap-2">
      <div className={tile}>
        <div className="text-xs text-m3-grey-600">รายการ</div>
        <div className="mt-0.5 font-m3-disp text-xl font-bold tabular-nums text-m3-grey-800">{totalLines.toLocaleString()}</div>
      </div>
      <div className={tile}>
        <div className="text-xs text-m3-grey-600">กล่องรวม</div>
        <div className="mt-0.5 font-m3-disp text-xl font-bold tabular-nums text-m3-grey-800">{totalBoxes.toLocaleString()}</div>
      </div>
      <div className={tile}>
        <div className="text-xs text-m3-grey-600">จำนวนรวม</div>
        <div className="mt-0.5 font-m3-disp text-xl font-bold tabular-nums text-m3-grey-800">{totalQty.toLocaleString()}</div>
      </div>
    </div>
  );
}

/** การ์ด "สรุปรอบนี้" ด้านขวา (D13 — จอ ≥lg) */
export function ReceiveSummaryCard({
  form,
  fields,
  confirmedLines,
  onOpenConfirmModal,
}: Pick<ReceiveLinesTableProps, "form" | "fields" | "confirmedLines" | "onOpenConfirmModal">) {
  const { totalLines, totalBoxes, totalQty, confirmedCount, hasZeroQty, allConfirmed } = useReceiveTotals(form, fields, confirmedLines);
  return (
    <aside className="m3-card space-y-4 p-5">
      <h2 className="text-base font-bold text-m3-grey-800">สรุปรอบนี้</h2>
      <SummaryStats totalLines={totalLines} totalBoxes={totalBoxes} totalQty={totalQty} />
      {totalLines > 0 && confirmedCount === totalLines && hasZeroQty && (
        <M3Banner tone="warning">มีรายการที่จำนวนเป็น 0 — ระบุจำนวนก่อนบันทึก</M3Banner>
      )}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-sm">
          <span className="text-m3-grey-600">ยืนยันแล้ว</span>
          <span className={`font-bold tabular-nums ${allConfirmed ? "text-m3-primary-dark" : "text-m3-grey-800"}`}>
            {confirmedCount.toLocaleString()}/{totalLines.toLocaleString()} รายการ
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-[rgba(145,158,171,0.2)]">
          <div
            className="h-full rounded-full bg-m3-primary transition-[width] duration-300"
            style={{ width: `${totalLines > 0 ? (confirmedCount / totalLines) * 100 : 0}%` }}
          />
        </div>
      </div>
      <button type="button" onClick={onOpenConfirmModal} disabled={!allConfirmed} className="m3-btn m3-btn-primary h-12 w-full">
        บันทึกรับสินค้า {totalQty.toLocaleString()} ชิ้น
      </button>
    </aside>
  );
}

export default function ReceiveLinesTable({
  form,
  fields,
  locations,
  products,
  activeWhId,
  confirmedLines,
  onToggleConfirm,
  onAddLocationForProduct,
  onRemove,
  onScanLocation,
  onScanFeedback,
  onOpenConfirmModal,
}: ReceiveLinesTableProps) {
  const watchLines = form.watch("lines") || [];
  const [showDone, setShowDone] = React.useState(false);

  const totalLines = fields.length;
  const totalBoxes = watchLines.reduce((acc, curr) => acc + (Number(curr.boxes) || 1), 0);
  const totalQty = watchLines.reduce((acc, curr) => acc + (Number(curr.qty) || 0), 0);
  const confirmedCount = fields.filter((_, idx) => Boolean(confirmedLines[idx])).length;
  const hasZeroQty = watchLines.some((l) => (Number(l.qty) || 0) <= 0);
  const allConfirmed = totalLines > 0 && confirmedCount === totalLines && !hasZeroQty;

  // Split the list into the work-in-progress group (top) and a collapsed summary strip
  // for confirmed lines (bottom) so the card being worked on never scrolls out of view.
  // Form array order and indices stay untouched — grouping is render-level only.
  const activeIdxs = fields.map((_, i) => i).filter((i) => !confirmedLines[i]);
  const doneIdxs = fields.map((_, i) => i).filter((i) => Boolean(confirmedLines[i]));

  const renderLine = (index: number) => {
    // Queued only when this line is unconfirmed AND an earlier line is still
    // unconfirmed — confirmed lines never lock, so reordering is safe
    const isQueued =
      !confirmedLines[index] && fields.some((_, j) => j < index && !confirmedLines[j]);
    return (
      <ReceiveLineItem
        key={fields[index].id}
        index={index}
        fieldId={fields[index].id}
        form={form}
        line={fields[index]}
        locations={locations}
        products={products}
        activeWhId={activeWhId}
        isConfirmed={Boolean(confirmedLines[index])}
        isLocked={isQueued}
        onToggleConfirm={onToggleConfirm}
        onAddLocationForProduct={onAddLocationForProduct}
        onRemove={onRemove}
        onScanLocation={onScanLocation}
        onScanFeedback={onScanFeedback}
      />
    );
  };

  if (totalLines === 0) {
    return (
      <div className={`${cardClass} p-6`}>
        <M3Empty title="ยังไม่มีรายการสินค้า" icon={<SolarBox size={36} />} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* มือถือ/แท็บเล็ต: สรุปด้านบน · ≥lg ใช้การ์ดสรุปด้านขวา (ReceiveSummaryCard) */}
      <div className="space-y-3 lg:hidden">
        <SummaryStats totalLines={totalLines} totalBoxes={totalBoxes} totalQty={totalQty} />
        <div className="space-y-1.5 px-1">
          <div className="flex items-center justify-between text-sm">
            <span className="text-m3-grey-600">ยืนยันแล้ว</span>
            <span className={`shrink-0 font-bold ${allConfirmed ? "text-m3-primary-dark" : "text-m3-grey-800"}`}>
              {confirmedCount.toLocaleString()}/{totalLines.toLocaleString()}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-[rgba(145,158,171,0.2)]">
            <div
              className="h-full rounded-full bg-m3-primary transition-[width] duration-300"
              style={{ width: `${totalLines > 0 ? (confirmedCount / totalLines) * 100 : 0}%` }}
            />
          </div>
          {confirmedCount === totalLines && hasZeroQty && (
            <M3Banner tone="warning" className="mt-2">
              มีรายการที่จำนวนเป็น 0 — ระบุจำนวนก่อนบันทึก
            </M3Banner>
          )}
        </div>
      </div>

      {activeIdxs.length > 0 && (
        <div className="space-y-3">{activeIdxs.map(renderLine)}</div>
      )}

      {doneIdxs.length > 0 && (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setShowDone((prev) => !prev)}
            aria-expanded={showDone}
            className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl border border-[rgba(145,158,171,0.32)] bg-white px-4 py-3 text-sm font-bold text-m3-grey-800 transition-colors hover:bg-[rgba(145,158,171,0.08)]"
          >
            <span className="flex items-center gap-2 min-w-0">
              <SolarCheckCircle size={20} className="shrink-0 text-m3-primary" />
              ยืนยันแล้ว {doneIdxs.length.toLocaleString()} รายการ
            </span>
            <svg
              className={`w-5 h-5 shrink-0 transition-transform duration-200 ${showDone ? "rotate-180" : "rotate-0"}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showDone && (
            <div className="space-y-3 fade-in">{doneIdxs.map(renderLine)}</div>
          )}
        </div>
      )}

      {allConfirmed && (
        <div className="fade-in pt-2 lg:hidden">
          <button
            type="button"
            onClick={onOpenConfirmModal}
            className="m3-btn m3-btn-primary h-14 w-full text-base shadow-[0_8px_16px_rgba(0,167,111,0.24)]"
          >
            บันทึกรับสินค้า {totalQty.toLocaleString()} ชิ้น
          </button>
        </div>
      )}
    </div>
  );
}

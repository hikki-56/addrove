"use client";

import { useMemo, useState } from "react";
import type { ProductionOrderItem, ProductionOrderRecord } from "@/types/production";

/** โต๊ะผลิตทั้งหมดของโรงงาน — สอดคล้องกับ PRODUCTION_TABLES ในหน้าผลิตสินค้า */
const PRODUCTION_TABLES = [1, 2, 3, 4, 5];

/** จำนวนรายการ "ผลิตเสร็จแล้ว" ล่าสุดที่แสดงต่อการ์ด */
const RECENT_DONE_LIMIT = 3;

interface ActiveRow {
  orderNo: string;
  createdAt: string;
  item: ProductionOrderItem;
  remaining: number;
}

interface DoneRow {
  orderNo: string;
  createdAt: string;
  item: ProductionOrderItem;
}

interface TableReportBoardProps {
  orders: ProductionOrderRecord[];
  /** ผู้ใช้มีสิทธิ์รายงานผลผลิต (แอดมิน/คนตรวจ) หรือไม่ */
  canReport: boolean;
  reporterName: string;
  openDetail: (orderNo: string) => void;
  /** เรียกหลังบันทึกสำเร็จเพื่อ reload ข้อมูล */
  onSubmitted: () => void;
}

/** แถบเลขที่ใบผลิต — กดเพื่อเปิดรายละเอียดใบ */
function OrderBadge({ orderNo, onClick }: { orderNo: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`ดูรายละเอียดใบผลิต ${orderNo}`}
      className="shrink-0 rounded bg-slate-100 hover:bg-[#EAF2EE] px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-600 hover:text-[#053425] transition-colors cursor-pointer"
    >
      {orderNo}
    </button>
  );
}

/** ช่องกรอกตัวเลข (ผลิตได้จริง / ของเสีย) */
function ReportInput({
  value,
  max,
  onChange,
  label,
  tone,
}: {
  value: string;
  max: number;
  onChange: (v: string) => void;
  label: string;
  tone: "good" | "defect";
}) {
  return (
    <label className="flex items-center gap-1.5 shrink-0">
      <span className={`text-[10px] font-bold whitespace-nowrap shrink-0 ${tone === "good" ? "text-[#06402B]" : "text-rose-700"}`}>
        {label}
      </span>
      <input
        type="number"
        min={0}
        max={max}
        inputMode="numeric"
        value={value}
        disabled={max <= 0}
        onChange={(e) => onChange(e.target.value)}
        onContextMenu={(e) => e.preventDefault()}
        placeholder="0"
        aria-label={label}
        className={`w-14 h-8 px-1.5 text-center rounded-lg border font-mono text-xs font-bold shadow-inner focus:outline-hidden focus:ring-2 disabled:bg-slate-100 disabled:text-slate-400 cursor-text ${
          tone === "good"
            ? "border-[#8FB3A3] bg-[#F7FAF8] text-[#052B1F] focus:ring-[#0F5C3F]"
            : "border-rose-200 bg-rose-50 text-rose-800 focus:ring-rose-400"
        }`}
      />
    </label>
  );
}

/**
 * บอร์ดรายงานผลผลิตแบบการ์ดโต๊ะ 1–5 — แต่ละโต๊ะแสดงสินค้าที่กำลังผลิต (จากใบผลิตที่ยังไม่ปิด)
 * พร้อมช่องกรอก "ผลิตได้จริง / ของเสีย" และสรุปรายการที่ผลิตเสร็จแล้วล่าสุดของโต๊ะนั้น
 */
export default function TableReportBoard({
  orders,
  canReport,
  reporterName,
  openDetail,
  onSubmitted,
}: TableReportBoardProps) {
  // ค่าที่พิมพ์ — คีย์ด้วย `${orderNo}|${fg_sku}` แยกสามช่อง (ผลิตได้จริง/ของเสีย/หมายเหตุ)
  const [inputs, setInputs] = useState<Record<string, { good: string; defect: string; note?: string }>>({});
  const [submittingTable, setSubmittingTable] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parsed = (v: string): number => {
    const n = parseInt(v, 10);
    return isNaN(n) || n < 0 ? 0 : n;
  };

  // แยกรายการตามสถานะใบผลิต — รายงานผลได้เฉพาะใบที่ยังไม่เสร็จ/ไม่ถูกยกเลิก
  const activeRowsByTable = useMemo(() => {
    const map = new Map<number, ActiveRow[]>();
    const active = orders.filter((o) => o.status === "PENDING" || o.status === "IN_PROGRESS");
    for (const order of active) {
      for (const item of order.items || []) {
        if (!item.table_no) continue;
        const remaining = Math.max(
          0,
          item.quantity - (Number(item.produced_qty) || 0) - (Number(item.defect_qty) || 0)
        );
        const list = map.get(item.table_no) || [];
        list.push({ orderNo: order.order_no, createdAt: order.created_at, item, remaining });
        map.set(item.table_no, list);
      }
    }
    for (const list of map.values()) {
      list.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    }
    return map;
  }, [orders]);

  const doneRowsByTable = useMemo(() => {
    const map = new Map<number, DoneRow[]>();
    const done = orders.filter((o) => o.status === "COMPLETED");
    for (const order of done) {
      for (const item of order.items || []) {
        if (!item.table_no) continue;
        const list = map.get(item.table_no) || [];
        list.push({ orderNo: order.order_no, createdAt: order.created_at, item });
        map.set(item.table_no, list);
      }
    }
    for (const list of map.values()) {
      list.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    }
    return map;
  }, [orders]);

  const setInput = (key: string, field: "good" | "defect" | "note", value: string) => {
    setInputs((prev) => {
      const current = prev[key] || { good: "", defect: "", note: "" };
      return { ...prev, [key]: { ...current, [field]: value } };
    });
  };

  /** บันทึกผลผลิตของหนึ่งโต๊ะ — รวมรายการที่กรอก แยกตามใบผลิต แล้วส่งทีละใบ */
  const handleSubmitTable = async (tableNo: number) => {
    const rows = activeRowsByTable.get(tableNo) || [];
    const filled = rows
      .map((r) => {
        const key = `${r.orderNo}|${r.item.fg_sku}`;
        const val = inputs[key] || { good: "", defect: "", note: "" };
        return { row: r, good: parsed(val.good), defect: parsed(val.defect), note: (val.note || "").trim() };
      })
      .filter((f) => f.good + f.defect > 0);

    if (filled.length === 0) {
      setError(`โต๊ะผลิต ${tableNo} — กรอกผลิตได้จริงหรือของเสียอย่างน้อย 1 ช่องก่อนบันทึก`);
      return;
    }

    const overLimit = filled.find((f) => f.good + f.defect > f.row.remaining);
    if (overLimit) {
      setError(
        `โต๊ะผลิต ${tableNo} — "${overLimit.row.item.fg_name}" รวมผลิตได้จริง+ของเสียเกินจำนวนที่เหลือ (${overLimit.row.remaining.toLocaleString()} ${overLimit.row.item.fg_unit})`
      );
      return;
    }

    // จัดกลุ่มตามใบผลิต — แต่ละใบส่งหนึ่งรอบตรวจ (ระบบจะตัดวัตถุดิบตามสูตร BOM อัตโนมัติ)
    // หมายเหตุของเสียแต่ละรายการถูกรวมลงในหมายเหตุของรอบตรวจ
    const byOrder = new Map<
      string,
      { fg_sku: string; good_qty: number; defect_qty: number; note?: string }[]
    >();
    for (const f of filled) {
      const list = byOrder.get(f.row.orderNo) || [];
      list.push({
        fg_sku: f.row.item.fg_sku,
        good_qty: f.good,
        defect_qty: f.defect,
        note: f.defect > 0 && f.note ? f.note : undefined,
      });
      byOrder.set(f.row.orderNo, list);
    }

    setSubmittingTable(tableNo);
    setError(null);
    const failures: string[] = [];

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (typeof window !== "undefined") {
        const token =
          sessionStorage.getItem("stockify_tab_token") || localStorage.getItem("stockify_tab_token");
        if (token) {
          headers["x-tab-token"] = token;
          headers["Authorization"] = `Bearer ${token}`;
        }
      }

      for (const [orderNo, items] of byOrder.entries()) {
        // หมายเหตุรอบตรวจ = ที่มาของรายงาน + สิ่งที่เสียแต่ละรายการ (ถ้ากรอก)
        const defectNotes = items
          .filter((i) => i.note)
          .map((i) => `${i.fg_sku} เสีย ${i.defect_qty.toLocaleString()} — ${i.note}`);
        const roundNote =
          `รายงานผลจากการ์ดโต๊ะผลิต ${tableNo}` +
          (defectNotes.length > 0 ? ` | ของเสีย: ${defectNotes.join("; ")}` : "");
        try {
          const res = await fetch(`/api/production/orders/${encodeURIComponent(orderNo)}/review`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              items: items.map((i) => ({
                fg_sku: i.fg_sku,
                good_qty: i.good_qty,
                defect_qty: i.defect_qty,
                warehouse_id: "wh-02",
                location: "",
              })),
              note: roundNote,
              confirmed_by_name: reporterName,
            }),
          });
          const json = await res.json();
          if (!json.success) failures.push(`${orderNo}: ${json.message || "บันทึกไม่สำเร็จ"}`);
        } catch {
          failures.push(`${orderNo}: เชื่อมต่อไม่สำเร็จ`);
        }
      }
    } finally {
      setSubmittingTable(null);
    }

    if (failures.length > 0) {
      setError(`บันทึกบางรายการไม่สำเร็จ — ${failures.join(" · ")}`);
    } else {
      setInputs((prev) => {
        const next = { ...prev };
        for (const f of filled) delete next[`${f.row.orderNo}|${f.row.item.fg_sku}`];
        return next;
      });
      const totalGood = filled.reduce((s, f) => s + f.good, 0);
      const totalDefect = filled.reduce((s, f) => s + f.defect, 0);
      setToast(
        `บันทึกผลผลิตโต๊ะ ${tableNo} แล้ว — ผลิตได้จริง ${totalGood.toLocaleString()} · ของเสีย ${totalDefect.toLocaleString()} (${byOrder.size} ใบผลิต)`
      );
      setTimeout(() => setToast(null), 4000);
      onSubmitted();
    }
  };

  return (
    <div className="space-y-4">
      {/* แบนเนอร์แจ้งเตือน — อยู่ใน flow ของหน้า (ดันเนื้อหา ไม่ลอยทับตัวหนังสืออื่น) */}
      {toast && (
        <div className="bg-[#06402B] text-white px-4 py-3 rounded-xl shadow-md flex items-center gap-3 animate-in fade-in slide-in-from-top-2 duration-200">
          <span className="w-6 h-6 rounded-full bg-[#0F5C3F] border border-white/30 text-white flex items-center justify-center text-xs font-bold shrink-0">
            ✓
          </span>
          <span className="text-sm font-semibold flex-1">{toast}</span>
          <button onClick={() => setToast(null)} className="text-slate-300 hover:text-white text-xs font-bold p-1 cursor-pointer">
            ✕
          </button>
        </div>
      )}
      {error && (
        <div className="rounded-xl bg-rose-50 border border-rose-200 p-3.5 flex items-start justify-between gap-3 shadow-xs">
          <div className="flex items-start gap-2 text-rose-800">
            <span className="text-base leading-5">⚠️</span>
            <p className="text-sm font-bold">{error}</p>
          </div>
          <button
            onClick={() => setError(null)}
            className="text-rose-700 hover:text-rose-900 text-xs font-bold px-2 py-1 rounded-lg hover:bg-rose-100 cursor-pointer transition-colors shrink-0"
          >
            ปิด
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {PRODUCTION_TABLES.map((tableNo) => {
          const activeRows = activeRowsByTable.get(tableNo) || [];
          const doneRows = (doneRowsByTable.get(tableNo) || []).slice(0, RECENT_DONE_LIMIT);
          const totalRemaining = activeRows.reduce((s, r) => s + r.remaining, 0);

          return (
            <section
              key={tableNo}
              className={`rounded-xl border p-3.5 flex flex-col ${
                activeRows.length > 0 ? "border-[#8FB3A3] bg-[#F7FAF8]" : "border-[#E8ECEA] bg-white"
              }`}
              aria-label={`โต๊ะผลิต ${tableNo}`}
            >
              {/* หัวการ์ด */}
              <div className="flex items-center justify-between gap-2 mb-2.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-8 h-8 rounded-lg bg-[#06402B] text-white font-mono text-sm font-black flex items-center justify-center shrink-0">
                    {tableNo}
                  </span>
                  <span className="text-sm font-extrabold text-[#052B1F] truncate">โต๊ะผลิต {tableNo}</span>
                </div>
                {activeRows.length > 0 ? (
                  <span className="rounded-full bg-[#DFEDE6] border border-[#8FB3A3] px-2 py-0.5 text-[11px] font-bold text-[#052B1F] whitespace-nowrap shrink-0">
                    กำลังผลิต {activeRows.length.toLocaleString()} รายการ · เหลือรายงาน{" "}
                    {totalRemaining.toLocaleString()}
                  </span>
                ) : (
                  <span className="rounded-full bg-slate-100 border border-slate-200 px-2 py-0.5 text-[11px] font-bold text-slate-500 whitespace-nowrap shrink-0">
                    ไม่มีรายการกำลังผลิต
                  </span>
                )}
              </div>

              {/* รายการกำลังผลิต + ช่องรายงานผล */}
              {activeRows.length === 0 ? (
                <div className="flex-1 min-h-[72px]" />
              ) : (
                <ul className="flex-1 space-y-1.5 max-h-80 overflow-y-auto pr-0.5">
                  {activeRows.map((row) => {
                    const key = `${row.orderNo}|${row.item.fg_sku}`;
                    const val = inputs[key] || { good: "", defect: "", note: "" };
                    const produced = Number(row.item.produced_qty) || 0;
                    const defect = Number(row.item.defect_qty) || 0;

                    return (
                      <li key={key} className="rounded-lg border border-[#E8ECEA] bg-white px-2 py-2 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <div className="w-10 h-10 rounded-md bg-[#EFF3F1] border border-[#EEF1EF] flex items-center justify-center p-0.5 overflow-hidden shrink-0">
                            <img
                              src={row.item.image || `/products/${row.item.fg_sku}.jpg`}
                              alt={row.item.fg_name}
                              className="max-h-full max-w-full object-contain"
                              onError={(e) => {
                                (e.target as HTMLElement).style.visibility = "hidden";
                              }}
                            />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-xs font-bold text-slate-900" title={row.item.fg_name}>
                              {row.item.fg_name}
                            </div>
                            <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                              <OrderBadge orderNo={row.orderNo} onClick={() => openDetail(row.orderNo)} />
                              <span className="font-mono text-[10px] font-semibold text-slate-400">{row.item.fg_sku}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="text-[10px] font-semibold text-slate-500 leading-4">
                            สั่ง <span className="font-mono font-bold text-slate-700">{row.item.quantity.toLocaleString()}</span>
                            {" · "}ได้แล้ว <span className="font-mono font-bold text-[#06402B]">{produced.toLocaleString()}</span>
                            {" · "}เสียแล้ว <span className="font-mono font-bold text-rose-600">{defect.toLocaleString()}</span>
                            {" · "}เหลือ{" "}
                            <span className="font-mono font-bold text-amber-700">{row.remaining.toLocaleString()}</span>{" "}
                            {row.item.fg_unit}
                          </div>
                          {canReport && (
                            <div className="flex items-center gap-2.5 shrink-0">
                              <ReportInput
                                label="ผลิตได้จริง"
                                tone="good"
                                value={val.good}
                                max={row.remaining}
                                onChange={(v) => setInput(key, "good", v)}
                              />
                              <ReportInput
                                label="ของเสีย"
                                tone="defect"
                                value={val.defect}
                                max={row.remaining}
                                onChange={(v) => setInput(key, "defect", v)}
                              />
                            </div>
                          )}
                        </div>

                        {/* หมายเหตุ — แสดงเมื่อกรอกของเสีย เพื่อระบุว่าอะไรเสีย */}
                        {canReport && parsed(val.defect) > 0 && (
                          <input
                            type="text"
                            value={val.note || ""}
                            onChange={(e) => setInput(key, "note", e.target.value)}
                            placeholder="หมายเหตุ — อะไรเสีย"
                            aria-label={`หมายเหตุของเสีย ${row.item.fg_name}`}
                            className="w-full h-8 px-2.5 rounded-lg border border-rose-200 bg-rose-50 text-xs font-semibold text-rose-900 placeholder:text-rose-300 focus:outline-hidden focus:ring-2 focus:ring-rose-400 cursor-text"
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              {/* รายการผลิตเสร็จแล้วล่าสุดของโต๊ะนี้ */}
              {doneRows.length > 0 && (
                <div className="mt-2.5 pt-2.5 border-t border-dashed border-[#D5DDD9]">
                  <p className="text-[11px] font-extrabold text-slate-500 mb-1.5">ผลิตเสร็จแล้ว (ล่าสุด)</p>
                  <ul className="space-y-1">
                    {doneRows.map((row) => {
                      const produced = Number(row.item.produced_qty) || 0;
                      const defect = Number(row.item.defect_qty) || 0;
                      return (
                        <li key={`${row.orderNo}|${row.item.fg_sku}`} className="flex items-center gap-2 text-[11px]">
                          <OrderBadge orderNo={row.orderNo} onClick={() => openDetail(row.orderNo)} />
                          <span className="truncate font-semibold text-slate-600 min-w-0 flex-1" title={row.item.fg_name}>
                            {row.item.fg_name}
                          </span>
                          <span className="shrink-0 font-mono font-bold text-[#06402B]">ได้ {produced.toLocaleString()}</span>
                          {defect > 0 && (
                            <span className="shrink-0 font-mono font-bold text-rose-600">เสีย {defect.toLocaleString()}</span>
                          )}
                          <span className="shrink-0 text-slate-400">{row.item.fg_unit}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {/* ปุ่มบันทึกผลของโต๊ะนี้ */}
              {canReport && activeRows.length > 0 && (
                <button
                  type="button"
                  disabled={submittingTable !== null}
                  onClick={() => handleSubmitTable(tableNo)}
                  className="mt-3 w-full h-10 rounded-xl bg-[#06402B] hover:bg-[#053425] text-white font-bold text-sm transition-all cursor-pointer active:scale-[0.98] shadow-md shadow-[#06402B]/20 flex items-center justify-center gap-2 disabled:opacity-50 disabled:pointer-events-none"
                >
                  {submittingTable === tableNo ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      กำลังบันทึก...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                      บันทึกผลผลิตของโต๊ะ {tableNo}
                    </>
                  )}
                </button>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

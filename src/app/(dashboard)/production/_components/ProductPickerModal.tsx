"use client";

import { Fragment, useState } from "react";
import { useEscapeKey } from "@/hooks/use-escape-key";
import type { EnrichedBomFormula, EnrichedBomItem } from "./types";

interface ProductPickerModalProps {
  /** โต๊ะที่กำลังเลือกสินค้าให้ */
  tableNo: number;
  boms: EnrichedBomFormula[];
  loading: boolean;
  /** รหัสสินค้าที่อยู่ในโต๊ะนี้แล้ว (แสดงป้าย "อยู่ในโต๊ะนี้แล้ว") */
  existingSkus: Set<string>;
  /** เพิ่มสินค้าลงตะกร้าของโต๊ะ — คืนข้อความ error ถ้าเพิ่มไม่สำเร็จ */
  onAddToCart: (bom: EnrichedBomFormula, tableNo: number, qty: number) => Promise<string | null>;
  onRefresh: () => void;
  onClose: () => void;
}

export default function ProductPickerModal({
  tableNo,
  boms,
  loading,
  existingSkus,
  onAddToCart,
  onRefresh,
  onClose,
}: ProductPickerModalProps) {
  useEscapeKey(true, onClose);

  const [search, setSearch] = useState("");
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);

  // จำนวนที่จะผลิตต่อสินค้า (คีย์ด้วย fg_sku — เฉพาะภายใน modal นี้)
  const [produceQty, setProduceQty] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    for (const b of boms) initial[b.fg_sku] = 1;
    return initial;
  });
  // ช่องจำนวนที่ผู้ใช้กำลังพิมพ์ (อาจว่างชั่วคราว) — กันค่าเก่าถูกหยิบไปใช้ตอนเพิ่ม
  const [editingQty, setEditingQty] = useState<{ sku: string; value: string } | null>(null);

  // วัตถุดิบแต่ละสูตร — ดึงแบบ lazy ตอนขยายแถวครั้งแรก
  const [expandedSku, setExpandedSku] = useState<string | null>(null);
  const [itemsCache, setItemsCache] = useState<Record<string, EnrichedBomItem[]>>({});
  const [loadingItemsSku, setLoadingItemsSku] = useState<string | null>(null);

  const [addError, setAddError] = useState<string | null>(null);
  const [addingSku, setAddingSku] = useState<string | null>(null);

  const filteredBoms = boms.filter(
    (b) =>
      b.fg_sku.toLowerCase().includes(search.toLowerCase()) ||
      b.fg_name.toLowerCase().includes(search.toLowerCase()) ||
      b.fg_barcode.includes(search)
  );

  const total = filteredBoms.length;
  const pageCount = pageSize === 0 ? 1 : Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount);
  const pagedBoms = pageSize === 0 ? filteredBoms : filteredBoms.slice((safePage - 1) * pageSize, safePage * pageSize);
  const rangeStart = total === 0 ? 0 : (safePage - 1) * (pageSize || total) + 1;
  const rangeEnd = pageSize === 0 ? total : Math.min(safePage * pageSize, total);

  const handleQuantityChange = (sku: string, val: number, max: number) => {
    const clamped = Math.max(1, Math.min(max > 0 ? max : 1, val));
    setProduceQty((prev) => ({ ...prev, [sku]: clamped }));
  };

  const toggleExpand = async (bom: EnrichedBomFormula) => {
    const sku = bom.fg_sku;
    if (expandedSku === sku) {
      setExpandedSku(null);
      return;
    }
    setExpandedSku(sku);

    if (!itemsCache[sku] && !(bom.items?.length ?? 0)) {
      setLoadingItemsSku(sku);
      try {
        const res = await fetch(`/api/production/bom?sku=${encodeURIComponent(sku)}`);
        const json = await res.json();
        if (json.success && Array.isArray(json.data?.items)) {
          setItemsCache((prev) => ({ ...prev, [sku]: json.data.items }));
        }
      } catch {
        // แสดงเป็นรายการว่าง — ผู้ใช้พับแล้วกางใหม่ได้
      } finally {
        setLoadingItemsSku(null);
      }
    }
  };

  const handleAdd = async (bom: EnrichedBomFormula) => {
    setAddError(null);
    if (bom.maxProducible <= 0) {
      setAddError(`วัตถุดิบในโกดัง 2 สำหรับผลิต ${bom.fg_sku} ไม่เพียงพอ — ไม่สามารถผลิตได้`);
      return;
    }
    setAddingSku(bom.fg_sku);
    try {
      const err = await onAddToCart(bom, tableNo, produceQty[bom.fg_sku] || 1);
      if (err) setAddError(err);
    } finally {
      setAddingSku(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`เลือกสินค้าผลิตให้โต๊ะ ${tableNo}`}
    >
      <div
        className="bg-white rounded-2xl border border-[#E8ECEA] shadow-2xl w-full max-w-5xl max-h-[92dvh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ส่วนหัว modal */}
        <div className="flex items-center justify-between gap-3 border-b border-[#EEF1EF] px-4 sm:px-5 py-3.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-8 h-8 rounded-lg bg-[#06402B] text-white font-mono text-sm font-black flex items-center justify-center shrink-0">
              {tableNo}
            </span>
            <h2 className="text-base font-extrabold text-slate-900 truncate">เพิ่มสินค้าผลิตให้โต๊ะ {tableNo}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors cursor-pointer shrink-0"
            aria-label="ปิดหน้าต่าง"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* ค้นหา + รีเฟรช */}
        <div className="border-b border-[#EEF1EF] px-4 sm:px-5 py-3 flex flex-col sm:flex-row gap-2.5">
          <div className="relative w-full sm:flex-1 sm:max-w-md">
            <input
              type="text"
              placeholder="ค้นหารหัสสินค้า, ชื่อสินค้า หรือบาร์โค้ด..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-[#E8ECEA] rounded-xl text-sm font-semibold text-slate-900 placeholder:text-slate-500 focus:outline-hidden focus:ring-2 focus:ring-[#0F5C3F] focus:bg-white transition-colors"
            />
            <svg
              className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            aria-label="รีเฟรชข้อมูล"
            title="รีเฟรชข้อมูล"
            className="p-2.5 self-start sm:self-auto text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all cursor-pointer border border-[#E8ECEA] active:scale-95"
          >
            <svg className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>

        {/* ข้อความ error จากการเพิ่ม (เช่น สินค้าซ้ำคนละโต๊ะ / เกินจำนวนที่ผลิตได้) */}
        {addError && (
          <div className="mx-4 sm:mx-5 mt-3 rounded-xl bg-rose-50 border border-rose-200 p-3 flex items-start justify-between gap-3">
            <div className="flex items-start gap-2 text-rose-800">
              <span className="text-base leading-5">⚠️</span>
              <p className="text-sm font-bold">{addError}</p>
            </div>
            <button
              onClick={() => setAddError(null)}
              className="text-rose-700 hover:text-rose-900 text-xs font-bold px-2 py-1 rounded-lg hover:bg-rose-100 cursor-pointer transition-colors shrink-0"
            >
              ปิด
            </button>
          </div>
        )}

        {/* เนื้อหา: ตารางสินค้า */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="py-20 text-center">
              <div className="w-8 h-8 border-3 border-[#0F5C3F] border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-sm text-slate-600 mt-3 font-semibold">กำลังโหลดข้อมูลสินค้าสำหรับผลิต...</p>
            </div>
          ) : filteredBoms.length === 0 ? (
            <div className="py-16 px-6 text-center">
              <p className="text-slate-700 text-base font-bold">ไม่พบรายการสินค้าที่ตรงกับคำค้นหา</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm min-w-[880px]">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b border-[#EEF1EF] bg-slate-50 text-slate-500 font-bold">
                    <th className="py-3 px-3 w-10 text-center" aria-label="ขยายดูวัตถุดิบ"></th>
                    <th className="py-3 px-3">รูป</th>
                    <th className="py-3 px-3">รหัส / บาร์โค้ด</th>
                    <th className="py-3 px-3">ชื่อสินค้า</th>
                    <th className="py-3 px-3 text-right">จำนวนที่ผลิตได้</th>
                    <th className="py-3 px-3 text-center">เพิ่มในโต๊ะ {tableNo}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EEF1EF]">
                  {pagedBoms.map((bom) => {
                    const maxProducible = bom.maxProducible || 0;
                    const currentQty = produceQty[bom.fg_sku] || 1;
                    const isExpanded = expandedSku === bom.fg_sku;
                    const alreadyInTable = existingSkus.has(bom.fg_sku);

                    return (
                      <Fragment key={bom.fg_sku}>
                        <tr
                          onClick={() => toggleExpand(bom)}
                          title={isExpanded ? "ซ่อนวัตถุดิบ" : "ดูวัตถุดิบที่ใช้ผลิต"}
                          className={`transition-colors cursor-pointer group ${
                            isExpanded ? "bg-[#EAF2EE]/50" : "hover:bg-slate-50/70"
                          }`}
                        >
                          <td className="py-3 px-3 text-center">
                            <svg
                              className={`w-4 h-4 mx-auto text-slate-400 transition-transform duration-200 ${
                                isExpanded ? "rotate-180 text-[#06402B]" : "group-hover:text-slate-600"
                              }`}
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </td>

                          <td className="py-3 px-3">
                            <div className="w-12 h-12 rounded-lg bg-[#EFF3F1] border border-[#EEF1EF] flex items-center justify-center p-1 overflow-hidden">
                              <img
                                src={bom.image || "/products/A002.jpg"}
                                alt={bom.fg_name}
                                className="max-h-full max-w-full object-contain"
                                onError={(e) => {
                                  (e.target as HTMLElement).style.visibility = "hidden";
                                }}
                              />
                            </div>
                          </td>

                          <td className="py-3 px-3 whitespace-nowrap">
                            <span className="font-mono font-bold text-slate-900">{bom.fg_sku}</span>
                            {bom.fg_barcode && (
                              <div className="font-mono text-xs font-medium text-slate-500 mt-0.5">{bom.fg_barcode}</div>
                            )}
                          </td>

                          <td className="py-3 px-3 max-w-[240px]">
                            <div className="font-bold text-slate-900 truncate" title={bom.fg_name}>
                              {bom.fg_name}
                            </div>
                            {typeof bom.fg_wh2_stock === "number" && (
                              <div className="text-xs text-slate-500 mt-0.5">
                                ในคลัง: <span className="font-mono font-semibold">{bom.fg_wh2_stock.toLocaleString()}</span>{" "}
                                {bom.fg_unit}
                              </div>
                            )}
                          </td>

                          <td className="py-3 px-3 text-right whitespace-nowrap">
                            {maxProducible > 0 ? (
                              <span className="text-[#052B1F] bg-[#DFEDE6] border border-[#8FB3A3] px-2.5 py-0.5 rounded-lg text-sm font-bold font-mono">
                                {maxProducible.toLocaleString()} {bom.fg_unit}
                              </span>
                            ) : (
                              <span className="text-rose-800 bg-rose-100 border border-rose-300 px-2.5 py-0.5 rounded-lg text-sm font-bold">
                                วัตถุดิบไม่พอ
                              </span>
                            )}
                          </td>

                          {/* ปุ่มจำนวน + เพิ่ม (ห้าม toggle แถวตอนกด) */}
                          <td className="py-3 px-3" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                type="button"
                                disabled={maxProducible <= 0}
                                onClick={() => handleQuantityChange(bom.fg_sku, currentQty - 1, maxProducible)}
                                className="w-9 h-9 rounded-lg bg-white border border-[#D5DDD9] text-slate-800 hover:bg-slate-100 active:scale-95 disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center font-bold text-lg transition-all shadow-2xs cursor-pointer select-none"
                                aria-label="ลดจำนวน"
                              >
                                −
                              </button>

                              <input
                                type="number"
                                min={1}
                                max={maxProducible > 0 ? maxProducible : 1}
                                disabled={maxProducible <= 0}
                                value={
                                  editingQty?.sku === bom.fg_sku
                                    ? editingQty.value
                                    : maxProducible > 0
                                      ? currentQty
                                      : 0
                                }
                                onChange={(e) => {
                                  const raw = e.target.value;
                                  if (raw === "") {
                                    setEditingQty({ sku: bom.fg_sku, value: "" });
                                    return;
                                  }
                                  setEditingQty(null);
                                  const val = parseInt(raw);
                                  if (!isNaN(val)) handleQuantityChange(bom.fg_sku, val, maxProducible);
                                }}
                                onBlur={() => {
                                  if (editingQty?.sku === bom.fg_sku) {
                                    if (editingQty.value === "") handleQuantityChange(bom.fg_sku, 1, maxProducible);
                                    setEditingQty(null);
                                    return;
                                  }
                                  if (currentQty < 1) handleQuantityChange(bom.fg_sku, 1, maxProducible);
                                }}
                                className="w-16 text-center h-9 px-1 bg-white border border-[#D5DDD9] rounded-lg font-mono text-sm font-bold text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-[#0F5C3F] shadow-inner disabled:bg-slate-100 disabled:text-slate-400 cursor-text select-all"
                                aria-label="จำนวนที่ต้องการผลิต"
                              />

                              <button
                                type="button"
                                disabled={maxProducible <= 0}
                                onClick={() => handleQuantityChange(bom.fg_sku, currentQty + 1, maxProducible)}
                                className="w-9 h-9 rounded-lg bg-white border border-[#D5DDD9] text-slate-800 hover:bg-slate-100 active:scale-95 disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center font-bold text-lg transition-all shadow-2xs cursor-pointer select-none"
                                aria-label="เพิ่มจำนวน"
                              >
                                +
                              </button>

                              <button
                                type="button"
                                disabled={maxProducible <= 0 || currentQty === maxProducible}
                                onClick={() => handleQuantityChange(bom.fg_sku, maxProducible, maxProducible)}
                                className="h-9 px-2 rounded-lg bg-[#EAF2EE] border border-[#8FB3A3] text-[#052B1F] hover:bg-[#DFEDE6] active:scale-95 disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center font-bold text-[11px] transition-all cursor-pointer select-none"
                                aria-label="ใส่จำนวนสูงสุด"
                                title="ใส่จำนวนสูงสุดที่ผลิตได้"
                              >
                                MAX
                              </button>

                              <button
                                type="button"
                                disabled={maxProducible <= 0 || addingSku === bom.fg_sku}
                                onClick={() => handleAdd(bom)}
                                className={`h-9 px-3.5 rounded-lg font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer active:scale-95 whitespace-nowrap ${
                                  maxProducible > 0
                                    ? "bg-[#06402B] hover:bg-[#053425] text-white shadow-md shadow-[#06402B]/20"
                                    : "bg-slate-200 text-slate-500 cursor-not-allowed shadow-none"
                                }`}
                              >
                                {addingSku === bom.fg_sku ? (
                                  <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                ) : (
                                  <>
                                    <span>{alreadyInTable ? `เพิ่มอีก (โต๊ะ ${tableNo})` : `เพิ่มในโต๊ะ ${tableNo}`}</span>
                                  </>
                                )}
                              </button>
                            </div>
                          </td>
                        </tr>

                        {/* แถวขยาย — วัตถุดิบที่ใช้ผลิต */}
                        {isExpanded && (() => {
                          const rowItems = itemsCache[bom.fg_sku] ?? bom.items ?? [];

                          if (loadingItemsSku === bom.fg_sku && rowItems.length === 0) {
                            return (
                              <tr className="bg-[#F7FAF8]">
                                <td colSpan={6} className="px-6 py-6 text-center">
                                  <div className="w-6 h-6 border-2 border-[#0F5C3F] border-t-transparent rounded-full animate-spin mx-auto" />
                                  <p className="text-xs text-slate-500 mt-2 font-semibold">กำลังดึงวัตถุดิบ...</p>
                                </td>
                              </tr>
                            );
                          }

                          if (rowItems.length === 0) {
                            return (
                              <tr className="bg-[#F7FAF8]">
                                <td colSpan={6} className="px-6 py-6 text-center text-sm text-slate-500 font-semibold">
                                  ไม่พบข้อมูลวัตถุดิบ
                                </td>
                              </tr>
                            );
                          }

                          return (
                            <tr className="bg-[#F7FAF8]">
                              <td colSpan={6} className="px-4 sm:px-6 py-4 border-l-4 border-[#0F5C3F]/60 animate-in fade-in slide-in-from-top-1 duration-150">
                                <div className="flex items-center justify-between gap-2 mb-2.5 flex-wrap">
                                  <h4 className="text-sm font-extrabold text-slate-900">
                                    วัตถุดิบที่ใช้ผลิต ({rowItems.length} รายการ)
                                  </h4>
                                  <span className="text-xs text-slate-500 font-semibold">
                                    ตรวจสอบยอดคงเหลือในโกดัง 2 ก่อนสั่งผลิต
                                  </span>
                                </div>
                                <div className="border border-[#E8ECEA] rounded-xl overflow-hidden bg-white">
                                  <table className="w-full text-left text-sm">
                                    <thead>
                                      <tr className="bg-slate-100 text-slate-600 font-bold border-b border-[#E8ECEA]">
                                        <th className="py-2.5 px-3 text-center">ประเภท</th>
                                        <th className="py-2.5 px-3">รหัสวัตถุดิบ</th>
                                        <th className="py-2.5 px-3">ชื่อวัตถุดิบ</th>
                                        <th className="py-2.5 px-3 text-right">ใช้ต่อ 1 ชุด</th>
                                        <th className="py-2.5 px-3 text-right">มีในโกดัง 2</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#EEF1EF]">
                                      {rowItems.map((item, idx) => {
                                        const isPrimary = Number(item.is_primary) === 1;
                                        const available = item.available_wh2_qty || 0;
                                        const req = item.rm_qty_required || 1;
                                        const hasEnough = available >= req;

                                        return (
                                          <tr key={item.rm_sku || idx} className="hover:bg-slate-50/70">
                                            <td className="py-2.5 px-3 text-center">
                                              <span
                                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${
                                                  isPrimary
                                                    ? "bg-emerald-100 text-emerald-900 border border-emerald-300"
                                                    : "bg-slate-100 text-slate-600 border border-slate-200"
                                                }`}
                                              >
                                                {isPrimary ? "หลัก" : "รอง"}
                                              </span>
                                            </td>
                                            <td className="py-2.5 px-3 font-mono font-bold text-slate-800 whitespace-nowrap">
                                              {item.rm_sku || "-"}
                                            </td>
                                            <td className="py-2.5 px-3 font-semibold text-slate-800">
                                              <span className="block truncate" title={item.rm_name}>
                                                {item.rm_name}
                                              </span>
                                            </td>
                                            <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-700 whitespace-nowrap">
                                              {req.toLocaleString()} {item.rm_unit}
                                              {(item.waste_percentage || 0) > 0 && (
                                                <span
                                                  className="ml-1 text-[10px] text-amber-700 font-bold"
                                                  title={`บวกเศษที่เสียไป ${item.waste_percentage}%`}
                                                >
                                                  +เศษ {item.waste_percentage}%
                                                </span>
                                              )}
                                            </td>
                                            <td
                                              className={`py-2.5 px-3 text-right font-mono font-bold whitespace-nowrap ${
                                                hasEnough ? "text-slate-700" : isPrimary ? "text-rose-600" : "text-amber-600"
                                              }`}
                                              title={`ต้องใช้ ${req} ${item.rm_unit} ต่อชุด`}
                                            >
                                              {available.toLocaleString()} {item.rm_unit}
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              </td>
                            </tr>
                          );
                        })()}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* แถบล่าง: แบ่งหน้า + ปุ่มเสร็จสิ้น */}
        <div className="border-t border-[#EEF1EF] px-4 sm:px-5 py-3 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
            <span>แสดง</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="bg-white border border-[#D5DDD9] rounded-lg px-2 py-1.5 text-xs font-bold text-slate-800 cursor-pointer focus:outline-hidden focus:ring-2 focus:ring-[#0F5C3F]"
              aria-label="จำนวนรายการต่อหน้า"
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={30}>30</option>
              <option value={50}>50</option>
              <option value={0}>ALL</option>
            </select>
            <span>รายการ/หน้า</span>
            <span className="ml-1 text-slate-400">
              ({rangeStart}–{rangeEnd} จาก {total} รายการ)
            </span>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setPage(Math.max(1, safePage - 1))}
              disabled={safePage <= 1}
              className="px-3 py-1.5 rounded-lg bg-white border border-[#D5DDD9] text-slate-700 hover:bg-slate-100 font-bold text-xs transition-all cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
            >
              ‹ ก่อนหน้า
            </button>
            <span className="px-1 text-xs font-bold text-slate-600 font-mono">
              หน้า {safePage} / {pageCount}
            </span>
            <button
              type="button"
              onClick={() => setPage(Math.min(pageCount, safePage + 1))}
              disabled={safePage >= pageCount}
              className="px-3 py-1.5 rounded-lg bg-white border border-[#D5DDD9] text-slate-700 hover:bg-slate-100 font-bold text-xs transition-all cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
            >
              ถัดไป ›
            </button>

            <button
              type="button"
              onClick={onClose}
              className="h-9 px-5 rounded-xl bg-[#06402B] hover:bg-[#053425] text-white font-bold text-sm transition-all cursor-pointer active:scale-95 shadow-md shadow-[#06402B]/20"
            >
              เสร็จสิ้น
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

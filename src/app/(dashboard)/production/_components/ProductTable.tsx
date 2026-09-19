"use client";

import { Fragment, useState } from "react";
import type { EnrichedBomFormula, EnrichedBomItem } from "./types";

interface ProductTableProps {
  boms: EnrichedBomFormula[];
  produceQty: Record<string, number>;
  onQuantityChange: (sku: string, val: number, max: number) => void;
  onAddToCart: (bom: EnrichedBomFormula) => void;
  // Pagination
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  rangeStart: number;
  rangeEnd: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

export default function ProductTable({
  boms,
  produceQty,
  onQuantityChange,
  onAddToCart,
  page,
  pageCount,
  pageSize,
  total,
  rangeStart,
  rangeEnd,
  onPageChange,
  onPageSizeChange,
}: ProductTableProps) {
  const [expandedSku, setExpandedSku] = useState<string | null>(null);
  // ช่องจำนวนที่ผู้ใช้กำลังพิมพ์ (อาจว่างชั่วคราว) — กันค่าเก่าถูกหยิบไปใช้ตอนเพิ่มตะกร้า
  // ทั้งที่ผู้ใช้ล้างช่องไปแล้ว (onBlur จะกลับเป็น 1 เอง)
  const [editingQty, setEditingQty] = useState<{ sku: string; value: string } | null>(null);
  // วัตถุดิบแต่ละสูตร — ดึงแบบ lazy ตอนขยายแถวครั้งแรก (หน้า list ได้แค่หัวสูตร)
  const [itemsCache, setItemsCache] = useState<Record<string, EnrichedBomItem[]>>({});
  const [loadingItemsSku, setLoadingItemsSku] = useState<string | null>(null);

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

  return (
    <div className="bg-white rounded-2xl border border-[#E8ECEA] shadow-xs overflow-hidden">
      <div className="p-4 sm:p-5 border-b border-[#EEF1EF] flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full bg-[#0F5C3F]" />
        <h2 className="text-base font-extrabold text-slate-900">รายการสินค้าสำหรับผลิต</h2>
        <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
          {total} รายการ
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm min-w-[1020px]">
          <thead>
            <tr className="border-b border-[#EEF1EF] bg-slate-50/70 text-slate-500 font-bold">
              <th className="py-3 px-3 w-10 text-center" aria-label="ขยายดูวัตถุดิบ"></th>
              <th className="py-3 px-4">รูป</th>
              <th className="py-3 px-4">รหัสสินค้า</th>
              <th className="py-3 px-4">บาร์โค้ด</th>
              <th className="py-3 px-4">ชื่อสินค้า</th>
              <th className="py-3 px-4 text-right">จำนวนที่ผลิตได้</th>
              <th className="py-3 px-4 text-center">สั่งผลิต / เพิ่มตะกร้า</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#EEF1EF]">
            {boms.map((bom) => {
              const maxProducible = bom.maxProducible || 0;
              const currentQty = produceQty[bom.fg_sku] || 1;
              const isExpanded = expandedSku === bom.fg_sku;

              return (
                <Fragment key={bom.fg_sku}>
                  <tr
                    onClick={() => toggleExpand(bom)}
                    title={isExpanded ? "ซ่อนวัตถุดิบ" : "ดูวัตถุดิบที่ใช้ผลิต"}
                    className={`transition-colors cursor-pointer group ${
                      isExpanded ? "bg-[#EAF2EE]/50" : "hover:bg-slate-50/70"
                    }`}
                  >
                    {/* Expand Chevron */}
                    <td className="py-3.5 px-3 text-center">
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

                    {/* Product Image */}
                    <td className="py-3.5 px-4">
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

                    {/* SKU */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <span className="font-mono font-bold text-slate-900">{bom.fg_sku}</span>
                    </td>

                    {/* Barcode */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {bom.fg_barcode ? (
                        <span className="font-mono text-xs font-medium text-slate-500">{bom.fg_barcode}</span>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>

                    {/* Name + Stock */}
                    <td className="py-3.5 px-4 max-w-[260px]">
                      <div className="font-bold text-slate-900 truncate" title={bom.fg_name}>
                        {bom.fg_name}
                      </div>
                      {typeof bom.fg_wh2_stock === "number" && (
                        <div className="text-xs text-slate-500 mt-0.5">
                          ในคลัง: <span className="font-mono font-semibold">{bom.fg_wh2_stock.toLocaleString()}</span> {bom.fg_unit}
                        </div>
                      )}
                    </td>

                    {/* Max Producible */}
                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
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

                    {/* Quantity Stepper + Add to Cart (clicks must not toggle the row) */}
                    <td className="py-3.5 px-4" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          type="button"
                          disabled={maxProducible <= 0}
                          onClick={() => onQuantityChange(bom.fg_sku, currentQty - 1, maxProducible)}
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
                          onContextMenu={(e) => e.preventDefault()}
                          onChange={(e) => {
                            const raw = e.target.value;
                            if (raw === "") {
                              // ค้างค่าว่างไว้ก่อน ยังไม่อัปเดต — onBlur จะกลับเป็น 1 เอง
                              setEditingQty({ sku: bom.fg_sku, value: "" });
                              return;
                            }
                            setEditingQty(null);
                            const val = parseInt(raw);
                            if (!isNaN(val)) {
                              onQuantityChange(bom.fg_sku, val, maxProducible);
                            }
                          }}
                          onBlur={() => {
                            if (editingQty?.sku === bom.fg_sku) {
                              if (editingQty.value === "") {
                                onQuantityChange(bom.fg_sku, 1, maxProducible);
                              }
                              setEditingQty(null);
                              return;
                            }
                            if (currentQty < 1) {
                              onQuantityChange(bom.fg_sku, 1, maxProducible);
                            }
                          }}
                          className="w-16 text-center h-9 px-1 bg-white border border-[#D5DDD9] rounded-lg font-mono text-sm font-bold text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-[#0F5C3F] shadow-inner disabled:bg-slate-100 disabled:text-slate-400 cursor-text select-all"
                          aria-label="จำนวนที่ต้องการผลิต"
                        />

                        <button
                          type="button"
                          disabled={maxProducible <= 0}
                          onClick={() => onQuantityChange(bom.fg_sku, currentQty + 1, maxProducible)}
                          className="w-9 h-9 rounded-lg bg-white border border-[#D5DDD9] text-slate-800 hover:bg-slate-100 active:scale-95 disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center font-bold text-lg transition-all shadow-2xs cursor-pointer select-none"
                          aria-label="เพิ่มจำนวน"
                        >
                          +
                        </button>

                        <button
                          type="button"
                          disabled={maxProducible <= 0 || currentQty === maxProducible}
                          onClick={() => onQuantityChange(bom.fg_sku, maxProducible, maxProducible)}
                          className="h-9 px-2 rounded-lg bg-[#EAF2EE] border border-[#8FB3A3] text-[#052B1F] hover:bg-[#DFEDE6] active:scale-95 disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center font-bold text-[11px] transition-all cursor-pointer select-none"
                          aria-label="ใส่จำนวนสูงสุด"
                          title="ใส่จำนวนสูงสุดที่ผลิตได้"
                        >
                          MAX
                        </button>

                        <button
                          type="button"
                          disabled={maxProducible <= 0}
                          onClick={() => onAddToCart(bom)}
                          className={`h-9 px-3.5 rounded-lg font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer active:scale-95 whitespace-nowrap ${
                            maxProducible > 0
                              ? "bg-[#06402B] hover:bg-[#053425] text-white shadow-md shadow-[#06402B]/20"
                              : "bg-slate-200 text-slate-500 cursor-not-allowed shadow-none"
                          }`}
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
                            />
                          </svg>
                          <span>{maxProducible > 0 ? "เพิ่มในตะกร้า" : "วัตถุดิบไม่พอ"}</span>
                        </button>
                      </div>
                    </td>
                  </tr>

                  {/* Expanded Row — Raw Materials (BOM) — ดึงวัตถุดิบแบบ lazy ตอนกางครั้งแรก */}
                  {isExpanded && (() => {
                    const rowItems = itemsCache[bom.fg_sku] ?? bom.items ?? [];

                    if (loadingItemsSku === bom.fg_sku && rowItems.length === 0) {
                      return (
                        <tr className="bg-[#F7FAF8]">
                          <td colSpan={7} className="px-6 py-6 text-center">
                            <div className="w-6 h-6 border-2 border-[#0F5C3F] border-t-transparent rounded-full animate-spin mx-auto" />
                            <p className="text-xs text-slate-500 mt-2 font-semibold">กำลังดึงวัตถุดิบ...</p>
                          </td>
                        </tr>
                      );
                    }

                    if (rowItems.length === 0) {
                      return (
                        <tr className="bg-[#F7FAF8]">
                          <td colSpan={7} className="px-6 py-6 text-center text-sm text-slate-500 font-semibold">
                            ไม่พบข้อมูลวัตถุดิบ — กดพับแล้วกางใหม่เพื่อลองอีกครั้ง
                          </td>
                        </tr>
                      );
                    }

                    return (
                    <tr className="bg-[#F7FAF8]">
                      <td colSpan={7} className="px-4 sm:px-6 py-4 border-l-4 border-[#0F5C3F]/60 animate-in fade-in slide-in-from-top-1 duration-150">
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

      {/* Pagination Footer */}
      <div className="p-3.5 border-t border-[#EEF1EF] flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
          <span>แสดง</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
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
          <span className="hidden sm:inline text-slate-400">· กดที่แถวเพื่อดูวัตถุดิบ</span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onPageChange(Math.max(1, page - 1))}
            disabled={page <= 1}
            className="px-3 py-1.5 rounded-lg bg-white border border-[#D5DDD9] text-slate-700 hover:bg-slate-100 font-bold text-xs transition-all cursor-pointer disabled:opacity-40 disabled:pointer-events-none flex items-center gap-1"
          >
            ‹ ก่อนหน้า
          </button>
          <span className="px-2 text-xs font-bold text-slate-600 font-mono">
            หน้า {page} / {pageCount}
          </span>
          <button
            type="button"
            onClick={() => onPageChange(Math.min(pageCount, page + 1))}
            disabled={page >= pageCount}
            className="px-3 py-1.5 rounded-lg bg-white border border-[#D5DDD9] text-slate-700 hover:bg-slate-100 font-bold text-xs transition-all cursor-pointer disabled:opacity-40 disabled:pointer-events-none flex items-center gap-1"
          >
            ถัดไป ›
          </button>
        </div>
      </div>
    </div>
  );
}

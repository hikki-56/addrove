"use client";

import { PRODUCTION_TABLES } from "../_lib/cart-store";
import type { CartItem } from "./types";

interface TableBoardProps {
  cart: CartItem[];
  /** เปิดหน้าต่างเลือกสินค้าให้โต๊ะนี้ */
  onOpenPicker: (tableNo: number) => void;
}

/** บอร์ดโต๊ะผลิต 1–5 — แต่ละโต๊ะแสดงสินค้าที่จัดให้ผลิต และปุ่มเพิ่มสินค้าผลิต */
export default function TableBoard({ cart, onOpenPicker }: TableBoardProps) {
  const itemsOf = (tableNo: number) => cart.filter((i) => i.table_no === tableNo);

  return (
    <div className="bg-white rounded-2xl border border-[#E8ECEA] shadow-xs p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-[#0F5C3F]" />
          <h2 className="text-base font-extrabold text-slate-900">โต๊ะผลิตทั้งหมด</h2>
          <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
            {PRODUCTION_TABLES.length} โต๊ะ
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {PRODUCTION_TABLES.map((tableNo) => {
          const items = itemsOf(tableNo);
          const totalUnits = items.reduce((sum, i) => sum + i.quantity, 0);
          const isEmpty = items.length === 0;

          return (
            <section
              key={tableNo}
              className={`rounded-xl border p-3.5 flex flex-col transition-colors ${
                isEmpty ? "border-[#E8ECEA] bg-white" : "border-[#8FB3A3] bg-[#F7FAF8]"
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
                {items.length > 0 && (
                  <span className="rounded-full bg-[#DFEDE6] border border-[#8FB3A3] px-2 py-0.5 text-[11px] font-bold text-[#052B1F] whitespace-nowrap shrink-0">
                    {items.length.toLocaleString()} รายการ · {totalUnits.toLocaleString()} หน่วย
                  </span>
                )}
              </div>

              {/* รายการสินค้าของโต๊ะนี้ */}
              {isEmpty ? (
                <div className="flex-1 min-h-[72px]" />
              ) : (
                <ul className="flex-1 space-y-1.5 max-h-64 overflow-y-auto pr-0.5">
                  {items.map((item) => (
                    <li
                      key={`${item.table_no}-${item.bom.fg_sku}`}
                      className="flex items-center gap-2 rounded-lg border border-[#E8ECEA] bg-white px-2 py-1.5"
                    >
                      <div className="w-10 h-10 rounded-md bg-[#EFF3F1] border border-[#EEF1EF] flex items-center justify-center p-0.5 overflow-hidden shrink-0">
                        <img
                          src={item.bom.image || "/products/A002.jpg"}
                          alt={item.bom.fg_name}
                          className="max-h-full max-w-full object-contain"
                          onError={(e) => {
                            (e.target as HTMLElement).style.visibility = "hidden";
                          }}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-bold text-slate-900" title={item.bom.fg_name}>
                          {item.bom.fg_name}
                        </div>
                        <div className="font-mono text-[10px] font-semibold text-slate-400">
                          {item.bom.fg_sku} · {item.bom.fg_unit}
                        </div>
                      </div>
                      {/* จำนวนที่จะผลิต (อ่านอย่างเดียว — ปรับจำนวน/ลบทำในหน้าตะกร้าผลิต) */}
                      <span className="shrink-0 rounded-md bg-[#DFEDE6] border border-[#8FB3A3] px-2 py-1 font-mono text-xs font-bold text-[#052B1F] whitespace-nowrap">
                        {item.quantity.toLocaleString()} {item.bom.fg_unit}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {/* ปุ่มเพิ่มสินค้าให้โต๊ะนี้ */}
              <button
                type="button"
                onClick={() => onOpenPicker(tableNo)}
                className="mt-3 w-full h-10 rounded-xl bg-[#06402B] hover:bg-[#053425] text-white font-bold text-sm transition-all cursor-pointer active:scale-[0.98] shadow-md shadow-[#06402B]/20 flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                </svg>
                เพิ่มสินค้าผลิต
              </button>
            </section>
          );
        })}
      </div>
    </div>
  );
}

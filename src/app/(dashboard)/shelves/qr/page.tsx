"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Location, Warehouse } from "@/types/models";
import { getDefaultLocationsForWarehouse, getWarehouseName } from "@/lib/warehouse-utils";
import BarcodeSvg from "@/components/ui/BarcodeSvg";
import {
  generateShelfBarcodeStickerDataUrl,
  getShelfArrowDirection,
} from "@/lib/barcode-utils";

interface ShelfQrItem {
  location_id: string;
  location_code: string;
  shelf_name: string;
  warehouse_id: string;
  warehouse_name: string;
  level_name: string;
}

const WAREHOUSES = [
  { id: "wh-01", name: "โกดัง1" },
  { id: "wh-02", name: "โกดัง2" },
  { id: "wh-03", name: "โกดัง3" },
  { id: "wh-04", name: "โกดัง4" },
  { id: "wh-05", name: "โกดัง5" },
  { id: "wh-06", name: "สำนักงานใหญ่" },
];

function extractShelfLevel(locationCode: string, shelfName: string): string {
  const text = `${locationCode} ${shelfName}`.toUpperCase();

  // 1. Check for explicit "ชั้นที่ X" or "ชั้น X"
  const channMatch = text.match(/ชั้น(?:ที่)?\s*([0-9]+)/i);
  if (channMatch && channMatch[1]) {
    return `ชั้นที่ ${channMatch[1]}`;
  }

  // 2. Pattern "-L1", "-L2", "-L3", "-L4", "-L5" or "L1", "L2", "L3" (e.g. SH-A1-L1)
  const lMatch = locationCode.match(/[-_]L([0-9]+)/i) || locationCode.match(/L([0-9]+)/i);
  if (lMatch && lMatch[1]) {
    return `ชั้นที่ ${lMatch[1]}`;
  }

  // 3. Pattern with Zone Letter & Level number (e.g. WH1-A01 -> ชั้นที่ 1, WH1-A02 -> ชั้นที่ 2)
  const zoneDigit = locationCode.match(/[A-Z]-?0*([1-9])$/i) || locationCode.match(/[A-Z]([1-9])$/i);
  if (zoneDigit && zoneDigit[1]) {
    return `ชั้นที่ ${zoneDigit[1]}`;
  }

  // 4. Trailing digit level (e.g. loc-a1 -> ชั้นที่ 1, loc-a2 -> ชั้นที่ 2, slf-a1-5 -> ชั้นที่ 5)
  const digitEnd = locationCode.match(/[-_\s]([0-9]+)$/);
  if (digitEnd && digitEnd[1]) {
    return `ชั้นที่ ${digitEnd[1]}`;
  }

  return "ชั้นที่ 1";
}

// Custom Scrollable Dropdown (shows ~4 items at a time with smooth scroll)
function ScrollableSelect({
  value,
  options,
  onChange,
  title,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (val: string) => void;
  title?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const currentOption = options.find((o) => o.value === value);

  return (
    <div className="relative flex-1 min-w-0" ref={ref}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        title={title}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-800 text-xs sm:text-sm font-semibold transition-all cursor-pointer shadow-2xs focus:outline-none focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-500/20"
      >
        <span className="truncate">{currentOption ? currentOption.label : value}</span>
        <svg
          className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full mt-1.5 w-full min-w-[160px] bg-white border border-slate-200 rounded-xl shadow-xl z-50 max-h-[160px] overflow-y-auto divide-y divide-slate-100 py-1">
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value);
                  setIsOpen(false);
                }}
                className={`w-full text-left px-3 py-2 text-xs font-semibold transition-colors cursor-pointer flex items-center justify-between ${
                  isSelected
                    ? "bg-indigo-50 text-indigo-700 font-bold"
                    : "text-slate-700 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                <span className="truncate">{opt.label}</span>
                {isSelected && <span className="text-indigo-600 text-xs font-bold ml-1.5 shrink-0">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function ShelfQrPage() {
  const [selectedWh, setSelectedWh] = useState<string>("ALL");
  const [selectedLevel, setSelectedLevel] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [shelfItems, setShelfItems] = useState<ShelfQrItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLocations = async () => {
      setLoading(true);
      try {
        let allLocs: Location[] = [];
        const res = await fetch("/api/locations").catch(() => null);
        if (res && res.ok) {
          const json = await res.json();
          if (json.success && Array.isArray(json.data) && json.data.length > 0) {
            allLocs = json.data.filter((l: Location) => l.active);
          }
        }

        if (allLocs.length === 0) {
          for (const wh of WAREHOUSES) {
            const defaults = getDefaultLocationsForWarehouse(wh.id);
            allLocs.push(...defaults);
          }
        }

        const items: ShelfQrItem[] = allLocs.map((loc) => {
          const whName = getWarehouseName(loc.warehouse_id);
          const shelfName = (loc as any).shelf_name || `ชั้นวาง ${loc.location_code}`;
          const levelName = (loc as any).shelf_level
            ? `ชั้นที่ ${(loc as any).shelf_level}`
            : extractShelfLevel(loc.location_code, shelfName);

          return {
            location_id: loc.location_id,
            location_code: loc.location_code,
            shelf_name: shelfName,
            warehouse_id: loc.warehouse_id,
            warehouse_name: whName,
            level_name: levelName,
          };
        });

        setShelfItems(items);
      } catch (err) {
        console.error("Load shelf locations error:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchLocations();
  }, []);

  const whFilteredItems = shelfItems.filter(
    (item) => selectedWh === "ALL" || item.warehouse_id === selectedWh
  );

  const availableLevels = Array.from(new Set(whFilteredItems.map((i) => i.level_name))).sort((a, b) => {
    const numA = parseInt(a.replace(/\D/g, ""), 10) || 999;
    const numB = parseInt(b.replace(/\D/g, ""), 10) || 999;
    return numA - numB;
  });

  const warehouseOptions = useMemo(() => {
    const opts = [{ value: "ALL", label: `โกดังทั้งหมด (${shelfItems.length})` }];
    for (const wh of WAREHOUSES) {
      const count = shelfItems.filter((i) => i.warehouse_id === wh.id).length;
      opts.push({ value: wh.id, label: `${wh.name} (${count})` });
    }
    return opts;
  }, [shelfItems]);

  const levelOptions = useMemo(() => {
    const opts = [{ value: "ALL", label: `ทุกชั้น (${whFilteredItems.length})` }];
    for (const lvl of availableLevels) {
      const count = whFilteredItems.filter((i) => i.level_name === lvl).length;
      opts.push({ value: lvl, label: `${lvl} (${count})` });
    }
    return opts;
  }, [availableLevels, whFilteredItems]);

  const filteredItems = whFilteredItems.filter((item) => {
    const matchesLevel = selectedLevel === "ALL" || item.level_name === selectedLevel;
    const q = searchQuery.trim().toLowerCase();
    const matchesSearch =
      !q ||
      item.location_code.toLowerCase().includes(q) ||
      item.shelf_name.toLowerCase().includes(q) ||
      item.warehouse_name.toLowerCase().includes(q) ||
      item.level_name.toLowerCase().includes(q);
    return matchesLevel && matchesSearch;
  });

  const groupedByLevel = availableLevels.map((lvl) => ({
    levelName: lvl,
    items: filteredItems.filter((i) => i.level_name === lvl),
  })).filter((group) => group.items.length > 0);

  const stickerPages: ShelfQrItem[][] = [];
  for (let i = 0; i < filteredItems.length; i += 9) {
    stickerPages.push(filteredItems.slice(i, i + 9));
  }

  const handlePrint = () => {
    window.print();
  };

  const renderItemCard = (item: ShelfQrItem, idx: number) => {
    const arrowDir = getShelfArrowDirection(item.location_code);

    return (
      <div
        key={`${item.warehouse_id}-${item.location_id}-${item.location_code}-${idx}`}
        className="bg-white rounded-3xl p-6 sm:p-7 text-slate-900 border border-slate-200 shadow-sm flex flex-col items-center justify-center gap-3.5 text-center relative overflow-hidden transition-all hover:border-slate-300 select-none"
      >
        <h2 className="text-3xl sm:text-4xl md:text-[2.6rem] font-black text-slate-900 tracking-wide font-mono select-none flex items-center justify-center gap-2 sm:gap-3 flex-nowrap w-full whitespace-nowrap overflow-hidden">
          {arrowDir === "down" && (
            <svg className="w-6 h-6 sm:w-8 sm:h-8 text-emerald-600 inline-block shrink-0 fill-current" viewBox="0 0 24 24" aria-label="A: ชี้ลง">
              <path d="M12 22l-8.5-9.5h5.5V2h6v10.5h5.5L12 22z" />
            </svg>
          )}
          {arrowDir === "up" && (
            <svg className="w-6 h-6 sm:w-8 sm:h-8 text-emerald-600 inline-block shrink-0 fill-current" viewBox="0 0 24 24" aria-label="B: ชี้ขึ้น">
              <path d="M12 2l8.5 9.5h-5.5V22h-6V11.5H3.5L12 2z" />
            </svg>
          )}

          <span className="whitespace-nowrap shrink-0">{item.location_code}</span>

          {arrowDir === "down" && (
            <svg className="w-6 h-6 sm:w-8 sm:h-8 text-emerald-600 inline-block shrink-0 fill-current" viewBox="0 0 24 24" aria-label="A: ชี้ลง">
              <path d="M12 22l-8.5-9.5h5.5V2h6v10.5h5.5L12 22z" />
            </svg>
          )}
          {arrowDir === "up" && (
            <svg className="w-6 h-6 sm:w-8 sm:h-8 text-emerald-600 inline-block shrink-0 fill-current" viewBox="0 0 24 24" aria-label="B: ชี้ขึ้น">
              <path d="M12 2l8.5 9.5h-5.5V22h-6V11.5H3.5L12 2z" />
            </svg>
          )}
        </h2>

        <div className="w-full flex items-center justify-center">
          <div className="w-full max-w-[380px] sm:max-w-[420px] bg-white rounded-2xl border border-slate-300 px-4 py-3 sm:px-6 sm:py-3.5 flex items-center justify-center shadow-2xs">
            <BarcodeSvg
              value={item.location_code}
              width={2.8}
              height={82}
              showText={false}
              disableZoom={true}
              className="border-0 p-0 shadow-none bg-transparent w-full"
            />
          </div>
        </div>
      </div>
    );
  };

  const totalStickerPages = stickerPages.length;

  return (
    <>
      <div className="max-w-6xl mx-auto space-y-6 w-full max-w-full pb-12 print:hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <svg className="w-6 h-6 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              <span>บาร์โค้ดชั้นวางสินค้า (แบ่งตามระดับชั้นและโกดัง)</span>
            </h1>
            <p className="text-slate-500 text-xs sm:text-sm mt-1">
              พิมพ์ป้ายบาร์โค้ดจัดลงกระดาษสติกเกอร์ A4 แนวนอน 9 ช่อง (3×3) รวมทั้งหมด {filteredItems.length} ตำแหน่ง ({totalStickerPages} หน้ากระดาษ)
            </p>
          </div>

          <button
            onClick={handlePrint}
            className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs sm:text-sm transition-all shadow-md shadow-indigo-600/20 flex items-center justify-center gap-2 shrink-0 cursor-pointer active:scale-95"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            <span>พิมพ์ป้ายบาร์โค้ดทั้งหมด ({filteredItems.length} ตำแหน่ง • {totalStickerPages} แผ่น A4)</span>
          </button>
        </div>

        <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200 shadow-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3.5 items-end">
            <div className="lg:col-span-4">
              <div className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center gap-1.5">
                <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
                <span>เลือกโกดัง</span>
              </div>
              <ScrollableSelect
                value={selectedWh}
                options={warehouseOptions}
                onChange={(val) => {
                  setSelectedWh(val);
                  setSelectedLevel("ALL");
                }}
                title="เลือกโกดัง"
              />
            </div>

            <div className="lg:col-span-3">
              <div className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center gap-1.5">
                <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
                <span>ระดับชั้น</span>
              </div>
              <ScrollableSelect
                value={selectedLevel}
                options={levelOptions}
                onChange={(val) => setSelectedLevel(val)}
                title="เลือกระดับชั้น"
              />
            </div>

            <div className="sm:col-span-2 lg:col-span-5">
              <label htmlFor="shelf-search-input" className="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center gap-1.5">
                <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <span>ค้นหารหัสชั้นวาง</span>
              </label>
              <div className="relative">
                <input
                  id="shelf-search-input"
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="พิมพ์รหัสชั้นวาง (เช่น 1K14-1A)..."
                  className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 text-xs sm:text-sm font-medium transition-all shadow-2xs"
                />
                <svg className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="py-20 text-center space-y-4">
            <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-slate-500 text-sm font-medium">กำลังโหลดข้อมูลชั้นวางสินค้า...</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="py-20 text-center bg-white border border-slate-200 shadow-xs rounded-2xl p-8 space-y-3">
            <span className="text-4xl block">🔍</span>
            <p className="text-slate-800 font-bold text-base">ไม่พบข้อมูลชั้นวางสินค้า</p>
            <p className="text-slate-500 text-xs">ลองเปลี่ยนคำค้นหา หรือเลือกโกดังอื่น</p>
          </div>
        ) : selectedLevel === "ALL" && groupedByLevel.length > 1 ? (
          <div className="space-y-8">
            {groupedByLevel.map((group) => (
              <div key={group.levelName} className="space-y-3.5">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-indigo-600" />
                    <span>{group.levelName}</span>
                    <span className="text-xs text-slate-500 font-normal">({group.items.length} ตำแหน่ง)</span>
                  </h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {group.items.map((item, idx) => renderItemCard(item, idx))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* Flat Grid View */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredItems.map((item, idx) => renderItemCard(item, idx))}
          </div>
        )}
      </div>

      {/* ======================================================== */}
      {/* Print View (A4 3x3 Grid Template with CSS Page-Breaks)   */}
      {/* ======================================================== */}
      <div id="print-sticker-container" className="hidden print:block">
        <style dangerouslySetInnerHTML={{ __html: `
          @media print {
            @page {
              size: A4 landscape;
              margin: 4mm;
            }
            html, body {
              width: 100% !important;
              height: auto !important;
              min-height: 0 !important;
              overflow: visible !important;
              background: #ffffff !important;
              color: #000000 !important;
              margin: 0 !important;
              padding: 0 !important;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            #__next, main, .admin-shell, .flex, .flex-col, .overflow-hidden, .overflow-y-auto {
              height: auto !important;
              min-height: 0 !important;
              max-height: none !important;
              overflow: visible !important;
              display: block !important;
              position: static !important;
            }
            header, nav, aside, footer, .sidebar, .navbar, .print\\:hidden {
              display: none !important;
            }
            #print-sticker-container {
              display: block !important;
              position: static !important;
              width: 100% !important;
              margin: 0 !important;
              padding: 0 !important;
            }
            .a4-sticker-page {
              width: 280mm !important;
              height: 196mm !important;
              max-height: 198mm !important;
              margin: 0 auto !important;
              display: grid !important;
              grid-template-columns: repeat(3, 1fr) !important;
              grid-template-rows: repeat(3, 1fr) !important;
              gap: 4mm 4mm !important;
              page-break-after: always !important;
              break-after: page !important;
              page-break-inside: avoid !important;
              break-inside: avoid !important;
              box-sizing: border-box !important;
              padding: 1mm !important;
            }
            .a4-sticker-page:last-child {
              page-break-after: auto !important;
              break-after: auto !important;
            }
            .sticker-slot {
              box-sizing: border-box !important;
              width: 100% !important;
              height: 100% !important;
              max-height: 63mm !important;
              display: flex !important;
              flex-direction: column !important;
              align-items: center !important;
              justify-content: center !important;
              padding: 2mm 3mm !important;
              border: 1px dashed #cbd5e1 !important;
              border-radius: 12px !important;
              background: #ffffff !important;
              text-align: center !important;
              page-break-inside: avoid !important;
              break-inside: avoid !important;
            }
          }
        `}} />

        {stickerPages.map((pageItems, pageIdx) => (
          <div key={`print-page-${pageIdx}`} className="a4-sticker-page">
            {pageItems.map((item, itemIdx) => {
              const arrowDir = getShelfArrowDirection(item.location_code);
              return (
                <div key={`slot-${item.warehouse_id}-${item.location_id}-${itemIdx}`} className="sticker-slot">
                  {/* Top: Location Code Title with Bold Green Arrows on Both Sides - Strictly 1 Line */}
                  <div
                    className="font-mono font-black text-slate-900 tracking-wide leading-none mb-2 select-none flex items-center justify-center gap-2 flex-nowrap w-full whitespace-nowrap overflow-hidden"
                    style={{ fontSize: "36px", fontWeight: 900, whiteSpace: "nowrap" }}
                  >
                    {arrowDir === "down" && (
                      <svg
                        viewBox="0 0 24 24"
                        style={{ width: "24px", height: "24px", fill: "#16a34a", display: "inline-block", flexShrink: 0 }}
                      >
                        <path d="M12 22l-8.5-9.5h5.5V2h6v10.5h5.5L12 22z" />
                      </svg>
                    )}
                    {arrowDir === "up" && (
                      <svg
                        viewBox="0 0 24 24"
                        style={{ width: "24px", height: "24px", fill: "#16a34a", display: "inline-block", flexShrink: 0 }}
                      >
                        <path d="M12 2l8.5 9.5h-5.5V22h-6V11.5H3.5L12 2z" />
                      </svg>
                    )}

                    <span style={{ whiteSpace: "nowrap", flexShrink: 0 }}>{item.location_code}</span>

                    {arrowDir === "down" && (
                      <svg
                        viewBox="0 0 24 24"
                        style={{ width: "24px", height: "24px", fill: "#16a34a", display: "inline-block", flexShrink: 0 }}
                      >
                        <path d="M12 22l-8.5-9.5h5.5V2h6v10.5h5.5L12 22z" />
                      </svg>
                    )}
                    {arrowDir === "up" && (
                      <svg
                        viewBox="0 0 24 24"
                        style={{ width: "24px", height: "24px", fill: "#16a34a", display: "inline-block", flexShrink: 0 }}
                      >
                        <path d="M12 2l8.5 9.5h-5.5V22h-6V11.5H3.5L12 2z" />
                      </svg>
                    )}
                  </div>

                  {/* Bottom: Barcode in Inner Box */}
                  <div className="w-full flex items-center justify-center">
                    <div className="w-full max-w-[84mm] bg-white rounded-xl border border-slate-400/90 px-3 py-1.5 flex items-center justify-center">
                      <BarcodeSvg
                        value={item.location_code}
                        width={2.4}
                        height={46}
                        showText={false}
                        disableZoom={true}
                        className="border-0 p-0 shadow-none bg-transparent w-full"
                      />
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Empty slots to preserve 3x3 grid on the last page */}
            {pageItems.length < 9 &&
              Array.from({ length: 9 - pageItems.length }).map((_, emptyIdx) => (
                <div key={`empty-slot-${emptyIdx}`} className="sticker-slot opacity-0 pointer-events-none" />
              ))}
          </div>
        ))}
      </div>
    </>
  );
}

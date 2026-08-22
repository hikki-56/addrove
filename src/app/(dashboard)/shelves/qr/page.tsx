"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import type { Location, Warehouse } from "@/types/models";
import { getDefaultLocationsForWarehouse, getWarehouseName } from "@/lib/warehouse-utils";
import BarcodeSvg from "@/components/ui/BarcodeSvg";
import {
  generateCode128PngDataUrl,
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
  qr_data_url?: string;
  barcode_data_url?: string;
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

export default function ShelfQrPage() {
  const [selectedWh, setSelectedWh] = useState<string>("ALL");
  const [selectedLevel, setSelectedLevel] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [displayFormat, setDisplayFormat] = useState<"barcode" | "qr">("barcode");
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

        // Fallback default locations for all 5 warehouses if database has fewer
        if (allLocs.length === 0) {
          for (const wh of WAREHOUSES) {
            const defaults = getDefaultLocationsForWarehouse(wh.id);
            allLocs.push(...defaults);
          }
        }

        // Build Shelf items & Generate Barcode & QR Codes
        const items: ShelfQrItem[] = [];
        for (const loc of allLocs) {
          const whName = getWarehouseName(loc.warehouse_id);
          const shelfName = (loc as any).shelf_name || `ชั้นวาง ${loc.location_code}`;
          const levelName = (loc as any).shelf_level
            ? `ชั้นที่ ${(loc as any).shelf_level}`
            : extractShelfLevel(loc.location_code, shelfName);

          const codeValue = loc.location_code || loc.location_id;

          let qrDataUrl = "";
          try {
            qrDataUrl = await QRCode.toDataURL(codeValue, {
              width: 320,
              margin: 2,
              color: {
                dark: "#0f172a",
                light: "#ffffff",
              },
            });
          } catch (e) {
            console.error("Failed to generate QR code for location:", loc.location_code, e);
          }

          const barcodeDataUrl = generateShelfBarcodeStickerDataUrl(codeValue);

          items.push({
            location_id: loc.location_id,
            location_code: loc.location_code,
            shelf_name: shelfName,
            warehouse_id: loc.warehouse_id,
            warehouse_name: whName,
            level_name: levelName,
            qr_data_url: qrDataUrl,
            barcode_data_url: barcodeDataUrl,
          });
        }

        setShelfItems(items);
      } catch (err) {
        console.error("Load shelf locations error:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchLocations();
  }, []);

  // Filter items by Warehouse first
  const whFilteredItems = shelfItems.filter(
    (item) => selectedWh === "ALL" || item.warehouse_id === selectedWh
  );

  // Dynamic Levels available for current warehouse selection (Sorted numerically: ชั้นที่ 1, ชั้นที่ 2...)
  const availableLevels = Array.from(new Set(whFilteredItems.map((i) => i.level_name))).sort((a, b) => {
    const numA = parseInt(a.replace(/\D/g, ""), 10) || 999;
    const numB = parseInt(b.replace(/\D/g, ""), 10) || 999;
    return numA - numB;
  });

  // Final Filter by Level and Search Query
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

  // Group items by Level
  const groupedByLevel = availableLevels.map((lvl) => ({
    levelName: lvl,
    items: filteredItems.filter((i) => i.level_name === lvl),
  })).filter((group) => group.items.length > 0);

  // Group filtered items into chunks of 9 for A4 3x3 sticker sheet printing
  const stickerPages: ShelfQrItem[][] = [];
  for (let i = 0; i < filteredItems.length; i += 9) {
    stickerPages.push(filteredItems.slice(i, i + 9));
  }

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadSingle = (item: ShelfQrItem) => {
    if (displayFormat === "barcode") {
      const dataUrl = item.barcode_data_url || generateShelfBarcodeStickerDataUrl(item.location_code);
      if (!dataUrl) return;
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `บาร์โค้ด-ชั้นวาง-${item.warehouse_name}-${item.location_code}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } else {
      if (!item.qr_data_url) return;
      const a = document.createElement("a");
      a.href = item.qr_data_url;
      a.download = `QR-ชั้นวาง-${item.warehouse_name}-${item.location_code}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  const renderItemCard = (item: ShelfQrItem, idx: number) => {
    const arrowDir = getShelfArrowDirection(item.location_code);

    return (
      <div
        key={`${item.warehouse_id}-${item.location_id}-${item.location_code}-${idx}`}
        onClick={() => handleDownloadSingle(item)}
        title="คลิกเพื่อดาวน์โหลดรูปภาพบาร์โค้ด"
        className="bg-white rounded-3xl p-6 sm:p-7 text-slate-900 border border-slate-200 shadow-md flex flex-col items-center justify-center gap-3.5 text-center relative overflow-hidden transition-all hover:scale-[1.01] hover:border-emerald-500 hover:shadow-xl cursor-pointer"
      >
        {/* Location Code (On Top of Barcode) with Bold Green Arrows on BOTH Sides */}
        <h2 className="text-5xl sm:text-6xl font-black text-slate-900 tracking-wider font-mono select-none flex items-center justify-center gap-3 sm:gap-4 flex-wrap">
          {arrowDir === "down" && (
            <svg className="w-8 h-8 sm:w-11 sm:h-11 text-emerald-600 inline-block shrink-0 fill-current" viewBox="0 0 24 24" aria-label="A: ชี้ลง">
              <path d="M12 22l-8.5-9.5h5.5V2h6v10.5h5.5L12 22z" />
            </svg>
          )}
          {arrowDir === "up" && (
            <svg className="w-8 h-8 sm:w-11 sm:h-11 text-emerald-600 inline-block shrink-0 fill-current" viewBox="0 0 24 24" aria-label="B: ชี้ขึ้น">
              <path d="M12 2l8.5 9.5h-5.5V22h-6V11.5H3.5L12 2z" />
            </svg>
          )}

          <span>{item.location_code}</span>

          {arrowDir === "down" && (
            <svg className="w-8 h-8 sm:w-11 sm:h-11 text-emerald-600 inline-block shrink-0 fill-current" viewBox="0 0 24 24" aria-label="A: ชี้ลง">
              <path d="M12 22l-8.5-9.5h5.5V2h6v10.5h5.5L12 22z" />
            </svg>
          )}
          {arrowDir === "up" && (
            <svg className="w-8 h-8 sm:w-11 sm:h-11 text-emerald-600 inline-block shrink-0 fill-current" viewBox="0 0 24 24" aria-label="B: ชี้ขึ้น">
              <path d="M12 2l8.5 9.5h-5.5V22h-6V11.5H3.5L12 2z" />
            </svg>
          )}
        </h2>

      {/* Barcode Inner Box (Matching sticker mockup with clean border) */}
      <div className="w-full flex items-center justify-center">
        {displayFormat === "barcode" ? (
          <div className="w-full max-w-[380px] sm:max-w-[420px] bg-white rounded-2xl border border-slate-300 px-4 py-3 sm:px-5 sm:py-3.5 flex items-center justify-center shadow-2xs">
            <BarcodeSvg
              value={item.location_code}
              width={2.8}
              height={82}
              showText={false}
              className="border-0 p-0 shadow-none bg-transparent w-full"
            />
          </div>
        ) : item.qr_data_url ? (
          <div className="w-full max-w-[380px] sm:max-w-[420px] bg-white rounded-2xl border border-slate-300 p-4 flex items-center justify-center shadow-2xs">
            <img
              src={item.qr_data_url}
              alt={`QR ${item.location_code}`}
              className="w-28 h-28 sm:w-36 sm:h-36 object-contain"
            />
          </div>
        ) : (
          <div className="w-28 h-28 flex items-center justify-center text-xs text-slate-400">
            กำลังสร้างรหัส...
          </div>
        )}
      </div>
    </div>
  );
};

  const totalStickerPages = stickerPages.length;

  return (
    <>
      {/* ======================================================== */}
      {/* Screen View (Interactive Dashboard)                      */}
      {/* ======================================================== */}
      <div className="max-w-6xl mx-auto space-y-6 w-full max-w-full pb-12 print:hidden">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/[0.08] pb-5">
          <div>
            <h1 className="text-xl font-bold text-slate-100 tracking-tight flex items-center gap-2">
              <svg className="w-6 h-6 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              <span>บาร์โค้ดชั้นวางสินค้า (แบ่งตามระดับชั้นและโกดัง)</span>
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              พิมพ์ป้ายบาร์โค้ดจัดลงกระดาษสติกเกอร์ A4 แนวนอน 9 ช่อง (3×3) รวมทั้งหมด {filteredItems.length} ตำแหน่ง ({totalStickerPages} หน้ากระดาษ)
            </p>
          </div>

          <button
            onClick={handlePrint}
            className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm transition-all shadow-lg shadow-emerald-900/30 flex items-center justify-center gap-2 shrink-0 cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            <span>พิมพ์ป้ายบาร์โค้ดทั้งหมด ({filteredItems.length} ตำแหน่ง • {totalStickerPages} แผ่น A4)</span>
          </button>
        </div>

        {/* Filter and Search Bar */}
        <div className="glass-card rounded-2xl p-4 space-y-4">
          <div className="flex flex-col gap-3">
            {/* Row 1: Warehouse Selector Tabs & Format Selector */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 lg:pb-0 scrollbar-none">
                <button
                  onClick={() => {
                    setSelectedWh("ALL");
                    setSelectedLevel("ALL");
                  }}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all shrink-0 cursor-pointer ${
                    selectedWh === "ALL"
                      ? "bg-emerald-500 text-white shadow-md shadow-emerald-500/20"
                      : "bg-white/[0.04] text-slate-400 hover:bg-white/[0.08] hover:text-slate-200 border border-white/[0.08]"
                  }`}
                >
                  โกดังทั้งหมด ({shelfItems.length})
                </button>
                {WAREHOUSES.map((wh) => {
                  const count = shelfItems.filter((i) => i.warehouse_id === wh.id).length;
                  return (
                    <button
                      key={wh.id}
                      onClick={() => {
                        setSelectedWh(wh.id);
                        setSelectedLevel("ALL");
                      }}
                      className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all shrink-0 cursor-pointer ${
                        selectedWh === wh.id
                          ? "bg-emerald-500 text-white shadow-md shadow-emerald-500/20"
                          : "bg-white/[0.04] text-slate-400 hover:bg-white/[0.08] hover:text-slate-200 border border-white/[0.08]"
                      }`}
                    >
                      {wh.name} ({count})
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                {/* Display Format Toggle (Barcode vs QR) */}
                <div className="flex items-center bg-white/[0.04] p-1 rounded-xl border border-white/[0.08] shrink-0">
                  <button
                    type="button"
                    onClick={() => setDisplayFormat("barcode")}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                      displayFormat === "barcode"
                        ? "bg-emerald-500 text-white shadow-sm"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                    title="แสดงในรูปแบบบาร์โค้ดสินค้า (Code 128)"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h2v12H4zm4 0h1v12H8zm3 0h2v12h-2zm4 0h1v12h-1zm3 0h2v12h-2z" />
                    </svg>
                    <span>บาร์โค้ดสินค้า</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDisplayFormat("qr")}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                      displayFormat === "qr"
                        ? "bg-emerald-500 text-white shadow-sm"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                    title="แสดงในรูปแบบ QR Code"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                    </svg>
                    <span>QR Code</span>
                  </button>
                </div>

                {/* Search Box */}
                <div className="relative min-w-[200px] flex-1 sm:flex-initial">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="ค้นหารหัสชั้นวาง, ระดับชั้น..."
                    className="w-full pl-9 pr-4 py-1.5 rounded-xl bg-white/[0.05] border border-white/[0.09] text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/50 text-xs transition-all"
                  />
                  <svg className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
              </div>
            </div>

            {/* Row 2: Shelf Level / Tier Filter Pills */}
            {availableLevels.length > 0 && (
              <div className="pt-2 border-t border-white/[0.06] flex items-center gap-2 overflow-x-auto scrollbar-none">
                <span className="text-xs font-medium text-amber-400/90 shrink-0 flex items-center gap-1">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                  </svg>
                  แบ่งตามชั้นวาง:
                </span>
                <button
                  onClick={() => setSelectedLevel("ALL")}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-all shrink-0 cursor-pointer ${
                    selectedLevel === "ALL"
                      ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                      : "bg-white/[0.03] text-slate-400 hover:text-slate-200 border border-white/[0.06]"
                  }`}
                >
                  ทุกชั้น ({whFilteredItems.length})
                </button>
                {availableLevels.map((lvl) => {
                  const count = whFilteredItems.filter((i) => i.level_name === lvl).length;
                  return (
                    <button
                      key={lvl}
                      onClick={() => setSelectedLevel(lvl)}
                      className={`px-3 py-1 rounded-lg text-xs font-medium transition-all shrink-0 cursor-pointer ${
                        selectedLevel === lvl
                          ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                          : "bg-white/[0.03] text-slate-400 hover:text-slate-200 border border-white/[0.06]"
                      }`}
                    >
                      {lvl} ({count})
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="text-center py-16 text-slate-400 text-sm animate-pulse">
            กำลังโหลดบาร์โค้ดชั้นวางสินค้า...
          </div>
        )}

        {/* Empty State */}
        {!loading && filteredItems.length === 0 && (
          <div className="glass-card rounded-2xl p-12 text-center text-slate-400 text-sm">
            ไม่พบข้อมูลชั้นวางสินค้าตามเงื่อนไขที่เลือก
          </div>
        )}

        {/* Grouped by Level View */}
        {!loading && filteredItems.length > 0 && (
          <div className="space-y-8">
            {groupedByLevel.map((group) => (
              <div key={group.levelName} className="space-y-4">
                <div className="flex items-center gap-2 border-b border-white/10 pb-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-amber-400 shrink-0" />
                  <h3 className="text-base font-bold text-amber-300">
                    {group.levelName} ({group.items.length} ตำแหน่ง)
                  </h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {group.items.map((item, idx) => renderItemCard(item, idx))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ======================================================== */}
      {/* Dedicated A4 Landscape 9-Sticker Sheet Print View (3x3)   */}
      {/* ======================================================== */}
      <div id="print-sticker-container" className="hidden print:block print:w-full print:m-0 print:p-0">
        <style dangerouslySetInnerHTML={{ __html: `
          @media print {
            @page {
              size: A4 landscape;
              margin: 6mm 8mm;
            }
            html, body {
              height: auto !important;
              min-height: 100% !important;
              overflow: visible !important;
              background: #ffffff !important;
              color: #000000 !important;
              margin: 0 !important;
              padding: 0 !important;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            /* Override Next.js layout scroll & fixed containers */
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
                  {/* Top: Location Code Title - Super Extra Large & Bold with Bold Green Arrows on Both Sides */}
                  <div
                    className="font-mono font-black text-slate-900 tracking-wider leading-none mb-2 select-none flex items-center justify-center gap-2.5"
                    style={{ fontSize: "46px", fontWeight: 900 }}
                  >
                    {arrowDir === "down" && (
                      <svg
                        viewBox="0 0 24 24"
                        style={{ width: "34px", height: "34px", fill: "#16a34a", display: "inline-block", flexShrink: 0 }}
                      >
                        <path d="M12 22l-8.5-9.5h5.5V2h6v10.5h5.5L12 22z" />
                      </svg>
                    )}
                    {arrowDir === "up" && (
                      <svg
                        viewBox="0 0 24 24"
                        style={{ width: "34px", height: "34px", fill: "#16a34a", display: "inline-block", flexShrink: 0 }}
                      >
                        <path d="M12 2l8.5 9.5h-5.5V22h-6V11.5H3.5L12 2z" />
                      </svg>
                    )}

                    <span>{item.location_code}</span>

                    {arrowDir === "down" && (
                      <svg
                        viewBox="0 0 24 24"
                        style={{ width: "34px", height: "34px", fill: "#16a34a", display: "inline-block", flexShrink: 0 }}
                      >
                        <path d="M12 22l-8.5-9.5h5.5V2h6v10.5h5.5L12 22z" />
                      </svg>
                    )}
                    {arrowDir === "up" && (
                      <svg
                        viewBox="0 0 24 24"
                        style={{ width: "34px", height: "34px", fill: "#16a34a", display: "inline-block", flexShrink: 0 }}
                      >
                        <path d="M12 2l8.5 9.5h-5.5V22h-6V11.5H3.5L12 2z" />
                      </svg>
                    )}
                  </div>

                  {/* Bottom: Barcode / QR in Inner Box */}
                  <div className="w-full flex items-center justify-center">
                    {displayFormat === "barcode" ? (
                      <div className="w-full max-w-[84mm] bg-white rounded-xl border border-slate-400/90 px-3 py-1 flex items-center justify-center">
                        <BarcodeSvg
                          value={item.location_code}
                          width={2.4}
                          height={46}
                          showText={false}
                          className="border-0 p-0 shadow-none bg-transparent w-full"
                        />
                      </div>
                    ) : item.qr_data_url ? (
                      <div className="w-full max-w-[84mm] bg-white rounded-xl border border-slate-400/90 p-1 flex items-center justify-center">
                        <img
                          src={item.qr_data_url}
                          alt={`QR ${item.location_code}`}
                          className="w-12 h-12 object-contain"
                        />
                      </div>
                    ) : (
                      <div className="w-14 h-14 flex items-center justify-center text-[10px] text-slate-400">
                        ...
                      </div>
                    )}
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


"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import type { Location, Warehouse } from "@/types/models";
import { getDefaultLocationsForWarehouse, getWarehouseName } from "@/lib/warehouse-utils";

interface ShelfQrItem {
  location_id: string;
  location_code: string;
  shelf_name: string;
  warehouse_id: string;
  warehouse_name: string;
  level_name: string;
  qr_data_url?: string;
}

const WAREHOUSES = [
  { id: "wh-01", name: "โกดัง1" },
  { id: "wh-02", name: "โกดัง2" },
  { id: "wh-03", name: "โกดัง3" },
  { id: "wh-04", name: "โกดัง4" },
  { id: "wh-05", name: "โกดัง5" },
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

        // Build Shelf QR items & Generate QR Codes
        const items: ShelfQrItem[] = [];
        for (const loc of allLocs) {
          const whName = getWarehouseName(loc.warehouse_id);
          const shelfName = (loc as any).shelf_name || `ชั้นวาง ${loc.location_code}`;
          const levelName = (loc as any).shelf_level
            ? `ชั้นที่ ${(loc as any).shelf_level}`
            : extractShelfLevel(loc.location_code, shelfName);

          // Code encoded inside QR for barcode scanner
          const qrCodeValue = loc.location_code || loc.location_id;

          let dataUrl = "";
          try {
            dataUrl = await QRCode.toDataURL(qrCodeValue, {
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

          items.push({
            location_id: loc.location_id,
            location_code: loc.location_code,
            shelf_name: shelfName,
            warehouse_id: loc.warehouse_id,
            warehouse_name: whName,
            level_name: levelName,
            qr_data_url: dataUrl,
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

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadSingle = (item: ShelfQrItem) => {
    if (!item.qr_data_url) return;
    const a = document.createElement("a");
    a.href = item.qr_data_url;
    a.download = `QR-ชั้นวาง-${item.warehouse_name}-${item.location_code}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const renderItemCard = (item: ShelfQrItem, idx: number) => (
    <div
      key={`${item.warehouse_id}-${item.location_id}-${item.location_code}-${idx}`}
      className="bg-white rounded-2xl p-6 text-slate-900 border border-slate-200 shadow-xl flex flex-col items-center justify-between text-center relative overflow-hidden transition-all hover:scale-[1.01] print:shadow-none print:border-slate-300 print:break-inside-avoid"
    >
      {/* Header Badge */}
      <div className="w-full flex items-center justify-between border-b border-slate-200 pb-3 mb-4">
        <span className="px-2.5 py-1 rounded-md bg-indigo-50 text-indigo-700 font-bold text-xs border border-indigo-200">
          {item.warehouse_name}
        </span>
        <span className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 font-bold text-[11px] border border-amber-200">
          {item.level_name}
        </span>
      </div>

      {/* Shelf Title & Code */}
      <div className="mb-3">
        <h2 className="text-2xl font-black text-slate-900 tracking-tight font-mono">
          {item.location_code}
        </h2>
        <p className="text-xs text-slate-600 font-medium mt-0.5">{item.shelf_name}</p>
      </div>

      {/* Printable QR Code Container */}
      <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 mb-4 shadow-inner flex items-center justify-center">
        {item.qr_data_url ? (
          <img
            src={item.qr_data_url}
            alt={`QR ${item.location_code}`}
            className="w-48 h-48 object-contain"
          />
        ) : (
          <div className="w-48 h-48 flex items-center justify-center text-xs text-slate-400">
            กำลังสร้าง QR...
          </div>
        )}
      </div>

      {/* Scannable Indicator */}
      <div className="mb-4">
        <span className="text-[11px] font-mono font-semibold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200">
          สแกนตำแหน่ง: {item.location_code}
        </span>
      </div>

      {/* Card Actions (Hidden when printing) */}
      <div className="w-full grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 print:hidden">
        <button
          onClick={() => handleDownloadSingle(item)}
          className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-all flex items-center justify-center gap-1 cursor-pointer"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          <span>โหลด PNG</span>
        </button>
        <button
          onClick={handlePrint}
          className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-all flex items-center justify-center gap-1 cursor-pointer"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
          </svg>
          <span>พิมพ์ป้าย</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto space-y-6 w-full max-w-full pb-12">
      {/* Page Header (Hidden when printing) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/[0.08] pb-5 print:hidden">
        <div>
          <h1 className="text-xl font-bold text-slate-100 tracking-tight flex items-center gap-2">
            <svg className="w-6 h-6 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <span>QR Code ชั้นวางสินค้า (แบ่งตามระดับชั้นและโกดัง)</span>
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            พิมพ์ป้าย QR Code ประจำชั้นวางสินค้าแยกเป็นชั้นๆ เพื่อนำไปติดหน้าชั้นวาง (พนักงานสามารถสแกนเพื่อจัดตำแหน่งได้ทันที)
          </p>
        </div>

        <button
          onClick={handlePrint}
          className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm transition-all shadow-lg shadow-emerald-900/30 flex items-center justify-center gap-2 shrink-0 cursor-pointer"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
          </svg>
          <span>พิมพ์ป้าย QR Code ทั้งหมด</span>
        </button>
      </div>

      {/* Filter and Search Bar (Hidden when printing) */}
      <div className="glass-card rounded-2xl p-4 space-y-4 print:hidden">
        <div className="flex flex-col gap-3">
          {/* Row 1: Warehouse Selector Tabs */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
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

            {/* Search Box */}
            <div className="relative min-w-[220px]">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ค้นหารหัสชั้นวาง, ระดับชั้น..."
                className="w-full pl-9 pr-4 py-2 rounded-xl bg-white/[0.05] border border-white/[0.09] text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/50 text-xs transition-all"
              />
              <svg className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>

          {/* Row 2: Shelf Level / Tier Filter Pills (การแบ่งเป็นชั้นๆ) */}
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
          กำลังโหลด QR Code ชั้นวางสินค้า...
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
              <div className="flex items-center gap-2 border-b border-white/10 pb-2 print:border-slate-300">
                <div className="w-2.5 h-2.5 rounded-full bg-amber-400 shrink-0" />
                <h3 className="text-base font-bold text-amber-300 print:text-slate-900">
                  {group.levelName} ({group.items.length} ตำแหน่ง)
                </h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 print:grid-cols-2 print:gap-4">
                {group.items.map((item, idx) => renderItemCard(item, idx))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

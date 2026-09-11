"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import Link from "next/link";
import {
  getWarehouseQrProductionOrigin,
  resolveWarehouseQrBaseUrl,
  toChromeIntentUrl,
} from "./_lib/warehouse-qr-url";

interface WarehouseItem {
  id: string;
  code: string;
  name: string;
  desc: string;
}

const WAREHOUSES: WarehouseItem[] = [
  { id: "wh-01", code: "WH-01", name: "โกดัง1", desc: "คลังสินค้าหลัก 1" },
  { id: "wh-02", code: "WH-02", name: "โกดัง2", desc: "คลังสินค้าหลัก 2" },
  { id: "wh-03", code: "WH-03", name: "โกดัง3", desc: "คลังสินค้าหลัก 3" },
  { id: "wh-04", code: "WH-04", name: "โกดัง4", desc: "คลังสินค้าหลัก 4" },
  { id: "wh-05", code: "WH-05", name: "โกดัง5", desc: "คลังสินค้าหลัก 5" },
  { id: "wh-06", code: "WH-06", name: "สำนักงานใหญ่", desc: "สำนักงานใหญ่" },
];

const ACTIONS = [
  { id: "receive", label: "รับสินค้าเข้า", path: "/movements/receive" },
];

type WarehouseQrPrintMode = "poster" | "grid";

// Sticker-sheet layout: 3x3 grid = 9 labels per A4 page,
// each warehouse QR repeated QR_COPIES_PER_WAREHOUSE times ("ละ 3 ชุด")
const QR_GRID_COLUMNS = 3;
const QR_GRID_ROWS = 3;
const QR_COPIES_PER_WAREHOUSE = 3;

export default function WarehouseQrPage() {
  const [selectedAction, setSelectedAction] = useState("receive");
  const [qrUrls, setQrUrls] = useState<Record<string, string>>({});
  const [baseUrl, setBaseUrl] = useState(getWarehouseQrProductionOrigin());
  const [wifiIp, setWifiIp] = useState("192.168.1.54");
  // Default OFF: intent:// QR สแกนไม่ได้บน iPhone/กล้องบางรุ่น/LINE scanner
  // QR แบบ https ตรงเปิดได้ทุกอุปกรณ์ เปิด toggle นี้เฉพาะเมื่อพนักงานใช้ Android + Chrome เท่านั้น
  const [forceChrome, setForceChrome] = useState(false);
  const [printMode, setPrintMode] = useState<WarehouseQrPrintMode | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const origin = window.location.origin;
      if (
        origin.includes("localhost") ||
        origin.includes("127.0.0.1") ||
        origin.includes("0.0.0.0") ||
        origin.endsWith(".vercel.app")
      ) {
        setBaseUrl(getWarehouseQrProductionOrigin());
      } else {
        setBaseUrl(resolveWarehouseQrBaseUrl(origin));
      }
      try {
        setForceChrome(window.localStorage.getItem("warehouseQrForceChrome") === "true");
      } catch {}
    }
    // Auto-detect server Wi-Fi IP
    fetch("/api/system/ip")
      .then((res) => res.json())
      .then((data) => {
        if (data.ip) {
          setWifiIp(data.ip);
        }
      })
      .catch(() => {});
  }, []);

  const actionObj = ACTIONS.find((a) => a.id === selectedAction) || ACTIONS[0];
  const qrBaseUrl = resolveWarehouseQrBaseUrl(baseUrl);

  // Check if current URL setting is a private Wi-Fi IP subnet
  const isLocalOrWifi =
    qrBaseUrl.includes("192.168.") ||
    qrBaseUrl.includes("10.") ||
    qrBaseUrl.includes("172.");

  useEffect(() => {
    if (!qrBaseUrl) return;

    const generateQrs = async () => {
      const urls: Record<string, string> = {};
      for (const wh of WAREHOUSES) {
        const targetPath = `${actionObj.path}?warehouse_id=${wh.id}`;
        
        // Wi-Fi / Local Mode -> Full URL directly
        // Production Mode -> Short URL /w/wh-xx
        const fullTargetUrl = isLocalOrWifi
          ? `${qrBaseUrl}/employee-login?warehouse_id=${wh.id}&callbackUrl=${encodeURIComponent(targetPath)}`
          : `${qrBaseUrl}/w/${wh.id}`;

        try {
          // บังคับเปิดใน Chrome: ฝัง Android Intent URL แทน https ตรงๆ
          // (สแกนด้วยกล้อง Android ส่วนใหญ่/Google Lens จะเปิดใน Chrome แม้ default ไม่ใช่ Chrome)
          const qrContent = forceChrome
            ? toChromeIntentUrl(fullTargetUrl)
            : fullTargetUrl;

          const dataUrl = await QRCode.toDataURL(qrContent, {
            width: 320,
            margin: 2,
            color: {
              dark: "#0f172a",
              light: "#ffffff",
            },
          });
          urls[wh.id] = dataUrl;
        } catch (e) {
          console.error("Failed to generate QR for", wh.id, e);
        }
      }
      setQrUrls(urls);
    };

    generateQrs();
  }, [qrBaseUrl, actionObj, isLocalOrWifi, forceChrome]);

  const qrGridCells = WAREHOUSES.flatMap((wh) =>
    Array.from({ length: QR_COPIES_PER_WAREHOUSE }, () => wh)
  );
  const qrGridPageSize = QR_GRID_COLUMNS * QR_GRID_ROWS;
  const qrGridPages: WarehouseItem[][] = [];
  for (let i = 0; i < qrGridCells.length; i += qrGridPageSize) {
    qrGridPages.push(qrGridCells.slice(i, i + qrGridPageSize));
  }

  useEffect(() => {
    if (!printMode) return;
    const resetMode = () => setPrintMode(null);
    window.addEventListener("afterprint", resetMode);
    const timer = setTimeout(() => {
      window.print();
      resetMode();
    }, 100);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("afterprint", resetMode);
    };
  }, [printMode]);

  const handlePrint = (mode: WarehouseQrPrintMode) => setPrintMode(mode);

  const handleDownloadSingle = (wh: WarehouseItem) => {
    const dataUrl = qrUrls[wh.id];
    if (!dataUrl) return;
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `QR-${wh.name}-${selectedAction}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <>
      {/* ======================================================== */}
      {/* Screen View (Interactive Dashboard)                      */}
      {/* ======================================================== */}
      <div className="max-w-6xl mx-auto space-y-6 w-full max-w-full pb-12 print:hidden">
        {/* Expired Token Notice Banner */}
        {typeof window !== "undefined" && new URLSearchParams(window.location.search).get("expired") === "true" && (
          <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm flex items-center gap-3 shadow-lg shadow-rose-950/20 print:hidden animate-pulse">
            <div className="w-9 h-9 rounded-xl bg-rose-500/20 flex items-center justify-center text-rose-400 shrink-0">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <p className="font-bold text-slate-100">⏰ โทเคนการเข้าใช้งานหมดอายุ</p>
              <p className="text-xs text-rose-300/80">กรุณาสแกน QR Code ประจำโกดังด้านล่างนี้เพื่อสลับเข้าสู่ระบบและเริ่มทำรายการใหม่</p>
            </div>
          </div>
        )}

        {/* Page Actions (Hidden when printing) */}
        <div className="flex items-center gap-2 flex-wrap justify-end pb-1">
          <button
            onClick={() => handlePrint("grid")}
            className="px-4 py-2.5 rounded-xl bg-[#06402B] hover:bg-[#053425] text-white font-bold text-xs sm:text-sm flex items-center gap-2 transition-colors cursor-pointer shadow-md shadow-[#06402B]/20 active:scale-95"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            <span>พิมพ์ QR 3×3 (ละ 3 ชุด)</span>
          </button>
          <button
            onClick={() => handlePrint("poster")}
            className="px-4 py-2.5 rounded-xl bg-white hover:bg-slate-50 border border-[#D5DDD9] text-slate-700 hover:text-slate-900 font-bold text-xs sm:text-sm flex items-center gap-2 transition-colors cursor-pointer shadow-xs active:scale-95"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h10M4 18h10" />
            </svg>
            <span>พิมพ์โปสเตอร์ (โกดังละหน้า)</span>
          </button>
        </div>

        {/* Target Action & Base URL Selector (Hidden when printing) */}
        <div className="bg-white rounded-2xl p-5 border border-[#E8ECEA] shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 p-3.5 rounded-xl border border-[#E8ECEA]">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#0F5C3F] animate-ping" />
              <span className="text-xs text-slate-700 font-semibold">Domain / IP Address สำหรับมือถือสแกน:</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                onBlur={() => setBaseUrl(resolveWarehouseQrBaseUrl(baseUrl))}
                className="px-3 py-1.5 rounded-lg bg-white border border-[#E8ECEA] text-slate-900 font-mono text-xs font-bold focus:outline-none focus:border-[#0F5C3F] w-64 shadow-2xs"
              />
              <button
                type="button"
                onClick={() => setBaseUrl(`http://${wifiIp}:3000`)}
                className="px-2.5 py-1.5 rounded-lg bg-[#EAF2EE] hover:bg-[#DFEDE6] text-[#053425] text-xs font-bold border border-[#C9DFD4] transition-colors cursor-pointer active:scale-95"
              >
                ใช้ Wi-Fi IP ({wifiIp})
              </button>
              <button
                type="button"
                onClick={() => setBaseUrl(getWarehouseQrProductionOrigin())}
                className="px-2.5 py-1.5 rounded-lg bg-[#EAF2EE] hover:bg-[#DFEDE6] text-[#053425] text-xs font-bold border border-[#C9DFD4] transition-colors cursor-pointer active:scale-95"
              >
                ใช้ URL Production
              </button>
            </div>
          </div>

          {/* Force Chrome Toggle */}
          <label className="flex items-center justify-between gap-3 bg-slate-50 p-3.5 rounded-xl border border-[#E8ECEA] cursor-pointer select-none">
            <span className="flex flex-col gap-0.5">
              <span className="text-xs text-slate-700 font-semibold flex items-center gap-1.5">
                <svg className="w-4 h-4 text-[#06402B] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                บังคับเปิดด้วย Chrome (Android เท่านั้น)
              </span>
              <span className="text-[11px] text-slate-500 leading-relaxed">
                แนะนำให้ปิดไว้ — QR แบบ https ตรงสแกนได้ทุกอุปกรณ์ (iPhone, กล้อง Android ทุกรุ่น, LINE scanner)
                เมื่อเปิด QR จะฝัง Android Intent URL ซึ่ง iPhone และแอปสแกนบางตัว "สแกนแล้วไม่เปิด" — ใช้เฉพาะเมื่อพนักงานใช้ Android ทุกคน
              </span>
            </span>
            <input
              type="checkbox"
              checked={forceChrome}
              onChange={(e) => {
                setForceChrome(e.target.checked);
                try {
                  window.localStorage.setItem("warehouseQrForceChrome", String(e.target.checked));
                } catch {}
              }}
              className="w-4.5 h-4.5 shrink-0 accent-[#06402B] cursor-pointer"
              aria-label="บังคับเปิดด้วย Chrome บน Android"
            />
          </label>

          {ACTIONS.length > 1 && (
            <div className="space-y-2">
              <div className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                เลือกหน้าที่ต้องการเปิดเมื่อสแกน QR Code:
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {ACTIONS.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => setSelectedAction(action.id)}
                    className={`p-3 rounded-xl border text-xs font-bold transition-all text-left flex items-center justify-between cursor-pointer ${
                      selectedAction === action.id
                        ? "bg-[#EAF2EE] border-[#8FB3A3] text-[#053425] shadow-xs"
                        : "bg-white border-[#E8ECEA] text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                    }`}
                  >
                    <span>{action.label}</span>
                    {selectedAction === action.id && (
                      <span className="w-2 h-2 rounded-full bg-[#06402B] animate-pulse" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 5 Warehouse QR Cards Display */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {WAREHOUSES.map((wh) => {
            const qrDataUrl = qrUrls[wh.id];
            const targetPath = `${actionObj.path}?warehouse_id=${wh.id}`;

            const fullTargetUrl = isLocalOrWifi
              ? `${qrBaseUrl}/employee-login?warehouse_id=${wh.id}&callbackUrl=${encodeURIComponent(targetPath)}`
              : `${qrBaseUrl}/w/${wh.id}`;

            return (
              <div
                key={wh.id}
                className="bg-white rounded-2xl p-6 border border-[#E8ECEA] flex flex-col items-center justify-between text-center space-y-4 shadow-xs hover:border-[#5B8A74] hover:shadow-md transition-all"
              >
                {/* Card Header */}
                <div className="space-y-1 w-full border-b border-[#EEF1EF] pb-3">
                  <span className="inline-block px-3 py-1 rounded-full text-xs font-bold bg-[#DFEDE6] text-[#053425] border border-[#C9DFD4]">
                    {wh.code}
                  </span>
                  <h2 className="text-xl font-bold text-slate-900 mt-1">{wh.name}</h2>
                  <p className="text-xs text-slate-500 font-medium">{wh.desc}</p>
                </div>

                {/* QR Code Container */}
                <div className="bg-white p-4 rounded-2xl border border-[#E8ECEA] shadow-xs flex items-center justify-center min-h-[200px] min-w-[200px]">
                  {qrDataUrl ? (
                    <img src={qrDataUrl} alt={`QR ${wh.name}`} className="w-44 h-44 object-contain" />
                  ) : (
                    <div className="w-44 h-44 bg-slate-100 rounded flex items-center justify-center text-slate-400 text-xs">
                      กำลังสร้าง QR...
                    </div>
                  )}
                </div>

                {/* Action Description */}
                <div className="w-full text-center space-y-1">
                  <p className="text-xs sm:text-sm font-bold text-[#053425]">
                    สแกนเพื่อ: {actionObj.label} ({wh.name})
                    {forceChrome && (
                      <span className="ml-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[#EAF2EE] border border-[#C9DFD4] text-[#053425] text-[10px] font-bold align-middle">
                        เปิดใน Chrome
                      </span>
                    )}
                  </p>
                  <Link
                    href={fullTargetUrl}
                    target="_blank"
                    className="text-xs text-[#06402B] hover:underline font-mono truncate block px-2"
                  >
                    {fullTargetUrl}
                  </Link>
                </div>

                {/* Buttons (Hidden when printing) */}
                <div className="w-full pt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleDownloadSingle(wh)}
                    className="w-full py-2 rounded-xl bg-white hover:bg-slate-50 border border-[#E8ECEA] text-slate-700 hover:text-slate-900 text-xs font-bold transition-colors cursor-pointer shadow-xs active:scale-95"
                  >
                    ดาวน์โหลด PNG
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ======================================================== */}
      {/* Dedicated Warehouse Poster Print View (1 Page Per Wh)    */}
      {/* Rendered only when printing in "poster" mode             */}
      {/* ======================================================== */}
      {printMode === "poster" && (
      <div id="warehouse-print-container" className="hidden print:block print:w-full print:m-0 print:p-0">
        <style dangerouslySetInnerHTML={{ __html: `
          @media print {
            @page {
              size: A4 portrait;
              margin: 12mm 15mm;
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
            #warehouse-print-container {
              display: block !important;
              position: static !important;
              width: 100% !important;
              margin: 0 !important;
              padding: 0 !important;
            }
            .warehouse-print-page {
              width: 100% !important;
              max-width: 180mm !important;
              height: 260mm !important;
              max-height: 268mm !important;
              margin: 0 auto !important;
              display: flex !important;
              flex-direction: column !important;
              align-items: center !important;
              justify-content: center !important;
              gap: 16mm !important;
              page-break-after: always !important;
              break-after: page !important;
              page-break-inside: avoid !important;
              break-inside: avoid !important;
              box-sizing: border-box !important;
              padding: 8mm 5mm !important;
              text-align: center !important;
            }
            .warehouse-print-page:last-child {
              page-break-after: auto !important;
              break-after: auto !important;
            }
          }
        `}} />

        {WAREHOUSES.map((wh) => {
          const qrDataUrl = qrUrls[wh.id];

          return (
            <div key={`print-wh-${wh.id}`} className="warehouse-print-page">
              {/* Only 1: Warehouse Name - Extra Large & Bold */}
              <h1
                className="text-slate-900 font-black tracking-wider leading-none select-none"
                style={{ fontSize: "64px", fontWeight: 900 }}
              >
                {wh.name}
              </h1>

              {/* Only 2: QR Code - Large & Clean */}
              <div className="p-6 sm:p-8 bg-white rounded-3xl border-2 border-[#D5DDD9] shadow-sm flex items-center justify-center">
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt={`QR ${wh.name}`}
                    className="w-[145mm] h-[145mm] max-w-[540px] max-h-[540px] object-contain"
                  />
                ) : (
                  <div className="w-[145mm] h-[145mm] flex items-center justify-center text-slate-400 text-sm">
                    กำลังสร้าง QR Code...
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      )}

      {/* ======================================================== */}
      {/* 3x3 Sticker-Sheet Print View                             */}
      {/* 9 QR labels per A4 page, each warehouse x 3 sets         */}
      {/* ======================================================== */}
      {printMode === "grid" && (
        <div id="warehouse-grid-print-container" className="hidden print:block print:w-full print:m-0 print:p-0">
          <style dangerouslySetInnerHTML={{ __html: `
            @media print {
              @page {
                size: A4 portrait;
                margin: 10mm;
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
              #__next, main, .admin-shell, .flex, .flex-col, .overflow-hidden, .overflow-y-auto {
                height: auto !important;
                min-height: 0 !important;
                max-height: none !important;
                overflow: visible !important;
                display: block !important;
                position: static !important;
              }
              header, nav, aside, footer, .sidebar, .navbar {
                display: none !important;
              }
              #warehouse-grid-print-container {
                display: block !important;
                position: static !important;
                width: 100% !important;
                margin: 0 !important;
                padding: 0 !important;
              }
              .qr-grid-page {
                display: grid !important;
                grid-template-columns: repeat(3, 1fr) !important;
                grid-template-rows: repeat(3, 1fr) !important;
                width: 100% !important;
                height: 277mm !important;
                margin: 0 !important;
                padding: 0 !important;
                page-break-after: always !important;
                break-after: page !important;
              }
              .qr-grid-page:last-child {
                page-break-after: auto !important;
                break-after: auto !important;
              }
              .qr-grid-cell {
                display: flex !important;
                flex-direction: column !important;
                align-items: center !important;
                justify-content: center !important;
                gap: 3mm !important;
                text-align: center !important;
                box-sizing: border-box !important;
                padding: 2mm !important;
                border: 1px dashed #94a3b8 !important;
                break-inside: avoid !important;
                page-break-inside: avoid !important;
                overflow: hidden !important;
              }
              .qr-grid-cell img {
                width: 50mm !important;
                height: 50mm !important;
                max-width: 50mm !important;
                max-height: 50mm !important;
                object-fit: contain !important;
              }
            }
          `}} />

          {qrGridPages.map((pageWhs, pageIdx) => (
            <div key={`qr-grid-page-${pageIdx}`} className="qr-grid-page">
              {pageWhs.map((wh, cellIdx) => (
                <div key={`qr-grid-cell-${pageIdx}-${cellIdx}`} className="qr-grid-cell">
                  <div>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: "#4338ca", letterSpacing: "0.08em" }}>
                      {wh.code}
                    </div>
                    <div style={{ fontSize: "18px", fontWeight: 900, color: "#0f172a", lineHeight: 1.2, marginTop: "1mm" }}>
                      {wh.name}
                    </div>
                  </div>
                  {qrUrls[wh.id] ? (
                    <img src={qrUrls[wh.id]} alt={`QR ${wh.name}`} />
                  ) : (
                    <div
                      style={{
                        width: "50mm",
                        height: "50mm",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#94a3b8",
                        fontSize: "10px",
                      }}
                    >
                      กำลังสร้าง QR Code...
                    </div>
                  )}
                  <div style={{ fontSize: "10px", color: "#334155", fontWeight: 700 }}>
                    สแกนเพื่อ: {actionObj.label}
                  </div>
                  {forceChrome && (
                    <div style={{ fontSize: "8px", color: "#64748b", fontWeight: 600, letterSpacing: "0.04em" }}>
                      เปิดใน CHROME (ANDROID)
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import Link from "next/link";
import {
  getWarehouseQrProductionOrigin,
  resolveWarehouseQrBaseUrl,
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

export default function WarehouseQrPage() {
  const [selectedAction, setSelectedAction] = useState("receive");
  const [qrUrls, setQrUrls] = useState<Record<string, string>>({});
  const [baseUrl, setBaseUrl] = useState(getWarehouseQrProductionOrigin());
  const [wifiIp, setWifiIp] = useState("192.168.1.54");

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
          const dataUrl = await QRCode.toDataURL(fullTargetUrl, {
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
  }, [qrBaseUrl, actionObj, isLocalOrWifi]);

  const handlePrint = () => {
    window.print();
  };

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

        {/* Page Header (Hidden when printing) */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/[0.08] pb-5">
          <div>
            <h1 className="text-xl font-bold text-slate-100 tracking-tight flex items-center gap-2">
              <svg className="w-6 h-6 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
              </svg>
              <span>QR Code ประจำโกดัง (โกดัง 1 - 5)</span>
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              สแกนเพื่อเปิดหน้าล็อกอินพนักงาน (PIN) และสลับเข้าสู่ระบบโกดังที่เลือกโดยอัตโนมัติ (พิมพ์แบบ 1 โกดังต่อ 1 หน้า)
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs flex items-center gap-2 transition-colors cursor-pointer shadow-lg shadow-indigo-600/20"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              <span>พิมพ์ป้าย QR ทั้งหมด 5 โกดัง (โกดังละหน้า)</span>
            </button>
          </div>
        </div>

        {/* Target Action & Base URL Selector (Hidden when printing) */}
        <div className="glass-card rounded-xl p-4 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white/[0.02] p-3 rounded-lg border border-white/[0.06]">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
              <span className="text-xs text-slate-300 font-medium">Domain / IP Address สำหรับมือถือสแกน:</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                onBlur={() => setBaseUrl(resolveWarehouseQrBaseUrl(baseUrl))}
                className="px-3 py-1.5 rounded-lg bg-black/40 border border-white/10 text-emerald-400 font-mono text-xs font-semibold focus:outline-none focus:border-indigo-500 w-64"
              />
              <button
                type="button"
                onClick={() => setBaseUrl(`http://${wifiIp}:3000`)}
                className="px-2.5 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-xs font-medium border border-emerald-500/30 transition-colors"
              >
                ใช้ Wi-Fi IP ({wifiIp})
              </button>
              <button
                type="button"
                onClick={() => setBaseUrl(getWarehouseQrProductionOrigin())}
                className="px-2.5 py-1.5 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 text-xs font-medium border border-indigo-500/30 transition-colors"
              >
                ใช้ URL Production
              </button>
            </div>
          </div>

          {ACTIONS.length > 1 && (
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
                เลือกหน้าที่ต้องการเปิดเมื่อสแกน QR Code:
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {ACTIONS.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => setSelectedAction(action.id)}
                    className={`p-3 rounded-xl border text-xs font-semibold transition-all text-left flex items-center justify-between ${
                      selectedAction === action.id
                        ? "bg-indigo-500/20 border-indigo-500 text-indigo-300 shadow-md shadow-indigo-900/30"
                        : "bg-white/[0.03] border-white/[0.08] text-slate-400 hover:bg-white/[0.06] hover:text-slate-200"
                    }`}
                  >
                    <span>{action.label}</span>
                    {selectedAction === action.id && (
                      <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
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
                className="glass-card rounded-2xl p-6 border border-white/[0.1] bg-[#111118] flex flex-col items-center justify-between text-center space-y-4 shadow-xl hover:border-indigo-500/40 transition-all"
              >
                {/* Card Header */}
                <div className="space-y-1 w-full border-b border-white/[0.08] pb-3">
                  <span className="inline-block px-3 py-1 rounded-full text-xs font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                    {wh.code}
                  </span>
                  <h2 className="text-xl font-bold text-slate-100 mt-1">{wh.name}</h2>
                  <p className="text-xs text-slate-400 font-medium">{wh.desc}</p>
                </div>

                {/* QR Code Container */}
                <div className="bg-white p-4 rounded-2xl border border-white/20 shadow-md flex items-center justify-center min-h-[200px] min-w-[200px]">
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
                  <p className="text-sm font-bold text-amber-300">
                    สแกนเพื่อ: {actionObj.label} ({wh.name})
                  </p>
                  <Link
                    href={fullTargetUrl}
                    target="_blank"
                    className="text-xs text-indigo-400 hover:underline font-mono truncate block px-2"
                  >
                    {fullTargetUrl}
                  </Link>
                </div>

                {/* Buttons (Hidden when printing) */}
                <div className="w-full pt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleDownloadSingle(wh)}
                    className="w-full py-2 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-slate-300 hover:text-white text-xs font-medium transition-colors cursor-pointer"
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
      {/* Contains ONLY Warehouse Name and QR Code                 */}
      {/* ======================================================== */}
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
              <div className="p-6 sm:p-8 bg-white rounded-3xl border-2 border-slate-300 shadow-sm flex items-center justify-center">
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
    </>
  );
}

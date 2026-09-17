"use client";

import { useState, useEffect, useCallback } from "react";
import QRCode from "qrcode";
import { outboundApi, type BusyQItem } from "@/lib/outbound-client";

const Q_BOXES = ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6"];

export default function WorkOrdersPage() {
  const [busyQs, setBusyQs] = useState<BusyQItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [qrUrls, setQrUrls] = useState<Record<string, string>>({});
  const [zoomCode, setZoomCode] = useState<string | null>(null);
  const [printTarget, setPrintTarget] = useState<"ALL" | string | null>(null);
  const [notice, setNotice] = useState("");

  // สร้าง QR Code เป็น Data URL (PNG) สำหรับทั้ง 6 กล่องตั้งแต่เริ่มโหลด
  useEffect(() => {
    (async () => {
      const urls: Record<string, string> = {};
      for (const q of Q_BOXES) {
        try {
          urls[q] = await QRCode.toDataURL(q, {
            width: 320,
            margin: 1,
            color: {
              dark: "#0f172a",
              light: "#ffffff",
            },
          });
        } catch (e) {
          console.error("QR Code generation error for", q, e);
        }
      }
      setQrUrls(urls);
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await outboundApi.listWorkOrders();
      setBusyQs(data.busy_qs ?? []);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "โหลดไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handlePrint = (target: "ALL" | string) => {
    setPrintTarget(target);
    setTimeout(() => {
      window.print();
    }, 150);
  };

  const busyCount = Q_BOXES.filter((q) => busyQs.some((b) => b.q_code === q)).length;
  const availableCount = Q_BOXES.length - busyCount;

  return (
    <>
      {/* หน้าจอหลัก (ซ่อนเมื่อสั่งพิมพ์) */}
      <div className="print:hidden w-full max-w-none space-y-4">
        {/* ส่วนหัวหน้าจอ */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold text-[#06402B]">📦 กล่อง Q (Q1 - Q6)</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handlePrint("ALL")}
              className="px-4 py-2 rounded-xl bg-[#06402B] hover:bg-[#053425] text-white text-sm font-bold shadow-md active:scale-95 transition flex items-center gap-2 cursor-pointer"
            >
              <span>🖨️</span>
              <span>พิมพ์ทั้งหมด</span>
            </button>
          </div>
        </div>

        {notice && (
          <div className="bg-[#EAF2EE] border border-[#C9DFD4] text-[#053425] rounded-xl px-4 py-3 text-sm">{notice}</div>
        )}

        <div className="space-y-4">
          {/* แถบสรุปสถานะ */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white px-4 py-3 rounded-2xl border border-[#E8ECEA]">
            <div className="flex flex-wrap items-center gap-2 lg:gap-3 text-sm">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 lg:px-4 lg:py-1.5 rounded-full text-xs lg:text-sm font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                ว่าง {availableCount} กล่อง
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 lg:px-4 lg:py-1.5 rounded-full text-xs lg:text-sm font-bold bg-amber-50 text-amber-800 border border-amber-200">
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                กำลังใช้งาน {busyCount} กล่อง
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void load()}
                disabled={loading}
                className="px-3 py-1.5 lg:px-4 lg:py-2 rounded-xl border border-[#E8ECEA] hover:bg-slate-50 text-slate-600 text-xs lg:text-sm font-semibold active:scale-95 transition flex items-center gap-1 cursor-pointer"
                title="รีเฟรช"
              >
                <span>{loading ? "⏳" : "🔄"}</span>
                <span>รีเฟรช</span>
              </button>
            </div>
          </div>

          {/* การ์ด 6 Q */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6 gap-4 xl:gap-5">
            {Q_BOXES.map((qCode) => {
              const busyInfo = busyQs.find((b) => b.q_code === qCode);
              return (
                <QCard
                  key={qCode}
                  qCode={qCode}
                  qrUrl={qrUrls[qCode]}
                  busyInfo={busyInfo}
                  onZoom={(code) => setZoomCode(code)}
                />
              );
            })}
          </div>
        </div>

        {/* โมดัลแสดงรายการสินค้าและ QR Code ของกล่อง Q */}
        {zoomCode && (
          <ZoomQRModal
            qCode={zoomCode}
            qrUrl={qrUrls[zoomCode]}
            busyInfo={busyQs.find((b) => b.q_code === zoomCode)}
            onClose={() => setZoomCode(null)}
          />
        )}
      </div>

      {/* เลย์เอาต์เฉพาะสั่งพิมพ์ (ซ่อนบนหน้าจอ แสดงเฉพาะตอน Print) */}
      <div className="hidden print:block font-sans print:p-4">
        <div className={`grid ${printTarget === "ALL" ? "grid-cols-2 gap-6" : "grid-cols-1 max-w-sm mx-auto"}`}>
          {(printTarget === "ALL" ? Q_BOXES : [printTarget]).map((code) => code && (
            <PrintStickerItem key={code} qCode={code} qrUrl={qrUrls[code]} />
          ))}
        </div>
      </div>
    </>
  );
}

/** การ์ดแสดง QR Code สำหรับแต่ละกล่อง Q */
function QCard({
  qCode,
  qrUrl,
  busyInfo,
  onZoom,
}: {
  qCode: string;
  qrUrl?: string;
  busyInfo?: BusyQItem;
  onZoom: (q: string) => void;
}) {
  const isBusy = Boolean(busyInfo);
  const itemCount = busyInfo?.items?.length ?? 0;
  const totalQty = busyInfo?.items?.reduce((s, it) => s + it.qty, 0) ?? 0;

  return (
    <div
      onClick={() => onZoom(qCode)}
      className="bg-white rounded-2xl border border-[#E8ECEA] p-5 lg:p-6 shadow-xs hover:shadow-md transition cursor-pointer group"
      title="คลิกเพื่อดูรายการสินค้าในกล่องและ QR Code"
    >
      {/* พื้นที่แสดง QR Code */}
      <div
        className="my-2 py-4 px-2 rounded-xl bg-slate-50 border border-slate-100 flex flex-col items-center justify-center group-hover:bg-slate-100 transition min-h-[200px] lg:min-h-[240px] 2xl:min-h-[280px]"
      >
        {qrUrl ? (
          <img
            src={qrUrl}
            alt={`QR กล่อง ${qCode}`}
            className="w-40 h-40 lg:w-48 lg:h-48 2xl:w-56 2xl:h-56 object-contain rounded-xl bg-white p-1 shadow-2xs group-hover:scale-102 transition"
          />
        ) : (
          <div className="w-40 h-40 lg:w-48 lg:h-48 2xl:w-56 2xl:h-56 bg-white rounded-xl flex items-center justify-center text-slate-400 text-xs">
            กำลังสร้าง QR...
          </div>
        )}
        <div className="text-base font-black font-mono text-[#06402B] mt-2 tracking-wider">
          {qCode}
        </div>
        {isBusy && itemCount > 0 ? (
          <div className="text-xs font-semibold text-slate-600 mt-1 flex items-center gap-1">
            <span>📋</span>
            <span>{itemCount} รายการ ({totalQty} ชิ้น)</span>
          </div>
        ) : isBusy ? (
          <div className="text-xs text-amber-700 mt-1">กำลังดำเนินการ</div>
        ) : (
          <div className="text-xs text-emerald-600 mt-1">ว่าง พร้อมใช้งาน</div>
        )}
      </div>
    </div>
  );
}

/** สติกเกอร์พิมพ์สำหรับตัดแปะกล่อง */
function PrintStickerItem({ qCode, qrUrl }: { qCode: string; qrUrl?: string }) {
  return (
    <div className="border-2 border-dashed border-slate-700 rounded-2xl p-6 text-center bg-white break-inside-avoid flex flex-col items-center justify-center">
      <div className="text-3xl font-black text-slate-900 font-mono mb-2">
        กล่อง {qCode}
      </div>
      <div className="my-2 flex flex-col items-center">
        {qrUrl ? (
          <img src={qrUrl} alt={qCode} className="w-48 h-48 object-contain" />
        ) : (
          <div className="w-48 h-48 bg-slate-100 flex items-center justify-center text-xs">...</div>
        )}
        <div className="text-2xl font-black font-mono mt-2 tracking-wider">{qCode}</div>
      </div>
    </div>
  );
}

/** โมดัลแสดงรายการสินค้าและ QR Code ของกล่อง Q */
function ZoomQRModal({
  qCode,
  qrUrl,
  busyInfo,
  onClose,
}: {
  qCode: string;
  qrUrl?: string;
  busyInfo?: BusyQItem;
  onClose: () => void;
}) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const totalQty = busyInfo?.items?.reduce((sum, it) => sum + it.qty, 0) ?? 0;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-[3px] flex items-center justify-center p-3 sm:p-5"
      onClick={onClose}
    >
      <div
        className="bg-[#FCFDFC] rounded-[20px] w-full max-w-[950px] max-h-[90vh] flex flex-col my-auto overflow-hidden shadow-[0_24px_70px_-20px_rgba(6,64,43,0.35)] border border-black/5 animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 sm:px-7 pt-5 sm:pt-6 pb-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-2xl bg-[#EAF2EE] border border-[#DFEDE6] flex items-center justify-center text-xl shrink-0">
              📦
            </div>
            <div className="min-w-0">
              <h2 className="text-xl sm:text-2xl font-black font-mono text-slate-900 tracking-tight leading-tight truncate">
                กล่อง {qCode}
              </h2>
              <div className="text-xs text-slate-400 font-medium">รายละเอียดกล่อง Q และรายการสินค้า</div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-700 flex items-center justify-center transition-colors cursor-pointer shrink-0"
            title="ปิด (Esc)"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body — 2 คอลัมน์บนจอใหญ่ (QR 35% / รายละเอียด 65%) */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 sm:px-7 pb-2 [scrollbar-width:thin]">
          <div className="grid grid-cols-1 lg:grid-cols-[35%_1fr] gap-4 lg:gap-6 pb-3">
            {/* ซ้าย: QR ประจำกล่อง */}
            <div className="rounded-[18px] bg-white border border-slate-200/70 shadow-[0_2px_12px_-6px_rgba(16,24,40,0.08)] p-5 flex flex-col items-center justify-center gap-3">
              <div className="text-xs font-semibold text-slate-400 tracking-[0.12em] uppercase">QR ประจำกล่อง</div>
              {qrUrl ? (
                <img
                  src={qrUrl}
                  alt={qCode}
                  className="w-40 h-40 sm:w-48 sm:h-48 lg:w-full lg:max-w-[216px] lg:h-auto aspect-square object-contain rounded-xl bg-white p-2 border border-slate-200/60"
                />
              ) : (
                <div className="w-40 h-40 sm:w-48 sm:h-48 lg:w-full lg:max-w-[216px] aspect-square bg-slate-50 rounded-xl flex items-center justify-center text-xs text-slate-400">
                  กำลังสร้าง QR...
                </div>
              )}
              <div className="text-2xl font-black font-mono text-[#06402B] tracking-[0.2em]">{qCode}</div>
            </div>

            {/* ขวา: ข้อมูลเอกสาร + รายการสินค้า */}
            <div className="min-w-0 flex flex-col gap-4">
              {busyInfo ? (
                <>
                  {/* Information Card */}
                  <div className="rounded-[18px] bg-white border border-slate-200/70 shadow-[0_2px_12px_-6px_rgba(16,24,40,0.08)] p-4 sm:p-5 grid grid-cols-2 gap-x-6 gap-y-4">
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-slate-400 mb-1">เอกสาร</div>
                      <div className="text-sm font-bold font-mono text-slate-900 truncate" title={busyInfo.document_no}>
                        {busyInfo.document_no}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-slate-400 mb-1">ลูกค้า / ปลายทาง</div>
                      <div
                        className="text-sm font-bold text-slate-800 truncate"
                        title={busyInfo.customer || "—"}
                      >
                        {busyInfo.customer || "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-400 mb-1">จำนวนรายการ</div>
                      <div className="text-sm font-bold text-slate-800">{busyInfo.items?.length ?? 0} รายการ</div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-slate-400 mb-1">จำนวนชิ้น</div>
                      <div className="text-sm font-bold text-slate-800">{totalQty} ชิ้น</div>
                    </div>
                  </div>

                  {/* รายการสินค้า */}
                  <div className="min-h-0 flex flex-col">
                    <div className="flex items-center justify-between gap-2 mb-2.5">
                      <div className="text-sm font-bold text-slate-800">รายการสินค้าในกล่อง</div>
                      <span className="text-xs font-semibold text-slate-400 tabular-nums">
                        {busyInfo.items?.length ?? 0} รายการ • {totalQty} ชิ้น
                      </span>
                    </div>

                    {busyInfo.items && busyInfo.items.length > 0 ? (
                      <div className="max-h-64 lg:max-h-72 overflow-y-auto space-y-2.5 pr-1 [scrollbar-width:thin]">
                        {busyInfo.items.map((item, idx) => (
                          <div
                            key={idx}
                            className="rounded-2xl bg-white border border-slate-200/70 px-4 py-3 flex items-center justify-between gap-3 hover:border-[#C9DFD4] transition-colors"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-bold font-mono text-slate-900">{item.sku}</span>
                                {item.location && (
                                  <span className="text-xs px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-500 font-mono">
                                    📍 {item.location}
                                  </span>
                                )}
                              </div>
                              {item.product_name && (
                                <div className="text-xs text-slate-500 truncate mt-1" title={item.product_name}>
                                  {item.product_name}
                                </div>
                              )}
                              {item.barcode && (
                                <div className="text-xs text-slate-400 font-mono mt-0.5">บาร์โค้ด {item.barcode}</div>
                              )}
                            </div>

                            <div className="flex flex-col items-end gap-1.5 shrink-0">
                              <div className="text-lg font-black text-[#06402B] leading-none tabular-nums">
                                {item.qty}
                                <span className="text-xs font-semibold text-slate-400 ml-1">ชิ้น</span>
                              </div>
                              {item.status && (
                                <span
                                  className={`text-xs font-bold px-2.5 py-1 rounded-full border ${
                                    item.status === "PICKED"
                                      ? "bg-emerald-50 text-emerald-700 border-emerald-200/70"
                                      : item.status === "SHORTAGE"
                                        ? "bg-rose-50 text-rose-700 border-rose-200/70"
                                        : "bg-amber-50 text-amber-700 border-amber-200/70"
                                  }`}
                                >
                                  {item.status === "PICKED" ? "หยิบแล้ว" : item.status === "SHORTAGE" ? "ของไม่ครบ" : "รอหยิบ"}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="py-8 text-center rounded-2xl bg-slate-50 border border-slate-200/60 text-slate-400 text-sm font-medium">
                        ยังไม่มีรายการสินค้าในกล่องนี้
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="h-full flex flex-col items-center justify-center p-8 text-center rounded-[18px] bg-emerald-50/50 border border-emerald-100">
                  <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-2xl mb-3">
                    ✓
                  </div>
                  <div className="text-base font-bold text-emerald-950 mb-1.5">กล่องว่าง พร้อมใช้งาน</div>
                  <p className="text-sm text-emerald-800/70 max-w-xs leading-relaxed">
                    ยังไม่มีบิลหรือใบงานใดผูกอยู่กับกล่อง {qCode} สามารถนำไปจัดสรรกับบิลใหม่ได้ทันที
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-5 sm:px-7 py-4 sm:py-5">
          <button
            onClick={onClose}
            className="px-8 py-3 rounded-xl bg-[#06402B] hover:bg-[#053425] text-white font-bold text-sm shadow-md hover:shadow-lg hover:shadow-[#06402B]/20 hover:-translate-y-0.5 active:translate-y-0 transition-all cursor-pointer"
          >
            ปิด
          </button>
        </div>
      </div>
    </div>
  );
}

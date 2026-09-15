"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { outboundApi, type BillDetailData } from "@/lib/outbound-client";
import { usePollingWhenVisible } from "@/hooks/use-visibility-polling";
import BarcodeScanInput from "@/components/scanner/BarcodeScanInput";
import ScanFeedbackBanner from "@/components/scanner/ScanFeedbackBanner";
import CameraBarcodeScannerModal from "@/components/ui/CameraBarcodeScannerModal";
import { feedbackSuccess, feedbackError, feedbackDone, feedbackWarn } from "@/lib/feedback";
import { generateBoxStickerDataUrl } from "@/lib/barcode-utils";
import { queuedScan } from "@/lib/offline-scan-queue";
import { useOfflineScanQueue, OfflineQueueBadge } from "@/hooks/use-offline-scan-queue";

/**
 * สถานีแพ็ก — สแกนของใส่กล่องปัจจุบัน · ปิดกล่อง = พิมพ์สติกเกอร์ (ไม่มี m
 * เพราะยังไม่รู้ว่าจบกี่กล่อง) · แพ็กครบ = ปุ่มพิมพ์สติกเกอร์ชุดเต็ม n/m
 */

type Feedback = { tone: "success" | "error" | "info"; message: string } | null;

interface BoxInfo {
  document_id: string;
  document_no: string;
  bill_document_no: string;
  box_no: number;
  box_status: string;
  items: Array<{ sku: string; qty: number }>;
  total_qty: number;
  sticker_printed: boolean;
}

interface StickerJob {
  billNo: string;
  customer?: string;
  stickers: Array<{ label: string; boxCode: string; itemCount: number }>;
}

export default function OutboundPackPage() {
  const [queue, setQueue] = useState<Array<{ document_id: string; document_no: string; express_bill_no: string; outbound_status: string; box_count: number; total_qty_required: number }>>([]);
  const [active, setActive] = useState<BillDetailData | null>(null);
  const [activeBillNo, setActiveBillNo] = useState("");
  const [boxes, setBoxes] = useState<BoxInfo[]>([]);
  const [scanValue, setScanValue] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [flash, setFlash] = useState<"ok" | "bad" | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [printJob, setPrintJob] = useState<StickerJob | null>(null);
  const lockRef = useRef(false);
  const offlineQueue = useOfflineScanQueue();

  const loadQueue = useCallback(async () => {
    try {
      const { data } = await outboundApi.listBills();
      setQueue(
        data.bills.filter((b) => ["READY_TO_PACK", "PACKING", "PACKED"].includes(b.outbound_status))
      );
    } catch {}
  }, []);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  const loadActive = useCallback(async (billNo: string) => {
    const [{ data: d }, { data: b }] = await Promise.all([
      outboundApi.getBill(billNo),
      outboundApi.getBoxes(billNo),
    ]);
    setActive(d);
    setActiveBillNo(d.doc.document_no);
    setBoxes(b.boxes);
    return d;
  }, []);

  usePollingWhenVisible(
    useCallback(() => {
      if (activeBillNo) return loadActive(activeBillNo).catch(() => {});
      return loadQueue();
    }, [activeBillNo, loadActive, loadQueue]),
    15000
  );

  // ยอดที่ลงกล่องแล้วต่อ SKU + กล่องเปิดอยู่
  const boxedBySku = useMemo(() => {
    const map = new Map<string, number>();
    for (const box of boxes) {
      if (box.box_status === "CANCELLED") continue;
      for (const it of box.items) {
        map.set(it.sku, (map.get(it.sku) || 0) + it.qty);
      }
    }
    return map;
  }, [boxes]);

  const openBox = useMemo(() => boxes.find((b) => b.box_status === "OPEN") ?? null, [boxes]);
  const note = active?.note;
  const packableItems = useMemo(() => {
    if (!note) return [];
    return note.items
      .filter((it) => it.qty_picked > 0)
      .map((it) => ({
        ...it,
        remaining: it.qty_picked - (boxedBySku.get(it.sku) || 0),
      }))
      .filter((it) => it.remaining > 0);
  }, [note, boxedBySku]);

  const doFlash = (kind: "ok" | "bad") => {
    setFlash(kind);
    window.setTimeout(() => setFlash(null), kind === "ok" ? 350 : 650);
  };

  // ---------- actions ----------
  const run = useCallback(
    async (fn: () => Promise<{ message: string }>) => {
      if (lockRef.current) return;
      lockRef.current = true;
      setBusy(true);
      try {
        const { message } = await fn();
        feedbackSuccess();
        doFlash("ok");
        setFeedback({ tone: "success", message });
        await loadActive(activeBillNo);
      } catch (e) {
        feedbackError();
        doFlash("bad");
        setFeedback({ tone: "error", message: e instanceof Error ? e.message : "ทำรายการไม่สำเร็จ" });
        await loadActive(activeBillNo).catch(() => {});
      } finally {
        setBusy(false);
        lockRef.current = false;
      }
    },
    [activeBillNo, loadActive]
  );

  const createBox = () =>
    void run(async () => outboundApi.boxAction(activeBillNo, { action: "create" }));

  const closeBox = () =>
    void run(async () => {
      const { data } = await outboundApi.boxAction(activeBillNo, { action: "close" });
      const closed = data as { box_document_no: string; box_no: number; total_qty: number };
      feedbackDone();
      // เปิดหน้าสติกเกอร์กล่องนี้ทันที (แบบไม่มี m)
      setPrintJob({
        billNo: note?.express_bill_no ?? activeBillNo,
        customer: note?.customer,
        stickers: [
          {
            label: `BOX ${String(closed.box_no).padStart(2, "0")}`,
            boxCode: closed.box_document_no,
            itemCount: closed.total_qty,
          },
        ],
      });
      return { message: `ปิดกล่องที่ ${closed.box_no} แล้ว — พิมพ์สติกเกอร์ติดกล่อง` };
    });

  const handleScan = useCallback(
    async (code: string) => {
      setScanValue("");
      if (!active || !openBox) return;
      const norm = (s: string) => s.trim().toLowerCase().replace(/[\s\-_#]/g, "");
      const item = active.note.items.find(
        (it) => norm(it.sku) === norm(code) || (it.barcode ? norm(it.barcode) === norm(code) : false)
      );
      if (!item) {
        feedbackError();
        doFlash("bad");
        setFeedback({ tone: "error", message: `✗ ไม่อยู่ในบิลนี้ (${code})` });
        return;
      }
      const remaining = item.qty_picked - (boxedBySku.get(item.sku) || 0);
      if (remaining <= 0) {
        feedbackError();
        doFlash("bad");
        setFeedback({ tone: "error", message: `✗ ${item.sku} ลงกล่องครบแล้ว` });
        return;
      }
      if (lockRef.current) return;
      lockRef.current = true;
      setBusy(true);
      try {
        const result = await queuedScan({
          url: `/api/outbound/bills/${encodeURIComponent(activeBillNo)}/boxes`,
          body: { action: "scan-item", sku: item.sku, qty: remaining },
          label: `ใส่กล่อง ${item.sku} ×${remaining} (${activeBillNo})`,
        });
        if (result.status === "queued") {
          feedbackWarn();
          setFeedback({ tone: "success", message: `🟠 ออฟไลน์ — บันทึก "${result.label}" ไว้ในเครื่องแล้ว จะส่งเองเมื่อเน็ตกลับ` });
          offlineQueue.refreshCounts();
        } else {
          feedbackSuccess();
          doFlash("ok");
          setFeedback({ tone: "success", message: result.message });
          await loadActive(activeBillNo);
        }
      } catch (e) {
        feedbackError();
        doFlash("bad");
        setFeedback({ tone: "error", message: e instanceof Error ? e.message : "✗ ใส่กล่องไม่สำเร็จ" });
        await loadActive(activeBillNo).catch(() => {});
      } finally {
        setBusy(false);
        lockRef.current = false;
      }
    },
    [active, openBox, boxedBySku, activeBillNo, loadActive, offlineQueue]
  );

  const printAllLabels = () => {
    if (!note || boxes.length === 0) return;
    feedbackDone();
    setPrintJob({
      billNo: note.express_bill_no,
      customer: note.customer,
      stickers: boxes.map((b) => ({
        label: `${b.box_no} / ${boxes.length}`,
        boxCode: b.document_no,
        itemCount: b.total_qty,
      })),
    });
  };

  // ============================================================
  // มุมมอง 1: คิวบิลรอแพ็ก
  // ============================================================
  if (!active) {
    return (
      <div className="max-w-2xl mx-auto pb-20 sm:pb-8 space-y-4">
        <h1 className="text-xl font-bold text-[#06402B] flex items-center gap-2">
          <span className="text-3xl">📦</span> แพ็กใส่กล่อง
        </h1>
        <p className="text-sm text-slate-500">เฉพาะบิลที่อนุมัติและหยิบครบแล้ว (สต็อกถูกตัดไปแล้ว)</p>

        {queue.length === 0 ? (
          <div className="bg-white rounded-2xl border border-[#E8ECEA] p-8 text-center text-slate-400">
            ไม่มีบิลรอแพ็กตอนนี้
          </div>
        ) : (
          queue.map((b) => (
            <button
              key={b.document_id}
              onClick={() => void loadActive(b.document_no).catch(() => {})}
              className="w-full bg-white rounded-2xl border border-[#E8ECEA] p-5 text-left hover:border-[#06402B]/40 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-lg font-extrabold text-slate-800 tabular-nums">{b.express_bill_no}</div>
                  <div className="text-xs text-slate-400 font-mono">{b.document_no}</div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <div className="text-3xl font-black text-[#06402B] tabular-nums leading-none">
                      {b.box_count}
                    </div>
                    <div className="text-xs text-slate-400">กล่อง</div>
                  </div>
                  <span className="text-4xl">
                    {b.outbound_status === "PACKED" ? "✅" : "▶"}
                  </span>
                </div>
              </div>
              {b.outbound_status === "PACKED" && (
                <div className="mt-2 text-xs font-semibold text-emerald-700">แพ็กครบ — เข้ารอบรถได้ / พิมพ์สติกเกอร์ชุดเต็มได้</div>
              )}
            </button>
          ))
        )}
      </div>
    );
  }

  // ============================================================
  // มุมมอง 2: สถานีแพ็กของบิลนี้
  // ============================================================
  const status = note?.outbound_status ?? "";
  const totalBoxed = Array.from(boxedBySku.values()).reduce((s, v) => s + v, 0);

  return (
    <div className={`max-w-2xl mx-auto pb-24 sm:pb-8 space-y-4 transition-colors duration-150 ${flash === "ok" ? "bg-emerald-50" : flash === "bad" ? "bg-red-50" : ""}`}>
      {/* หัวบิล */}
      <div className="bg-white rounded-2xl border border-[#E8ECEA] p-4 flex items-center justify-between">
        <button onClick={() => { setActive(null); setActiveBillNo(""); setFeedback(null); }} className="text-slate-400 hover:text-slate-600 text-sm">
          ✕ ปิด
        </button>
        <div className="text-center">
          <div className="text-xl font-extrabold text-slate-800 tabular-nums">{note?.express_bill_no}</div>
          <div className="text-[18px] text-slate-400">{note?.customer}</div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-black tabular-nums text-[#06402B]">
            {boxes.filter((b) => b.box_status !== "CANCELLED").length}
          </div>
          <div className="text-[18px] text-slate-400">กล่อง · {totalBoxed.toLocaleString("th-TH")} ชิ้น</div>
        </div>
      </div>

      <OfflineQueueBadge pendingCount={offlineQueue.pendingCount} online={offlineQueue.online} />

      {feedback && <ScanFeedbackBanner feedback={feedback ? { type: feedback.tone === "error" ? "error" : "success", message: feedback.message } : null} />}

      {(status === "READY_TO_PACK" || status === "PACKING") && (
        <>
          {/* กล่องปัจจุบัน */}
          {openBox ? (
            <div className="bg-white rounded-2xl border-2 border-[#06402B]/30 p-5 text-center">
              <div className="text-[18px] text-slate-400 tracking-widest">BOX กำลังรับของ</div>
              <div className="text-4xl font-black font-mono text-[#06402B]">#{openBox.box_no}</div>
              <div className="text-xs font-mono text-slate-400">{openBox.document_no}</div>
              <div className="mt-2 text-2xl font-black tabular-nums text-slate-900">
                {openBox.total_qty.toLocaleString("th-TH")} <span className="text-sm font-normal text-slate-400">ชิ้นในกล่อง</span>
              </div>

              {openBox.items.length > 0 && (
                <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                  {openBox.items.map((it, i) => (
                    <span key={i} className="px-2 py-1 rounded-lg bg-[#F7F9F8] text-xs font-mono text-slate-600">
                      {it.sku} ×{it.qty}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={createBox}
              disabled={busy}
              className="w-full py-8 rounded-2xl bg-[#06402B] text-white text-2xl font-black disabled:opacity-50 active:scale-[0.98] transition-transform"
            >
              ➕ เปิดกล่องใหม่
            </button>
          )}

          {/* ของที่ยังต้องใส่ */}
          {openBox && packableItems.length > 0 && (
            <div className="bg-white rounded-2xl border border-[#E8ECEA] p-4 space-y-2">
              <div className="text-xs font-bold text-slate-500">ยังต้องใส่อีก ({packableItems.length} รายการ)</div>
              {packableItems.map((it) => (
                <button
                  key={it.sku}
                  onClick={() => void handleScan(it.sku)}
                  disabled={busy}
                  className="w-full flex items-center justify-between px-3 py-3 rounded-xl bg-[#F7F9F8] hover:bg-emerald-50 disabled:opacity-50 text-left"
                >
                  <div>
                    <div className="font-mono font-bold text-slate-800">{it.sku}</div>
                    <div className="text-[18px] text-slate-400">{it.product_name}</div>
                  </div>
                  <div className="text-3xl font-black tabular-nums text-[#06402B]">{it.remaining}</div>
                </button>
              ))}
            </div>
          )}

          {/* ช่องสแกน */}
          {openBox && (
            <BarcodeScanInput
              value={scanValue}
              onChange={setScanValue}
              onScanSubmit={(code) => void handleScan(code)}
              onOpenScannerModal={() => setCameraOpen(true)}
              placeholder="สแกนสินค้าใส่กล่อง…"
              isProcessing={busy}
            />
          )}

          {/* ปิดกล่อง */}
          {openBox && openBox.items.length > 0 && (
            <button
              onClick={closeBox}
              disabled={busy}
              className="w-full py-6 rounded-2xl bg-emerald-600 text-white text-2xl font-black disabled:opacity-50 active:scale-[0.98] transition-transform"
            >
              📦 ปิดกล่อง
            </button>
          )}
          {openBox && openBox.items.length === 0 && (
            <button
              onClick={() => void run(async () => outboundApi.boxAction(activeBillNo, { action: "cancel-open" }))}
              disabled={busy}
              className="w-full py-3 rounded-2xl border border-[#E8ECEA] text-slate-500 font-semibold disabled:opacity-50"
            >
              ยกเลิกกล่องเปล่านี้
            </button>
          )}
        </>
      )}

      {/* แพ็กครบแล้ว */}
      {status === "PACKED" && (
        <div className="space-y-3">
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 text-center">
            <div className="text-5xl mb-2">✅</div>
            <div className="font-bold text-emerald-900">แพ็กครบ {boxes.length} กล่อง — พร้อมเข้ารอบรถ</div>
            <div className="text-sm text-emerald-700 mt-1">ไปหน้าขึ้นรถเพื่อสร้างรอบ/สแกนกล่อง</div>
          </div>
          <button
            onClick={printAllLabels}
            className="w-full py-5 rounded-2xl bg-[#06402B] text-white text-xl font-black active:scale-[0.98] transition-transform"
          >
            🖨 พิมพ์สติกเกอร์ชุดเต็ม ({boxes.length} กล่อง)
          </button>
        </div>
      )}

      {/* รายการกล่องของบิล */}
      {boxes.length > 0 && (
        <div className="bg-white rounded-2xl border border-[#E8ECEA] p-4">
          <div className="text-xs font-bold text-slate-500 mb-2">กล่องทั้งหมด ({boxes.length})</div>
          <div className="grid grid-cols-2 gap-2">
            {boxes.map((b) => (
              <button
                key={b.document_id}
                onClick={() => {
                  if (b.box_status === "CANCELLED") return;
                  setPrintJob({
                    billNo: note?.express_bill_no ?? "",
                    customer: note?.customer,
                    stickers: [
                      {
                        label: `BOX ${String(b.box_no).padStart(2, "0")}`,
                        boxCode: b.document_no,
                        itemCount: b.total_qty,
                      },
                    ],
                  });
                }}
                className={`border rounded-xl p-3 text-center ${b.box_status === "CANCELLED" ? "border-slate-100 opacity-40" : "border-[#E8ECEA] hover:border-[#06402B]/40"}`}
              >
                <div className="text-2xl">📦</div>
                <div className="font-bold text-slate-800">กล่อง {b.box_no} · {b.total_qty} ชิ้น</div>
                <div className="text-[18px] font-mono text-slate-400">{b.document_no}</div>
                <div className="text-[18px] text-slate-500">{b.box_status}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      <CameraBarcodeScannerModal
        isOpen={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onScanSuccess={(code) => {
          setCameraOpen(false);
          void handleScan(code);
        }}
      />

      {/* หน้าต่างพิมพ์สติกเกอร์ */}
      {printJob && (
        <div className="fixed inset-0 z-50 bg-black/60 overflow-auto p-4">
          <div className="bg-white rounded-3xl max-w-2xl mx-auto p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="font-bold text-slate-800">สติกเกอร์กล่อง — {printJob.billNo}</div>
              <button onClick={() => setPrintJob(null)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {printJob.stickers.map((s) => (
                <img
                  key={s.boxCode}
                  src={generateBoxStickerDataUrl({
                    billNo: printJob.billNo,
                    boxLabel: s.label,
                    boxCode: s.boxCode,
                    itemCount: s.itemCount,
                    customer: printJob.customer,
                  })}
                  alt={`สติกเกอร์กล่อง ${s.boxCode}`}
                  className="w-full border border-[#E8ECEA] rounded-xl sticker-print-item"
                />
              ))}
            </div>
            <div className="flex gap-2 no-print">
              <button
                onClick={() => {
                  void Promise.all(
                    printJob.stickers.map((s) =>
                      boxes.find((b) => b.document_no === s.boxCode)
                        ? outboundApi.boxAction(activeBillNo, {
                            action: "mark-sticker-printed",
                            box_id: boxes.find((b) => b.document_no === s.boxCode)!.document_id,
                          })
                        : Promise.resolve({ data: {}, message: "" })
                    )
                  ).then(() => window.print());
                }}
                className="flex-1 py-3 rounded-xl bg-[#06402B] text-white font-bold"
              >
                🖨 พิมพ์
              </button>
              <button onClick={() => setPrintJob(null)} className="px-4 py-3 rounded-xl border border-[#E8ECEA] text-slate-600">
                ปิด
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CSS สำหรับโหมดพิมพ์ — พิมพ์เฉพาะสติกเกอร์ */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .sticker-print-item, .sticker-print-item * { visibility: visible !important; }
          .sticker-print-item { position: absolute; left: 0; top: 0; width: 100%; page-break-after: always; border: none !important; }
          .no-print { display: none !important; }
        }
      `}</style>
    </div>
  );
}

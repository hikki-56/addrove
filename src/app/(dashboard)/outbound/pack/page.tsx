"use client";

import { SolarBoxClosed } from "@/components/icons";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { outboundApi, type BillDetailData } from "@/client/outbound-client";
import { usePollingWhenVisible } from "@/hooks/use-visibility-polling";
import BarcodeScanInput from "@/components/scanner/BarcodeScanInput";
import ScanFeedbackBanner from "@/components/scanner/ScanFeedbackBanner";
import CameraBarcodeScannerModal from "@/components/ui/CameraBarcodeScannerModal";
import { feedbackSuccess, feedbackError, feedbackDone, feedbackWarn } from "@/client/feedback";
import { generateBoxStickerDataUrl } from "@/lib/barcode-utils";
import { queuedScan } from "@/client/offline-scan-queue";
import { useOfflineScanQueue, OfflineQueueBadge } from "@/hooks/use-offline-scan-queue";
import type { Feedback } from "@/app/(dashboard)/outbound/_lib/types";

/**
 * สถานีแพ็ก — สแกนของใส่กล่องปัจจุบัน · ปิดกล่อง = พิมพ์สติกเกอร์ (ไม่มี m
 * เพราะยังไม่รู้ว่าจบกี่กล่อง) · แพ็กครบ = ปุ่มพิมพ์สติกเกอร์ชุดเต็ม n/m
 */

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
    async (code: string, playSound = false) => {
      setScanValue("");
      if (!active || !openBox) return;
      const norm = (s: string) => s.trim().toLowerCase().replace(/[\s\-_#]/g, "");
      const item = active.note.items.find(
        (it) => norm(it.sku) === norm(code) || (it.barcode ? norm(it.barcode) === norm(code) : false)
      );
      if (!item) {
        if (playSound) feedbackError();
        doFlash("bad");
        setFeedback({ tone: "error", message: `✗ ไม่อยู่ในบิลนี้ (${code})` });
        return;
      }
      const remaining = item.qty_picked - (boxedBySku.get(item.sku) || 0);
      if (remaining <= 0) {
        if (playSound) feedbackError();
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
          if (playSound) feedbackWarn();
          setFeedback({ tone: "success", message: `🟠 ออฟไลน์ — บันทึก "${result.label}" ไว้ในเครื่องแล้ว จะส่งเองเมื่อเน็ตกลับ` });
          offlineQueue.refreshCounts();
        } else {
          if (playSound) feedbackSuccess();
          doFlash("ok");
          setFeedback({ tone: "success", message: result.message });
          await loadActive(activeBillNo);
        }
      } catch (e) {
        if (playSound) feedbackError();
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
        <h1 className="text-xl font-bold text-m3-primary-dark flex items-center gap-2">
          แพ็กใส่กล่อง
        </h1>

        {queue.length === 0 ? (
          <div className="bg-white rounded-xl border border-[rgba(145,158,171,0.2)] p-8 text-center text-m3-grey-500">
            ไม่มีบิลรอแพ็กตอนนี้
          </div>
        ) : (
          queue.map((b) => (
            <button
              key={b.document_id}
              onClick={() => void loadActive(b.document_no).catch(() => {})}
              className="w-full bg-white rounded-xl border border-[rgba(145,158,171,0.2)] p-5 text-left hover:border-m3-primary/40 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-lg font-extrabold text-m3-grey-800 tabular-nums">{b.express_bill_no}</div>
                  <div className="text-xs text-m3-grey-500 tabular-nums">{b.document_no}</div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <div className="text-3xl font-extrabold text-m3-primary-dark tabular-nums leading-none">
                      {b.box_count}
                    </div>
                    <div className="text-xs text-m3-grey-500">กล่อง</div>
                  </div>
                  <span className="text-4xl">
                    {b.outbound_status === "PACKED" ? "✅" : "▶"}
                  </span>
                </div>
              </div>
              {b.outbound_status === "PACKED" && (
                <div className="mt-2 text-xs font-semibold text-m3-primary-dark">แพ็กครบแล้ว</div>
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
    <div className={`max-w-2xl mx-auto pb-24 sm:pb-8 space-y-4 transition-colors duration-150 ${flash === "ok" ? "bg-[rgba(0,167,111,0.08)]" : flash === "bad" ? "bg-[rgba(255,86,48,0.08)]" : ""}`}>
      {/* หัวบิล */}
      <div className="bg-white rounded-xl border border-[rgba(145,158,171,0.2)] p-4 flex items-center justify-between">
        <button onClick={() => { setActive(null); setActiveBillNo(""); setFeedback(null); }} className="text-m3-grey-500 hover:text-m3-grey-600 text-sm">
          ✕ ปิด
        </button>
        <div className="text-center">
          <div className="text-xl font-extrabold text-m3-grey-800 tabular-nums">{note?.express_bill_no}</div>
          <div className="text-xs text-m3-grey-500">{note?.customer}</div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-extrabold tabular-nums text-m3-primary-dark">
            {boxes.filter((b) => b.box_status !== "CANCELLED").length}
          </div>
          <div className="text-xs text-m3-grey-500">กล่อง · {totalBoxed.toLocaleString("th-TH")} ชิ้น</div>
        </div>
      </div>

      <OfflineQueueBadge pendingCount={offlineQueue.pendingCount} online={offlineQueue.online} />

      {feedback && <ScanFeedbackBanner feedback={feedback ? { type: feedback.tone === "error" ? "error" : "success", message: feedback.message } : null} />}

      {(status === "READY_TO_PACK" || status === "PACKING") && (
        <>
          {/* กล่องปัจจุบัน */}
          {openBox ? (
            <div className="bg-white rounded-xl border-2 border-m3-primary/30 p-5 text-center">
              <div className="text-xs text-m3-grey-500 tracking-widest">BOX กำลังรับของ</div>
              <div className="text-4xl font-extrabold tabular-nums text-m3-primary-dark">#{openBox.box_no}</div>
              <div className="text-xs tabular-nums text-m3-grey-500">{openBox.document_no}</div>
              <div className="mt-2 text-2xl font-extrabold tabular-nums text-m3-grey-800">
                {openBox.total_qty.toLocaleString("th-TH")} <span className="text-sm font-normal text-m3-grey-500">ชิ้นในกล่อง</span>
              </div>

              {openBox.items.length > 0 && (
                <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                  {openBox.items.map((it, i) => {
                    const itDetail = note?.items.find((x) => x.sku === it.sku);
                    return (
                      <span key={i} className="px-2 py-1 rounded-lg bg-m3-grey-100 text-xs text-m3-grey-700">
                        {itDetail?.product_name || it.sku} ×{it.qty}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={createBox}
              disabled={busy}
              className="w-full py-8 rounded-xl bg-m3-primary text-white text-2xl font-extrabold disabled:opacity-50 active:scale-[0.98] transition-transform"
            >
              เปิดกล่องใหม่
            </button>
          )}

          {/* ของที่ยังต้องใส่ */}
          {openBox && packableItems.length > 0 && (
            <div className="bg-white rounded-xl border border-[rgba(145,158,171,0.2)] p-4 space-y-2">
              <div className="text-xs font-bold text-m3-grey-600">ยังต้องใส่อีก ({packableItems.length} รายการ)</div>
              {packableItems.map((it) => (
                <button
                  key={it.sku}
                  onClick={() => void handleScan(it.sku)}
                  disabled={busy}
                  className="w-full flex items-center justify-between px-3 py-3 rounded-xl bg-m3-grey-100 hover:bg-[rgba(0,167,111,0.08)] disabled:opacity-50 text-left"
                >
                  <div>
                    <div className="font-bold text-m3-grey-800 text-sm lg:text-base">{it.product_name || it.sku}</div>
                  </div>
                  <div className="text-3xl font-extrabold tabular-nums text-m3-primary-dark">{it.remaining}</div>
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
              className="w-full py-6 rounded-xl bg-m3-primary text-white text-2xl font-extrabold disabled:opacity-50 active:scale-[0.98] transition-transform"
            >
              ปิดกล่อง
            </button>
          )}
          {openBox && openBox.items.length === 0 && (
            <button
              onClick={() => void run(async () => outboundApi.boxAction(activeBillNo, { action: "cancel-open" }))}
              disabled={busy}
              className="w-full py-3 rounded-xl border border-[rgba(145,158,171,0.2)] text-m3-grey-600 font-semibold disabled:opacity-50"
            >
              ยกเลิกกล่องเปล่านี้
            </button>
          )}
        </>
      )}

      {/* แพ็กครบแล้ว */}
      {status === "PACKED" && (
        <div className="space-y-3">
          <div className="bg-[rgba(0,167,111,0.08)] border border-[rgba(0,167,111,0.24)] rounded-xl p-6 text-center">
            <div className="text-5xl mb-2">✅</div>
            <div className="font-bold text-m3-primary-dark">แพ็กครบ {boxes.length} กล่อง — พร้อมเข้ารอบรถ</div>
          </div>
          <button
            onClick={printAllLabels}
            className="w-full py-5 rounded-xl bg-m3-primary text-white text-xl font-extrabold active:scale-[0.98] transition-transform"
          >
            พิมพ์สติกเกอร์ชุดเต็ม ({boxes.length} กล่อง)
          </button>
        </div>
      )}

      {/* รายการกล่องของบิล */}
      {boxes.length > 0 && (
        <div className="bg-white rounded-xl border border-[rgba(145,158,171,0.2)] p-4">
          <div className="text-xs font-bold text-m3-grey-600 mb-2">กล่องทั้งหมด ({boxes.length})</div>
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
                className={`border rounded-xl p-3 text-center ${b.box_status === "CANCELLED" ? "border-m3-grey-200 opacity-40" : "border-[rgba(145,158,171,0.2)] hover:border-m3-primary/40"}`}
              >
                <SolarBoxClosed size={28} className="text-m3-grey-500" />
                <div className="font-bold text-m3-grey-800">กล่อง {b.box_no} · {b.total_qty} ชิ้น</div>
                <div className="text-xs tabular-nums text-m3-grey-500">{b.document_no}</div>
                <div className="text-xs text-m3-grey-600">{b.box_status}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      <CameraBarcodeScannerModal
        feedbackHandledByCaller
        isOpen={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onScanSuccess={(code, playSound) => {
          setCameraOpen(false);
          return handleScan(code, playSound);
        }}
      />

      {/* หน้าต่างพิมพ์สติกเกอร์ */}
      {printJob && (
        <div className="fixed inset-0 z-50 bg-m3-grey-800/48 overflow-auto p-4">
          <div className="bg-white rounded-2xl max-w-2xl mx-auto p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="font-bold text-m3-grey-800">สติกเกอร์กล่อง — {printJob.billNo}</div>
              <button onClick={() => setPrintJob(null)} className="text-m3-grey-500 hover:text-m3-grey-600">✕</button>
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
                  className="w-full border border-[rgba(145,158,171,0.2)] rounded-xl sticker-print-item"
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
                className="flex-1 py-3 rounded-xl bg-m3-primary text-white font-bold"
              >
                พิมพ์
              </button>
              <button onClick={() => setPrintJob(null)} className="px-4 py-3 rounded-xl border border-[rgba(145,158,171,0.2)] text-m3-grey-600">
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

"use client";

import { SolarDangerTriangle } from "@/components/icons";
import { useState, useEffect, useCallback, useMemo } from "react";
import { outboundApi, type ShipmentDetailData, type ShipmentListItem } from "@/client/outbound-client";
import { usePollingWhenVisible } from "@/hooks/use-visibility-polling";
import BarcodeScanInput from "@/components/scanner/BarcodeScanInput";
import ScanFeedbackBanner from "@/components/scanner/ScanFeedbackBanner";
import CameraBarcodeScannerModal from "@/components/ui/CameraBarcodeScannerModal";
import { feedbackSuccess, feedbackError, feedbackDone, feedbackWarn } from "@/client/feedback";
import { queuedScan } from "@/client/offline-scan-queue";
import { useOfflineScanQueue, OfflineQueueBadge } from "@/hooks/use-offline-scan-queue";
import type { Feedback } from "@/app/(dashboard)/outbound/_lib/types";

/**
 * ขึ้นรถ — "เลือกบิลก่อน แล้วค่อยสแกนกล่อง"
 * สร้างรอบ (ทะเบียนรถ + ☑ บิล) → Expected = จำนวนกล่องรวม → สแกน BX ทีละใบ
 * ปิดรอบได้เมื่อครบ หรือ Manager ยืนยันกล่องที่ขาดทุกใบ (ไปรอบถัดไป/ยกเลิก + เหตุผล)
 */

export default function OutboundLoadingPage() {
  const [shipments, setShipments] = useState<ShipmentListItem[]>([]);
  const [packedBills, setPackedBills] = useState<Array<{ document_id: string; document_no: string; express_bill_no: string; customer?: string; box_count: number; outbound_status: string }>>([]);
  const [active, setActive] = useState<ShipmentDetailData | null>(null);
  const [activeNo, setActiveNo] = useState("");

  const [scanValue, setScanValue] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [flash, setFlash] = useState<"ok" | "bad" | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // ฟอร์มสร้างรอบ
  const [showCreate, setShowCreate] = useState(false);
  const [truckPlate, setTruckPlate] = useState("");
  const [destination, setDestination] = useState("");
  const [selectedBills, setSelectedBills] = useState<string[]>([]);

  // โมดัลปิดรอบ (ยืนยันกล่องที่ขาด)
  const [closing, setClosing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [{ data: s }, { data: b }] = await Promise.all([
        outboundApi.listShipments(),
        outboundApi.listBills(),
      ]);
      setShipments(s.shipments);
      setPackedBills(
        b.bills.filter((x) => x.outbound_status === "PACKED" || x.outbound_status === "PARTIALLY_SHIPPED")
      );
    } catch {}
  }, []);

  const loadActive = useCallback(async (no: string) => {
    const { data } = await outboundApi.getShipment(no);
    setActive(data);
    setActiveNo(data.doc.document_no);
    return data;
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  usePollingWhenVisible(
    useCallback(() => {
      if (activeNo) return loadActive(activeNo).catch(() => {});
      return load();
    }, [activeNo, loadActive, load]),
    12000
  );

  const doFlash = (kind: "ok" | "bad") => {
    setFlash(kind);
    window.setTimeout(() => setFlash(null), kind === "ok" ? 350 : 650);
  };

  const expected = active?.note.expected_box_ids.length ?? 0;
  const loaded = active?.note.loaded_box_ids.length ?? 0;

  // ---------- สร้างรอบ ----------
  const createRound = useCallback(async () => {
    if (!truckPlate.trim() || selectedBills.length === 0) return;
    setBusy(true);
    try {
      const { message } = await outboundApi.createShipment({
        truck_plate: truckPlate.trim(),
        destination: destination.trim() || undefined,
        bill_ids: selectedBills,
      });
      feedbackDone();
      setFeedback({ tone: "success", message });
      setShowCreate(false);
      setTruckPlate("");
      setDestination("");
      setSelectedBills([]);
      await load();
    } catch (e) {
      feedbackError();
      setFeedback({ tone: "error", message: e instanceof Error ? e.message : "สร้างรอบไม่สำเร็จ" });
    } finally {
      setBusy(false);
    }
  }, [truckPlate, destination, selectedBills, load]);

  // ---------- สแกนกล่อง ----------
  const offlineQueue = useOfflineScanQueue();
  const handleScan = useCallback(
    async (code: string, playSound = false) => {
      setScanValue("");
      if (!active) return;
      try {
        const result = await queuedScan({
          url: `/api/outbound/shipments/${encodeURIComponent(activeNo)}`,
          body: { action: "scan", box_code: code },
          label: `กล่อง ${code} ขึ้นรถ (${activeNo})`,
        });
        if (result.status === "queued") {
          if (playSound) feedbackWarn();
          setFeedback({ tone: "success", message: `🟠 ออฟไลน์ — บันทึกกล่อง ${code} ไว้ในเครื่องแล้ว จะส่งเองเมื่อเน็ตกลับ` });
          offlineQueue.refreshCounts();
          return;
        }
        if (playSound) feedbackSuccess();
        doFlash("ok");
        const done = loaded + 1 >= expected;
        if (done && playSound) feedbackDone();
        setFeedback({ tone: "success", message: result.message });
        await loadActive(activeNo);
      } catch (e) {
        if (playSound) feedbackError();
        doFlash("bad");
        setFeedback({ tone: "error", message: e instanceof Error ? e.message : "✗ สแกนไม่สำเร็จ" });
        await loadActive(activeNo).catch(() => {});
      }
    },
    [active, activeNo, loadActive, loaded, expected, offlineQueue]
  );

  // ---------- ปิดรอบ ----------
  const missingBoxes = active?.missing ?? [];
  const [confirmations, setConfirmations] = useState<Record<string, { outcome: "ROLLOVER" | "CANCELLED"; reason: string }>>({});

  const closeRound = useCallback(async () => {
    if (!active) return;
    // ทุกกล่องที่ขาดต้องมีการตัดสิน
    const payload = missingBoxes.map((b) => {
      const c = confirmations[b.box_id];
      if (!c || !c.reason.trim()) {
        throw new Error(`กล่อง ${b.box_code} ยังไม่ได้เลือกผล/กรอกเหตุผล`);
      }
      return { box_id: b.box_id, outcome: c.outcome, reason: c.reason.trim() };
    });
    setBusy(true);
    try {
      const { message } = await outboundApi.shipmentAction(activeNo, { action: "close", confirmations: payload });
      feedbackDone();
      setFeedback({ tone: "success", message });
      setClosing(false);
      setActive(null);
      setActiveNo("");
      setConfirmations({});
      await load();
    } catch (e) {
      feedbackError();
      setFeedback({ tone: "error", message: e instanceof Error ? e.message : "ปิดรอบไม่สำเร็จ" });
    } finally {
      setBusy(false);
    }
  }, [active, activeNo, missingBoxes, confirmations, load]);

  // ============================================================
  // มุมมอง 2: รอบที่กำลังทำงาน
  // ============================================================
  if (active) {
    const allLoaded = loaded >= expected && expected > 0;
    return (
      <div className={`max-w-2xl mx-auto pb-24 sm:pb-8 space-y-4 transition-colors duration-150 ${flash === "ok" ? "bg-[rgba(0,167,111,0.08)]" : flash === "bad" ? "bg-[rgba(255,86,48,0.08)]" : ""}`}>
        <div className="bg-white rounded-xl border border-[rgba(145,158,171,0.2)] p-4">
          <div className="flex items-center justify-between">
            <button
              onClick={() => { setActive(null); setActiveNo(""); setFeedback(null); }}
              className="text-m3-grey-500 hover:text-m3-grey-600 text-sm"
            >
              ✕ ปิด
            </button>
            <div className="text-center">
              <div className="text-2xl font-extrabold text-m3-grey-800">{active.note.truck_plate}</div>
              <div className="text-xs text-m3-grey-500">{active.doc.document_no}{active.note.destination ? ` · ${active.note.destination}` : ""}</div>
            </div>
            <div className="text-right text-xs text-m3-grey-500">
              {active.bills.length} บิล
            </div>
          </div>
        </div>

        <OfflineQueueBadge pendingCount={offlineQueue.pendingCount} online={offlineQueue.online} />

        {feedback && <ScanFeedbackBanner feedback={feedback ? { type: feedback.tone === "error" ? "error" : "success", message: feedback.message } : null} />}

        {/* ตัวนับใหญ่ */}
        <div className="bg-white rounded-xl border-2 border-m3-primary/30 p-6 text-center">
          <div className="text-xs text-m3-grey-500 tracking-widest">กล่องที่ขึ้นรถแล้ว</div>
          <div className="text-6xl font-extrabold tabular-nums text-m3-primary-dark leading-none">
            {loaded}<span className="text-3xl text-m3-grey-400">/{expected}</span>
          </div>
          <div className="mt-3 h-3 rounded-full bg-m3-grey-200 overflow-hidden">
            <div className="h-full bg-m3-primary rounded-full transition-all duration-300" style={{ width: `${expected ? Math.round((loaded / expected) * 100) : 0}%` }} />
          </div>
        </div>

        {(active.note.shipment_status === "OPEN" || active.note.shipment_status === "LOADING") && (
          <>
            <BarcodeScanInput
              value={scanValue}
              onChange={setScanValue}
              onScanSubmit={(code) => void handleScan(code)}
              onOpenScannerModal={() => setCameraOpen(true)}
              placeholder="สแกนบาร์โค้ดกล่อง (BX-…)…"
              isProcessing={busy}
            />

            {/* กล่องในรอบ */}
            <div className="bg-white rounded-xl border border-[rgba(145,158,171,0.2)] p-4 space-y-2">
              <div className="text-xs font-bold text-m3-grey-600">กล่องในรอบนี้</div>
              {active.boxes.map((b) => (
                <div
                  key={b.box_id}
                  className={`flex items-center justify-between px-3 py-2.5 rounded-xl ${
                    b.box_status === "LOADED" || b.box_status === "SHIPPED"
                      ? "bg-[rgba(0,167,111,0.08)] text-m3-primary-dark"
                      : "bg-m3-grey-100 text-m3-grey-600"
                  }`}
                >
                  <div className="tabular-nums text-sm">{b.box_code}</div>
                  <div className="text-xs">
                    {b.bill_document_no} · {b.total_qty} ชิ้น ·{" "}
                    {b.box_status === "LOADED" || b.box_status === "SHIPPED" ? "✓ ขึ้นรถแล้ว" : "ยังไม่ขึ้น"}
                  </div>
                  {b.box_status === "LOADED" && (
                    <button
                      onClick={async () => {
                        try {
                          await outboundApi.shipmentAction(activeNo, { action: "unload", box_code: b.box_code });
                          await loadActive(activeNo);
                        } catch (e) {
                          setFeedback({ tone: "error", message: e instanceof Error ? e.message : "ถอดไม่สำเร็จ" });
                        }
                      }}
                      className="text-xs text-m3-error-dark font-semibold"
                    >
                      ถอด
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* ปิดรอบ */}
            <button
              onClick={() => {
                if (allLoaded) void closeRound();
                else setClosing(true);
              }}
              disabled={busy || loaded === 0}
              className="w-full py-6 rounded-xl bg-m3-primary text-white text-2xl font-extrabold disabled:opacity-40 active:scale-[0.98] transition-transform"
            >
              {allLoaded ? "ปิดรอบ — ออกรถ" : `ปิดรอบ (เหลือ ${expected - loaded} กล่อง)`}
            </button>
          </>
        )}

        {active.note.shipment_status === "CLOSED" && (
          <div className="space-y-3">
            <div className="bg-[rgba(0,167,111,0.08)] border border-[rgba(0,167,111,0.24)] rounded-xl p-5 text-center font-bold text-m3-primary-dark">
              ปิดรอบแล้ว — ออกรถเรียบร้อย ✅
            </div>
            {active.note.express_synced_at ? (
              <div className="text-center text-xs text-m3-grey-500">
                ส่งยอดเข้า Express แล้วเมื่อ {new Date(active.note.express_synced_at).toLocaleString("th-TH")}
              </div>
            ) : (
              <button
                onClick={async () => {
                  try {
                    const res = await fetch(
                      `/api/outbound/shipments/${encodeURIComponent(activeNo)}/export-express`,
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        cache: "no-store",
                      }
                    );
                    const json = await res.json();
                    if (!res.ok || json?.success === false) throw new Error(json?.message || "ส่งไม่สำเร็จ");
                    feedbackDone();
                    setFeedback({ tone: "success", message: json.message });
                    await loadActive(activeNo);
                  } catch (e) {
                    feedbackError();
                    setFeedback({ tone: "error", message: e instanceof Error ? e.message : "ส่งเข้า Express ไม่สำเร็จ" });
                  }
                }}
                className="w-full py-4 rounded-xl bg-m3-primary text-white text-lg font-extrabold active:scale-[0.98] transition-transform"
              >
                ส่งยอดเข้า Express
              </button>
            )}
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

        {/* โมดัลยืนยันกล่องที่ขาด */}
        {closing && (
          <div className="fixed inset-0 z-50 bg-m3-grey-800/48 overflow-auto p-4">
            <div className="bg-white rounded-2xl max-w-lg mx-auto p-5 space-y-4">
              <div className="text-center">
                <SolarDangerTriangle size={40} className="mx-auto mb-1 text-m3-warning" />
                <div className="font-bold text-m3-grey-800">ยังมี {missingBoxes.length} กล่องที่ไม่ได้ขึ้นรถ</div>
                <div className="text-xs text-m3-grey-600">ระบุผลและเหตุผลให้ครบทุกใบ</div>
              </div>
              {missingBoxes.map((b) => {
                const c = confirmations[b.box_id] ?? { outcome: "ROLLOVER" as const, reason: "" };
                return (
                  <div key={b.box_id} className="border border-[rgba(145,158,171,0.2)] rounded-xl p-3 space-y-2">
                    <div className="tabular-nums text-sm font-bold text-m3-grey-800">{b.box_code} <span className="text-xs font-normal text-m3-grey-500">({b.bill_document_no})</span></div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setConfirmations((prev) => ({ ...prev, [b.box_id]: { ...c, outcome: "ROLLOVER" } }))}
                        className={`flex-1 py-2.5 rounded-xl text-sm font-bold border ${c.outcome === "ROLLOVER" ? "bg-m3-warning text-white border-m3-warning" : "border-[rgba(145,158,171,0.2)] text-m3-grey-600"}`}
                      >
                        ไปรอบถัดไป
                      </button>
                      <button
                        onClick={() => setConfirmations((prev) => ({ ...prev, [b.box_id]: { ...c, outcome: "CANCELLED" } }))}
                        className={`flex-1 py-2.5 rounded-xl text-sm font-bold border ${c.outcome === "CANCELLED" ? "bg-m3-error text-white border-m3-error" : "border-[rgba(145,158,171,0.2)] text-m3-grey-600"}`}
                      >
                        ✕ ไม่ส่งกล่องนี้
                      </button>
                    </div>
                    <input
                      type="text"
                      value={c.reason}
                      onChange={(e) => setConfirmations((prev) => ({ ...prev, [b.box_id]: { ...c, reason: e.target.value } }))}
                      placeholder="เหตุผล"
                      className="w-full border border-[rgba(145,158,171,0.2)] rounded-xl px-3 py-2 text-sm"
                    />
                  </div>
                );
              })}
              <div className="flex gap-2">
                <button
                  onClick={() => void closeRound()}
                  disabled={busy}
                  className="flex-1 py-3 rounded-xl bg-m3-primary text-white font-bold disabled:opacity-40"
                >
                  ยืนยันปิดรอบ
                </button>
                <button onClick={() => setClosing(false)} className="px-4 py-3 rounded-xl border border-[rgba(145,158,171,0.2)] text-m3-grey-600">
                  ย้อนกลับ
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ============================================================
  // มุมมอง 1: รายการรอบ + สร้างรอบใหม่
  // ============================================================
  return (
    <div className="max-w-2xl mx-auto pb-20 sm:pb-8 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-m3-primary-dark flex items-center gap-2">
          ของขึ้นรถ
        </h1>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="px-4 py-2.5 rounded-xl bg-m3-primary text-white text-sm font-semibold"
        >
          สร้างรอบ
        </button>
      </div>

      {feedback && <ScanFeedbackBanner feedback={feedback ? { type: feedback.tone === "error" ? "error" : "success", message: feedback.message } : null} />}

      {/* ฟอร์มสร้างรอบ: เลือกบิลก่อน → รู้จำนวนกล่องรวม */}
      {showCreate && (
        <div className="bg-white rounded-xl border border-[rgba(145,158,171,0.2)] p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold text-m3-grey-700 mb-1">ทะเบียนรถ *</label>
              <input
                type="text"
                value={truckPlate}
                onChange={(e) => setTruckPlate(e.target.value)}
                placeholder="เช่น 1กข 1234"
                className="w-full border border-[rgba(145,158,171,0.2)] rounded-xl px-3 py-2.5"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-m3-grey-700 mb-1">ปลายทาง/หมายเหตุ</label>
              <input
                type="text"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                className="w-full border border-[rgba(145,158,171,0.2)] rounded-xl px-3 py-2.5"
              />
            </div>
          </div>

          <div>
            <div className="text-sm font-semibold text-m3-grey-700 mb-2">
              เลือกบิลที่จะขึ้นรอบนี้ ({selectedBills.length} เลือกแล้ว)
            </div>
            {packedBills.length === 0 ? (
              <div className="text-sm text-m3-grey-500">ไม่มีบิลที่แพ็กครบรอขึ้นรถ</div>
            ) : (
              <div className="space-y-2">
                {packedBills.map((b) => {
                  const checked = selectedBills.includes(b.document_id);
                  return (
                    <button
                      key={b.document_id}
                      onClick={() =>
                        setSelectedBills((prev) =>
                          checked ? prev.filter((x) => x !== b.document_id) : [...prev, b.document_id]
                        )
                      }
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-colors ${
                        checked ? "border-m3-primary bg-[rgba(0,167,111,0.08)]" : "border-[rgba(145,158,171,0.2)] hover:border-m3-grey-400"
                      }`}
                    >
                      <span className={`w-6 h-6 rounded-md border flex items-center justify-center text-sm font-extrabold ${checked ? "bg-m3-primary text-white border-m3-primary" : "border-m3-grey-400"}`}>
                        {checked ? "✓" : ""}
                      </span>
                      <span className="flex-1">
                        <span className="font-bold text-m3-grey-800">{b.express_bill_no}</span>
                        <span className="ml-2 text-xs text-m3-grey-500">{b.customer}</span>
                        {b.outbound_status === "PARTIALLY_SHIPPED" && (
                          <span className="ml-2 text-xs font-bold text-m3-warning-dark">กล่องค้างจากรอบก่อน</span>
                        )}
                      </span>
                      <span className="text-2xl font-extrabold tabular-nums text-m3-primary-dark">{b.box_count}</span>
                      <span className="text-xs text-m3-grey-500">กล่อง</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <button
            onClick={() => void createRound()}
            disabled={busy || !truckPlate.trim() || selectedBills.length === 0}
            className="w-full py-3.5 rounded-xl bg-m3-primary text-white font-bold disabled:opacity-40"
          >
            สร้างรอบรถ
          </button>
        </div>
      )}

      {/* รายการรอบ */}
      {shipments.length === 0 ? (
        <div className="bg-white rounded-xl border border-[rgba(145,158,171,0.2)] p-8 text-center text-m3-grey-500">
          ยังไม่มีรอบรถ
        </div>
      ) : (
        shipments.map((s) => (
          <button
            key={s.document_id}
            onClick={() => void loadActive(s.document_no).catch(() => {})}
            className="w-full bg-white rounded-xl border border-[rgba(145,158,171,0.2)] p-5 text-left hover:border-m3-primary/40 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="text-lg font-extrabold text-m3-grey-800">{s.truck_plate}</div>
                <div className="text-xs text-m3-grey-500 tabular-nums">
                  {s.document_no} · {s.bill_count} บิล{s.destination ? ` · ${s.destination}` : ""}
                </div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-extrabold tabular-nums text-m3-primary-dark">
                  {s.loaded_boxes}/{s.expected_boxes}
                </div>
                <div className="text-xs text-m3-grey-500">กล่อง</div>
              </div>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span
                className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                  s.shipment_status === "CLOSED"
                    ? "bg-[rgba(0,167,111,0.08)] text-m3-primary-dark"
                    : s.shipment_status === "CANCELLED"
                      ? "bg-m3-grey-200 text-m3-grey-500"
                      : "bg-[rgba(0,184,217,0.08)] text-m3-info-dark"
                }`}
              >
                {s.shipment_status === "OPEN" ? "เปิดรอบ" : s.shipment_status === "LOADING" ? "กำลังขึ้นรถ" : s.shipment_status === "CLOSED" ? "ปิดรอบแล้ว" : "ยกเลิก"}
              </span>
              {s.shipment_status !== "CLOSED" && s.shipment_status !== "CANCELLED" && (
                <span className="text-xs text-m3-grey-500">สแกนกล่อง ▶</span>
              )}
            </div>
          </button>
        ))
      )}
    </div>
  );
}

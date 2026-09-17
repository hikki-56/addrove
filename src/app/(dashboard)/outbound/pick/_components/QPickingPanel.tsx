"use client";

import { useState, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { outboundApi, type QPickViewData } from "@/lib/outbound-client";
import BarcodeScanInput from "@/components/scanner/BarcodeScanInput";
import ScanFeedbackBanner from "@/components/scanner/ScanFeedbackBanner";
import CameraBarcodeScannerModal from "@/components/ui/CameraBarcodeScannerModal";
import { feedbackSuccess, feedbackError, feedbackDone, feedbackWarn } from "@/lib/feedback";
import { areBarcodesMatching } from "@/lib/barcode-utils";
import { getWarehouseDisplayName } from "@/lib/warehouse-utils";
import { queuedScan } from "@/lib/offline-scan-queue";

/**
 * งานกล่อง Q — พนักงานแพ็กของ
 * ขั้นตอนสั้นที่สุด: สแกนกล่อง Q → ดูรายการที่ Admin กำหนด → หยิบ → สแกนสินค้ายืนยันทีละชิ้น → ครบ → ยืนยันไปแพ็ก
 * (พนักงานไม่เลือกสินค้าเอง — Admin กำหนดทุกอย่างล่วงหน้าแล้ว)
 */

type Feedback = { tone: "success" | "error" | "info"; message: string } | null;

const PROBLEM_OPTIONS = [
  { value: "NOT_FOUND", icon: "📭", label: "หาไม่เจอ" },
  { value: "INSUFFICIENT", icon: "🔻", label: "ของไม่ครบ" },
  { value: "DAMAGED", icon: "💥", label: "ของเสีย" },
  { value: "BAD_BARCODE", icon: "▤", label: "บาร์โค้ดเสีย" },
  { value: "OTHER", icon: "❓", label: "อื่นๆ" },
] as const;

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s\-_#]/g, "");

export default function QPickingPanel() {
  const router = useRouter();
  const [view, setView] = useState<"scan" | "picking" | "done">("scan");
  const [qData, setQData] = useState<QPickViewData | null>(null);
  const [qScanValue, setQScanValue] = useState("");
  const [itemScanValue, setItemScanValue] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [flash, setFlash] = useState<"ok" | "bad" | null>(null);
  const [cameraMode, setCameraMode] = useState<"q" | "item" | null>(null);
  const [problemFor, setProblemFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [doneMessage, setDoneMessage] = useState("");
  const lockRef = useRef(false);

  const doFlash = (kind: "ok" | "bad") => {
    setFlash(kind);
    window.setTimeout(() => setFlash(null), kind === "ok" ? 350 : 650);
  };

  // ---------- สแกนกล่อง Q → เปิดรายการ ----------
  const startQ = useCallback(async (code: string) => {
    setQScanValue("");
    if (lockRef.current) return;
    lockRef.current = true;
    setBusy(true);
    setFeedback(null);
    try {
      const { data } = await outboundApi.qPickAction({ q_code: code, action: "start" });
      setQData(data as unknown as QPickViewData);
      setView("picking");
      setItemScanValue("");
      feedbackSuccess();
      doFlash("ok");
      setFeedback(null);
    } catch (e) {
      feedbackError();
      doFlash("bad");
      setFeedback({ tone: "error", message: e instanceof Error ? e.message : "✗ ไม่พบงานของกล่องนี้" });
    } finally {
      setBusy(false);
      lockRef.current = false;
    }
  }, []);

  const qDataRef = useRef<QPickViewData | null>(null);
  qDataRef.current = qData;
  const scanQueueRef = useRef<Promise<void>>(Promise.resolve());

  // ---------- สแกนสินค้ายืนยัน 1 ชิ้น (Optimistic Instant Update — 0ms ทันที) ----------
  const handleItemScan = useCallback(
    (code: string) => {
      setItemScanValue("");
      const currentQData = qDataRef.current;
      if (!currentQData) return;

      // ตรวจฝั่ง client ทันที (0ms)
      const codeClean = norm(code);
      const item = currentQData.items.find((it) => {
        if (areBarcodesMatching(code, [it.sku, it.barcode, it.product_id])) return true;
        if (it.product_name) {
          const pn = norm(it.product_name);
          if (pn === codeClean) return true;
          if (codeClean.length >= 3 && (pn.includes(codeClean) || codeClean.includes(pn))) return true;
        }
        return false;
      });

      if (!item) {
        feedbackError();
        doFlash("bad");
        setFeedback({ tone: "error", message: `✗ ไม่อยู่ในกล่อง ${currentQData.q_code} (${code})` });
        return;
      }

      if (item.qty_picked >= item.qty_required) {
        feedbackWarn();
        doFlash("bad");
        setFeedback({ tone: "error", message: `✗ ${item.product_name || item.sku} หยิบครบแล้ว` });
        return;
      }

      // 1. ตอบสนองทันทีแบบ Real-time (0ms Optimistic UI)
      item.qty_picked += 1;
      item.remaining = Math.max(0, item.qty_required - item.qty_picked);
      const isBoxDone = currentQData.items.every(
        (it) => it.qty_picked >= it.qty_required || it.status === "PROBLEM"
      );

      // อัปเดตหน้าจอทันที ไม่ต้องรอผลจาก Server
      setQData({
        ...currentQData,
        items: [...currentQData.items],
      });
      feedbackSuccess();
      doFlash("ok");
      setFeedback({
        tone: "success",
        message: `✓ หยิบ ${item.product_name || item.sku}: ${item.qty_picked}/${item.qty_required} ชิ้น${
          item.qty_picked >= item.qty_required ? " (ครบแล้ว)" : ""
        }`,
      });

      if (isBoxDone) {
        feedbackDone();
        setDoneMessage(`กล่อง ${currentQData.q_code} หยิบเสร็จสมบูรณ์`);
        setView("done");
      }

      // 2. ส่งคำขอยืนยันไปที่ Server ในเบื้องหลังผ่านคิวเรียงลำดับ (Sequential Queue)
      scanQueueRef.current = scanQueueRef.current
        .then(async () => {
          const result = await queuedScan({
            url: "/api/outbound/q/pick",
            body: { q_code: currentQData.q_code, action: "confirm-item", scan: item.sku },
            label: `Q ${currentQData.q_code}: หยิบ ${item.product_name || item.sku} (1 ชิ้น)`,
          });

          if (result.status === "queued") return;

          const payload = result.data as {
            sku: string;
            qty_picked: number;
            q_status: string;
            work_order_status: string;
          };

          // ซิงค์ยอดที่ถูกต้องจาก server หากมีค่าที่มากกว่า
          if (qDataRef.current) {
            const serverItem = qDataRef.current.items.find((it) => norm(it.sku) === norm(payload.sku));
            if (serverItem && serverItem.qty_picked < payload.qty_picked) {
              serverItem.qty_picked = payload.qty_picked;
              serverItem.remaining = Math.max(0, serverItem.qty_required - payload.qty_picked);
              setQData({ ...qDataRef.current, items: [...qDataRef.current.items] });
            }
          }
        })
        .catch((err) => {
          // หาก Server ปฏิเสธ (เช่น เกิดข้อผิดพลาดจริง): Rollback ยอดที่เพิ่มไว้กลับ
          if (qDataRef.current) {
            const rollbackItem = qDataRef.current.items.find((it) => norm(it.sku) === norm(item.sku));
            if (rollbackItem && rollbackItem.qty_picked > 0) {
              rollbackItem.qty_picked -= 1;
              rollbackItem.remaining = Math.min(
                rollbackItem.qty_required,
                rollbackItem.qty_required - rollbackItem.qty_picked
              );
              setQData({ ...qDataRef.current, items: [...qDataRef.current.items] });
            }
          }
          feedbackError();
          doFlash("bad");
          setFeedback({
            tone: "error",
            message: err instanceof Error ? err.message : "✗ สแกนไม่สำเร็จ ระบบยกเลิกยอดที่เพิ่ม",
          });
        });
    },
    []
  );

  // ---------- แจ้งปัญหา ----------
  const submitProblem = useCallback(
    async (problem: string, pickedQty?: number) => {
      if (!problemFor || !qData) return;
      setBusy(true);
      try {
        const { message } = await outboundApi.qPickAction({
          q_code: qData.q_code,
          action: "report-problem",
          scan: problemFor,
          problem,
          ...(typeof pickedQty === "number" ? { picked_qty: pickedQty } : {}),
        });
        feedbackWarn();
        setProblemFor(null);
        setFeedback({ tone: "info", message });
        setQData((prev) =>
          prev
            ? {
                ...prev,
                items: prev.items.map((it) =>
                  norm(it.sku) === norm(problemFor) ? { ...it, status: "PROBLEM" } : it
                ),
              }
            : prev
        );
      } catch (e) {
        feedbackError();
        setFeedback({ tone: "error", message: e instanceof Error ? e.message : "บันทึกปัญหาไม่สำเร็จ" });
      } finally {
        setBusy(false);
      }
    },
    [problemFor, qData]
  );

  const items = useMemo(() => qData?.items ?? [], [qData]);
  const pendingItems = useMemo(
    () =>
      items
        .filter((it) => it.qty_picked < it.qty_required && it.status !== "PROBLEM")
        .sort((a, b) => (a.location_id || "zz").localeCompare(b.location_id || "zz")),
    [items]
  );
  const current = pendingItems[0];
  const pickedCount = items.filter((it) => it.qty_picked >= it.qty_required || it.status === "PROBLEM").length;
  const totalCount = items.length;

  const resetToScan = () => {
    setView("scan");
    setQData(null);
    setFeedback(null);
    setDoneMessage("");
  };

  // ============================================================
  // มุมมอง: สแกนกล่อง Q (จุดเริ่มงาน — หน้ามีแค่ช่องสแกน)
  // ============================================================
  if (view === "scan") {
    return (
      <div className="space-y-3">
        <div className="bg-gradient-to-br from-sky-600 to-sky-700 rounded-2xl p-6 sm:p-8 text-white space-y-4 shadow-md">
          <div className="flex items-center gap-4">
            <span className="text-5xl">📦</span>
            <div>
              <div className="text-xl sm:text-2xl font-extrabold">งานกล่อง Q (Q1 - Q6)</div>
              <div className="text-xs sm:text-sm text-sky-100">
                สแกน QR Code / บาร์โค้ดหน้ากล่องเพื่อเปิดรายการสินค้า
              </div>
            </div>
          </div>
          <div className="rounded-xl bg-white/95 p-3">
            <BarcodeScanInput
              value={qScanValue}
              onChange={setQScanValue}
              onScanSubmit={(code) => void startQ(code)}
              onOpenScannerModal={() => setCameraMode("q")}
              placeholder="สแกน QR Code หรือพิมพ์กล่อง Q เช่น Q1, Q2…"
              isProcessing={busy}
            />
          </div>
          {busy && (
            <div className="flex items-center justify-center gap-2.5 py-1 text-white text-sm sm:text-base font-bold animate-pulse">
              <svg className="w-5 h-5 animate-spin text-white" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              <span>กำลังโหลดข้อมูลกล่อง Q...</span>
            </div>
          )}
        </div>
        {feedback && (
          <ScanFeedbackBanner
            feedback={{ type: feedback.tone === "error" ? "error" : "success", message: feedback.message }}
          />
        )}
        <CameraBarcodeScannerModal
          isOpen={cameraMode === "q"}
          onClose={() => setCameraMode(null)}
          onScanSuccess={(code) => {
            setCameraMode(null);
            void startQ(code);
          }}
        />
      </div>
    );
  }

  // ============================================================
  // มุมมอง: กล่องหยิบเสร็จ → ยืนยันไปขั้นตอนแพ็กของใส่กล่อง
  // ============================================================
  if (view === "done" && qData) {
    return (
      <div className="space-y-4">
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-8 text-center space-y-3">
          <div className="text-6xl">✅</div>
          <div className="text-2xl font-black text-emerald-900">กล่อง {qData.q_code} หยิบเสร็จ</div>
          <div className="text-sm text-emerald-700">{doneMessage}</div>
          <div className="text-xs text-emerald-600">
            รายการทั้งหมด {totalCount} รายการ — กดยืนยันเพื่อไปขั้นตอนแพ็กของใส่กล่อง
          </div>
        </div>
        <button
          onClick={() => router.push("/outbound/pack")}
          className="w-full py-6 rounded-2xl bg-emerald-600 text-white text-2xl font-black active:scale-[0.98] transition-transform"
        >
          ✓ ยืนยัน — ไปแพ็กของใส่กล่อง
        </button>
        <button
          onClick={resetToScan}
          className="w-full py-4 rounded-2xl bg-white border border-[#E8ECEA] text-slate-600 text-lg font-bold active:scale-[0.98] transition-transform"
        >
          📦 สแกนกล่อง Q ถัดไป
        </button>
        {feedback && (
          <ScanFeedbackBanner
            feedback={{ type: feedback.tone === "error" ? "error" : "success", message: feedback.message }}
          />
        )}
      </div>
    );
  }

  // ============================================================
  // มุมมอง: กำลังหยิบตามรายการของกล่อง Q
  // ============================================================
  if (!qData) return null;

  return (
    <div
      className={`flex flex-col gap-4 transition-colors duration-150 lg:min-h-[calc(100dvh-13rem)] ${
        flash === "ok" ? "bg-emerald-50" : flash === "bad" ? "bg-red-50" : ""
      }`}
    >
      {/* หัวกล่อง + บาร์โค้ดประจำกล่อง Q + progress */}
      <div className="bg-white rounded-2xl border border-sky-200 p-4 sm:p-5 space-y-3 shadow-sm">
        <div className="flex items-center justify-between">
          <button onClick={resetToScan} className="text-slate-400 hover:text-slate-600 text-sm font-semibold flex items-center gap-1">
            ✕ ปิด
          </button>
          <div className="text-center">
            <div className="text-3xl lg:text-5xl font-black text-sky-700 tabular-nums">📦 {qData.q_code}</div>
          </div>
          <div className="text-right">
            <div className="text-2xl lg:text-4xl font-black tabular-nums text-sky-700">
              {pickedCount}/{totalCount}
            </div>
            <div className="text-xs lg:text-sm text-slate-400">รายการ</div>
          </div>
        </div>


        {/* แถบ Progress */}
        <div className="h-3 rounded-full bg-slate-100 overflow-hidden">
          <div
            className="h-full bg-sky-600 rounded-full transition-all duration-300"
            style={{ width: `${totalCount === 0 ? 0 : Math.round((pickedCount / totalCount) * 100)}%` }}
          />
        </div>
      </div>

      {feedback && (
        <ScanFeedbackBanner
          feedback={{ type: feedback.tone === "error" ? "error" : "success", message: feedback.message }}
        />
      )}

      {/* ช่องสแกนบาร์โค้ดเร็ว — 1 สแกน = 1 ชิ้น */}
      <div className="bg-white rounded-2xl border border-[#E8ECEA] p-3">
        <BarcodeScanInput
          value={itemScanValue}
          onChange={setItemScanValue}
          onScanSubmit={(code) => void handleItemScan(code)}
          onOpenScannerModal={() => setCameraMode("item")}
          placeholder="สแกนบาร์โค้ด หรือพิมพ์ชื่อสินค้าเพื่อตัดยอดหยิบทันที…"
          isProcessing={busy}
        />
      </div>

      {/* แสดงรายการสินค้าที่จะต้องไปหยิบใส่ในกล่อง Q นี้ให้ครบทุกรายการ */}
      <div className="bg-white rounded-2xl border border-[#E8ECEA] p-4 space-y-3 shadow-sm">

        <div className="space-y-3">
          {items.map((it, i) => {
            const done = it.qty_picked >= it.qty_required;
            const problem = it.status === "PROBLEM";
            const remaining = Math.max(0, it.qty_required - it.qty_picked);
            const isCurrent = Boolean(current) && norm(it.sku) === norm(current.sku);

            return (
              <div
                key={`${it.sku}-${i}`}
                className={`p-3.5 lg:p-5 rounded-2xl border transition-all ${
                  isCurrent
                    ? "bg-sky-50/70 border-sky-300 ring-2 ring-sky-200/80 shadow-sm"
                    : done
                      ? "bg-emerald-50/40 border-emerald-200"
                      : problem
                        ? "bg-orange-50/50 border-orange-200"
                        : "bg-[#F7F9F8] border-slate-200"
                }`}
              >
                <div className="flex items-start gap-3">
                  <span className="text-xl sm:text-2xl shrink-0 mt-0.5">
                    {done ? "✅" : problem ? "⚠️" : isCurrent ? "🔵" : "⬜"}
                  </span>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    {/* แท็กตำแหน่งชั้นวาง */}
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-2.5 py-0.5 rounded-lg bg-sky-100 text-sky-900 font-mono font-black text-xs sm:text-sm">
                        📍 {it.location_id || (it as unknown as { location_hint?: string }).location_hint || "ไม่ระบุตำแหน่ง"}
                      </span>
                      {it.location_wh && (
                        <span className="px-2 py-0.5 rounded-lg bg-amber-100 text-amber-800 text-xs font-medium">
                          🏬 {getWarehouseDisplayName(it.location_wh)}
                        </span>
                      )}
                      {done && (
                        <span className="px-2 py-0.5 rounded-lg bg-emerald-100 text-emerald-800 text-xs font-bold">
                          ✓ หยิบครบแล้ว
                        </span>
                      )}
                      {problem && (
                        <span className="px-2 py-0.5 rounded-lg bg-orange-100 text-orange-800 text-xs font-bold">
                          ⚠️ แจ้งปัญหาแล้ว
                        </span>
                      )}
                    </div>

                    {/* ชื่อสินค้า + จำนวน (อยู่บรรทัดเดียวกัน) */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="font-bold text-slate-900 text-base sm:text-lg leading-snug break-words flex-1 min-w-0">
                        {it.product_name || it.sku}
                      </div>

                      <div className="text-right shrink-0">
                        <button
                          type="button"
                          onClick={() => handleItemScan(it.sku)}
                          disabled={done || problem}
                          className="text-right active:scale-90 transition-transform cursor-pointer px-2.5 py-1 -mr-1 rounded-xl bg-sky-50 hover:bg-sky-100 border border-sky-200/80 shadow-xs"
                          title="แตะเพื่อหยิบ 1 ชิ้นทันที"
                        >
                          <div className="text-xl sm:text-2xl font-black tabular-nums text-sky-950">
                            {it.qty_picked}/{it.qty_required} <span className="text-xs font-normal text-slate-500">ชิ้น</span>
                          </div>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ปุ่มเมื่อหยิบครบทุกรายการในกล่องนี้ */}
      {items.every((it) => it.qty_picked >= it.qty_required || it.status === "PROBLEM") && (
        <button
          onClick={() => {
            feedbackDone();
            setDoneMessage(`กล่อง ${qData.q_code} หยิบเสร็จสมบูรณ์`);
            setView("done");
          }}
          className="w-full py-5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-xl sm:text-2xl font-black shadow-lg active:scale-[0.98] transition-transform"
        >
          ✓ ยืนยัน — กล่อง {qData.q_code} หยิบครบแล้ว (ไปแพ็กของใส่กล่อง)
        </button>
      )}

      {/* รายการที่มีปัญหาแล้ว */}
      {items.some((it) => it.status === "PROBLEM") && (
        <div className="bg-orange-50 rounded-2xl border border-orange-200 p-3">
          <div className="text-xs font-bold text-orange-900 mb-1">แจ้งปัญหาแล้ว (รอหัวหน้าตัดสิน)</div>
          {items
            .filter((it) => it.status === "PROBLEM")
            .map((it, i) => (
              <div key={i} className="text-xs text-orange-800">
                ⚠️ {it.product_name || it.sku} ({it.qty_picked}/{it.qty_required})
              </div>
            ))}
        </div>
      )}

      <CameraBarcodeScannerModal
        isOpen={cameraMode === "item"}
        onClose={() => setCameraMode(null)}
        onScanSuccess={(code) => {
          setCameraMode(null);
          void handleItemScan(code);
        }}
      />

      {/* โมดัลเลือกปัญหา */}
      {problemFor && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-5 w-full max-w-md space-y-3">
            <div className="text-center">
              <div className="text-4xl mb-1">⚠️</div>
              <div className="font-bold text-slate-800">มีปัญหาอะไรกับ</div>
              {(() => {
                const targetItem = items.find((it) => it.sku === problemFor);
                return (
                  <div className="font-bold text-slate-900 text-base lg:text-lg">
                    {targetItem?.product_name || problemFor}
                  </div>
                );
              })()}
              <div className="text-xs text-slate-400 mt-1">ในกล่อง {qData.q_code}</div>
            </div>
            {PROBLEM_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => {
                  if (opt.value === "INSUFFICIENT") {
                    const req = items.find((it) => it.sku === problemFor)?.qty_required ?? 0;
                    const input = window.prompt(`ได้จำนวนจริงเท่าไร? (0–${req})`, "0");
                    const n = Number(input);
                    if (input === null) return;
                    if (!Number.isInteger(n) || n < 0) {
                      window.alert("กรอกเลขจำนวนเต็มไม่ติดลบ");
                      return;
                    }
                    void submitProblem(opt.value, n);
                  } else {
                    void submitProblem(opt.value);
                  }
                }}
                disabled={busy}
                className="w-full py-4 rounded-2xl border border-[#E8ECEA] hover:border-amber-400 hover:bg-amber-50 flex items-center gap-3 px-4 disabled:opacity-50"
              >
                <span className="text-3xl">{opt.icon}</span>
                <span className="text-lg font-bold text-slate-800">{opt.label}</span>
              </button>
            ))}
            <button onClick={() => setProblemFor(null)} className="w-full py-3 rounded-2xl text-slate-500 font-semibold">
              ยกเลิก
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

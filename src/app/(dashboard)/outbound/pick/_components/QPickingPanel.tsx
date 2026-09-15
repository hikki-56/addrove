"use client";

import { useState, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { outboundApi, type QPickViewData } from "@/lib/outbound-client";
import BarcodeScanInput from "@/components/scanner/BarcodeScanInput";
import ScanFeedbackBanner from "@/components/scanner/ScanFeedbackBanner";
import CameraBarcodeScannerModal from "@/components/ui/CameraBarcodeScannerModal";
import { feedbackSuccess, feedbackError, feedbackDone, feedbackWarn } from "@/lib/feedback";
import { generateCode128PngDataUrl } from "@/lib/barcode-utils";
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
      const { data, message } = await outboundApi.qPickAction({ q_code: code, action: "start" });
      setQData(data as unknown as QPickViewData);
      setView("picking");
      setItemScanValue("");
      feedbackSuccess();
      doFlash("ok");
      setFeedback({ tone: "success", message });
    } catch (e) {
      feedbackError();
      doFlash("bad");
      setFeedback({ tone: "error", message: e instanceof Error ? e.message : "✗ ไม่พบงานของกล่องนี้" });
    } finally {
      setBusy(false);
      lockRef.current = false;
    }
  }, []);

  // ---------- สแกนสินค้ายืนยัน 1 ชิ้น ----------
  const handleItemScan = useCallback(
    async (code: string) => {
      setItemScanValue("");
      if (!qData || lockRef.current) return;
      lockRef.current = true;
      try {
        // ตรวจฝั่ง client ก่อน (server ตรวจซ้ำอีกชั้นเสมอ)
        const item = qData.items.find(
          (it) => norm(it.sku) === norm(code) || (it.barcode ? norm(it.barcode) === norm(code) : false)
        );
        if (!item) {
          throw new Error(`✗ ไม่อยู่ในกล่อง ${qData.q_code} (${code})`);
        }
        if (item.qty_picked >= item.qty_required) {
          throw new Error(`✗ ${item.sku} หยิบครบแล้ว`);
        }

        const result = await queuedScan({
          url: "/api/outbound/q/pick",
          body: { q_code: qData.q_code, action: "confirm-item", scan: item.sku },
          label: `Q ${qData.q_code}: หยิบ ${item.sku} (1 ชิ้น)`,
        });

        if (result.status === "queued") {
          feedbackWarn();
          setFeedback({
            tone: "success",
            message: `🟠 ออฟไลน์ — บันทึก "${result.label}" ไว้ในเครื่องแล้ว จะส่งเองเมื่อเน็ตกลับ`,
          });
          return;
        }

        const payload = result.data as {
          sku: string;
          qty_picked: number;
          q_status: string;
          work_order_status: string;
        };

        // อัปเดตตัวนับในหน้าจอจากผลลัพธ์ server
        setQData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            items: prev.items.map((it) =>
              norm(it.sku) === norm(payload.sku)
                ? { ...it, qty_picked: payload.qty_picked, remaining: Math.max(0, it.qty_required - payload.qty_picked) }
                : it
            ),
          };
        });

        feedbackSuccess();
        doFlash("ok");
        setFeedback({ tone: "success", message: result.message ?? "✓ ถูกต้อง" });

        if (payload.q_status === "DONE") {
          feedbackDone();
          setDoneMessage(result.message ?? `กล่อง ${qData.q_code} หยิบเสร็จ`);
          setView("done");
        }
      } catch (e) {
        feedbackError();
        doFlash("bad");
        setFeedback({ tone: "error", message: e instanceof Error ? e.message : "✗ สแกนไม่ถูกต้อง" });
      } finally {
        lockRef.current = false;
      }
    },
    [qData]
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
        <div className="bg-gradient-to-br from-sky-600 to-sky-700 rounded-2xl p-6 sm:p-10 text-white space-y-4 shadow-md">
          <div className="flex items-center gap-4">
            <span className="text-5xl">📦</span>
            <div>
              <div className="text-xl sm:text-2xl font-extrabold">งานกล่อง Q (Q1 - Q6)</div>
              <div className="text-xs sm:text-sm text-sky-100">
                สแกน QR Code หรือบาร์โค้ดกล่อง Q เพื่อเปิดรายการสินค้าที่ต้องหยิบ
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
      {/* หัวกล่อง + progress */}
      <div className="bg-white rounded-2xl border border-sky-200 p-4">
        <div className="flex items-center justify-between">
          <button onClick={resetToScan} className="text-slate-400 hover:text-slate-600 text-sm">
            ✕ ปิด
          </button>
          <div className="text-center">
            <div className="text-3xl lg:text-5xl font-black text-sky-700 tabular-nums">📦 {qData.q_code}</div>
            <div className="text-[18px] lg:text-2xl text-slate-400 font-mono">ใบงาน {qData.document_no}</div>
          </div>
          <div className="text-right">
            <div className="text-2xl lg:text-4xl font-black tabular-nums text-sky-700">
              {pickedCount}/{totalCount}
            </div>
            <div className="text-[18px] lg:text-xl text-slate-400">รายการ</div>
          </div>
        </div>
        <div className="mt-2 h-3 rounded-full bg-slate-100 overflow-hidden">
          <div
            className="h-full bg-sky-600 rounded-full transition-all duration-300"
            style={{ width: `${totalCount === 0 ? 0 : Math.round((pickedCount / totalCount) * 100)}%}` }}
          />
        </div>
      </div>

      {feedback && (
        <ScanFeedbackBanner
          feedback={{ type: feedback.tone === "error" ? "error" : "success", message: feedback.message }}
        />
      )}

      {/* การ์ดรายการปัจจุบัน */}
      {current ? (
        <>
          <div className="bg-white rounded-2xl border-2 border-sky-500/30 p-6 lg:p-10 lg:flex-[3] lg:flex lg:flex-col lg:justify-center text-center space-y-3 lg:space-y-5">
            <div>
              <div className="text-[18px] lg:text-2xl text-slate-400 tracking-widest">LOCATION ตำแหน่ง</div>
              <div className="text-5xl sm:text-6xl lg:text-8xl font-black font-mono text-sky-700 tabular-nums leading-tight">
                {current.location_id || (current as unknown as { location_hint?: string }).location_hint || "—"}
              </div>
              {current.location_wh && (
                <div className="mt-1 text-sm lg:text-2xl font-bold text-amber-600">
                  🏬 {getWarehouseDisplayName(current.location_wh)}
                </div>
              )}
            </div>

            <div className="h-px bg-[#E8ECEA]" />

            <div>
              <div className="text-[18px] lg:text-2xl text-slate-400 tracking-widest">QTY จำนวนที่ต้องหยิบ</div>
              <div className="text-6xl lg:text-8xl font-black text-slate-900 tabular-nums leading-none">
                {(current.qty_required - current.qty_picked).toLocaleString("th-TH")}
              </div>
              <div className="mt-1 text-sm lg:text-2xl font-bold text-sky-700 tabular-nums">
                หยิบแล้ว {current.qty_picked}/{current.qty_required}
              </div>
            </div>

            {current.barcode && (
              <div className="flex justify-center">
                <img
                  src={generateCode128PngDataUrl(current.barcode, { height: 56, scale: 3 })}
                  alt={`บาร์โค้ด ${current.sku}`}
                  className="h-14 lg:h-24"
                />
              </div>
            )}
            <div className="font-mono text-sm lg:text-2xl text-slate-500">{current.sku}</div>
            <div className="text-xs lg:text-xl text-slate-400">{current.product_name}</div>
          </div>

          {/* ช่องสแกน — 1 สแกน = 1 ชิ้น */}
          <BarcodeScanInput
            value={itemScanValue}
            onChange={setItemScanValue}
            onScanSubmit={(code) => void handleItemScan(code)}
            onOpenScannerModal={() => setCameraMode("item")}
            placeholder="สแกนสินค้าทุกครั้งที่หยิบ 1 ชิ้น…"
            isProcessing={busy}
          />

          {/* ปุ่มปัญหา */}
          <button
            onClick={() => setProblemFor(current.sku)}
            disabled={busy}
            className="w-full py-5 lg:py-7 rounded-2xl bg-amber-400 text-amber-950 text-2xl lg:text-4xl font-black disabled:opacity-50 active:scale-[0.98] transition-transform"
          >
            ⚠️ มีปัญหา
          </button>
        </>
      ) : (
        // ทุกรายการครบหรือแจ้งปัญหาหมดแล้ว (เช่น ติดปัญหา → รอหัวหน้า)
        <div className="bg-orange-50 border border-orange-200 rounded-2xl p-6 text-center space-y-2">
          <div className="text-5xl">⚠️</div>
          <div className="font-bold text-orange-900">รายการในกล่องนี้เหลือแต่ที่แจ้งปัญหา — รอหัวหน้าตัดสิน</div>
          <div className="text-sm text-orange-700">เมื่อหัวหน้าตัดสินแล้ว กล่องจะถูกปิดให้อัตโนมัติ</div>
        </div>
      )}

      {/* รายการทั้งหมดในกล่อง Q นี้ */}
      <div className="bg-white rounded-2xl border border-[#E8ECEA] p-3 lg:flex-1 lg:min-h-0 lg:flex lg:flex-col">
        <div className="text-[18px] lg:text-xl text-slate-400 mb-1.5">
          รายการทั้งหมดในกล่อง {qData.q_code} ({totalCount})
        </div>
        <div className="space-y-1 lg:flex-1 lg:overflow-y-auto">
          {items.map((it, i) => {
            const done = it.qty_picked >= it.qty_required;
            const problem = it.status === "PROBLEM";
            const isCurrent = Boolean(current) && norm(it.sku) === norm(current.sku);
            return (
              <div
                key={`${it.sku}-${i}`}
                className={`flex items-center gap-2 lg:gap-3 px-2 lg:px-3 py-1.5 lg:py-2.5 rounded-lg text-xs lg:text-lg font-mono ${
                  isCurrent
                    ? "bg-sky-50 border border-sky-200"
                    : done
                      ? "bg-emerald-50/60"
                      : problem
                        ? "bg-orange-50"
                        : "bg-[#F7F9F8]"
                }`}
              >
                <span>{done ? "✅" : problem ? "⚠️" : isCurrent ? "🔵" : "⬜"}</span>
                <span className="font-bold w-14 lg:w-28 shrink-0">{it.location_id || "—"}</span>
                {it.location_wh && (
                  <span className="text-[18px] lg:text-base px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 shrink-0">
                    {getWarehouseDisplayName(it.location_wh)}
                  </span>
                )}
                <span className="flex-1 min-w-0 truncate text-slate-600">{it.sku}</span>
                <span className={`tabular-nums shrink-0 ${done ? "text-emerald-700" : "text-slate-500"}`}>
                  {it.qty_picked}/{it.qty_required}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* รายการที่มีปัญหาแล้ว */}
      {items.some((it) => it.status === "PROBLEM") && (
        <div className="bg-orange-50 rounded-2xl border border-orange-200 p-3">
          <div className="text-xs font-bold text-orange-900 mb-1">แจ้งปัญหาแล้ว (รอหัวหน้าตัดสิน)</div>
          {items
            .filter((it) => it.status === "PROBLEM")
            .map((it, i) => (
              <div key={i} className="text-xs text-orange-800 font-mono">
                ⚠️ {it.sku} ({it.qty_picked}/{it.qty_required})
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
              <div className="font-mono font-bold text-slate-900">{problemFor}</div>
              <div className="text-xs text-slate-400">ในกล่อง {qData.q_code}</div>
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

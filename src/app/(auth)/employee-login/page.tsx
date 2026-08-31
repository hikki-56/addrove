"use client";
import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useTabAuth } from "@/context/TabAuthContext";
import {
  getActiveWarehouse,
  setActiveWarehouse,
  getWarehouseName,
  normalizeWarehouseId,
} from "@/lib/warehouse-utils";

// ── Direct PIN Login Screen (Stockify Frontdoor) ──────────────
function PinScreen() {
  const searchParams = useSearchParams();
  const tokenParam = searchParams.get("token") || searchParams.get("emp_id") || "";
  const callbackUrl = searchParams.get("callbackUrl") || searchParams.get("redirect") || "/dashboard";
  const whParam = searchParams.get("warehouse_id") || searchParams.get("wh");

  const { login: tabLogin } = useTabAuth();

  // Resolve warehouse ID & name for reassurance display
  const resolvedWh = whParam || (() => {
    if (!callbackUrl) return "";
    try {
      const decoded = decodeURIComponent(callbackUrl);
      const match = decoded.match(/[?&](?:warehouse_id|wh)=([^&]+)/);
      return match && match[1] ? decodeURIComponent(match[1]) : "";
    } catch {
      return "";
    }
  })();

  const warehouseDisplayName = resolvedWh ? getWarehouseName(resolvedWh) : null;
  const canonicalWhCode = resolvedWh ? normalizeWarehouseId(resolvedWh).toUpperCase() : null;

  useEffect(() => {
    if (whParam) {
      setActiveWarehouse(whParam);
    } else if (callbackUrl) {
      try {
        const decoded = decodeURIComponent(callbackUrl);
        const match = decoded.match(/[?&](?:warehouse_id|wh)=([^&]+)/);
        if (match && match[1]) {
          setActiveWarehouse(decodeURIComponent(match[1]));
        }
      } catch {}
    }
  }, [whParam, callbackUrl]);

  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [locked, setLocked] = useState(false);
  const [lockSeconds, setLockSeconds] = useState(0);

  // Lockout countdown
  useEffect(() => {
    if (!locked) return;
    const t = setInterval(() => {
      setLockSeconds((s) => {
        if (s <= 1) {
          clearInterval(t);
          setLocked(false);
          setAttempts(0);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [locked]);

  // Subtle haptic vibration for warehouse workers (tactile feedback)
  const triggerHaptic = useCallback(() => {
    if (typeof window !== "undefined" && window.navigator && "vibrate" in window.navigator) {
      try {
        window.navigator.vibrate(12);
      } catch {}
    }
  }, []);

  // PIN submission
  const submitPin = useCallback(async () => {
    if (pin.length !== 4 || submitting) return;
    setSubmitting(true);
    setError("");
    setSuccessMessage("");

    try {
      const res = await fetch("/api/auth/qr-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tokenParam, pin }),
      });
      const json = await res.json();

      if (json.success) {
        setSuccessMessage(json.message || "เข้าสู่ระบบสำเร็จ!");
        if (json.user && json.token) {
          tabLogin(json.user, json.token, json.expires_at);
        }
        const targetWh = getActiveWarehouse(whParam);
        let finalUrl = "/movements/transfer";
        if (json.user?.role !== "APPROVER") {
          finalUrl = targetWh ? `/dashboard?warehouse_id=${targetWh}` : "/dashboard";
        }
        setTimeout(() => {
          window.location.href = finalUrl;
        }, 300);
      } else {
        const next = attempts + 1;
        setAttempts(next);
        setPin("");
        if (next >= 5) {
          setLocked(true);
          setLockSeconds(300);
          setError("กรุณารอ 5 นาที — PIN ผิดเกิน 5 ครั้ง");
        } else {
          setError(json.message || `กรุณากรอกรหัส PIN ให้ถูกต้อง (${next}/5 ครั้ง)`);
        }
        setSubmitting(false);
      }
    } catch {
      setError("กรุณาลองใหม่อีกครั้ง เกิดข้อผิดพลาดในการเชื่อมต่อ");
      setPin("");
      setSubmitting(false);
    }
  }, [pin, submitting, tokenParam, tabLogin, whParam, attempts]);

  const handleNumClick = useCallback((k: string) => {
    if (locked || submitting) return;
    triggerHaptic();
    setError("");
    setSuccessMessage("");

    if (k === "del") {
      setPin((prev) => (prev.length > 0 ? prev.slice(0, -1) : ""));
      return;
    }

    setPin((prev) => {
      if (prev.length >= 4) return prev;
      return prev + k;
    });
  }, [locked, submitting, triggerHaptic]);

  const handleClear = () => {
    if (submitting) return;
    triggerHaptic();
    setPin("");
    setError("");
    setSuccessMessage("");
  };

  // Auto-submit when 4 digits entered
  useEffect(() => {
    if (pin.length === 4) {
      const t = setTimeout(() => {
        void submitPin();
      }, 100);
      return () => clearTimeout(t);
    }
  }, [pin, submitPin]);

  // Physical keyboard support for desktop & barcode terminal keypad
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key >= "0" && e.key <= "9") handleNumClick(e.key);
      if (e.key === "Backspace") handleNumClick("del");
      if (e.key === "Escape") handleClear();
      if (e.key === "Enter") void submitPin();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleNumClick, submitPin]);

  // Clean URL if expired=true was present
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.search.includes("expired=true")) {
      const cleanUrl =
        window.location.pathname +
        window.location.search.replace(/[?&]expired=true/, "").replace(/^\?$/, "");
      window.history.replaceState({}, "", cleanUrl || "/employee-login");
    }
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-100 flex flex-col items-center justify-center p-4 sm:p-6 relative overflow-hidden">
      {/* Ambient background brand tint (Stockify Emerald & Slate) */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="absolute top-0 right-1/4 w-[480px] h-[480px] bg-emerald-500/6 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 left-10 w-[380px] h-[380px] bg-teal-600/5 rounded-full blur-[100px]" />
        <div className="absolute top-1/2 left-1/4 -translate-y-1/2 w-[520px] h-[520px] bg-slate-400/5 rounded-full blur-[140px]" />
      </div>

      {/* Main Container */}
      <div className="relative w-full max-w-sm z-10 flex flex-col items-center my-auto">
        {/* Brand Header */}
        <div className="text-center mb-3.5 flex flex-col items-center">
          <div className="flex justify-center mb-2">
            <img
              src="/logo.png"
              alt="Stockify Logo"
              className="h-12 sm:h-14 w-auto object-contain max-w-[210px]"
            />
          </div>

          {/* Reassurance Beacon: Warehouse context confirmation */}
          {warehouseDisplayName ? (
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-medium shadow-xs">
              <svg
                className="w-4 h-4 text-emerald-700 flex-shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
              <span>
                เข้าปฏิบัติงาน: <strong className="font-semibold text-emerald-900">{warehouseDisplayName}</strong>{" "}
                {canonicalWhCode && <span className="font-mono text-emerald-700">({canonicalWhCode})</span>}
              </span>
            </div>
          ) : (
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 border border-slate-200 text-slate-700 text-sm font-medium">
              <svg
                className="w-4 h-4 text-slate-600 flex-shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                />
              </svg>
              <span>ระบบสำหรับพนักงานคลังสินค้า</span>
            </div>
          )}
        </div>

        {/* PIN Login Card */}
        <div className="w-full rounded-3xl p-4.5 sm:p-7 border border-slate-200/90 shadow-xl bg-white">
          {/* Card Title */}
          <div className="text-center mb-3">
            <h1 className="text-slate-900 font-bold text-lg sm:text-xl mb-0.5">กรอกรหัส PIN</h1>
            <p className="text-slate-600 text-sm">แตะรหัส PIN 4 หลักเพื่อเริ่มต้นปฏิบัติงาน</p>
          </div>

          {/* 4 PIN Square Indicator Boxes */}
          <div
            className="flex justify-center gap-3 sm:gap-4 mb-3"
            role="status"
            aria-label={`กรอกแล้ว ${pin.length} จาก 4 หลัก`}
          >
            {[0, 1, 2, 3].map((i) => {
              const isFilled = i < pin.length;
              return (
                <div
                  key={i}
                  className={`w-13 h-13 sm:w-14 sm:h-14 rounded-2xl border-2 flex items-center justify-center transition-all duration-150 ${
                    isFilled
                      ? "border-emerald-600 bg-emerald-50/60 shadow-xs scale-102"
                      : "border-slate-200 bg-slate-50"
                  } ${submitting ? "opacity-75 animate-pulse" : ""}`}
                >
                  {isFilled && (
                    <span className="w-4 h-4 sm:w-4.5 sm:h-4.5 rounded-full bg-emerald-700 shadow-xs inline-block" />
                  )}
                </div>
              );
            })}
          </div>

          {/* Error / Success / Lockout Message Feedback */}
          <div className="min-h-[40px] flex items-center justify-center mb-3 text-center px-1">
            {submitting ? (
              <p className="text-emerald-800 text-sm font-semibold flex items-center gap-2 animate-pulse">
                <span className="w-4 h-4 border-2 border-emerald-700 border-t-transparent rounded-full animate-spin inline-block flex-shrink-0" />
                กำลังยืนยันตัวตน...
              </p>
            ) : successMessage ? (
              <p className="text-emerald-800 text-sm font-semibold flex items-center gap-2">
                <svg
                  className="w-5 h-5 text-emerald-700 flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
                {successMessage}
              </p>
            ) : error ? (
              <div
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-medium ${
                  locked
                    ? "bg-amber-50 border border-amber-300 text-amber-900"
                    : "bg-red-50 border border-red-200 text-red-700"
                }`}
              >
                {locked ? (
                  <svg
                    className="w-5 h-5 text-amber-700 flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                    />
                  </svg>
                ) : (
                  <svg
                    className="w-5 h-5 text-red-600 flex-shrink-0"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
                <span>
                  {locked
                    ? `กรุณารอ ${Math.floor(lockSeconds / 60)}:${String(lockSeconds % 60).padStart(2, "0")} นาที — ระงับการกดชั่วคราว`
                    : error}
                </span>
              </div>
            ) : (
              <p className="text-slate-600 text-sm">แตะปุ่มตัวเลขด้านล่างเพื่อป้อนรหัส</p>
            )}
          </div>

          {/* On-Screen Ergonomic Numpad Grid */}
          <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((k) => (
              <button
                type="button"
                key={k}
                id={`pin-key-${k}`}
                disabled={locked || submitting}
                onClick={() => handleNumClick(k)}
                className="h-14 sm:h-16 rounded-2xl bg-white border border-slate-200 shadow-xs
                           text-slate-900 font-bold text-2xl font-mono
                           hover:bg-emerald-50 hover:border-emerald-300 hover:text-emerald-800
                           active:bg-emerald-700 active:text-white active:scale-95
                           transition-all duration-100 cursor-pointer flex items-center justify-center
                           select-none touch-manipulation disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {k}
              </button>
            ))}

            {/* Clear Button */}
            <button
              type="button"
              id="pin-key-clear"
              disabled={locked || submitting}
              onClick={handleClear}
              className="h-14 sm:h-16 rounded-2xl bg-slate-100/90 border border-slate-200 shadow-xs
                         text-slate-700 font-semibold text-sm
                         hover:bg-slate-200 hover:text-slate-900 active:bg-slate-300 active:scale-95
                         transition-all duration-100 cursor-pointer flex flex-col items-center justify-center gap-0.5
                         select-none touch-manipulation disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="ล้างรหัส PIN ทั้งหมด"
              title="ล้างรหัส PIN ทั้งหมด"
            >
              <svg
                className="w-4 h-4 text-slate-600 flex-shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              <span>ล้าง</span>
            </button>

            {/* Digit 0 */}
            <button
              type="button"
              id="pin-key-0"
              disabled={locked || submitting}
              onClick={() => handleNumClick("0")}
              className="h-14 sm:h-16 rounded-2xl bg-white border border-slate-200 shadow-xs
                         text-slate-900 font-bold text-2xl font-mono
                         hover:bg-emerald-50 hover:border-emerald-300 hover:text-emerald-800
                         active:bg-emerald-700 active:text-white active:scale-95
                         transition-all duration-100 cursor-pointer flex items-center justify-center
                         select-none touch-manipulation disabled:opacity-50 disabled:cursor-not-allowed"
            >
              0
            </button>

            {/* Backspace Button */}
            <button
              type="button"
              id="pin-key-del"
              disabled={locked || submitting}
              onClick={() => handleNumClick("del")}
              className="h-14 sm:h-16 rounded-2xl bg-slate-100/90 border border-slate-200 shadow-xs
                         text-slate-700
                         hover:bg-amber-50 hover:border-amber-300 hover:text-amber-800
                         active:bg-amber-700 active:text-white active:scale-95
                         transition-all duration-100 cursor-pointer flex items-center justify-center
                         select-none touch-manipulation disabled:opacity-50 disabled:cursor-not-allowed"
              title="ลบตัวเลขล่าสุด"
            >
              <svg
                className="w-6 h-6 text-slate-700 pointer-events-none"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M3 12l6.414-6.414a2 2 0 011.414-.586H19a2 2 0 012 2v12a2 2 0 01-2 2H10.828a2 2 0 01-1.414-.586L3 12z"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Footer Info */}
        <p className="text-slate-600 text-sm mt-3 sm:mt-4 text-center">
          © {new Date().getFullYear()} Stockify — ระบบจัดการคลังสินค้า
        </p>
      </div>
    </div>
  );
}

// ── Default Export: Wrapped in Suspense ───────────────────────
export default function EmployeeLoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-50 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <svg
              className="animate-spin h-8 w-8 text-emerald-700"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            <p className="text-slate-600 text-sm font-medium">กำลังเตรียมระบบ...</p>
          </div>
        </div>
      }
    >
      <PinScreen />
    </Suspense>
  );
}

"use client";
import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useTabAuth } from "@/context/TabAuthContext";
import { getActiveWarehouse, setActiveWarehouse } from "@/lib/warehouse-utils";

// ── Direct PIN Login Screen ──────────────────────────────────
function PinScreen() {
  const searchParams = useSearchParams();
  const tokenParam = searchParams.get("token") || searchParams.get("emp_id") || "";
  const callbackUrl = searchParams.get("callbackUrl") || searchParams.get("redirect") || "/dashboard";
  const whParam = searchParams.get("warehouse_id") || searchParams.get("wh");

  const { login: tabLogin } = useTabAuth();

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
        if (s <= 1) { clearInterval(t); setLocked(false); setAttempts(0); return 0; }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [locked]);

  // Pure functional PIN updater - 100% immune to stale closures or event drop
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
          setError("PIN ผิดเกิน 5 ครั้ง — ล็อค 5 นาที");
        } else {
          setError(json.message || `รหัส PIN ไม่ถูกต้อง (${next}/5 ครั้ง)`);
        }
        setSubmitting(false);
      }
    } catch {
      setError("เกิดข้อผิดพลาดในการเชื่อมต่อ");
      setPin("");
      setSubmitting(false);
    }
  }, [pin, submitting, tokenParam, tabLogin, whParam, attempts]);

  const handleNumClick = useCallback((k: string) => {
    if (locked || submitting) return;
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
  }, [locked, submitting]);

  const handleClear = () => {
    if (submitting) return;
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

  // Physical keyboard support for desktop
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key >= "0" && e.key <= "9") handleNumClick(e.key);
      if (e.key === "Backspace") handleNumClick("del");
      if (e.key === "Enter") void submitPin();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleNumClick, submitPin]);

  // Clean URL if expired=true was present
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.search.includes("expired=true")) {
      const cleanUrl = window.location.pathname + window.location.search.replace(/[?&]expired=true/, "").replace(/^\?$/, "");
      window.history.replaceState({}, "", cleanUrl || "/employee-login");
    }
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center p-4 sm:p-6 relative overflow-hidden">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 right-1/4 w-[500px] h-[500px] bg-indigo-600/8 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 right-10 w-[400px] h-[400px] bg-violet-600/8 rounded-full blur-[100px]" />
        <div className="absolute top-1/2 left-1/4 -translate-y-1/2 w-[600px] h-[600px] bg-indigo-500/4 rounded-full blur-[150px]" />
      </div>

      {/* Employee PIN Login Card */}
      <div className="relative w-full max-w-sm z-10">
        {/* Logo */}
        <div className="text-center mb-6">
          <div className="flex justify-center mb-3">
            <img src="/logo.png" alt="A'AMAZON Logo" className="h-14 w-auto object-contain max-w-[240px]" />
          </div>
          <p className="text-slate-500 text-xs mt-0.5">ระบบสำหรับพนักงาน</p>
        </div>

        <div className="glass-card rounded-2xl p-6 sm:p-7 border border-white/[0.09] shadow-2xl bg-[#111118]">

          {/* Title */}
          <div className="text-center mb-5">
            <h2 className="text-slate-100 font-bold text-base mb-1">กรอกรหัส PIN</h2>
            <p className="text-slate-400 text-xs">กดรหัส PIN 4 หลักบนปุ่มด้านล่างเพื่อเข้าสู่ระบบ</p>
          </div>

          {/* 4 PIN Square Boxes Display (Vibrant Emerald Green Theme) */}
          <div className="flex justify-center gap-3.5 mb-5">
            {[0, 1, 2, 3].map((i) => {
              const isFilled = i < pin.length;
              return (
                <div
                  key={i}
                  className={`w-12 h-12 rounded-2xl border-2 flex items-center justify-center transition-all duration-150 ${
                    isFilled
                      ? "border-emerald-500 bg-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.5)]"
                      : "border-white/[0.15] bg-white/[0.03]"
                  } ${submitting ? "opacity-60 animate-pulse" : ""}`}
                >
                  {isFilled && (
                    <span className="w-4 h-4 rounded-full bg-emerald-400 shadow-[0_0_12px_#34d399] inline-block" />
                  )}
                </div>
              );
            })}
          </div>

          {/* Error / Success / lock message */}
          <div className="min-h-[32px] flex items-center justify-center mb-3">
            {submitting ? (
              <p className="text-emerald-400 text-xs font-semibold flex items-center gap-1.5 animate-pulse">
                <span className="w-3.5 h-3.5 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin inline-block" />
                กำลังเข้าสู่ระบบ...
              </p>
            ) : successMessage ? (
              <p className="text-emerald-400 text-xs font-semibold flex items-center gap-1.5 animate-pulse">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                {successMessage}
              </p>
            ) : error ? (
              <p className="text-red-400 text-xs font-medium flex items-center gap-1.5 text-center px-2">
                <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                    clipRule="evenodd" />
                </svg>
                {locked
                  ? `🔒 ล็อค — ลองใหม่ใน ${Math.floor(lockSeconds / 60)}:${String(lockSeconds % 60).padStart(2, "0")}`
                  : error}
              </p>
            ) : null}
          </div>

          {/* Web On-Screen Numpad Grid - Clean Standard HTML Buttons for 100% Compatibility */}
          <div className="grid grid-cols-3 gap-3">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((k) => (
              <button
                type="button"
                key={k}
                id={`pin-key-${k}`}
                onClick={() => handleNumClick(k)}
                className="py-4 rounded-2xl bg-white/[0.06] border border-white/[0.12] text-slate-100 font-semibold
                           text-2xl hover:bg-indigo-500/20 active:bg-indigo-600 active:text-white active:scale-95
                           transition-all duration-100 cursor-pointer flex items-center justify-center shadow-md select-none touch-manipulation"
              >
                {k}
              </button>
            ))}
            <button
              type="button"
              id="pin-key-clear"
              onClick={handleClear}
              className="py-4 rounded-2xl bg-white/[0.04] border border-white/[0.08] text-slate-400 text-xs font-semibold
                         hover:bg-white/[0.08] active:bg-slate-700 active:text-white active:scale-95 transition-all duration-100
                         cursor-pointer flex items-center justify-center shadow-md select-none touch-manipulation"
            >
              CLR
            </button>
            <button
              type="button"
              id="pin-key-0"
              onClick={() => handleNumClick("0")}
              className="py-4 rounded-2xl bg-white/[0.06] border border-white/[0.12] text-slate-100 font-semibold
                         text-2xl hover:bg-indigo-500/20 active:bg-indigo-600 active:text-white active:scale-95
                         transition-all duration-100 cursor-pointer flex items-center justify-center shadow-md select-none touch-manipulation"
            >
              0
            </button>
            <button
              type="button"
              id="pin-key-del"
              onClick={() => handleNumClick("del")}
              className="py-4 rounded-2xl bg-white/[0.04] border border-white/[0.08] text-amber-400 font-semibold
                         hover:bg-amber-500/15 active:bg-amber-600 active:text-white active:scale-95 transition-all duration-100
                         cursor-pointer flex items-center justify-center shadow-md select-none touch-manipulation"
            >
              <svg className="w-6 h-6 text-amber-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M3 12l6.414-6.414a2 2 0 011.414-.586H19a2 2 0 012 2v12a2 2 0 01-2 2H10.828a2 2 0 01-1.414-.586L3 12z" />
              </svg>
            </button>
          </div>

          {/* Loading indicator */}
          {submitting && (
            <div className="mt-4 flex items-center justify-center gap-2 text-indigo-400 text-xs font-medium">
              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              กำลังยืนยันตัวตน...
            </div>
          )}

        </div>

        <p className="text-center text-slate-600 text-xs mt-5">
          © {new Date().getFullYear()} Stockify — Warehouse Management System
        </p>
      </div>
    </div>
  );
}

// ── Default export: wrap in Suspense ─────────────────────────
export default function EmployeeLoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <svg className="animate-spin h-7 w-7 text-indigo-400" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
            <p className="text-slate-500 text-xs">กำลังโหลด...</p>
          </div>
        </div>
      }
    >
      <PinScreen />
    </Suspense>
  );
}

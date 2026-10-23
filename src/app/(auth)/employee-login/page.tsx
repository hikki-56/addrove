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
import AuthShell from "@/components/layout/AuthShell";
import { M3Banner, M3Loading } from "@/components/ui/m3";
import { SolarAltArrowRight } from "@/components/icons";

// ── Direct PIN Login Screen (Stockify Frontdoor) ──────────────
function PinScreen() {
  const searchParams = useSearchParams();
  const tokenParam = searchParams.get("token") || searchParams.get("emp_id") || "";
  const callbackUrl = searchParams.get("callbackUrl") || searchParams.get("redirect") || "/dashboard";
  const whParam = searchParams.get("warehouse_id") || searchParams.get("wh");
  // section=packer — มาจากบาร์โค้ดประจำจุดพนักงานแพ็กของ (/w/packer)
  const sectionParam = searchParams.get("section") || "";
  const isPackerSection = sectionParam.trim().toLowerCase() === "packer";

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
        body: JSON.stringify({ token: tokenParam, pin, section: sectionParam }),
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
  }, [pin, submitting, tokenParam, sectionParam, tabLogin, whParam, attempts]);

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
    <AuthShell
      footer={
        <>
          <a href="/login" className="font-semibold text-m3-primary-dark hover:underline">
            เข้าด้วยอีเมลแอดมิน
          </a>
          <div className="mt-2">© {new Date().getFullYear()} Stockify — ระบบจัดการคลังสินค้า</div>
        </>
      }
    >
      <div className="flex flex-col items-center text-center">
        <h1 className="font-m3-disp text-[26px] font-bold text-m3-grey-800">กรอกรหัส PIN</h1>
        <p className="mt-1 text-sm text-m3-grey-600">ระบบสำหรับพนักงานคลังสินค้า</p>
      </div>

      {/* Reassurance Beacon: Section/Warehouse context confirmation */}
      {isPackerSection ? (
        <M3Banner tone="info" className="mt-5">
          เข้าปฏิบัติงาน: <strong className="font-bold">ส่วนพนักงานแพ็กของ</strong>
        </M3Banner>
      ) : warehouseDisplayName ? (
        <M3Banner tone="info" className="mt-5">
          เข้าปฏิบัติงาน: <strong className="font-bold">{warehouseDisplayName}</strong>{" "}
          {canonicalWhCode && <span className="font-m3-disp">({canonicalWhCode})</span>}
        </M3Banner>
      ) : null}

      {/* 4 PIN dot indicators */}
      <div
        className="mt-7 flex justify-center gap-5"
        role="status"
        aria-label={`กรอกแล้ว ${pin.length} จาก 4 หลัก`}
      >
        {[0, 1, 2, 3].map((i) => {
          const isFilled = i < pin.length;
          return (
            <span
              key={i}
              className={`size-4 rounded-full transition-all duration-150 ${
                isFilled ? "bg-m3-grey-800 scale-110" : "border-2 border-m3-grey-400 bg-white"
              } ${submitting ? "opacity-75 animate-pulse" : ""}`}
            />
          );
        })}
      </div>

      {/* Error / Success / Lockout Message Feedback */}
      <div className="mt-4 mb-4 flex min-h-[44px] items-center justify-center text-center">
        {submitting ? (
          <p className="flex items-center gap-2 text-sm font-semibold text-m3-primary-dark">
            <span className="inline-block size-4 shrink-0 animate-spin rounded-full border-2 border-m3-primary border-r-transparent" />
            กำลังยืนยันตัวตน...
          </p>
        ) : successMessage ? (
          <M3Banner tone="success" className="w-full">{successMessage}</M3Banner>
        ) : error ? (
          <M3Banner tone={locked ? "warning" : "error"} role="alert" className="w-full text-left">
            {locked
              ? `กรุณารอ ${Math.floor(lockSeconds / 60)}:${String(lockSeconds % 60).padStart(2, "0")} นาที — ระงับการกดชั่วคราว`
              : error}
          </M3Banner>
        ) : null}
      </div>

      {/* On-Screen Numpad */}
      <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((k) => (
          <button
            type="button"
            key={k}
            id={`pin-key-${k}`}
            disabled={locked || submitting}
            onClick={() => handleNumClick(k)}
            className="h-14 sm:h-[60px] rounded-xl bg-m3-grey-200/70 font-m3-disp text-[26px] font-semibold text-m3-grey-800
                hover:bg-m3-grey-300/70 active:bg-m3-grey-800 active:text-white active:scale-95
                transition-all duration-100 cursor-pointer flex items-center justify-center
                select-none touch-manipulation disabled:opacity-48 disabled:cursor-not-allowed"
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
          className="h-14 sm:h-[60px] rounded-xl text-sm font-semibold text-m3-grey-600 hover:bg-[rgba(145,158,171,0.08)] active:scale-95
                transition-all duration-100 cursor-pointer flex items-center justify-center
                select-none touch-manipulation disabled:opacity-48 disabled:cursor-not-allowed"
          aria-label="ล้างรหัส PIN ทั้งหมด"
          title="ล้างรหัส PIN ทั้งหมด"
        >
          <span>ล้าง</span>
        </button>

        {/* Digit 0 */}
        <button
          type="button"
          id="pin-key-0"
          disabled={locked || submitting}
          onClick={() => handleNumClick("0")}
          className="h-14 sm:h-[60px] rounded-xl bg-m3-grey-200/70 font-m3-disp text-[26px] font-semibold text-m3-grey-800
                hover:bg-m3-grey-300/70 active:bg-m3-grey-800 active:text-white active:scale-95
                transition-all duration-100 cursor-pointer flex items-center justify-center
                select-none touch-manipulation disabled:opacity-48 disabled:cursor-not-allowed"
        >
          0
        </button>

        {/* Backspace Button */}
        <button
          type="button"
          id="pin-key-del"
          disabled={locked || submitting}
          onClick={() => handleNumClick("del")}
          className="h-14 sm:h-[60px] rounded-xl text-m3-grey-800 hover:bg-[rgba(145,158,171,0.08)] active:scale-95
                transition-all duration-100 cursor-pointer flex items-center justify-center
                select-none touch-manipulation disabled:opacity-48 disabled:cursor-not-allowed"
          title="ลบตัวเลขล่าสุด"
          aria-label="ลบตัวเลขล่าสุด"
        >
          <SolarAltArrowRight size={24} className="pointer-events-none rotate-180" />
        </button>
      </div>
    </AuthShell>
  );
}

// ── Default Export: Wrapped in Suspense ───────────────────────
export default function EmployeeLoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-white">
          <M3Loading label="กำลังเตรียมระบบ..." />
        </div>
      }
    >
      <PinScreen />
    </Suspense>
  );
}

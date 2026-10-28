"use client";

/**
 * Feedback กลางสำหรับหน้างานสแกน — เสียง + การสั่น
 * (ดึงมาจาก CameraBarcodeScannerModal เดิมให้ใช้ร่วมกับทุกขั้นตอน outbound)
 *
 * หลักการ: คนงานไม่ต้องอ่านภาษา — แยกผลลัพธ์ด้วยเสียงและการสั่น
 *   สำเร็จ   = บี๊ปสั้น 1 ครั้ง + สั่นสั้น
 *   ผิดพลาด = บัซซ์ต่ำ 2 ครั้ง + สั่นยาว
 */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (!audioCtx || audioCtx.state === "closed") audioCtx = new Ctor();
    if (audioCtx.state === "suspended") void audioCtx.resume().catch(() => {});
    return audioCtx;
  } catch {
    return null;
  }
}

/** Call from a user gesture so mobile browsers can enable scanner audio. */
export function prepareFeedbackAudio() {
  getAudioContext();
}

function tone(freq: number, durationMs: number, delayMs = 0, type: OscillatorType = "sine") {
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const start = ctx.currentTime + delayMs / 1000;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.25, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + durationMs / 1000);
    osc.connect(gain).connect(ctx.destination);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(start);
    osc.stop(start + durationMs / 1000 + 0.02);
  } catch {
    // เสียงเป็นส่วนเสริม — ห้ามพังงานหลัก
  }
}

function vibrate(pattern: number | number[]) {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(pattern);
    }
  } catch {
    // ละเว้น
  }
}

// ป้ายเด้งมุมขวาบน "สแกนสำเร็จ/ไม่สำเร็จ" — แสดงเฉพาะตอนเปิดกล้องสแกน (CameraBarcodeScannerModal)
let cameraScanOpen = 0;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

/** CameraBarcodeScannerModal เรียกตอนเปิด/ปิด */
export function setCameraScanActive(active: boolean) {
  cameraScanOpen = Math.max(0, cameraScanOpen + (active ? 1 : -1));
}

function scanToast(ok: boolean) {
  if (!cameraScanOpen || typeof document === "undefined") return;
  try {
    let el = document.getElementById("stockify-scan-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "stockify-scan-toast";
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "assertive");
      Object.assign(el.style, {
        position: "fixed",
        top: "calc(env(safe-area-inset-top, 0px) + 16px)",
        right: "16px",
        zIndex: "100001",
        padding: "12px 18px",
        borderRadius: "12px",
        color: "#fff",
        fontSize: "18px",
        fontWeight: "700",
        boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
        pointerEvents: "none",
        transition: "opacity 150ms, transform 150ms",
      });
      document.body.appendChild(el);
    }
    el.textContent = ok ? "✓ สแกนสำเร็จ" : "✕ สแกนไม่สำเร็จ";
    el.style.background = ok ? "#118D57" : "#B71D18";
    el.style.opacity = "1";
    el.style.transform = "translateY(0)";
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      if (el) {
        el.style.opacity = "0";
        el.style.transform = "translateY(-8px)";
      }
    }, ok ? 1200 : 2000);
  } catch {
    // ป้ายเป็นส่วนเสริม — ห้ามพังงานหลัก
  }
}

/** เสียงสำเร็จอย่างเดียว (ปุ่มทดสอบเสียง) — ไม่แสดงป้าย */
export function playSuccessSound() {
  tone(1000, 120);
  vibrate(80);
}

/** สแกนถูก/สำเร็จ — บี๊ปใส 1 ครั้ง + สั่นสั้น */
export function feedbackSuccess() {
  playSuccessSound();
  scanToast(true);
}

/** สแกนผิด/เกิดข้อผิดพลาด — บัซซ์ต่ำ 2 ครั้ง + สั่นยาว */
export function feedbackError() {
  tone(220, 160, 0, "square");
  tone(180, 200, 200, "square");
  vibrate([120, 60, 120]);
  scanToast(false);
}

/** จบขั้นตอน (ปิดกล่อง/ปิดรอบ) — บี๊บ-บี๊บขึ้นทำนอง */
export function feedbackDone() {
  tone(880, 100);
  tone(1320, 160, 120);
  vibrate([60, 40, 60, 40, 120]);
}

/** เตือน (offline / มีรายการรอ sync) — บี๊บกลาง 1 ครั้ง */
export function feedbackWarn() {
  tone(600, 200, 0, "triangle");
  vibrate(150);
}

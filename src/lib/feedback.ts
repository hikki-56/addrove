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
    if (!audioCtx) audioCtx = new Ctor();
    if (audioCtx.state === "suspended") void audioCtx.resume();
    return audioCtx;
  } catch {
    return null;
  }
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

/** สแกนถูก/สำเร็จ — บี๊ปใส 1 ครั้ง + สั่นสั้น */
export function feedbackSuccess() {
  tone(1000, 120);
  vibrate(80);
}

/** สแกนผิด/เกิดข้อผิดพลาด — บัซซ์ต่ำ 2 ครั้ง + สั่นยาว */
export function feedbackError() {
  tone(220, 160, 0, "square");
  tone(180, 200, 200, "square");
  vibrate([120, 60, 120]);
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

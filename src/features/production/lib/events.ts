// Event กลางของระบบผลิต — ใช้แจ้งให้หน้าจอ/กระดิ่ง reload เมื่อมีการเปลี่ยนแปลงงานผลิต
// แยกเป็นไฟล์ไม่มี hook เพื่อให้ component นอก feature (เช่น ProductionBell) import ได้โดยไม่ดึง hook มาด้วย
//
// - แท็บเดียวกัน: custom window event (PRODUCTION_UPDATED_EVENT)
// - ข้ามแท็บ: BroadcastChannel (แทนการฟัง `storage` event ทุก key แบบเดิม ซึ่ง reload ทุกครั้งที่
//   localStorage ใด ๆ เปลี่ยน เช่น ตอน login/ตั้งค่าอื่น)
export const PRODUCTION_UPDATED_EVENT = "stockify-production-updated";
export const PRODUCTION_BROADCAST_CHANNEL = "stockify-production";

interface ProductionBroadcastMessage {
  type: "updated";
  /** id ของแท็บที่ส่ง — แท็บเดียวกันได้ custom event แล้ว จึงข้ามข้อความของตัวเอง */
  source: string;
}

const TAB_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
let senderChannel: BroadcastChannel | null = null;

function openChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  try {
    return new BroadcastChannel(PRODUCTION_BROADCAST_CHANNEL);
  } catch {
    return null;
  }
}

export function emitProductionUpdated(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(PRODUCTION_UPDATED_EVENT));
  if (!senderChannel) senderChannel = openChannel();
  try {
    senderChannel?.postMessage({ type: "updated", source: TAB_ID } satisfies ProductionBroadcastMessage);
  } catch {
    /* channel ปิดแล้ว/ไม่รองรับ — แท็บอื่นจะได้ข้อมูลใหม่จาก polling แทน */
  }
}

function isUpdateFromOtherTab(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const msg = data as Partial<ProductionBroadcastMessage>;
  return msg.type === "updated" && msg.source !== TAB_ID;
}

/** ฟังการเปลี่ยนแปลงระบบผลิตทั้งในแท็บนี้และจากแท็บอื่น — คืนฟังก์ชันยกเลิก */
export function subscribeProductionUpdated(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onLocal = () => handler();
  window.addEventListener(PRODUCTION_UPDATED_EVENT, onLocal);
  const channel = openChannel();
  const onMessage = (e: MessageEvent) => {
    if (isUpdateFromOtherTab(e.data)) handler();
  };
  channel?.addEventListener("message", onMessage);
  return () => {
    window.removeEventListener(PRODUCTION_UPDATED_EVENT, onLocal);
    if (channel) {
      channel.removeEventListener("message", onMessage);
      channel.close();
    }
  };
}

/** สำหรับ test เท่านั้น */
export const __testing = { TAB_ID, isUpdateFromOtherTab };

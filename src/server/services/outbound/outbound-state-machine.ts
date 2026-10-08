import type {
  OutboundBillStatus,
  OutboundBoxStatus,
  ShipmentStatus,
  DocumentStatus,
} from "@/types/models";

/**
 * State machine ของโมดูลส่งของออก — API เท่านั้นที่เปลี่ยนสถานะได้
 * frontend ขอได้แค่ "action" (เช่น start-pick, close-box) แล้ว service
 * เป็นคนแปลง action → transition ผ่านตารางนี้เท่านั้น
 *
 * ห้าม transition ที่ไม่อยู่ในตาราง เช่น PACKED → PICKING, SHIPPED → *
 */

export class OutboundStateError extends Error {
  constructor(
    public readonly entityType: "bill" | "box" | "shipment",
    public readonly from: string,
    public readonly to: string
  ) {
    super(
      `ไม่อนุญาตให้เปลี่ยนสถานะ${entityType === "bill" ? "บิล" : entityType === "box" ? "กล่อง" : "รอบรถ"}จาก ${from} เป็น ${to}`
    );
    this.name = "OutboundStateError";
  }
}

// ---- บิล (OUTBOUND_ORDER) ----
// HOLD เก็บ held_from ไว้ใน note เพื่อ resume กลับสถานะเดิม —
// transition HOLD → held_from จะถูกตรวจแบบ dynamic ใน assertBillTransition
export const BILL_TRANSITIONS: Record<OutboundBillStatus, readonly OutboundBillStatus[]> = {
  // DRAFT ใช้เฉพาะใบงานกล่อง Q (WORK_ORDER) — Admin สร้างไว้และยังไม่กดส่ง
  DRAFT: ["READY_TO_PICK", "CANCELLED"],
  IMPORTED: ["READY_TO_PICK", "HOLD", "CANCELLED"],
  READY_TO_PICK: ["PICKING", "HOLD", "CANCELLED"],
  // PICKED_WAITING_APPROVAL/READY_TO_PACK จาก PICKING/SHORTAGE ใช้เฉพาะใบงาน Q
  // (สต็อกถูกตัดตั้งแต่กดส่งใบงาน จึงข้ามขั้นอนุมัติ — service เช็ค source === WORK_ORDER ก่อนใช้)
  PICKING: ["PICKED_WAITING_APPROVAL", "READY_TO_PACK", "SHORTAGE", "HOLD", "CANCELLED"],
  SHORTAGE: ["PICKING", "PICKED_WAITING_APPROVAL", "READY_TO_PACK", "HOLD", "CANCELLED"],
  PICKED_WAITING_APPROVAL: ["READY_TO_PACK", "SHORTAGE", "HOLD", "CANCELLED"],
  READY_TO_PACK: ["PACKING", "HOLD", "CANCELLED"],
  PACKING: ["PACKED", "HOLD", "CANCELLED"],
  PACKED: ["ASSIGNED_TO_SHIPMENT", "HOLD", "CANCELLED"],
  ASSIGNED_TO_SHIPMENT: ["LOADING", "PACKED", "HOLD", "CANCELLED"],
  // LOADING → PACKED ใช้เฉพาะเมื่อยกเลิกรอบรถทั้งรอบ (คืนบิลกลับสถานะพร้อมเลือกใหม่)
  LOADING: ["SHIPPED", "PARTIALLY_SHIPPED", "PACKED", "HOLD"],
  PARTIALLY_SHIPPED: ["ASSIGNED_TO_SHIPMENT", "HOLD", "CANCELLED"],
  HOLD: [], // กำหนดแบบ dynamic: HOLD → held_from | CANCELLED
  SHIPPED: [],
  CANCELLED: [],
};

// ---- กล่อง (OUTBOUND_BOX) ----
// LOADED → CLOSED ใช้สำหรับ unload (สแกนผิด/ยกออกจากรอบก่อนออกรถ)
export const BOX_TRANSITIONS: Record<OutboundBoxStatus, readonly OutboundBoxStatus[]> = {
  OPEN: ["CLOSED", "CANCELLED"],
  CLOSED: ["LOADED", "CANCELLED"],
  LOADED: ["SHIPPED", "CLOSED", "ROLLOVER"],
  ROLLOVER: ["LOADED", "CANCELLED"],
  SHIPPED: [],
  CANCELLED: [],
};

// ---- รอบรถ (SHIPMENT) ----
export const SHIPMENT_TRANSITIONS: Record<ShipmentStatus, readonly ShipmentStatus[]> = {
  OPEN: ["LOADING", "CANCELLED"],
  LOADING: ["CLOSED", "CANCELLED"],
  CLOSED: [],
  CANCELLED: [],
};

export function canTransition(
  entityType: "bill" | "box" | "shipment",
  from: string,
  to: string
): boolean {
  if (from === to) return false;
  const table =
    entityType === "bill"
      ? BILL_TRANSITIONS
      : entityType === "box"
        ? BOX_TRANSITIONS
        : SHIPMENT_TRANSITIONS;
  const allowed = (table as Record<string, readonly string[]>)[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

export function assertBillTransition(from: OutboundBillStatus, to: OutboundBillStatus, heldFrom?: OutboundBillStatus): void {
  // HOLD → กลับสู่สถานะเดิมที่ถูก hold ไว้เท่านั้น (dynamic guard)
  if (from === "HOLD") {
    const resumable = heldFrom && heldFrom !== "HOLD" && heldFrom !== "CANCELLED" && heldFrom !== "SHIPPED";
    if (to === "CANCELLED") return;
    if (resumable && to === heldFrom) return;
    throw new OutboundStateError("bill", from, to);
  }
  if (!canTransition("bill", from, to)) {
    throw new OutboundStateError("bill", from, to);
  }
}

export function assertBoxTransition(from: OutboundBoxStatus, to: OutboundBoxStatus): void {
  if (!canTransition("box", from, to)) {
    throw new OutboundStateError("box", from, to);
  }
}

export function assertShipmentTransition(from: ShipmentStatus, to: ShipmentStatus): void {
  if (!canTransition("shipment", from, to)) {
    throw new OutboundStateError("shipment", from, to);
  }
}

/**
 * แปลงสถานะละเอียดของบิล → DocumentStatus หยาบๆ ของระบบเดิม
 * เพื่อให้หน้าประวัติ/คิวอนุมัติทั่วไปยังอ่านได้โดยไม่ต้องรู้จัก outbound_status
 */
export function billStatusToDocumentStatus(status: OutboundBillStatus): DocumentStatus {
  switch (status) {
    case "DRAFT":
      return "DRAFT";
    case "IMPORTED":
    case "READY_TO_PICK":
      return "PENDING";
    case "PICKED_WAITING_APPROVAL":
      return "WAITING_APPROVAL";
    case "PICKING":
    case "SHORTAGE":
    case "READY_TO_PACK":
    case "PACKING":
    case "PACKED":
    case "ASSIGNED_TO_SHIPMENT":
    case "LOADING":
    case "PARTIALLY_SHIPPED":
    case "HOLD":
      return "PROCESSING";
    case "SHIPPED":
      return "COMPLETED";
    case "CANCELLED":
      return "CANCELLED";
  }
}

/** สถานะบิลที่ยัง "จองสต็อก" อยู่ (Reserved ยังไม่ถูกปล่อย) */
export const RESERVING_BILL_STATUSES: readonly OutboundBillStatus[] = [
  "PICKING",
  "SHORTAGE",
  "PICKED_WAITING_APPROVAL",
];

export function isBillReserving(status: OutboundBillStatus): boolean {
  return RESERVING_BILL_STATUSES.includes(status);
}

export const BILL_STATUS_LABELS_TH: Record<OutboundBillStatus, string> = {
  DRAFT: "ร่างใบงาน Q",
  IMPORTED: "นำเข้าแล้ว",
  READY_TO_PICK: "พร้อมหยิบ",
  PICKING: "กำลังหยิบ",
  PICKED_WAITING_APPROVAL: "รออนุมัติบิล",
  READY_TO_PACK: "พร้อมแพ็ก",
  PACKING: "กำลังแพ็ก",
  PACKED: "แพ็กแล้ว",
  ASSIGNED_TO_SHIPMENT: "อยู่ในรอบรถ",
  LOADING: "กำลังขึ้นรถ",
  SHIPPED: "ส่งแล้ว",
  PARTIALLY_SHIPPED: "ส่งบางส่วน",
  HOLD: "พักงาน (มีปัญหา)",
  SHORTAGE: "ของไม่ครบ",
  CANCELLED: "ยกเลิก",
};

export const BOX_STATUS_LABELS_TH: Record<OutboundBoxStatus, string> = {
  OPEN: "เปิดกล่องอยู่",
  CLOSED: "ปิดกล่องแล้ว",
  LOADED: "ขึ้นรถแล้ว",
  SHIPPED: "ออกส่งแล้ว",
  ROLLOVER: "รอรอบถัดไป",
  CANCELLED: "ยกเลิก",
};

export const SHIPMENT_STATUS_LABELS_TH: Record<ShipmentStatus, string> = {
  OPEN: "เปิดรอบ",
  LOADING: "กำลังขึ้นรถ",
  CLOSED: "ปิดรอบแล้ว",
  CANCELLED: "ยกเลิก",
};

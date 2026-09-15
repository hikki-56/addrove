import {
  BILL_TRANSITIONS,
  BOX_TRANSITIONS,
  SHIPMENT_TRANSITIONS,
  canTransition,
  assertBillTransition,
  assertBoxTransition,
  assertShipmentTransition,
  billStatusToDocumentStatus,
  isBillReserving,
  OutboundStateError,
} from "@/lib/services/outbound/outbound-state-machine";

describe("outbound state machine — บิล", () => {
  it("เดินตามลำดับปกติได้ทุกขั้น IMPORTED → SHIPPED", () => {
    const happy: Array<keyof typeof BILL_TRANSITIONS> = [
      "IMPORTED",
      "READY_TO_PICK",
      "PICKING",
      "PICKED_WAITING_APPROVAL",
      "READY_TO_PACK",
      "PACKING",
      "PACKED",
      "ASSIGNED_TO_SHIPMENT",
      "LOADING",
      "SHIPPED",
    ];
    for (let i = 0; i < happy.length - 1; i++) {
      expect(() => assertBillTransition(happy[i], happy[i + 1])).not.toThrow();
    }
  });

  it("ห้ามข้ามขั้น เช่น READY_TO_PICK → SHIPPED, PACKED → PICKING", () => {
    expect(() => assertBillTransition("READY_TO_PICK", "SHIPPED")).toThrow(OutboundStateError);
    expect(() => assertBillTransition("PACKED", "PICKING")).toThrow(OutboundStateError);
    expect(() => assertBillTransition("IMPORTED", "PACKING")).toThrow(OutboundStateError);
    expect(() => assertBillTransition("READY_TO_PACK", "ASSIGNED_TO_SHIPMENT")).toThrow(OutboundStateError);
  });

  it("สถานะปลายทาง (SHIPPED/CANCELLED) ไปต่อไม่ได้", () => {
    expect(BILL_TRANSITIONS.SHIPPED).toHaveLength(0);
    expect(BILL_TRANSITIONS.CANCELLED).toHaveLength(0);
    expect(canTransition("bill", "SHIPPED", "PACKED")).toBe(false);
    expect(canTransition("bill", "CANCELLED", "IMPORTED")).toBe(false);
  });

  it("PICKING ออกได้ทั้งครบ (WAITING_APPROVAL) และไม่ครบ (SHORTAGE/HOLD/CANCELLED)", () => {
    expect(BILL_TRANSITIONS.PICKING).toEqual(
      expect.arrayContaining(["PICKED_WAITING_APPROVAL", "SHORTAGE", "HOLD", "CANCELLED"])
    );
  });

  it("HOLD resume กลับสู่สถานะเดิมที่ถูกพักไว้เท่านั้น", () => {
    expect(() => assertBillTransition("HOLD", "PICKING", "PICKING")).not.toThrow();
    expect(() => assertBillTransition("HOLD", "PACKING", "PACKING")).not.toThrow();
    expect(() => assertBillTransition("HOLD", "CANCELLED", "PICKING")).not.toThrow();
    // resume ไปสถานะอื่นไม่ได้ แม้เป็นสถานะถูกกฎตอนปกติ
    expect(() => assertBillTransition("HOLD", "SHIPPED", "PICKING")).toThrow(OutboundStateError);
    expect(() => assertBillTransition("HOLD", "PICKED_WAITING_APPROVAL", "PICKING")).toThrow(OutboundStateError);
    // ยกเลิกบิลที่พักไว้ ทำได้เสมอ (แม้ held_from เพี้ยน)
    expect(() => assertBillTransition("HOLD", "CANCELLED", "CANCELLED")).not.toThrow();
  });

  it("PARTIALLY_SHIPPED กลับไปเข้ารอบใหม่ได้ (กล่อง rollover)", () => {
    expect(() => assertBillTransition("PARTIALLY_SHIPPED", "ASSIGNED_TO_SHIPMENT")).not.toThrow();
  });

  it("แปลงสถานะบิล → DocumentStatus ถูกต้อง", () => {
    expect(billStatusToDocumentStatus("IMPORTED")).toBe("PENDING");
    expect(billStatusToDocumentStatus("READY_TO_PICK")).toBe("PENDING");
    expect(billStatusToDocumentStatus("PICKED_WAITING_APPROVAL")).toBe("WAITING_APPROVAL");
    expect(billStatusToDocumentStatus("PICKING")).toBe("PROCESSING");
    expect(billStatusToDocumentStatus("PARTIALLY_SHIPPED")).toBe("PROCESSING");
    expect(billStatusToDocumentStatus("SHIPPED")).toBe("COMPLETED");
    expect(billStatusToDocumentStatus("CANCELLED")).toBe("CANCELLED");
  });

  it("สถานะที่ถือว่าจองสต็อกอยู่", () => {
    expect(isBillReserving("PICKING")).toBe(true);
    expect(isBillReserving("SHORTAGE")).toBe(true);
    expect(isBillReserving("PICKED_WAITING_APPROVAL")).toBe(true);
    expect(isBillReserving("READY_TO_PICK")).toBe(false);
    expect(isBillReserving("READY_TO_PACK")).toBe(false);
    expect(isBillReserving("CANCELLED")).toBe(false);
    expect(isBillReserving("SHIPPED")).toBe(false);
  });
});

describe("outbound state machine — กล่อง", () => {
  it("วงจรกล่องปกติ OPEN → CLOSED → LOADED → SHIPPED", () => {
    expect(() => assertBoxTransition("OPEN", "CLOSED")).not.toThrow();
    expect(() => assertBoxTransition("CLOSED", "LOADED")).not.toThrow();
    expect(() => assertBoxTransition("LOADED", "SHIPPED")).not.toThrow();
  });

  it("ROLLOVER กลับขึ้นรอบใหม่ได้, ปิดรอบแบบขาดได้ ROLLOVER", () => {
    expect(() => assertBoxTransition("LOADED", "ROLLOVER")).not.toThrow();
    expect(() => assertBoxTransition("ROLLOVER", "LOADED")).not.toThrow();
    expect(() => assertBoxTransition("ROLLOVER", "CANCELLED")).not.toThrow();
  });

  it("unload กล่อง LOADED → CLOSED ได้ (สแกนผิด)", () => {
    expect(() => assertBoxTransition("LOADED", "CLOSED")).not.toThrow();
  });

  it("กล่องห้ามข้ามขั้น/ย้อนหลังผิดกฎ", () => {
    expect(() => assertBoxTransition("OPEN", "LOADED")).toThrow(OutboundStateError);
    expect(() => assertBoxTransition("CLOSED", "SHIPPED")).toThrow(OutboundStateError);
    expect(() => assertBoxTransition("SHIPPED", "ROLLOVER")).toThrow(OutboundStateError);
    expect(BOX_TRANSITIONS.SHIPPED).toHaveLength(0);
  });
});

describe("outbound state machine — รอบรถ", () => {
  it("OPEN → LOADING → CLOSED", () => {
    expect(() => assertShipmentTransition("OPEN", "LOADING")).not.toThrow();
    expect(() => assertShipmentTransition("LOADING", "CLOSED")).not.toThrow();
  });

  it("ปิดรอบแล้วแก้ไขต่อไม่ได้", () => {
    expect(() => assertShipmentTransition("CLOSED", "LOADING")).toThrow(OutboundStateError);
    expect(SHIPMENT_TRANSITIONS.CLOSED).toHaveLength(0);
    expect(SHIPMENT_TRANSITIONS.CANCELLED).toHaveLength(0);
  });
});

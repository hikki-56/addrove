import type { IStockRepository } from "@/lib/repositories/interfaces";
import type { Document } from "@/types/models";
import {
  getBusyQCodes,
  nextFreeQCode,
  parseMaxItemsPerQ,
  planBillQAssignments,
  DEFAULT_MAX_ITEMS_PER_Q,
} from "@/lib/services/outbound/q-assignment.service";

function billDoc(
  docNo: string,
  status: string,
  qAssignments?: Array<{ q_code: string; items: Array<{ sku: string; qty: number }> }>
): Document {
  return {
    document_id: `doc-${docNo}`,
    document_no: docNo,
    document_type: "OUTBOUND_ORDER",
    reference_no: "",
    document_date: "2026-09-14",
    status: "PROCESSING",
    note: JSON.stringify({
      kind: "outbound_bill",
      outbound_status: status,
      express_bill_no: `EXP-${docNo}`,
      warehouse_id: "wh-01",
      items: [],
      box_document_ids: [],
      exceptions: [],
      ...(qAssignments ? { q_assignments: qAssignments } : {}),
    }),
    created_by: "tester",
    created_at: "2026-09-14T00:00:00Z",
  };
}

function makeRepo(docs: Document[]): IStockRepository {
  return {
    documents: {
      findAll: async (filters?: { document_type?: string }) => ({
        data: docs.filter((d) => !filters?.document_type || d.document_type === filters.document_type),
        total: docs.length,
      }),
      findById: async () => null,
      findByNo: async () => null,
    },
  } as unknown as IStockRepository;
}

describe("planBillQAssignments — แบ่งกล่อง Q อัตโนมัติ", () => {
  it("บิล 12 รายการ (max 5) → 3 กล่อง (5+5+2) รายการเรียงติดกันตามลำดับเดิม", () => {
    const busy = new Map();
    const items = Array.from({ length: 12 }, (_, i) => ({ sku: `S${i + 1}`, qty: 1 }));
    const result = planBillQAssignments(items, busy, 5);
    expect(result.map((q) => q.q_code)).toEqual(["Q1", "Q2", "Q3"]);
    expect(result.map((q) => q.items.length)).toEqual([5, 5, 2]);
    // ต้องเรียงลำดับเดิม ไม่กระจาย
    expect(result[0].items.map((i) => i.sku)).toEqual(["S1", "S2", "S3", "S4", "S5"]);
    expect(result[2].items.map((i) => i.sku)).toEqual(["S11", "S12"]);
    // กล่อง ≤ 5 เสมอ
    expect(result.every((q) => q.items.length <= 5)).toBe(true);
  });

  it("บิล ≤ max ทั้งบิลอยู่กล่องเดียว — ไม่มีการแบ่งละนิดละหน่อย", () => {
    const result = planBillQAssignments(
      [{ sku: "A", qty: 3 }, { sku: "B", qty: 2 }, { sku: "C", qty: 1 }],
      new Map(),
      5
    );
    expect(result).toHaveLength(1);
    expect(result[0].q_code).toBe("Q1");
    expect(result[0].items).toHaveLength(3);
  });

  it("ข้ามรหัส Q ที่ติดงานอยู่ แล้วใช้ตัวถัดไปที่ว่าง", () => {
    const busy = new Map([
      ["Q1", { document_id: "x1", document_no: "BIL-1" }],
      ["Q3", { document_id: "x2", document_no: "BIL-2" }],
    ]);
    expect(nextFreeQCode(busy)).toBe("Q2");
    const result = planBillQAssignments(Array.from({ length: 7 }, (_, i) => ({ sku: `S${i}`, qty: 1 })), busy, 5);
    // 7 รายการ max 5 → 2 กล่อง → ได้ Q2 และ Q4 (ข้าม Q3 ที่ติดงาน)
    expect(result.map((q) => q.q_code)).toEqual(["Q2", "Q4"]);
  });

  it("เรียกต่อกันหลายบิล — รหัสที่จัดไปแล้วถูก mark busy ไม่ชนกัน", () => {
    const busy = new Map();
    const bill1 = planBillQAssignments(Array.from({ length: 6 }, (_, i) => ({ sku: `A${i}`, qty: 1 })), busy, 5);
    const bill2 = planBillQAssignments(Array.from({ length: 2 }, (_, i) => ({ sku: `B${i}`, qty: 1 })), busy, 5);
    expect(bill1.map((q) => q.q_code)).toEqual(["Q1", "Q2"]);
    expect(bill2.map((q) => q.q_code)).toEqual(["Q3"]);
  });

  it("parseMaxItemsPerQ: ค่าเริ่มต้น 5 / ค่าต่ำกว่า 1 หรือผิดรูป = default / จำกัดสูงสุด 50", () => {
    expect(parseMaxItemsPerQ(undefined)).toBe(DEFAULT_MAX_ITEMS_PER_Q);
    expect(parseMaxItemsPerQ("0")).toBe(DEFAULT_MAX_ITEMS_PER_Q);
    expect(parseMaxItemsPerQ("abc")).toBe(DEFAULT_MAX_ITEMS_PER_Q);
    expect(parseMaxItemsPerQ("999")).toBe(50);
    expect(parseMaxItemsPerQ("8")).toBe(8);
  });
});

describe("getBusyQCodes — กล่อง Q ที่ติดงานทั้งระบบ", () => {
  it("บิล Express ที่มี q_assignments และยังไม่แพ็ก = กล่องติดงาน / PACKED หรือ CANCELLED = ว่าง", async () => {
    const repo = makeRepo([
      billDoc("BIL-1", "PICKING", [{ q_code: "Q1", items: [{ sku: "A", qty: 1 }] }]),
      billDoc("BIL-2", "PACKED", [{ q_code: "Q2", items: [{ sku: "B", qty: 1 }] }]),
      billDoc("BIL-3", "CANCELLED", [{ q_code: "Q3", items: [{ sku: "C", qty: 1 }] }]),
      billDoc("BIL-4", "IMPORTED"), // ไม่มี q_assignments
    ]);
    const busy = await getBusyQCodes(repo);
    expect(busy.has("Q1")).toBe(true);
    expect(busy.get("Q1")?.document_no).toBe("BIL-1");
    expect(busy.has("Q2")).toBe(false);
    expect(busy.has("Q3")).toBe(false);
    expect(busy.has("Q4")).toBe(false);
  });
});

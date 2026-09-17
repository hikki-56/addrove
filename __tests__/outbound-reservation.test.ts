import type { IStockRepository } from "@/lib/repositories/interfaces";
import type { Document, StockSummary } from "@/types/models";
import {
  getReservedEntries,
  getAvailability,
  assertAvailableForPick,
  OutboundReservationError,
  suggestPickLocation,
  suggestPickLocationAll,
} from "@/lib/services/outbound/stock-reservation.service";

function billDoc(
  docNo: string,
  status: string,
  items: Array<{ sku: string; product_id: string; qty_required: number; qty_picked: number; item_status?: string }>
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
      express_bill_no: docNo.replace("BIL", "EXP"),
      warehouse_id: "wh-01",
      items: items.map((it) => ({
        sku: it.sku,
        product_id: it.product_id,
        qty_required: it.qty_required,
        qty_picked: it.qty_picked,
        status: it.item_status ?? "PENDING",
      })),
      box_document_ids: [],
      exceptions: [],
    }),
    created_by: "tester",
    created_at: "2026-09-14T00:00:00Z",
  };
}

function makeRepo(opts: {
  docs?: Document[];
  summaries?: Array<{ product_id: string; warehouse_id: string; location_id: string; quantity: number }>;
}): IStockRepository {
  const summaries: StockSummary[] = (opts.summaries ?? []).map((s, i) => ({
    product_id: s.product_id,
    warehouse_id: s.warehouse_id,
    location_id: s.location_id,
    quantity: s.quantity,
    last_updated: new Date().toISOString().slice(0, 10) + `-${i}`,
  }));
  return {
    documents: {
      findAll: async (filters?: { document_type?: string }) => ({
        data: (opts.docs ?? []).filter((d) => !filters?.document_type || d.document_type === filters.document_type),
        total: (opts.docs ?? []).length,
      }),
      findById: async () => null,
      findByNo: async () => null,
      create: async () => { throw new Error("not used"); },
      updateStatus: async () => {},
      updateNote: async () => {},
      generateDocumentNo: async () => "X-1",
    },
    stockSummary: {
      // เลียนแบบ repo จริง: findAll(warehouseId) กรองตามคลัง
      findAll: async (warehouseId?: string) =>
        summaries.filter((s) => !warehouseId || s.warehouse_id === warehouseId),
    },
  } as unknown as IStockRepository;
}

describe("stock reservation — On Hand / Reserved / Available", () => {
  const SKU_A = "prod-a";
  const SKU_B = "prod-b";

  it("does not report zero stock when the stock source fails", async () => {
    const repo = makeRepo({});
    repo.stockSummary.findAll = jest.fn().mockRejectedValue(new Error("stock source unavailable"));
    await expect(getAvailability(repo, "wh-01", [{ sku: "A", product_id: SKU_A, qty: 1 }]))
      .rejects.toThrow("stock source unavailable");
  });

  it("reports an unlinked product separately from a real stock shortage", async () => {
    const doc = billDoc("BIL-UNLINKED", "READY_TO_PICK", [
      { sku: "UNKNOWN", product_id: "", qty_required: 1, qty_picked: 0 },
    ]);
    await expect(assertAvailableForPick(makeRepo({}), "wh-01", JSON.parse(doc.note)))
      .rejects.toThrow(/ยังไม่ได้เชื่อมกับสินค้า.*UNKNOWN/);
  });

  it("นับ Reserved จากบิลที่อยู่ในสถานะจองเท่านั้น (หักส่วนที่หยิบแล้ว)", async () => {
    const repo = makeRepo({
      docs: [
        billDoc("BIL-1", "PICKING", [{ sku: "A", product_id: SKU_A, qty_required: 8, qty_picked: 3 }]),
        billDoc("BIL-2", "PICKED_WAITING_APPROVAL", [{ sku: "A", product_id: SKU_A, qty_required: 6, qty_picked: 0 }]),
        billDoc("BIL-3", "READY_TO_PICK", [{ sku: "A", product_id: SKU_A, qty_required: 4, qty_picked: 0 }]), // ยังไม่จอง
        billDoc("BIL-4", "READY_TO_PACK", [{ sku: "B", product_id: SKU_B, qty_required: 5, qty_picked: 5 }]), // อนุมัติแล้ว = ปล่อยจอง
        billDoc("BIL-5", "CANCELLED", [{ sku: "B", product_id: SKU_B, qty_required: 5, qty_picked: 0 }]), // ยกเลิก = ปล่อยจอง
      ],
    });
    const entries = await getReservedEntries(repo);
    const totalA = entries.filter((e) => e.product_id === SKU_A).reduce((s, e) => s + e.qty, 0);
    expect(totalA).toBe(5 + 6); // (8-3) + 6 — ไม่นับ READY_TO_PICK/READY_TO_PACK/CANCELLED
    expect(entries.filter((e) => e.product_id === SKU_B)).toHaveLength(0);
  });

  it("Available = On Hand − Reserved", async () => {
    const repo = makeRepo({
      docs: [billDoc("BIL-1", "PICKING", [{ sku: "A", product_id: SKU_A, qty_required: 8, qty_picked: 0 }])],
      summaries: [
        { product_id: SKU_A, warehouse_id: "wh-01", location_id: "L1", quantity: 6 },
        { product_id: SKU_A, warehouse_id: "wh-01", location_id: "L2", quantity: 4 },
        { product_id: SKU_A, warehouse_id: "wh-02", location_id: "L3", quantity: 100 }, // คลังอื่นไม่นับ
      ],
    });
    const rows = await getAvailability(repo, "wh-01", [{ sku: "A", product_id: SKU_A, qty: 9 }]);
    expect(rows[0].on_hand).toBe(10);
    expect(rows[0].reserved).toBe(8);
    expect(rows[0].available).toBe(2);
    expect(rows[0].short).toBe(-7);
  });

  it("assertAvailableForPick: สต็อกไม่พอ → throw พร้อมรายละเอียด (กันสองบิลหยิบเกิน)", async () => {
    const repo = makeRepo({
      docs: [billDoc("BIL-1", "PICKING", [{ sku: "A", product_id: SKU_A, qty_required: 8, qty_picked: 0 }])],
      summaries: [{ product_id: SKU_A, warehouse_id: "wh-01", location_id: "L1", quantity: 10 }],
    });
    // บิลใหม่ต้องการ 5 แต่ Available เหลือ 2 (ถูก BIL-1 จอง 8) → ปฏิเสธ
    const newBillNote = {
      kind: "outbound_bill" as const,
      outbound_status: "READY_TO_PICK" as const,
      express_bill_no: "EXP-2",
      warehouse_id: "wh-01",
      items: [{ sku: "A", product_id: SKU_A, qty_required: 5, qty_picked: 0, status: "PENDING" as const }],
      box_document_ids: [],
      exceptions: [],
    };
    await expect(assertAvailableForPick(repo, "wh-01", newBillNote)).rejects.toThrow(OutboundReservationError);
    await expect(assertAvailableForPick(repo, "wh-01", newBillNote)).rejects.toThrow(/Available 2/);
  });

  it("assertAvailableForPick: ของอยู่คลังอื่น/สำนักงานใหญ่ก็ผ่าน (นับรวมทุกคลัง)", async () => {
    const repo = makeRepo({
      summaries: [
        { product_id: SKU_A, warehouse_id: "wh-03", location_id: "L5", quantity: 15 },
        { product_id: SKU_A, warehouse_id: "wh-06", location_id: "21", quantity: 10 }, // สำนักงานใหญ่
      ],
    });
    // บิลผูก wh-01 แต่ไม่มีสต็อกใน wh-01 เลย — รวมทุกคลังมี 25 → ผ่าน
    const note = {
      kind: "outbound_bill" as const,
      outbound_status: "READY_TO_PICK" as const,
      express_bill_no: "EXP-1",
      warehouse_id: "wh-01",
      items: [{ sku: "A", product_id: SKU_A, qty_required: 20, qty_picked: 0, status: "PENDING" as const }],
      box_document_ids: [],
      exceptions: [],
    };
    const rows = await assertAvailableForPick(repo, "wh-01", note);
    expect(rows[0].on_hand).toBe(25);
  });

  it("assertAvailableForPick: พอ → ผ่าน", async () => {
    const repo = makeRepo({
      summaries: [{ product_id: SKU_A, warehouse_id: "wh-01", location_id: "L1", quantity: 10 }],
    });
    const note = {
      kind: "outbound_bill" as const,
      outbound_status: "READY_TO_PICK" as const,
      express_bill_no: "EXP-1",
      warehouse_id: "wh-01",
      items: [{ sku: "A", product_id: SKU_A, qty_required: 10, qty_picked: 0, status: "PENDING" as const }],
      box_document_ids: [],
      exceptions: [],
    };
    await expect(assertAvailableForPick(repo, "wh-01", note)).resolves.toBeTruthy();
  });

  it("suggestPickLocation ชี้ตำแหน่งที่มีสต็อกมากสุดในคลัง", () => {
    const summaries: StockSummary[] = [
      { product_id: SKU_A, warehouse_id: "wh-01", location_id: "L1", quantity: 3, last_updated: "" },
      { product_id: SKU_A, warehouse_id: "wh-01", location_id: "L2", quantity: 7, last_updated: "" },
      { product_id: SKU_A, warehouse_id: "wh-01", location_id: "L3", quantity: 0, last_updated: "" },
      { product_id: SKU_A, warehouse_id: "wh-02", location_id: "L9", quantity: 99, last_updated: "" },
    ];
    expect(suggestPickLocation(summaries, "wh-01", SKU_A)?.location_id).toBe("L2");
    expect(suggestPickLocation(summaries, "wh-02", "nope")).toBeNull();
  });

  it("suggestPickLocationAll: ชอบคลังของบิลก่อน ถ้าไม่มีค่อยไล่คลังอื่น/สำนักงานใหญ่", () => {
    const summaries: StockSummary[] = [
      { product_id: SKU_A, warehouse_id: "wh-02", location_id: "L9", quantity: 99, last_updated: "" },
      { product_id: SKU_A, warehouse_id: "wh-01", location_id: "L1", quantity: 3, last_updated: "" },
      { product_id: SKU_A, warehouse_id: "wh-06", location_id: "21", quantity: 50, last_updated: "" }, // สำนักงานใหญ่
    ];
    // คลังของบิล (wh-01) มีสต็อก 3 ชิ้น → ใช้คลังนี้แม้คลังอื่นจะมีมากกว่า
    expect(suggestPickLocationAll(summaries, "wh-01", SKU_A)).toEqual({
      warehouse_id: "wh-01",
      location_id: "L1",
      quantity: 3,
    });
    // คลังของบิล (wh-03) ไม่มีสต็อก → ตกไปตำแหน่งที่มีมากสุดในคลังอื่น
    expect(suggestPickLocationAll(summaries, "wh-03", SKU_A)).toEqual({
      warehouse_id: "wh-02",
      location_id: "L9",
      quantity: 99,
    });
    expect(suggestPickLocationAll(summaries, "wh-03", "nope")).toBeNull();
  });
});

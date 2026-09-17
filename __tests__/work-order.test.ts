import type { IStockRepository } from "@/lib/repositories/interfaces";
import type { Actor } from "@/lib/security/actor";
import type { Document } from "@/types/models";

jest.mock("@/lib/services/stock", () => ({
  issueStock: jest.fn(async () => ({ document_id: "iss-mock-1", document_no: "ISS-MOCK-1" })),
  receiveStock: jest.fn(async () => ({ document_id: "rcv-mock-1", document_no: "RCV-MOCK-1" })),
}));

import { issueStock, receiveStock } from "@/lib/services/stock";
import {
  createWorkOrder,
  sendWorkOrder,
  startQBox,
  confirmQItemScan,
  reportQProblem,
  resolveWorkOrderShortage,
  cancelWorkOrder,
  getQBoxHistory,
  WorkOrderError,
} from "@/lib/services/outbound/work-order.service";

const admin: Actor = { id: "usr-admin", username: "แอดมิน", role: "ADMIN" } as Actor;
const packerA: Actor = { id: "usr-p1", username: "พนักงาน1", role: "PACKER" } as Actor;
const packerB: Actor = { id: "usr-p2", username: "พนักงาน2", role: "PACKER" } as Actor;

/** repo จำลองที่เก็บเอกสารใน memory และรองรับ read-modify-write แบบเดียวกับชีตจริง */
function makeRepo(): { repo: IStockRepository; docs: Document[] } {
  const docs: Document[] = [];
  let seq = 0;
  const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
  const repo = {
    documents: {
      findAll: async (filters?: { document_type?: string }) => ({
        data: docs.filter((d) => !filters?.document_type || d.document_type === filters.document_type),
        total: docs.length,
      }),
      findById: async (id: string) => clone(docs.find((d) => d.document_id === id) ?? null),
      findByNo: async (no: string) => clone(docs.find((d) => d.document_no === no) ?? null),
      create: async (doc: Omit<Document, "document_id" | "document_no" | "created_at">) => {
        seq += 1;
        const full: Document = {
          ...doc,
          document_id: `doc-tv-${seq}`,
          document_no: `TV-20260914-${String(seq).padStart(6, "0")}`,
          created_at: new Date().toISOString(),
        };
        docs.push(full);
        return clone(full);
      },
      updateNote: async (id: string, note: string) => {
        const d = docs.find((x) => x.document_id === id || x.document_no === id);
        if (d) d.note = note;
      },
      updateStatus: async (id: string, status: Document["status"]) => {
        const d = docs.find((x) => x.document_id === id || x.document_no === id);
        if (d) d.status = status;
      },
      updateDoc: async (id: string, updates: Partial<Document>) => {
        const d = docs.find((x) => x.document_id === id || x.document_no === id);
        if (d) Object.assign(d, updates);
      },
    },
    stockSummary: {
      findAll: async (warehouseId?: string) =>
        [
          { product_id: "prod-a", warehouse_id: "wh-01", location_id: "A-01", quantity: 100 },
          { product_id: "prod-b", warehouse_id: "wh-01", location_id: "B-02", quantity: 100 },
        ].filter((s) => !warehouseId || s.warehouse_id === warehouseId) as never,
    },
  } as unknown as IStockRepository;
  return { repo, docs };
}

function input(boxes: Array<{ q_code: string; items: Array<{ sku: string; qty: number }> }>) {
  return {
    warehouse_id: "wh-01",
    title: "ทดสอบ",
    q_boxes: boxes.map((b) => ({
      q_code: b.q_code,
      items: b.items.map((it) => ({
        sku: it.sku,
        product_id: `prod-${it.sku.toLowerCase()}`,
        barcode: `BC-${it.sku}`,
        product_name: `สินค้า ${it.sku}`,
        qty: it.qty,
      })),
    })),
  };
}

const TWO_BOXES = [
  { q_code: "Q1", items: [{ sku: "A", qty: 2 }, { sku: "B", qty: 3 }] },
  { q_code: "Q2", items: [{ sku: "A", qty: 1 }] },
];

async function createdAndSent(boxes = TWO_BOXES) {
  const { repo, docs } = makeRepo();
  const created = await createWorkOrder(repo, input(boxes), admin);
  await sendWorkOrder(repo, created.document_id, admin);
  return { repo, docs, documentNo: created.document_no };
}

describe("ใบงานกล่อง Q — สร้าง/ส่ง", () => {
  beforeEach(() => {
    (issueStock as jest.Mock).mockClear();
    (receiveStock as jest.Mock).mockClear();
  });

  it("สร้างร่างใบงาน: สถานะ DRAFT + รวมยอดสินค้าข้ามกล่องให้ขั้นแพ็กใช้ต่อ", async () => {
    const { repo, docs } = makeRepo();
    const created = await createWorkOrder(repo, input(TWO_BOXES), admin);
    const note = JSON.parse(docs[0].note);
    expect(note.outbound_status).toBe("DRAFT");
    expect(note.source).toBe("WORK_ORDER");
    expect(note.express_bill_no).toBe(created.document_no);
    // A = 2 (Q1) + 1 (Q2) = 3, B = 3
    expect(note.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sku: "A", qty_required: 3 }),
        expect.objectContaining({ sku: "B", qty_required: 3 }),
      ])
    );
    expect(note.q_boxes.map((q: { q_code: string }) => q.q_code)).toEqual(["Q1", "Q2"]);
  });

  it("ห้ามระบุกล่อง Q ซ้ำในใบงานเดียว", async () => {
    const { repo } = makeRepo();
    await expect(
      createWorkOrder(repo, input([{ q_code: "Q1", items: [{ sku: "A", qty: 1 }] }, { q_code: "q1", items: [{ sku: "B", qty: 1 }] }]), admin)
    ).rejects.toThrow(/ซ้ำ/);
  });

  it("ห้ามใช้กล่อง Q ที่ติดงานอื่นอยู่", async () => {
    const { repo } = makeRepo();
    await createWorkOrder(repo, input(TWO_BOXES), admin);
    await expect(
      createWorkOrder(repo, input([{ q_code: "Q1", items: [{ sku: "A", qty: 1 }] }]), admin)
    ).rejects.toThrow(/ติดงานอื่น/);
  });

  it("ส่งใบงาน: ตัดสต็อกครั้งเดียว (idempotent key) + stamp ตำแหน่ง + READY_TO_PICK", async () => {
    const { repo, docs } = makeRepo();
    const created = await createWorkOrder(repo, input(TWO_BOXES), admin);
    await sendWorkOrder(repo, created.document_id, admin);

    expect(issueStock).toHaveBeenCalledTimes(1);
    const call = (issueStock as jest.Mock).mock.calls[0][1];
    expect(call.idempotency_key).toBe(`work-order-${created.document_id}`);
    // รวมยอดตาม product+location: A×3 ที่ A-01, B×3 ที่ B-02
    const lines = call.lines as Array<{ product_id: string; location_id: string; qty: number }>;
    expect(lines).toContainEqual({ product_id: "prod-a", location_id: "A-01", qty: 3 });
    expect(lines).toContainEqual({ product_id: "prod-b", location_id: "B-02", qty: 3 });

    const note = JSON.parse(docs[0].note);
    expect(note.outbound_status).toBe("READY_TO_PICK");
    expect(note.q_boxes[0].items[0].location_id).toBe("A-01");
    expect(note.sent_at).toBeTruthy();
  });
});

describe("ใบงานกล่อง Q — พนักงานสแกนกล่อง/สินค้า", () => {
  it.each(["PACKED", "HOLD", "CANCELLED"])(
    "ignores an old Express bill in %s when Q1 has a new bill",
    async (status) => {
      const { repo, docs } = await createdAndSent([
        { q_code: "Q1", items: [{ sku: "A", qty: 2 }] },
      ]);
      const active = docs[0];
      const note = JSON.parse(active.note);
      delete note.source;
      delete note.q_boxes;
      note.q_assignments = [{ q_code: "Q1", items: [{ sku: "A", qty: 2 }], status: "PENDING" }];
      note.outbound_status = "PICKING";
      active.document_type = "OUTBOUND_ORDER";
      active.note = JSON.stringify(note);
      docs.unshift({
        ...active,
        document_id: "old-bill",
        document_no: "OLD-BILL",
        note: JSON.stringify({ ...note, outbound_status: status }),
      });
      const view = await startQBox(repo, "Q1", packerA);
      expect(view.document_id).toBe(active.document_id);
      expect((await confirmQItemScan(repo, "Q1", "BC-A", packerA)).qty_picked).toBe(1);
      expect(JSON.parse(docs[0].note).items[0].qty_picked).toBe(0);
    }
  );

  it("opens the new assignment when an older completed work order reused Q1", async () => {
    const boxes = [{ q_code: "Q1", items: [{ sku: "A", qty: 1 }] }];
    const { repo, docs } = await createdAndSent(boxes);
    await startQBox(repo, "Q1", packerA);
    await confirmQItemScan(repo, "Q1", "A", packerA);
    const next = await createWorkOrder(repo, input(boxes), admin);
    await sendWorkOrder(repo, next.document_id, admin);
    // Exercise both repository orderings; historical rows must never hide active work.
    for (let i = 0; i < 2; i++) {
      const view = await startQBox(repo, "Q1", packerA);
      expect(view.document_id).toBe(next.document_id);
      docs.reverse();
    }
    expect((await confirmQItemScan(repo, "Q1", "prod-a", packerA)).qty_picked).toBe(1);
  });

  beforeEach(() => {
    (issueStock as jest.Mock).mockClear();
    (receiveStock as jest.Mock).mockClear();
  });

  it("สแกนกล่อง Q1 → เห็นรายการเรียงตามตำแหน่ง + ล็อกคนหยิบ", async () => {
    const { repo } = await createdAndSent();
    const view = await startQBox(repo, "q1", packerA); // รับตัวพิมพ์เล็ก
    expect(view.q_code).toBe("Q1");
    expect(view.items.map((i) => i.sku)).toEqual(["A", "B"]); // A-01 < B-02
    const note = JSON.parse((await repo.documents.findByNo(view.document_no) as Document).note);
    expect(note.outbound_status).toBe("PICKING");
    expect(note.q_boxes[0].picked_by).toBe("usr-p1");
  });

  it("พนักงานคนอื่นสแกนกล่องที่กำลังหยิบอยู่ → ปฏิเสธ", async () => {
    const { repo } = await createdAndSent();
    await startQBox(repo, "Q1", packerA);
    await expect(startQBox(repo, "Q1", packerB)).rejects.toThrow(/กำลังถูกหยิบโดย/);
  });

  it("สแกนสินค้า 1 ครั้ง = 1 ชิ้น — นับ 0/2 → 1/2 และ sync ยอดรวมของใบงาน", async () => {
    const { repo, docs } = await createdAndSent();
    await startQBox(repo, "Q1", packerA);
    const r = await confirmQItemScan(repo, "Q1", "BC-A", packerA); // สแกนด้วยบาร์โค้ด
    expect(r.qty_picked).toBe(1);
    expect(r.qty_required).toBe(2);
    const note = JSON.parse(docs[0].note);
    expect(note.q_boxes[0].items[0].qty_picked).toBe(1);
    expect(note.items.find((i: { sku: string }) => i.sku === "A").qty_picked).toBe(1);
  });

  it("สแกนสินค้าผิด → ปฏิเสธ ไม่นับจำนวน", async () => {
    const { repo } = await createdAndSent();
    await startQBox(repo, "Q1", packerA);
    await expect(confirmQItemScan(repo, "Q1", "ZZZ", packerA)).rejects.toThrow(/ไม่อยู่ในกล่อง/);
  });

  it("สแกนเกินจำนวน → ปฏิเสธ (ห้ามเกิน qty_required)", async () => {
    const { repo } = await createdAndSent();
    await startQBox(repo, "Q1", packerA);
    await confirmQItemScan(repo, "Q1", "A", packerA); // 1/2
    await confirmQItemScan(repo, "Q1", "A", packerA); // 2/2
    await expect(confirmQItemScan(repo, "Q1", "A", packerA)).rejects.toThrow(/หยิบครบแล้ว/);
  });

  it("ครบทุกกล่อง → กล่อง DONE และใบงานเข้าคิวแพ็กทันที (READY_TO_PACK)", async () => {
    const { repo, docs } = await createdAndSent();
    await startQBox(repo, "Q1", packerA);
    await confirmQItemScan(repo, "Q1", "A", packerA);
    await confirmQItemScan(repo, "Q1", "A", packerA);
    await confirmQItemScan(repo, "Q1", "B", packerA);
    await confirmQItemScan(repo, "Q1", "B", packerA);
    await confirmQItemScan(repo, "Q1", "B", packerA);
    let note = JSON.parse(docs[0].note);
    expect(note.q_boxes[0].status).toBe("DONE");
    expect(note.outbound_status).toBe("PICKING"); // ยังมี Q2

    await startQBox(repo, "Q2", packerA);
    await confirmQItemScan(repo, "Q2", "A", packerA);
    note = JSON.parse(docs[0].note);
    expect(note.outbound_status).toBe("READY_TO_PACK");
    expect(note.items.find((i: { sku: string }) => i.sku === "A").qty_picked).toBe(3);
  });

  it("กล่องที่หยิบเสร็จแล้ว สแกนซ้ำไม่ได้", async () => {
    const { repo } = await createdAndSent();
    await startQBox(repo, "Q1", packerA);
    for (let i = 0; i < 5; i++) await confirmQItemScan(repo, "Q1", i < 2 ? "A" : "B", packerA);
    await expect(startQBox(repo, "Q1", packerA)).rejects.toThrow(/หยิบเสร็จ|ไม่พบงาน/);
  });
});

describe("ใบงานกล่อง Q — ปัญหาและการตัดสิน", () => {
  beforeEach(() => {
    (issueStock as jest.Mock).mockClear();
    (receiveStock as jest.Mock).mockClear();
  });

  it("แจ้งปัญหาจนเหลือแต่รายการติดปัญหา → ใบงาน SHORTAGE และตัดสิน REDUCE_QTY คืนสต็อกส่วนต่าง", async () => {
    const { repo, docs, documentNo } = await createdAndSent();
    await startQBox(repo, "Q1", packerA);
    // Q1: B ติดปัญหาทั้ง 3 ชิ้น, A หยิบครบ 2
    await confirmQItemScan(repo, "Q1", "A", packerA);
    await confirmQItemScan(repo, "Q1", "A", packerA);
    await reportQProblem(repo, "Q1", "B", { problem: "NOT_FOUND" }, packerA);
    // Q2: หยิบครบ
    await startQBox(repo, "Q2", packerA);
    await confirmQItemScan(repo, "Q2", "A", packerA);
    let note = JSON.parse(docs[0].note);
    expect(note.outbound_status).toBe("SHORTAGE");

    await resolveWorkOrderShortage(repo, documentNo, "REDUCE_QTY", admin);
    const call = (receiveStock as jest.Mock).mock.calls[0][1];
    expect(call.idempotency_key).toBe(`work-order-return-${documentNo}`);
    expect(call.lines).toContainEqual(
      expect.objectContaining({ product_id: "prod-b", location_id: "B-02", qty: 3 })
    );

    note = JSON.parse(docs[0].note);
    expect(note.outbound_status).toBe("READY_TO_PACK");
    expect(note.q_boxes[0].items.find((i: { sku: string }) => i.sku === "B").qty_required).toBe(0);
  });

  it("ยกเลิกหลังส่ง (ผ่าน resolve CANCEL) → คืนสต็อกทั้งยอด", async () => {
    const { repo, documentNo } = await createdAndSent();
    await startQBox(repo, "Q1", packerA);
    await reportQProblem(repo, "Q1", "A", { problem: "INSUFFICIENT", picked_qty: 0 }, packerA);
    await reportQProblem(repo, "Q1", "B", { problem: "NOT_FOUND" }, packerA);
    await startQBox(repo, "Q2", packerA);
    await reportQProblem(repo, "Q2", "A", { problem: "NOT_FOUND" }, packerA);

    const r = await resolveWorkOrderShortage(repo, documentNo, "CANCEL", admin, "ไม่เอาแล้ว");
    expect(r.work_order_status).toBe("CANCELLED");
    const call = (receiveStock as jest.Mock).mock.calls[0][1];
    const totalQty = (call.lines as Array<{ qty: number }>).reduce((s, l) => s + l.qty, 0);
    expect(totalQty).toBe(6); // A3 + B3 คืนทั้งหมด
  });

  it("ยกเลิกร่าง (ก่อนส่ง) ได้ฟรี แต่หลังส่งต้องผ่านการตัดสิน", async () => {
    const { repo } = makeRepo();
    const created = await createWorkOrder(repo, input(TWO_BOXES), admin);
    const r = await cancelWorkOrder(repo, created.document_id, admin);
    expect(r.work_order_status).toBe("CANCELLED");

    const { repo: repo2, documentNo } = await createdAndSent();
    await expect(cancelWorkOrder(repo2, documentNo, admin)).rejects.toThrow(WorkOrderError);
  });

  it("ประวัติกล่อง Q ย้อนหลังได้ครบทุกใบงาน", async () => {
    const { repo } = await createdAndSent();
    const history = await getQBoxHistory(repo, "Q1");
    expect(history).toHaveLength(1);
    expect(history[0].document_no).toMatch(/^TV-/);
    expect(history[0].q_status).toBe("PENDING");
  });

  it("พนักงานสแกนกล่อง Q ที่ถูกแบ่งในบิล Express (OUTBOUND_ORDER) → แสดงสินค้าและหยิบได้ทันที", async () => {
    const { repo, docs } = makeRepo();
    // จำลองบิล Express ที่ถูกนำเข้าพร้อมการแบ่งกล่อง Q (Q1 และ Q2)
    const billDoc: Document = {
      document_id: "doc-bil-1",
      document_no: "BIL-20260914-000001",
      document_type: "OUTBOUND_ORDER",
      reference_no: "BIL-20260914-000001",
      document_date: "2026-09-14",
      status: "APPROVED",
      note: JSON.stringify({
        kind: "outbound_bill",
        outbound_status: "IMPORTED",
        express_bill_no: "BIL-20260914-000001",
        customer: "ร้านลูกค้า Express",
        warehouse_id: "wh-01",
        items: [
          { sku: "A", product_id: "prod-a", barcode: "885001", product_name: "สินค้า A", qty_required: 2, qty_picked: 0, status: "PENDING", location_hint: "A-01" },
          { sku: "B", product_id: "prod-b", barcode: "885002", product_name: "สินค้า B", qty_required: 1, qty_picked: 0, status: "PENDING", location_hint: "B-02" },
        ],
        q_assignments: [
          { q_code: "Q1", items: [{ sku: "A", qty: 2 }] },
          { q_code: "Q2", items: [{ sku: "B", qty: 1 }] },
        ],
        box_document_ids: [],
        exceptions: [],
      }),
      created_at: new Date().toISOString(),
    };
    docs.push(billDoc);

    // 1. สแกน Q1 เพื่อเปิดงานหยิบ
    const q1View = await startQBox(repo, "Q1", packerA);
    expect(q1View.q_code).toBe("Q1");
    expect(q1View.document_no).toBe("BIL-20260914-000001");
    expect(q1View.items).toHaveLength(1);
    expect(q1View.items[0].sku).toBe("A");
    expect(q1View.items[0].qty_required).toBe(2);
    expect(q1View.items[0].qty_picked).toBe(0);
    expect(q1View.items[0].remaining).toBe(2);

    // ตรวจสอบว่าบิลถูกปรับสถานะเป็น PICKING
    let savedNote = JSON.parse(docs.find((d) => d.document_no === "BIL-20260914-000001")!.note);
    expect(savedNote.outbound_status).toBe("PICKING");

    // 2. สแกนสินค้าใน Q1 ชิ้นที่ 1
    const scan1 = await confirmQItemScan(repo, "Q1", "885001", packerA);
    expect(scan1.qty_picked).toBe(1);
    expect(scan1.q_status).toBe("PICKING");

    // 3. สแกนสินค้าใน Q1 ชิ้นที่ 2 (ครบกล่อง Q1)
    const scan2 = await confirmQItemScan(repo, "Q1", "A", packerA);
    expect(scan2.qty_picked).toBe(2);
    expect(scan2.q_status).toBe("DONE");
    expect(scan2.message).toContain("กล่อง Q1 หยิบเสร็จ");

    // 4. สแกน Q2 ชิ้นที่ 1 (ครบทั้งบิล → บิลต้องเข้า READY_TO_PACK)
    await startQBox(repo, "Q2", packerB);
    const scanQ2 = await confirmQItemScan(repo, "Q2", "885002", packerB);
    expect(scanQ2.qty_picked).toBe(1);
    expect(scanQ2.q_status).toBe("DONE");
    expect(scanQ2.work_order_status).toBe("READY_TO_PACK");

    savedNote = JSON.parse(docs.find((d) => d.document_no === "BIL-20260914-000001")!.note);
    expect(savedNote.outbound_status).toBe("READY_TO_PACK");
  });
});

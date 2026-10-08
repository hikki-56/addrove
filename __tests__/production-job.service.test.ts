// ============================================================
// Unit Tests — ระบบสั่งผลิตและรายงานผลผลิต (production-job.service)
// ครอบคลุม: วงจรเต็ม (สร้าง→ส่ง→เริ่ม→รายงานหลายรอบ→จบงาน), เคสตัวอย่างใน spec
// (เป้า 1000 / รายงาน 600+20 และ 380+10 → สะสม 980/30/ขาด 20), จบงานไม่ครบบังคับเหตุผล,
// กดยืนยันซ้ำ (idempotency), แก้ไขงานตามกติกาสถานะ, ยกเลิกเก็บผลผลิต, ปรับปรุงยอด,
// state machine ผิดลำดับ, สต็อกเพิ่มครั้งเดียวต่อรายงาน
// ============================================================
import type { Product } from "@/types/models";

// ---- Mock Google Sheets client เป็น store ในหน่วยความจำ ----
jest.mock("@/server/google-sheets/client", () => {
  let sheets: Record<string, string[][]> = {};
  const clone = (rows: string[][]) => rows.map((r) => [...r]);
  return {
    SHEETS: {
      DOCUMENTS: "Documents",
      PRODUCTION_JOBS: "ProductionJobs",
      PRODUCTION_REPORTS: "ProductionReports",
      PRODUCTION_HISTORY: "ProductionHistory",
      PRODUCTION_NOTIFS: "ProductionNotifications",
    },
    getWarehouseSheetName: (whId: string) => `warehouse:${whId}`,
    readSheet: jest.fn(async (name: string) => clone(sheets[name] || [])),
    appendRows: jest.fn(async (name: string, rows: (string | number)[][]) => {
      sheets[name] = [...(sheets[name] || []), ...rows.map((r) => r.map((v) => String(v)))];
    }),
    updateRow: jest.fn(async (name: string, rowNumber: number, values: (string | number | boolean)[]) => {
      const rows = sheets[name] || [];
      rows[rowNumber - 2] = values.map((v) => String(v));
      sheets[name] = rows;
    }),
    batchUpdateRows: jest.fn(async (name: string, updates: { rowNumber: number; values: (string | number | boolean)[] }[]) => {
      const rows = sheets[name] || [];
      for (const u of updates) rows[u.rowNumber - 2] = u.values.map((v) => String(v));
      sheets[name] = rows;
    }),
    deleteRows: jest.fn(async (name: string, rowIndices: number[]) => {
      const rows = sheets[name] || [];
      for (const idx of [...rowIndices].sort((a, b) => b - a)) rows.splice(idx, 1);
      sheets[name] = rows;
    }),
    ensureSheetTabExists: jest.fn(async (name: string) => name),
    clearSheetCache: jest.fn(),
    __resetSheets: () => {
      sheets = {};
    },
    __getSheets: () => sheets,
  };
});

// ---- Mock idempotency เป็น in-memory (replay คืน cached result) ----
jest.mock("@/server/idempotency", () => {
  const completed = new Map<string, unknown>();
  return {
    claimIdempotencyKey: jest.fn(async (_repo: unknown, key: string) =>
      completed.has(key) ? { isReplay: true, cachedResult: completed.get(key) } : { isReplay: false }
    ),
    completeIdempotencyKey: jest.fn(async (_repo: unknown, key: string, result: unknown) => {
      completed.set(key, result);
    }),
    failIdempotencyKey: jest.fn(async (_repo: unknown, key: string) => {
      completed.delete(key);
    }),
    __resetIdempotency: () => completed.clear(),
  };
});

jest.mock("@/server/audit", () => ({
  logAudit: jest.fn(async () => null),
}));

// ---- Fake repository (products/documents/movements/stockSummary/warehouseSync) ----
const TEST_PRODUCT: Product = {
  product_id: "prod-A1",
  sku: "A1",
  barcode: "BC-A1",
  product_name: "กล่องสินค้า A",
  category: "สินค้าสำเร็จรูป",
  base_unit: "ชิ้น",
  minimum_stock: 0,
  description: "",
  active: true,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

function makeFakeRepo() {
  return {
    products: {
      findById: jest.fn(async (id: string) => (id.startsWith("prod-A1") || id === "A1" ? TEST_PRODUCT : null)),
      findBySku: jest.fn(async (sku: string) => (sku === "A1" ? TEST_PRODUCT : null)),
    },
    documents: {
      created: [] as any[],
      create: jest.fn(async (d: any) => {
        fakeRepo.documents.created.push(d);
        return d;
      }),
      updateStatus: jest.fn(async () => undefined),
      updateNote: jest.fn(async () => undefined),
    },
    movements: {
      created: [] as any[],
      existsByIdempotencyKey: jest.fn(async (key: string) =>
        fakeRepo.movements.created.some((m) => m.idempotency_key === key)
      ),
      batchCreate: jest.fn(async (movements: any[]) => {
        const now = new Date().toISOString();
        const made = movements.map((m, i) => ({ ...m, movement_id: `mov-${Date.now()}-${i}`, created_at: now }));
        fakeRepo.movements.created.push(...made);
        return made;
      }),
      findByDocumentId: jest.fn(async () => []),
      getBalance: jest.fn(async () => ({})),
    },
    stockSummary: {
      changes: [] as any[],
      applyChanges: jest.fn(async (changes: any[]) => {
        fakeRepo.stockSummary.changes.push(...changes);
      }),
    },
    warehouseSync: {
      adds: [] as any[],
      deducts: [] as any[],
      syncAdd: jest.fn(async (wh: string, product: any, qty: number, loc?: string) => {
        fakeRepo.warehouseSync.adds.push({ wh, product, qty, loc });
      }),
      syncDeduct: jest.fn(async (wh: string, productId: string, qty: number, loc?: string) => {
        fakeRepo.warehouseSync.deducts.push({ wh, productId, qty, loc });
      }),
    },
    idempotency: {},
    audit: { log: async () => null },
  };
}

let fakeRepo: ReturnType<typeof makeFakeRepo>;
jest.mock("@/server/repositories", () => ({
  getRepository: () => fakeRepo,
}));

import {
  createJobs,
  submitJobs,
  startJob,
  reportProduction,
  cancelJob,
  reopenJob,
  adjustProduction,
  updateJob,
  deleteDraft,
  listJobs,
  getJobDetail,
  listNotifications,
  markNotificationsRead,
  ProductionError,
} from "@/server/production/production-job.service";
import type { CreateProductionJobInput } from "@/server/production/production-schemas";

const clientMock = require("@/server/google-sheets/client") as {
  __resetSheets: () => void;
  __getSheets: () => Record<string, string[][]>;
};
const idemMock = require("@/server/idempotency") as { __resetIdempotency: () => void };

const ADMIN = { id: "usr-admin", name: "Admin ทดสอบ", role: "ADMIN" };
const APPROVER = { id: "usr-approver", name: "ผู้ผลิต ทดสอบ", role: "APPROVER" };

function jobInput(overrides: Partial<CreateProductionJobInput> = {}): CreateProductionJobInput {
  return {
    production_date: "2026-10-07",
    table_no: 2,
    product_id: "prod-A1",
    target_qty: 1000,
    priority: "NORMAL",
    note: "",
    location: "2A-01",
    ...overrides,
  };
}

async function createStartedJob(target = 1000, table = 2) {
  const [job] = await createJobs(ADMIN, [jobInput({ target_qty: target, table_no: table })]);
  await submitJobs(ADMIN, [job.job_no]);
  await startJob(APPROVER, job.job_no);
  return job.job_no;
}

function reportPayload(overrides: Record<string, unknown> = {}) {
  return {
    good_qty: 0,
    defect_qty: 0,
    defect_cause: "",
    note: "",
    photo_url: "",
    report_kind: "PARTIAL" as const,
    close_reason: "",
    idempotency_key: `key-${Math.random().toString(36).slice(2)}`,
    ...overrides,
  };
}

function receiveMovements() {
  return fakeRepo.movements.created.filter((m) => m.movement_type === "RECEIVE");
}

beforeEach(() => {
  clientMock.__resetSheets();
  idemMock.__resetIdempotency();
  fakeRepo = makeFakeRepo();
});

// ── สร้าง / เลขใบสั่งผลิต ────────────────────────────────────────

describe("createJobs — สร้างงานฉบับร่าง", () => {
  it("สร้างได้หลายงาน สถานะ DRAFT เลขใบเรียงลำดับ 6 หลัก ขึ้นต้น PRD-", async () => {
    const jobs = await createJobs(ADMIN, [jobInput(), jobInput({ table_no: 3, target_qty: 50 })]);
    expect(jobs).toHaveLength(2);
    for (const j of jobs) {
      expect(j.status).toBe("DRAFT");
      expect(j.job_no).toMatch(/^PRD-\d{8}-\d{6}$/);
    }
    expect(jobs[1].job_no > jobs[0].job_no).toBe(true);
    expect(jobs[0].sku).toBe("A1");
    expect(jobs[0].unit).toBe("ชิ้น");
    expect(jobs[0].remaining_qty).toBe(1000);
  });

  it("เชื่อมกับสินค้าจริง — สินค้าที่ไม่มีในระบบถูกปฏิเสธ", async () => {
    await expect(createJobs(ADMIN, [jobInput({ product_id: "prod-XX" })])).rejects.toThrow(ProductionError);
  });
});

// ── ส่งงาน / เริ่มผลิต ────────────────────────────────────────────

describe("submitJobs + startJob", () => {
  it("ส่งงาน DRAFT→WAITING แจ้ง APPROVER · ส่งซ้ำถูกข้าม · APPROVER เริ่มผลิตแล้วแจ้ง ADMIN", async () => {
    const [job] = await createJobs(ADMIN, [jobInput()]);
    const result = await submitJobs(ADMIN, [job.job_no]);
    expect(result.submitted).toHaveLength(1);
    expect(result.submitted[0].status).toBe("WAITING");

    // ส่งซ้ำ = skipped (ไม่เกิดแจ้งเตือนซ้ำ)
    const again = await submitJobs(ADMIN, [job.job_no]);
    expect(again.submitted).toHaveLength(0);
    expect(again.skipped).toHaveLength(1);

    // แจ้งเตือน APPROVER 1 รายการ
    const notifs = await listNotifications("APPROVER", "usr-approver");
    expect(notifs.unread_count).toBe(1);
    expect(notifs.items[0].job_no).toBe(job.job_no);

    const started = await startJob(APPROVER, job.job_no);
    expect(started.status).toBe("IN_PROGRESS");
    expect(started.started_by_name).toBe(APPROVER.name);

    // เริ่มซ้ำ → conflict
    await expect(startJob(APPROVER, job.job_no)).rejects.toThrow(ProductionError);

    // ADMIN ได้รับแจ้งเตือนว่าเริ่มผลิต
    const adminNotifs = await listNotifications("ADMIN", "usr-admin");
    expect(adminNotifs.unread_count).toBe(1);
  });

  it("รายงานผลก่อนเริ่มผลิตไม่ได้", async () => {
    const [job] = await createJobs(ADMIN, [jobInput()]);
    await submitJobs(ADMIN, [job.job_no]);
    await expect(
      reportProduction(APPROVER, job.job_no, reportPayload({ good_qty: 10 }))
    ).rejects.toThrow(ProductionError);
  });
});

// ── รายงานผลหลายรอบ — เคสตัวอย่างใน spec ─────────────────────────

describe("reportProduction — เป้า 1000 / รายงาน 600+20 และ 380+10 จบงาน", () => {
  it("สะสมดี 980 เสีย 30 ขาด 20 · สถานะ COMPLETED · สต็อกเพิ่มครั้งเดียวต่อรายงาน", async () => {
    const jobNo = await createStartedJob(1000);

    // รอบ 1: มีของเสียแต่ไม่กรอกสาเหตุ → ปฏิเสธ
    await expect(
      reportProduction(APPROVER, jobNo, reportPayload({ good_qty: 600, defect_qty: 20 }))
    ).rejects.toThrow("สาเหตุของเสีย");

    // รอบ 1 ถูกต้อง
    const r1 = await reportProduction(
      APPROVER,
      jobNo,
      reportPayload({ good_qty: 600, defect_qty: 20, defect_cause: "แตกหัก", report_kind: "PARTIAL" })
    );
    expect(r1.report.cumulative_good).toBe(600);
    expect(r1.report.cumulative_defect).toBe(20);
    expect(r1.job.status).toBe("IN_PROGRESS"); // บางส่วนยังกำลังผลิต
    expect(r1.job.remaining_qty).toBe(400);

    // รอบ 2: จบงานโดยยังขาด → ต้องระบุเหตุผล
    await expect(
      reportProduction(APPROVER, jobNo, reportPayload({ good_qty: 380, defect_qty: 10, defect_cause: "พิมพ์เพี้ยน", report_kind: "FINAL" }))
    ).rejects.toThrow("เหตุผล");

    const r2 = await reportProduction(
      APPROVER,
      jobNo,
      reportPayload({
        good_qty: 380,
        defect_qty: 10,
        defect_cause: "พิมพ์เพี้ยน",
        report_kind: "FINAL",
        close_reason: "วัตถุดิบไม่พอ",
      })
    );
    // เคสตัวอย่างใน spec: ดีสะสม 980 เสีย 30 ขาด 20
    expect(r2.report.cumulative_good).toBe(980);
    expect(r2.report.cumulative_defect).toBe(30);
    expect(r2.job.status).toBe("COMPLETED");
    expect(r2.job.produced_good).toBe(980);
    expect(r2.job.defect_total).toBe(30);
    expect(r2.job.remaining_qty).toBe(20);
    expect(r2.job.over_qty).toBe(0);

    // สต็อก: เพิ่มเฉพาะผลิตดี ต่อรายงาน ครั้งเดียว — 600 + 380 = 980 (จบงานไม่เพิ่มสะสมซ้ำ)
    const movements = receiveMovements();
    expect(movements).toHaveLength(2);
    expect(movements.map((m) => m.qty_change).sort((a, b) => a - b)).toEqual([380, 600]);
    expect(movements.every((m) => m.warehouse_id === "wh-2")).toBe(true);
    expect(fakeRepo.documents.created).toHaveLength(2);
    expect(fakeRepo.documents.created.every((d) => d.document_no.startsWith("PRD-"))).toBe(true);
  });

  it("รายงานเฉพาะของเสีย (ดี = 0) ไม่เพิ่มสต็อก", async () => {
    const jobNo = await createStartedJob(100);
    await reportProduction(APPROVER, jobNo, reportPayload({ good_qty: 0, defect_qty: 5, defect_cause: "เสียหาย" }));
    expect(receiveMovements()).toHaveLength(0);
  });

  it("ผลิตเกินเป้าแล้วจบงาน — บังคับเหตุผล + คำนวณเกินถูกต้อง", async () => {
    const jobNo = await createStartedJob(100);
    await reportProduction(APPROVER, jobNo, reportPayload({ good_qty: 100 }));
    await expect(
      reportProduction(APPROVER, jobNo, reportPayload({ good_qty: 30, report_kind: "FINAL" }))
    ).rejects.toThrow("เกินเป้า");
    const r = await reportProduction(
      APPROVER,
      jobNo,
      reportPayload({ good_qty: 30, report_kind: "FINAL", close_reason: "ADMIN ขอเพิ่ม" })
    );
    expect(r.job.over_qty).toBe(30);
    expect(r.job.remaining_qty).toBe(0);
  });
});

// ── กดยืนยันซ้ำ (idempotency) ─────────────────────────────────────

describe("reportProduction — กดยืนยันซ้ำ/ส่งคำขอซ้ำ", () => {
  it("idempotency_key เดิมส่งซ้ำ → คืนผลเดิม ไม่บันทึกรายงาน/สต็อกซ้ำ", async () => {
    const jobNo = await createStartedJob(500);
    const payload = reportPayload({ good_qty: 200, idempotency_key: "idem-fixed-001" });
    const first = await reportProduction(APPROVER, jobNo, payload);
    expect(first.replayed).toBe(false);

    const second = await reportProduction(APPROVER, jobNo, { ...payload });
    expect(second.replayed).toBe(true);
    expect(second.report.report_id).toBe(first.report.report_id);

    const detail = await getJobDetail(jobNo);
    expect(detail!.reports).toHaveLength(1);
    expect(receiveMovements()).toHaveLength(1);
    expect(receiveMovements()[0].qty_change).toBe(200);
  });
});

// ── จบงาน/ยกเลิกแล้วรายงานต่อไม่ได้จนกว่าเปิดใหม่ ──────────────────

describe("หลังงานจบหรือยกเลิก", () => {
  it("รายงานหลังจบงานไม่ได้ · ADMIN เปิดงานผลิตต่อ (พร้อมเหตุผล) แล้วรายงานต่อได้ · ยอดเดิมคงอยู่", async () => {
    const jobNo = await createStartedJob(100);
    await reportProduction(APPROVER, jobNo, reportPayload({ good_qty: 100, report_kind: "FINAL" }));

    await expect(
      reportProduction(APPROVER, jobNo, reportPayload({ good_qty: 1 }))
    ).rejects.toThrow(ProductionError);

    const reopened = await reopenJob(ADMIN, jobNo, "ลูกค้าขอเพิ่ม");
    expect(reopened.status).toBe("IN_PROGRESS");
    expect(reopened.produced_good).toBe(100); // ยอดเดิมคงอยู่
    expect(reopened.reopen_count).toBe(1);

    const more = await reportProduction(APPROVER, jobNo, reportPayload({ good_qty: 20, report_kind: "FINAL", close_reason: "ส่งเพิ่ม" }));
    expect(more.job.produced_good).toBe(120);
    // สต็อกเพิ่มเฉพาะยอดใหม่ (100 เดิม + 20 ใหม่)
    expect(receiveMovements().reduce((s, m) => s + m.qty_change, 0)).toBe(120);
  });

  it("ยกเลิกงานที่มีผลผลิตแล้ว — ผลผลิตและสต็อกที่ยืนยันแล้วยังอยู่ครบ", async () => {
    const jobNo = await createStartedJob(100);
    await reportProduction(APPROVER, jobNo, reportPayload({ good_qty: 60 }));

    const cancelled = await cancelJob(ADMIN, jobNo, "ยกเลิกส่วนที่เหลือ ย้ายไปโต๊ะอื่น");
    expect(cancelled.status).toBe("CANCELLED");

    const detail = await getJobDetail(jobNo);
    expect(detail!.reports).toHaveLength(1); // ผลผลิตเดิมไม่ถูกลบ
    expect(detail!.job.produced_good).toBe(60);
    expect(receiveMovements()).toHaveLength(1); // สต็อกที่เพิ่มไปแล้วยังอยู่

    await expect(
      reportProduction(APPROVER, jobNo, reportPayload({ good_qty: 1 }))
    ).rejects.toThrow(ProductionError);
  });
});

// ── กติกาการแก้ไขและลบ (§6) ───────────────────────────────────────

describe("updateJob / deleteDraft — กติกาตามสถานะ", () => {
  it("DRAFT แก้ได้ทุกอย่างไม่ต้องมีเหตุผล · ลบได้", async () => {
    const [job] = await createJobs(ADMIN, [jobInput()]);
    const updated = await updateJob(ADMIN, job.job_no, {
      updated_at: job.updated_at,
      table_no: 5,
      target_qty: 2000,
    });
    expect(updated.table_no).toBe(5);
    expect(updated.target_qty).toBe(2000);
    await deleteDraft(ADMIN, job.job_no);
    await expect(getJobDetail(job.job_no)).resolves.toBeNull();
  });

  it("WAITING แก้สินค้า/จำนวน/โต๊ะได้แต่ต้องมีเหตุผล + แจ้ง APPROVER · เปลี่ยนวันที่ไม่ได้", async () => {
    const [job] = await createJobs(ADMIN, [jobInput()]);
    await submitJobs(ADMIN, [job.job_no]);

    await expect(
      updateJob(ADMIN, job.job_no, { updated_at: job.updated_at, target_qty: 1500 })
    ).rejects.toThrow("เหตุผล");

    const before = (await listNotifications("APPROVER", "x")).unread_count;
    const updated = await updateJob(ADMIN, job.job_no, {
      updated_at: job.updated_at,
      target_qty: 1500,
      table_no: 4,
      reason: "เพิ่มออเดอร์",
    });
    expect(updated.target_qty).toBe(1500);
    expect(updated.table_no).toBe(4);
    const afterNotifs = await listNotifications("APPROVER", "x");
    expect(afterNotifs.unread_count).toBe(before + 1);

    await expect(
      updateJob(ADMIN, job.job_no, { updated_at: updated.updated_at, production_date: "2026-10-10", reason: "x" })
    ).rejects.toThrow("วันที่ผลิต");
  });

  it("IN_PROGRESS แก้ได้เฉพาะเป้าหมาย/หมายเหตุ — แก้โต๊ะ/สินค้าถูกปฏิเสธ", async () => {
    const jobNo = await createStartedJob(100);
    const detail = await getJobDetail(jobNo);
    await expect(
      updateJob(ADMIN, jobNo, { updated_at: detail!.job.updated_at, table_no: 3, reason: "ย้ายโต๊ะ" })
    ).rejects.toThrow("เฉพาะเป้าหมายและหมายเหตุ");
    const updated = await updateJob(ADMIN, jobNo, {
      updated_at: detail!.job.updated_at,
      target_qty: 300,
      reason: "ปรับเป้าใหม่",
    });
    expect(updated.target_qty).toBe(300);
  });

  it("updated_at ไม่ตรง (มีคนแก้ก่อนหน้า) → conflict 409 กันเขียนทับ", async () => {
    const [job] = await createJobs(ADMIN, [jobInput()]);
    await expect(
      updateJob(ADMIN, job.job_no, { updated_at: "2000-01-01T00:00:00.000Z", target_qty: 5 })
    ).rejects.toThrow(ProductionError);
  });

  it("ลบงานที่ส่งแล้วไม่ได้ — ต้องใช้การยกเลิก", async () => {
    const [job] = await createJobs(ADMIN, [jobInput()]);
    await submitJobs(ADMIN, [job.job_no]);
    await expect(deleteDraft(ADMIN, job.job_no)).rejects.toThrow("ฉบับร่าง");
  });
});

// ── ปรับปรุงยอดผลผลิต (ADMIN) ────────────────────────────────────

describe("adjustProduction — ห้ามเขียนทับ สร้างรายการปรับ + ปรับสต็อกย้อนหลังได้", () => {
  it("ลดยอดดี 980→975 สร้าง ADJUSTMENT delta -5 + movement ADJUST + ประวัติก่อน–หลัง", async () => {
    const jobNo = await createStartedJob(1000);
    await reportProduction(APPROVER, jobNo, reportPayload({ good_qty: 600, defect_qty: 20, defect_cause: "แตก" }));
    await reportProduction(
      APPROVER,
      jobNo,
      reportPayload({ good_qty: 380, defect_qty: 10, defect_cause: "พิมพ์", report_kind: "FINAL", close_reason: "ปิดงาน" })
    );

    const result = await adjustProduction(ADMIN, jobNo, {
      new_good_qty: 975,
      new_defect_qty: 30,
      reason: "นับซ้ำ 5 ชิ้น",
      idempotency_key: "adj-key-1",
    });
    expect(result.report.kind).toBe("ADJUSTMENT");
    expect(result.report.good_qty).toBe(-5);
    expect(result.job.produced_good).toBe(975);
    expect(result.job.defect_total).toBe(30);

    const adjustMovements = fakeRepo.movements.created.filter((m) => m.movement_type === "ADJUST");
    expect(adjustMovements).toHaveLength(1);
    expect(adjustMovements[0].qty_change).toBe(-5);

    // ประวัติมีรายการ ADJUST พร้อมยอดก่อน–หลัง
    const detail = await getJobDetail(jobNo);
    const adjustHistory = detail!.history.find((h) => h.action === "ADJUST");
    expect(adjustHistory).toBeDefined();
    expect(adjustHistory!.detail).toContain('"before"');
    expect(adjustHistory!.detail).toContain('"after"');
  });

  it("กดยืนยันปรับปรุงซ้ำด้วย key เดิม → replay ไม่ซ้ำ", async () => {
    const jobNo = await createStartedJob(100);
    await reportProduction(APPROVER, jobNo, reportPayload({ good_qty: 100 }));
    const first = await adjustProduction(ADMIN, jobNo, {
      new_good_qty: 95,
      new_defect_qty: 0,
      reason: "แก้ยอด",
      idempotency_key: "adj-key-dup",
    });
    const second = await adjustProduction(ADMIN, jobNo, {
      new_good_qty: 95,
      new_defect_qty: 0,
      reason: "แก้ยอด",
      idempotency_key: "adj-key-dup",
    });
    expect(second.replayed).toBe(true);
    const detail = await getJobDetail(jobNo);
    expect(detail!.reports.filter((r) => r.kind === "ADJUSTMENT")).toHaveLength(1);
  });
});

// ── listJobs / ตัวกรอง ────────────────────────────────────────────

describe("listJobs — ตัวกรองและลำดับ", () => {
  it("กรองด้วยวันที่/โต๊ะ และในโต๊ะเดียวกันงานด่วนมากมาก่อน", async () => {
    await createJobs(ADMIN, [
      jobInput({ table_no: 1, priority: "NORMAL" }),
      jobInput({ table_no: 1, priority: "CRITICAL" }),
      jobInput({ production_date: "2026-10-06", table_no: 1 }),
      jobInput({ production_date: "2026-10-07", table_no: 2 }),
    ]);
    const today = await listJobs({ date_from: "2026-10-07", date_to: "2026-10-07" });
    expect(today).toHaveLength(3);
    // โต๊ะ 1 ก่อนโต๊ะ 2 และในโต๊ะเดียวกัน CRITICAL มาก่อน NORMAL
    expect(today[0].priority).toBe("CRITICAL");
    expect(today[0].table_no).toBe(1);
    expect(today[1].priority).toBe("NORMAL");
    expect(today[2].table_no).toBe(2);

    const table1 = await listJobs({ table_no: 1 });
    expect(table1).toHaveLength(3); // รวมงานเมื่อวานของโต๊ะ 1 (ไม่กรองวันที่)
  });
});

// ── การแจ้งเตือน: อ่านแล้ว/ยังไม่อ่าน ─────────────────────────────

describe("notifications — สถานะอ่านต่อผู้ใช้", () => {
  it("markNotificationsRead เฉพาะรายการที่เลือก", async () => {
    const [a, b] = await createJobs(ADMIN, [jobInput(), jobInput({ table_no: 5 })]);
    await submitJobs(ADMIN, [a.job_no, b.job_no]);

    const before = await listNotifications("APPROVER", "usr-approver");
    expect(before.unread_count).toBe(2);

    await markNotificationsRead("APPROVER", "usr-approver", [before.items[0].notif_id]);
    const after = await listNotifications("APPROVER", "usr-approver");
    expect(after.unread_count).toBe(1);
    expect(after.items.find((n) => n.notif_id === before.items[0].notif_id)?.is_read).toBe(true);
  });
});

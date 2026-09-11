import type { Document, DocumentStatus } from "@/types/models";
import { withStockLocks } from "@/lib/locking";
import {
  ReceivingPlanCreateSchema,
  CancelReceivingPlanSchema,
  CloseReceivingPlanSchema,
  type ReceivingPlanCreateInput,
} from "@/types/api";
import type { IStockRepository } from "@/lib/repositories/interfaces";
import {
  StockUseCaseDeps,
  findWarehouse,
  matchSku,
} from "./shared";
import {
  StockConflictError,
  StockNotFoundError,
  StockValidationError,
} from "./stock-errors";
import { executeAtomicOperation } from "./atomic-stock-executor";

export {
  ReceivingPlanCreateSchema,
  CancelReceivingPlanSchema,
  CloseReceivingPlanSchema,
  type ReceivingPlanCreateInput,
};

// ============================================================
// Receiving Plan (แผนรับสินค้า) — รายการสินค้าที่คาดว่าจะมาถึงโกดัง
// สร้างโดย ADMIN → พนักงานเห็นในหน้ารับสินค้า → รับเข้าตามแผน
// เก็บเป็นเอกสารประเภท RECEIVE_PLAN โดยรายการและ progress
// อยู่ใน note (JSON) ตาม pattern เดียวกับ receive/transfer
//
// สถานะ: PENDING (รอรับ) → PROCESSING (กำลังรับ) → COMPLETED (รับครบ/ปิดแผน)
//        หรือ CANCELLED (ยกเลิกโดยแอดมิน)
// ============================================================

export interface ReceivingPlanLineItem {
  product_id: string;
  sku: string;
  barcode: string;
  product_name: string;
  base_unit: string;
  /** ไม่ระบุ = รายการเช็คลิสต์อย่างเดียว (ไม่มีเป้าจำนวน จึงไม่ถูกนับรวมในการปิดแผนอัตโนมัติ) */
  expected_qty?: number;
  expected_boxes?: number;
  note?: string;
}

export interface ReceivingPlanReceiptLine {
  product_id: string;
  qty: number;
}

export interface ReceivingPlanReceiptLog {
  document_id: string;
  document_no: string;
  received_at: string;
  received_by_name: string;
  lines: ReceivingPlanReceiptLine[];
}

export interface ReceivingPlanPayload {
  warehouse_id: string;
  warehouse_name: string;
  expected_date: string;
  note: string;
  lines: ReceivingPlanLineItem[];
  receipts: ReceivingPlanReceiptLog[];
  closed_by?: string;
  closed_at?: string;
  closed_reason?: string;
  cancelled_by?: string;
  cancelled_at?: string;
  cancelled_reason?: string;
}

export interface ReceivingPlanLineView extends ReceivingPlanLineItem {
  received_qty: number;
  /** true เมื่อระบุ expected_qty ไว้และรับครบแล้ว (รายการไม่ระบุจำนวนจะเป็น false เสมอ) */
  fulfilled: boolean;
}

export interface ReceivingPlanView {
  document_id: string;
  document_no: string;
  status: DocumentStatus;
  warehouse_id: string;
  warehouse_name: string;
  reference_no: string;
  expected_date: string;
  note: string;
  created_by: string;
  created_by_name: string;
  created_at: string;
  lines: ReceivingPlanLineView[];
  receipts: ReceivingPlanReceiptLog[];
  progress: {
    lines_total: number;
    lines_with_target: number;
    lines_fulfilled: number;
    has_target: boolean;
    fully_received: boolean;
  };
}

function planLockKey(planId: string): string {
  return `plan:${planId}`;
}

/** โกดังเดียวกันอาจถูกเขียนเป็น wh-01 / wh-1 — นอร์มัลก่อนเทียบ */
export function normalizeWarehouseRef(ref?: string): string {
  return (ref || "").trim().toLowerCase().replace(/^wh-0*(\d+)$/, "wh-$1");
}

function parseNoteRoot(note?: string): { plan?: ReceivingPlanPayload; [key: string]: unknown } | null {
  if (!note || !note.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(note);
    if (!parsed || typeof parsed !== "object" || !parsed.plan) return null;
    if (!Array.isArray(parsed.plan.lines)) parsed.plan.lines = [];
    if (!Array.isArray(parsed.plan.receipts)) parsed.plan.receipts = [];
    return parsed;
  } catch {
    return null;
  }
}

function computeReceivedByProduct(payload: ReceivingPlanPayload): Map<string, number> {
  const received = new Map<string, number>();
  for (const receipt of payload.receipts || []) {
    for (const line of receipt.lines || []) {
      if (!line?.product_id) continue;
      received.set(line.product_id, (received.get(line.product_id) || 0) + (Number(line.qty) || 0));
    }
  }
  return received;
}

function isPlanFulfilled(payload: ReceivingPlanPayload): boolean {
  // ปิดแผนอัตโนมัติเมื่อรายการ "ที่ระบุจำนวน" ครบทุกรายการ
  // รายการที่ไม่ระบุจำนวน (เช็คลิสต์) ไม่มีเป้า จึงไม่กั้นการปิดแผน
  const targets = (payload.lines || []).filter((l) => typeof l.expected_qty === "number" && l.expected_qty > 0);
  if (targets.length === 0) return false;
  const received = computeReceivedByProduct(payload);
  return targets.every((l) => (received.get(l.product_id) || 0) >= (l.expected_qty as number));
}

export function buildReceivingPlanView(doc: Document): ReceivingPlanView | null {
  const root = parseNoteRoot(doc.note);
  if (!root || !root.plan) return null;
  const payload = root.plan;
  const received = computeReceivedByProduct(payload);

  const lines: ReceivingPlanLineView[] = (payload.lines || []).map((l) => {
    const receivedQty = received.get(l.product_id) || 0;
    const hasTarget = typeof l.expected_qty === "number" && (l.expected_qty as number) > 0;
    return {
      ...l,
      received_qty: receivedQty,
      fulfilled: hasTarget ? receivedQty >= (l.expected_qty as number) : false,
    };
  });

  const linesWithTarget = lines.filter((l) => typeof l.expected_qty === "number" && (l.expected_qty as number) > 0);
  const linesFulfilled = linesWithTarget.filter((l) => l.fulfilled).length;

  return {
    document_id: doc.document_id,
    document_no: doc.document_no || "",
    status: doc.status || "PENDING",
    warehouse_id: payload.warehouse_id || "",
    warehouse_name: payload.warehouse_name || payload.warehouse_id || "",
    reference_no: doc.reference_no || "",
    expected_date: payload.expected_date || "",
    note: payload.note || "",
    created_by: doc.created_by || "",
    created_by_name: (doc as any).created_by_name || "",
    created_at: doc.created_at || "",
    lines,
    receipts: payload.receipts || [],
    progress: {
      lines_total: lines.length,
      lines_with_target: linesWithTarget.length,
      lines_fulfilled: linesFulfilled,
      has_target: linesWithTarget.length > 0,
      fully_received: linesWithTarget.length > 0 && linesFulfilled === linesWithTarget.length,
    },
  };
}

// ------------------------------------------------------------
// Create
// ------------------------------------------------------------
export async function createReceivingPlan(
  deps: StockUseCaseDeps,
  input: ReceivingPlanCreateInput & {
    user_id: string;
    role?: string;
    correlation_id?: string;
    created_by_name?: string;
  }
): Promise<ReceivingPlanView> {
  const idempotencyKey =
    (input.idempotency_key && input.idempotency_key.trim()) ||
    `idem-plan-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const doc = await executeAtomicOperation({
    repo: deps.repo,
    operationType: "RECEIVING_PLAN_CREATE",
    idempotencyKey,
    actorId: input.user_id,
    actorRole: input.role || "ADMIN",
    correlationId: input.correlation_id,
    lockKeys: [planLockKey(`create:${input.warehouse_id}`)],
    auditAction: "RECEIVING_PLAN_CREATE",
    warehouseId: input.warehouse_id,
    payload: input,
    execute: async ({ repo }) => {
      const warehouse = await findWarehouse(repo, input.warehouse_id);
      if (!warehouse) {
        throw new StockNotFoundError("ไม่พบโกดังที่ระบุ");
      }
      if (warehouse.active === false) {
        throw new StockValidationError("โกดังถูกปิดใช้งาน");
      }
      const warehouseName =
        warehouse.warehouse_name || `โกดัง${String(warehouse.warehouse_id).replace(/^wh-0?/, "")}`;

      const allProducts = await repo.products.findAll().catch(() => [] as any[]);

      const resolvedLines: ReceivingPlanLineItem[] = [];
      const seenProductIds = new Set<string>();
      for (const line of input.lines) {
        const prod = (allProducts as any[]).find(
          (p) => p.product_id === line.product_id || p.sku === line.product_id
        );
        if (!prod) {
          throw new StockValidationError(`ไม่พบสินค้า "${line.product_id}" ในระบบ กรุณาตรวจสอบรายการในแผน`);
        }
        if (seenProductIds.has(prod.product_id)) {
          throw new StockValidationError(
            `สินค้า "${prod.product_name || prod.sku}" มีอยู่ในแผนซ้ำ กรุณารวมเป็นรายการเดียว`
          );
        }
        seenProductIds.add(prod.product_id);
        resolvedLines.push({
          product_id: prod.product_id,
          sku: prod.sku || "",
          barcode: prod.barcode || prod.sku || "",
          product_name: prod.product_name || prod.sku || "",
          base_unit: prod.base_unit || "ชิ้น",
          expected_qty: line.expected_qty,
          expected_boxes: line.expected_boxes,
          note: line.note || "",
        });
      }

      const payload: ReceivingPlanPayload = {
        warehouse_id: warehouse.warehouse_id,
        warehouse_name: warehouseName,
        expected_date: (input.expected_date || "").trim(),
        note: input.note || "",
        lines: resolvedLines,
        receipts: [],
      };

      const doc = await repo.documents.create({
        document_type: "RECEIVE_PLAN",
        reference_no: input.reference_no || "",
        document_date: new Date().toISOString().slice(0, 10),
        status: "PENDING",
        note: JSON.stringify({ plan: payload, idempotency_key: idempotencyKey }),
        created_by: input.user_id,
        created_by_name:
          input.created_by_name ||
          (input.role === "ADMIN" ? "ผู้ดูแลระบบ (Admin)" : "ผู้สร้างแผนรับสินค้า"),
      });

      return doc;
    },
  });

  const view = buildReceivingPlanView(doc);
  if (!view) {
    // ไม่มีทางเกิดขึ้นจริง — note เพิ่งถูกสร้างจาก payload ด้านบน
    throw new StockValidationError("สร้างแผนรับสินค้าไม่สำเร็จ กรุณาลองอีกครั้ง");
  }
  return view;
}

// ------------------------------------------------------------
// List / Get
// ------------------------------------------------------------
export interface ReceivingPlanListFilters {
  warehouse_id?: string;
  /** "OPEN" = PENDING + PROCESSING (รายการที่ยังรับได้) หรือระบุสถานะเต็ม เช่น COMPLETED */
  status?: string;
}

export async function listReceivingPlans(
  deps: StockUseCaseDeps,
  filters: ReceivingPlanListFilters = {}
): Promise<ReceivingPlanView[]> {
  const result = await deps.repo.documents.findAll({ page: 1, limit: 99999 });
  const docs = result.data || [];

  let views = docs
    .filter((d) => (d.document_type || "").toUpperCase() === "RECEIVE_PLAN")
    .map((d) => buildReceivingPlanView(d))
    .filter((v): v is ReceivingPlanView => Boolean(v));

  if (filters.warehouse_id) {
    const wanted = normalizeWarehouseRef(filters.warehouse_id);
    views = views.filter((v) => normalizeWarehouseRef(v.warehouse_id) === wanted);
  }

  if (filters.status) {
    const wanted = filters.status.trim().toUpperCase();
    if (wanted === "OPEN") {
      views = views.filter((v) => v.status === "PENDING" || v.status === "PROCESSING");
    } else {
      views = views.filter((v) => v.status === wanted);
    }
  }

  views.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  return views;
}

export async function getReceivingPlan(deps: StockUseCaseDeps, idOrNo: string): Promise<ReceivingPlanView> {
  const doc = await loadFreshPlanDoc(deps.repo, idOrNo);
  const view = buildReceivingPlanView(doc);
  if (!view) {
    throw new StockValidationError("เอกสารนี้ไม่ใช่แผนรับสินค้าที่มีข้อมูลถูกต้อง");
  }
  return view;
}

async function loadFreshPlanDoc(repo: IStockRepository, idOrNo: string): Promise<Document> {
  const clean = (idOrNo || "").trim();
  if (!clean) throw new StockNotFoundError("กรุณาระบุแผนรับสินค้า");
  const doc =
    (await repo.documents.findById(clean, { forceFresh: true }).catch(() => null)) ||
    (await repo.documents.findByNo(clean, { forceFresh: true }).catch(() => null));
  if (!doc || (doc.document_type || "").toUpperCase() !== "RECEIVE_PLAN") {
    throw new StockNotFoundError(`ไม่พบแผนรับสินค้า "${clean}"`);
  }
  return doc;
}

// ------------------------------------------------------------
// Cancel / Close (แอดมิน)
// ------------------------------------------------------------
export interface PlanActionParams {
  plan_id: string;
  reason?: string;
  user_id: string;
  user_name?: string;
  role?: string;
  correlation_id?: string;
}

export async function cancelReceivingPlan(deps: StockUseCaseDeps, params: PlanActionParams): Promise<ReceivingPlanView> {
  return withStockLocks([planLockKey(params.plan_id)], async () => {
    const doc = await loadFreshPlanDoc(deps.repo, params.plan_id);
    const root = parseNoteRoot(doc.note);
    if (!root || !root.plan) {
      throw new StockValidationError("เอกสารนี้ไม่ใช่แผนรับสินค้าที่มีข้อมูลถูกต้อง");
    }
    const status = (doc.status || "").toUpperCase();
    if (status === "CANCELLED") {
      // ยกเลิกซ้ำ = idempotent คืนสถานะปัจจุบัน
      return buildReceivingPlanView(doc) as ReceivingPlanView;
    }
    if (status === "COMPLETED") {
      throw new StockConflictError("แผนนี้ถูกปิดไปแล้ว (รับครบหรือปิดโดยแอดมิน) ไม่สามารถยกเลิกได้");
    }

    root.plan.cancelled_by = params.user_name || "";
    root.plan.cancelled_at = new Date().toISOString();
    root.plan.cancelled_reason = params.reason || "";

    await writePlanDoc(deps.repo, doc.document_id, "CANCELLED", root);
    return buildReceivingPlanView({ ...doc, status: "CANCELLED", note: JSON.stringify(root) }) as ReceivingPlanView;
  });
}

export async function closeReceivingPlan(deps: StockUseCaseDeps, params: PlanActionParams): Promise<ReceivingPlanView> {
  return withStockLocks([planLockKey(params.plan_id)], async () => {
    const doc = await loadFreshPlanDoc(deps.repo, params.plan_id);
    const root = parseNoteRoot(doc.note);
    if (!root || !root.plan) {
      throw new StockValidationError("เอกสารนี้ไม่ใช่แผนรับสินค้าที่มีข้อมูลถูกต้อง");
    }
    const status = (doc.status || "").toUpperCase();
    if (status === "COMPLETED") {
      // ปิดซ้ำ = idempotent คืนสถานะปัจจุบัน
      return buildReceivingPlanView(doc) as ReceivingPlanView;
    }
    if (status === "CANCELLED") {
      throw new StockConflictError("แผนนี้ถูกยกเลิกไปแล้ว ไม่สามารถปิดแผนได้");
    }

    root.plan.closed_by = params.user_name || "";
    root.plan.closed_at = new Date().toISOString();
    root.plan.closed_reason = params.reason || "";

    await writePlanDoc(deps.repo, doc.document_id, "COMPLETED", root);
    return buildReceivingPlanView({ ...doc, status: "COMPLETED", note: JSON.stringify(root) }) as ReceivingPlanView;
  });
}

async function writePlanDoc(
  repo: IStockRepository,
  documentId: string,
  status: DocumentStatus,
  noteRoot: { plan?: ReceivingPlanPayload; [key: string]: unknown }
): Promise<void> {
  const updates = {
    status,
    note: JSON.stringify(noteRoot),
  };
  if (typeof repo.documents.updateDoc === "function") {
    await repo.documents.updateDoc(documentId, updates);
  } else {
    await repo.documents.updateStatus(documentId, status);
    await repo.documents.updateNote(documentId, updates.note);
  }
}

// ------------------------------------------------------------
// ส่วนที่ถูกเรียกจาก receive-stock เมื่อรับสินค้า "ตามแผน"
// ------------------------------------------------------------
export interface LoadPlanForReceiveResult {
  doc: Document;
  payload: ReceivingPlanPayload;
}

/** โหลดแผนเพื่อรับสินค้าต่อ — ต้องเรียกภายใต้ lock ของแผน (ผู้เรียกจัดการให้) */
export async function loadPlanForReceive(
  repo: IStockRepository,
  planDocumentId: string,
  warehouseId: string
): Promise<LoadPlanForReceiveResult> {
  const doc =
    (await repo.documents.findById(planDocumentId, { forceFresh: true }).catch(() => null)) ||
    (await repo.documents.findByNo(planDocumentId, { forceFresh: true }).catch(() => null));
  if (!doc || (doc.document_type || "").toUpperCase() !== "RECEIVE_PLAN") {
    throw new StockValidationError("ไม่พบแผนรับสินค้าที่ระบุ กรุณาตรวจสอบอีกครั้ง");
  }

  const status = (doc.status || "").trim().toUpperCase();
  if (status === "COMPLETED") {
    throw new StockValidationError("แผนรับสินค้านี้ปิดไปแล้ว ไม่สามารถบันทึกการรับเพิ่มได้");
  }
  if (status === "CANCELLED") {
    throw new StockValidationError("แผนรับสินค้านี้ถูกยกเลิกแล้ว ไม่สามารถบันทึกการรับได้");
  }
  if (status !== "PENDING" && status !== "PROCESSING") {
    throw new StockValidationError("แผนรับสินค้านี้อยู่ในสถานะที่ไม่สามารถบันทึกการรับได้");
  }

  const root = parseNoteRoot(doc.note);
  if (!root || !root.plan) {
    throw new StockValidationError("รูปแบบข้อมูลแผนรับสินค้าไม่ถูกต้อง");
  }

  const planWh = normalizeWarehouseRef(root.plan.warehouse_id);
  const receiveWh = normalizeWarehouseRef(warehouseId);
  if (planWh !== receiveWh) {
    throw new StockValidationError(
      `แผนนี้เป็นของ${root.plan.warehouse_name || root.plan.warehouse_id} ไม่ตรงกับโกดังที่กำลังรับสินค้า`
    );
  }

  return { doc, payload: root.plan };
}

/**
 * นโยบายเข้มงวด: รับได้เฉพาะสินค้าที่อยู่ในแผนเท่านั้น
 * เทียบด้วย product_id หรือ SKU (ผ่าน matchSku)
 */
export function assertLinesInPlan(
  payload: ReceivingPlanPayload,
  lines: Array<{ product_id: string }>,
  resolveProduct: (productId: string) => { product_id: string; sku: string; product_name: string } | null
): void {
  const offenders: string[] = [];
  for (const line of lines) {
    const prod = resolveProduct(line.product_id);
    const productId = prod?.product_id || line.product_id;
    const sku = prod?.sku || "";
    const inPlan = (payload.lines || []).some(
      (pl) => pl.product_id === productId || (sku && matchSku(pl.sku, sku))
    );
    if (!inPlan) {
      offenders.push(prod?.product_name || sku || line.product_id);
    }
  }
  if (offenders.length > 0) {
    throw new StockValidationError(
      `ไม่สามารถรับสินค้าที่ไม่อยู่ในแผนได้: ${offenders.join(", ")} — กรุณาแจ้งแอดมินเพื่อปรับแผนก่อน`
    );
  }
}

export interface ApplyPlanReceiptParams {
  plan: Document;
  receipt: {
    document_id: string;
    document_no: string;
    received_at: string;
    received_by_name: string;
  };
  lines: ReceivingPlanReceiptLine[];
}

export interface ApplyPlanReceiptResult {
  status: DocumentStatus;
  view: ReceivingPlanView;
}

/**
 * บันทึกยอดรับเข้าสู่แผน (append receipt log + คำนวณสถานะใหม่)
 * ต้องเรียกภายใต้ lock ของแผน — progress นับ ณ ตอนส่งเอกสารรับเข้า
 * (ถ้าแอดมิน reject เอกสารรับภายหลัง ยอดสะสมของแผนไม่ย้อนกลับ — ทราบ trade-off นี้ไว้)
 */
export async function applyReceivingPlanReceipt(
  deps: StockUseCaseDeps,
  params: ApplyPlanReceiptParams
): Promise<ApplyPlanReceiptResult> {
  const root = parseNoteRoot(params.plan.note);
  if (!root || !root.plan) {
    throw new StockValidationError("รูปแบบข้อมูลแผนรับสินค้าไม่ถูกต้อง");
  }

  root.plan.receipts = root.plan.receipts || [];
  root.plan.receipts.push({
    document_id: params.receipt.document_id,
    document_no: params.receipt.document_no,
    received_at: params.receipt.received_at,
    received_by_name: params.receipt.received_by_name || "",
    lines: params.lines,
  });

  const newStatus: DocumentStatus = isPlanFulfilled(root.plan) ? "COMPLETED" : "PROCESSING";
  const updatedNote = JSON.stringify(root);
  await writePlanDoc(deps.repo, params.plan.document_id, newStatus, root);

  const view = buildReceivingPlanView({ ...params.plan, status: newStatus, note: updatedNote });
  if (!view) {
    throw new StockValidationError("อัปเดตความคืบหน้าของแผนไม่สำเร็จ กรุณาลองอีกครั้ง");
  }
  return { status: newStatus, view };
}

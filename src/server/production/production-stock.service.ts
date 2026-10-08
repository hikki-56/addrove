// โพสต์สต็อกสินค้าดีจากการผลิตเข้าโกดัง 2 (wh-2) — ครั้งเดียวต่อรายงาน
// ทำตามแพทเทิร์นการโพสต์ของ /api/approvals/[id]/approve (มาตรฐานสูงสุดของระบบ):
// movements.batchCreate + stockSummary.applyChanges + warehouseSync.syncAdd + แถว Documents POSTED
//
// ข้อตกลงของระบบผลิต v2:
// - เพิ่มสต็อก "เฉพาะผลิตดี" ของแต่ละรายงานที่ยืนยัน ครั้งเดียว (กันซ้ำด้วย idempotency_key ของ movement)
// - จบงานไม่เพิ่มยอดสะสมซ้ำ / ของเสียไม่เข้าสต็อกสินค้าดี
// - การปรับปรุงยอด (ADJUSTMENT) สร้าง movement ชนิด ADJUST ที่ตรวจสอบย้อนหลังได้
// - ไม่ตัดวัตถุดิบ (ยังไม่มีสูตร BOM — รอกำหนดเพิ่ม)

import type { IStockRepository } from "@/server/repositories/interfaces";
import type { Document, StockMovement } from "@/types/models";
import type { ProductionJob, ProductionReport } from "@/types/production";

/** คลังรับสินค้าสำเร็จรูปจากการผลิต (ตามระบบเดิม) */
export const PRODUCTION_RECEIVE_WAREHOUSE = "wh-2";

export interface ProductionStockDeps {
  repo: IStockRepository;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function resolveProduct(deps: ProductionStockDeps, job: ProductionJob) {
  return (
    (await deps.repo.products.findById(job.product_id).catch(() => null)) ||
    (await deps.repo.products.findBySku(job.sku).catch(() => null))
  );
}

/**
 * เพิ่มสต็อกสินค้าดีของรายงานหนึ่งรอบเข้าโกดัง 2 — คืน Document ที่สร้าง (หรือ null ถ้าไม่มียอด/เคยโพสต์แล้ว)
 * ผู้เรียกต้องถือล็อก (withKeyedLock งาน + withStockLocks โกดัง 2) อยู่แล้ว
 */
export async function postReportStockToWh2(
  deps: ProductionStockDeps,
  params: {
    job: ProductionJob;
    report: ProductionReport;
    actorId: string;
  }
): Promise<Document | null> {
  const good = round2(params.report.good_qty);
  if (good <= 0) return null;

  const idemKey = `mfg-rpt-${params.report.report_id}`;
  if (await deps.repo.movements.existsByIdempotencyKey(idemKey)) {
    // เคยโพสต์สต็อกรายงานนี้แล้ว (retry หลังขั้นตอนก่อนหน้าล้มเหลว) — ไม่เพิ่มซ้ำ
    return null;
  }

  const documentId = `doc-${params.report.report_id}`;
  const documentNo = `${params.job.job_no}-R${params.report.report_no}`;
  const nowIso = new Date().toISOString();

  const doc: Document = {
    document_id: documentId,
    document_no: documentNo,
    document_type: "RECEIVE",
    reference_no: params.job.job_no,
    document_date: nowIso.slice(0, 10),
    status: "POSTED",
    note: JSON.stringify({
      kind: "PRODUCTION_RECEIPT",
      job_no: params.job.job_no,
      report_no: params.report.report_no,
      report_kind: params.report.report_kind || "PARTIAL",
      sku: params.job.sku,
      product_name: params.job.product_name,
      good_qty: good,
      defect_qty: params.report.defect_qty,
      table_no: params.job.table_no,
    }),
    created_by: params.actorId,
    created_at: nowIso,
  };
  await deps.repo.documents.create(doc).catch((err) => {
    console.warn("[ProductionStock] documents.create non-fatal:", err);
  });

  await deps.repo.movements.batchCreate([
    {
      document_id: documentId,
      product_id: params.job.product_id,
      warehouse_id: PRODUCTION_RECEIVE_WAREHOUSE,
      location_id: params.job.location || "",
      qty_change: good,
      movement_type: "RECEIVE",
      idempotency_key: idemKey,
      created_by: params.actorId,
    },
  ]);

  await deps.repo.stockSummary
    .applyChanges([
      {
        productId: params.job.product_id,
        warehouseId: PRODUCTION_RECEIVE_WAREHOUSE,
        locationId: params.job.location || "",
        delta: good,
      },
    ])
    .catch((err) => console.warn("[ProductionStock] stockSummary.applyChanges warning:", err));

  const product = await resolveProduct(deps, params.job);
  if (deps.repo.warehouseSync) {
    await deps.repo.warehouseSync
      .syncAdd(
        PRODUCTION_RECEIVE_WAREHOUSE,
        {
          sku: product?.sku || params.job.sku,
          barcode: product?.barcode || params.job.sku,
          product_name: product?.product_name || params.job.product_name,
          category: product?.category || "สินค้าสำเร็จรูป",
          base_unit: product?.base_unit || params.job.unit,
          supplier: "ฝ่ายผลิต",
        },
        good,
        params.job.location || ""
      )
      .catch((err) => console.warn("[ProductionStock] warehouseSync.syncAdd warning:", err));
  }

  return doc;
}

/**
 * ปรับสต็อกตามรายการปรับปรุงยอดผลผลิตของ ADMIN — delta เป็นลบได้ (ลดยอด = ตัดสต็อก)
 * คืน Document ที่สร้าง (หรือ null เมื่อ delta = 0 หรือเคยโพสต์แล้ว)
 */
export async function postAdjustStockToWh2(
  deps: ProductionStockDeps,
  params: {
    job: ProductionJob;
    report: ProductionReport;
    goodDelta: number;
    actorId: string;
  }
): Promise<Document | null> {
  const delta = round2(params.goodDelta);
  if (delta === 0) return null;

  const idemKey = `mfg-adj-${params.report.report_id}`;
  if (await deps.repo.movements.existsByIdempotencyKey(idemKey)) return null;

  const documentId = `doc-${params.report.report_id}`;
  const documentNo = `${params.job.job_no}-A${params.report.report_no}`;
  const nowIso = new Date().toISOString();

  const doc: Document = {
    document_id: documentId,
    document_no: documentNo,
    document_type: "ADJUST",
    reference_no: params.job.job_no,
    document_date: nowIso.slice(0, 10),
    status: "POSTED",
    note: JSON.stringify({
      kind: "PRODUCTION_ADJUSTMENT",
      job_no: params.job.job_no,
      adjustment_no: params.report.report_no,
      sku: params.job.sku,
      product_name: params.job.product_name,
      good_delta: delta,
      reason: params.report.reason,
    }),
    created_by: params.actorId,
    created_at: nowIso,
  };
  await deps.repo.documents.create(doc).catch((err) => {
    console.warn("[ProductionStock] documents.create (adjust) non-fatal:", err);
  });

  const movement: Omit<StockMovement, "movement_id" | "created_at"> = {
    document_id: documentId,
    product_id: params.job.product_id,
    warehouse_id: PRODUCTION_RECEIVE_WAREHOUSE,
    location_id: params.job.location || "",
    qty_change: delta,
    movement_type: "ADJUST",
    idempotency_key: idemKey,
    created_by: params.actorId,
  };
  await deps.repo.movements.batchCreate([movement]);

  await deps.repo.stockSummary
    .applyChanges([
      {
        productId: params.job.product_id,
        warehouseId: PRODUCTION_RECEIVE_WAREHOUSE,
        locationId: params.job.location || "",
        delta,
      },
    ])
    .catch((err) => console.warn("[ProductionStock] stockSummary.applyChanges (adjust) warning:", err));

  const product = await resolveProduct(deps, params.job);
  if (deps.repo.warehouseSync) {
    const productInfo = {
      sku: product?.sku || params.job.sku,
      barcode: product?.barcode || params.job.sku,
      product_name: product?.product_name || params.job.product_name,
      category: product?.category || "สินค้าสำเร็จรูป",
      base_unit: product?.base_unit || params.job.unit,
      supplier: "ฝ่ายผลิต",
    };
    if (delta > 0) {
      await deps.repo.warehouseSync
        .syncAdd(PRODUCTION_RECEIVE_WAREHOUSE, productInfo, delta, params.job.location || "")
        .catch((err) => console.warn("[ProductionStock] syncAdd (adjust) warning:", err));
    } else {
      await deps.repo.warehouseSync
        .syncDeduct(PRODUCTION_RECEIVE_WAREHOUSE, params.job.product_id, -delta, params.job.location || "")
        .catch((err) => console.warn("[ProductionStock] syncDeduct (adjust) warning:", err));
    }
  }

  return doc;
}

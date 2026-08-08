import type { Document, StockMovement, Product } from "@/types/models";
import { withStockLocks, formatStockLockKey } from "@/lib/locking";
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  failIdempotencyKey,
} from "@/lib/idempotency";
import { logAudit } from "@/lib/audit";
import {
  CreateTransferSchema,
  CompleteTransferSchema,
  CancelTransferSchema,
  type CreateTransferInput,
  type CompleteTransferInput,
  type CancelTransferInput,
} from "@/types/api";
import {
  StockUseCaseDeps,
  findWarehouse,
} from "./shared";
import {
  StockNotFoundError,
  InvalidTransferStateError,
  InsufficientStockError,
  UnauthorizedStockOperationError,
} from "./stock-errors";
import { hasWarehouseAccess } from "@/lib/api-response";
import { executeAtomicOperation } from "./atomic-stock-executor";
export {
  CreateTransferSchema,
  CompleteTransferSchema,
  CancelTransferSchema,
  type CreateTransferInput,
  type CompleteTransferInput,
  type CancelTransferInput,
};

export async function createTransfer(
  deps: StockUseCaseDeps,
  input: CreateTransferInput & { user_id: string; role?: string; correlation_id?: string; warehouse_access?: string | string[] }
): Promise<Document> {
  const fromWhKey = formatStockLockKey(input.from_warehouse_id, input.from_location_id || "A1", input.product_id);
  const toWhKey = formatStockLockKey(input.to_warehouse_id, input.to_location_id || "A1", input.product_id);

  if (input.from_warehouse_id === input.to_warehouse_id) {
    throw new InvalidTransferStateError("โกดังต้นทางและโกดังปลายทางต้องไม่ซ้ำกัน");
  }

  // Check warehouse authorization for source warehouse if restricted
  if (input.role && input.role !== "ADMIN" && input.warehouse_access !== undefined) {
    const hasFrom = hasWarehouseAccess(input.warehouse_access, input.from_warehouse_id);
    if (!hasFrom) {
      throw new UnauthorizedStockOperationError("คุณไม่มีสิทธิ์เข้าถึงโกดังต้นทาง");
    }
  }

  return executeAtomicOperation({
    repo: deps.repo,
    operationType: "TRANSFER_CREATE",
    idempotencyKey: input.idempotency_key,
    actorId: input.user_id,
    actorRole: input.role || "STAFF",
    correlationId: input.correlation_id,
    lockKeys: [fromWhKey, toWhKey],
    auditAction: "STOCK_TRANSFER_CREATE",
    warehouseId: input.from_warehouse_id,
    payload: input,
    execute: async ({ repo }) => {
      const fromWh = await findWarehouse(repo, input.from_warehouse_id);
      const toWh = await findWarehouse(repo, input.to_warehouse_id);
      if (!fromWh || !toWh) {
        throw new StockNotFoundError("ไม่พบโกดังต้นทางหรือโกดังปลายทาง");
      }

      const finalToLocId = (input.to_location_id || "A1").replace(/^loc-wh-0?[0-9]-?/, "").replace(/^loc-/, "") || "A1";
      const fromLoc = input.from_location_id || "A1";

      const currentBalance = await repo.movements.getBalance(
        input.product_id,
        fromWh.warehouse_id,
        fromLoc
      );
      if (currentBalance < input.qty) {
        throw new InsufficientStockError(
          `ยอดคงเหลือสินค้าในโกดังต้นทาง (${currentBalance}) ไม่เพียงพอสำหรับจำนวนที่ต้องการย้าย (${input.qty})`
        );
      }

      const notePayload = JSON.stringify({
        from_warehouse_id: fromWh.warehouse_id,
        to_warehouse_id: toWh.warehouse_id,
        from_location_id: fromLoc,
        to_location_id: finalToLocId,
        product_id: input.product_id,
        qty: input.qty,
        moved_by: input.moved_by,
        original_note: input.note,
        idempotency_key: input.idempotency_key,
      });

      const doc = await repo.documents.create({
        document_type: "TRANSFER",
        reference_no: input.reference_no,
        document_date: input.document_date,
        status: "POSTED",
        note: notePayload,
        created_by: input.user_id,
      });

      const movements: Omit<StockMovement, "movement_id" | "created_at">[] = [
        {
          document_id: doc.document_id,
          product_id: input.product_id,
          warehouse_id: fromWh.warehouse_id,
          location_id: fromLoc,
          qty_change: -input.qty,
          movement_type: "TRANSFER_OUT",
          idempotency_key: `${input.idempotency_key}-out`,
          created_by: input.user_id,
        },
        {
          document_id: doc.document_id,
          product_id: input.product_id,
          warehouse_id: toWh.warehouse_id,
          location_id: finalToLocId,
          qty_change: input.qty,
          movement_type: "TRANSFER_IN",
          idempotency_key: `${input.idempotency_key}-in`,
          created_by: input.user_id,
        },
      ];

      const created = await repo.movements.batchCreate(movements);
      await repo.stockSummary.applyChanges(
        created.map((m: StockMovement) => ({
          productId: m.product_id,
          warehouseId: m.warehouse_id,
          locationId: m.location_id,
          delta: m.qty_change,
        }))
      );

      if (repo.warehouseSync) {
        let product = await repo.products.findById(input.product_id);
        if (!product) {
          product = await repo.products.findBySku(input.product_id.replace(/^prod-/, ""));
        }
        const skuVal = product?.sku || input.product_id.replace(/^prod-/, "");

        const sourceInfo = await repo.warehouseSync.syncDeduct(
          fromWh.warehouse_id,
          skuVal,
          input.qty,
          fromLoc
        );

        await repo.warehouseSync.syncAdd(
          toWh.warehouse_id,
          {
            sku: sourceInfo?.sku || skuVal,
            barcode: sourceInfo?.barcode || product?.barcode || skuVal,
            product_name: sourceInfo?.product_name || product?.product_name || skuVal,
            category: sourceInfo?.category || product?.category || "ทั่วไป",
            base_unit: sourceInfo?.base_unit || product?.base_unit || "ชิ้น",
            supplier: sourceInfo?.supplier || product?.supplier || "ย้ายสินค้าเข้า",
          },
          input.qty,
          finalToLocId
        );
      }

      return doc;
    },
  });
}

export async function completeTransfer(
  deps: StockUseCaseDeps,
  docId: string,
  toLocationId?: string,
  userId?: string,
  userRole?: string,
  warehouseAccess?: string | string[]
): Promise<Document> {
  const doc =
    (await deps.repo.documents.findById(docId)) ||
    (await deps.repo.documents.findByNo(docId));
  if (!doc) throw new StockNotFoundError("ไม่พบเอกสารใบย้ายสินค้า");
  if (doc.document_type !== "TRANSFER") {
    throw new InvalidTransferStateError("เอกสารนี้ไม่ใช่ใบย้ายสินค้า");
  }

  // Idempotent completion check
  if (doc.status === "COMPLETED") {
    return doc;
  }

  if (doc.status === "CANCELLED") {
    throw new InvalidTransferStateError("ไม่สามารถเปลี่ยนใบย้ายที่ยกเลิกแล้วเป็น COMPLETED");
  }

  // Fail closed on missing or malformed note
  if (!doc.note || !doc.note.startsWith("{")) {
    throw new InvalidTransferStateError("ข้อมูลเอกสารใบย้ายสินค้าไม่สมบูรณ์หรือไม่ถูกต้อง");
  }

  let meta: {
    from_warehouse_id: string;
    to_warehouse_id: string;
    from_location_id?: string;
    to_location_id?: string;
    product_id: string;
    qty: number;
    idempotency_key: string;
  };

  try {
    meta = JSON.parse(doc.note);
  } catch {
    throw new InvalidTransferStateError("ข้อมูลเอกสารใบย้ายสินค้าไม่สมบูรณ์หรือไม่ถูกต้อง");
  }

  if (!meta.from_warehouse_id || !meta.to_warehouse_id || !meta.product_id || typeof meta.qty !== "number" || meta.qty <= 0) {
    throw new InvalidTransferStateError("ข้อมูลเอกสารใบย้ายสินค้าไม่สมบูรณ์หรือไม่ถูกต้อง");
  }

  // Warehouse authorization check: receiver MUST have destination warehouse access (unless ADMIN)
  if (userRole && userRole !== "ADMIN" && warehouseAccess !== undefined) {
    const hasTo = hasWarehouseAccess(warehouseAccess, meta.to_warehouse_id);
    if (!hasTo) {
      throw new UnauthorizedStockOperationError("คุณไม่มีสิทธิ์ในโกดังปลายทางสำหรับเอกสารใบย้ายสินค้านี้");
    }
  }

  const rawToLoc = toLocationId || meta.to_location_id || "";
  const finalToLocId = rawToLoc.replace(/^loc-wh-0?[0-9]-?/, "").replace(/^loc-/, "") || "A1";
  const executorId = userId || doc.created_by || "staff";

  let product = await deps.repo.products.findById(meta.product_id);
  if (!product) {
    const rawSku = meta.product_id.replace(/^prod-/, "");
    product = await deps.repo.products.findBySku(rawSku);
  }

  const skuVal = product?.sku || meta.product_id.replace(/^prod-/, "");
  const prodObj: Product = product || {
    product_id: meta.product_id,
    sku: skuVal,
    barcode: skuVal,
    product_name: skuVal,
    category: "ทั่วไป",
    base_unit: "ชิ้น",
    minimum_stock: 0,
    supplier: "",
    description: "",
    active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const fromLock = formatStockLockKey(meta.from_warehouse_id, meta.from_location_id || "A1", meta.product_id);
  const toLock = formatStockLockKey(meta.to_warehouse_id, finalToLocId, meta.product_id);

  return executeAtomicOperation({
    repo: deps.repo,
    operationType: "TRANSFER_COMPLETE",
    idempotencyKey: `complete-transfer-${doc.document_id}`,
    actorId: executorId,
    actorRole: userRole || "STAFF",
    lockKeys: [fromLock, toLock],
    auditAction: "STOCK_TRANSFER_COMPLETE",
    warehouseId: meta.to_warehouse_id,
    payload: { docId, toLocationId },
    execute: async ({ repo }) => {
      // Re-check document status after acquiring lock
      const freshDoc =
        (await repo.documents.findById(doc.document_id)) ||
        (await repo.documents.findByNo(doc.document_id));
      if (freshDoc && freshDoc.status === "COMPLETED") {
        return freshDoc;
      }
      if (freshDoc && freshDoc.status === "CANCELLED") {
        throw new InvalidTransferStateError("ไม่สามารถเปลี่ยนใบย้ายที่ยกเลิกแล้วเป็น COMPLETED");
      }

      // Check if movements already exist (single stock effect guarantee)
      const existingMovements = await repo.movements.findByDocumentId(doc.document_id);
      const hasIn = existingMovements.some((m: StockMovement) => m.movement_type === "TRANSFER_IN");

      if (!hasIn) {
        const movements: Omit<StockMovement, "movement_id" | "created_at">[] = [
          {
            document_id: doc.document_id,
            product_id: meta.product_id,
            warehouse_id: meta.from_warehouse_id,
            location_id: meta.from_location_id || "A1",
            qty_change: -meta.qty,
            movement_type: "TRANSFER_OUT",
            idempotency_key: `${meta.idempotency_key || doc.document_id}-out`,
            created_by: executorId,
          },
          {
            document_id: doc.document_id,
            product_id: meta.product_id,
            warehouse_id: meta.to_warehouse_id,
            location_id: finalToLocId,
            qty_change: meta.qty,
            movement_type: "TRANSFER_IN",
            idempotency_key: `${meta.idempotency_key || doc.document_id}-in`,
            created_by: executorId,
          },
        ];

        const created = await repo.movements.batchCreate(movements);
        await repo.stockSummary.applyChanges(
          created.map((m: StockMovement) => ({
            productId: m.product_id,
            warehouseId: m.warehouse_id,
            locationId: m.location_id,
            delta: m.qty_change,
          }))
        );

        if (repo.warehouseSync) {
          const sourceInfo = await repo.warehouseSync.syncDeduct(
            meta.from_warehouse_id,
            prodObj.sku,
            meta.qty,
            meta.from_location_id
          );

          const finalProductSync = {
            sku: sourceInfo?.sku || prodObj.sku,
            barcode: sourceInfo?.barcode || prodObj.barcode || prodObj.sku,
            product_name: sourceInfo?.product_name || prodObj.product_name,
            category: sourceInfo?.category || prodObj.category || "ทั่วไป",
            base_unit: sourceInfo?.base_unit || prodObj.base_unit || "ชิ้น",
            supplier: sourceInfo?.supplier || prodObj.supplier || "ย้ายสินค้าเข้า",
          };

          await repo.warehouseSync.syncAdd(
            meta.to_warehouse_id,
            finalProductSync,
            meta.qty,
            finalToLocId
          );
        }
      }

      // Mark completed only after all operations succeed
      await repo.documents.updateStatus(doc.document_id, "COMPLETED");

      return { ...doc, status: "COMPLETED" };
    }
  });
}

export async function cancelTransfer(
  deps: StockUseCaseDeps,
  docId: string,
  note?: string,
  userId?: string,
  userRole?: string,
  warehouseAccess?: string | string[]
): Promise<Document> {
  const doc =
    (await deps.repo.documents.findById(docId)) ||
    (await deps.repo.documents.findByNo(docId));
  if (!doc) throw new StockNotFoundError("ไม่พบใบย้ายสินค้า");
  if (doc.document_type !== "TRANSFER") {
    throw new InvalidTransferStateError("เอกสารนี้ไม่ใช่ใบย้ายสินค้า");
  }

  // Idempotent cancel check
  if (doc.status === "CANCELLED") {
    return doc;
  }

  if (doc.status === "COMPLETED") {
    throw new InvalidTransferStateError("ไม่สามารถยกเลิกใบย้ายสินค้าที่เสร็จสมบูรณ์แล้วได้ (กรุณาใช้การกลับยอด)");
  }

  // Fail closed on missing or malformed note
  if (!doc.note || !doc.note.startsWith("{")) {
    throw new InvalidTransferStateError("ข้อมูลเอกสารใบย้ายสินค้าไม่สมบูรณ์หรือไม่ถูกต้อง");
  }

  let meta: {
    from_warehouse_id: string;
    to_warehouse_id: string;
    from_location_id?: string;
    to_location_id?: string;
    product_id?: string;
    qty?: number;
    idempotency_key?: string;
  };

  try {
    meta = JSON.parse(doc.note);
  } catch {
    throw new InvalidTransferStateError("ข้อมูลเอกสารใบย้ายสินค้าไม่สมบูรณ์หรือไม่ถูกต้อง");
  }

  if (!meta.from_warehouse_id || !meta.to_warehouse_id) {
    throw new InvalidTransferStateError("ข้อมูลเอกสารใบย้ายสินค้าไม่สมบูรณ์หรือไม่ถูกต้อง");
  }

  // Warehouse authorization check: canceler MUST have source warehouse access (unless ADMIN)
  if (userRole && userRole !== "ADMIN" && warehouseAccess !== undefined) {
    const hasFrom = hasWarehouseAccess(warehouseAccess, meta.from_warehouse_id);
    if (!hasFrom) {
      throw new UnauthorizedStockOperationError("คุณไม่มีสิทธิ์ในโกดังต้นทางสำหรับเอกสารใบย้ายสินค้านี้");
    }
  }

  return executeAtomicOperation({
    repo: deps.repo,
    operationType: "TRANSFER_CANCEL",
    idempotencyKey: `cancel-transfer-${doc.document_id}`,
    actorId: userId || "system",
    actorRole: userRole || "STAFF",
    lockKeys: [
      formatStockLockKey(meta.from_warehouse_id, meta.from_location_id || "A1", meta.product_id || "unknown"),
      formatStockLockKey(meta.to_warehouse_id, meta.to_location_id || "A1", meta.product_id || "unknown")
    ],
    auditAction: "STOCK_TRANSFER_CANCEL",
    warehouseId: meta.from_warehouse_id,
    payload: { docId, note },
    execute: async ({ repo }) => {
      // Re-check document status before executing reversal
      const freshDoc =
        (await repo.documents.findById(doc.document_id)) ||
        (await repo.documents.findByNo(doc.document_id));
      if (freshDoc && freshDoc.status === "CANCELLED") {
        return freshDoc;
      }
      if (freshDoc && freshDoc.status === "COMPLETED") {
        throw new InvalidTransferStateError("ไม่สามารถยกเลิกใบย้ายสินค้าที่เสร็จสมบูรณ์แล้วได้ (กรุณาใช้การกลับยอด)");
      }

      const existingMovements = await repo.movements.findByDocumentId(doc.document_id);
      if (existingMovements.length > 0) {
        const { reverseStock } = await import("./reverse-stock");
        await reverseStock(deps, {
          original_document_id: doc.document_id,
          note: note || "ยกเลิกโดยผู้ใช้",
          idempotency_key: `cancel-transfer-reversal-${doc.document_id}`,
          user_id: userId || "system",
          role: userRole || "STAFF",
        });
      }

      await repo.documents.updateStatus(doc.document_id, "CANCELLED");

      return { ...doc, status: "CANCELLED" };
    }
  });
}



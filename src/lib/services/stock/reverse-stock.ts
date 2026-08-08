import type { Document, StockMovement } from "@/types/models";
import { formatStockLockKey } from "@/lib/locking";
import {
  ReverseStockSchema,
  type ReverseStockInput,
} from "@/types/api";
import {
  StockUseCaseDeps,
} from "./shared";
import {
  StockConflictError,
  StockNotFoundError,
  StockAlreadyReversedError,
  InsufficientStockError,
  StockValidationError,
} from "./stock-errors";
import { executeAtomicOperation } from "./atomic-stock-executor";

export { ReverseStockSchema, type ReverseStockInput };

export async function reverseStock(
  deps: StockUseCaseDeps,
  input: ReverseStockInput & { user_id: string; role?: string; correlation_id?: string }
): Promise<Document> {
  // 1. Find original document
  const originalDoc =
    (await deps.repo.documents.findById(input.original_document_id)) ||
    (await deps.repo.documents.findByNo(input.original_document_id));
  if (!originalDoc) {
    throw new StockNotFoundError("ไม่พบเอกสารที่ต้องการกลับยอด");
  }

  if (originalDoc.status !== "POSTED" && originalDoc.status !== "COMPLETED") {
    throw new StockValidationError(
      "สามารถกลับยอดได้เฉพาะเอกสารที่มีสถานะ POSTED หรือ COMPLETED เท่านั้น"
    );
  }

  // 2. Check if already reversed
  const allDocs = await deps.repo.documents.findAll({ page: 1, limit: 9999 });
  const alreadyReversed = allDocs.data.some(
    (d: Document) =>
      d.document_type === "REVERSAL" &&
      d.reference_no === originalDoc.document_no
  );
  if (alreadyReversed) {
    throw new StockAlreadyReversedError("เอกสารนี้ถูกกลับยอดไปแล้ว");
  }

  // 3. Get original movements
  const originalMovements = await deps.repo.movements.findByDocumentId(
    originalDoc.document_id
  );
  if (originalMovements.length === 0) {
    throw new StockNotFoundError("ไม่พบรายการเคลื่อนไหวของเอกสารนี้");
  }

  const lockKeys = originalMovements.map((m: StockMovement) =>
    formatStockLockKey(m.warehouse_id, m.location_id, m.product_id)
  );

  return executeAtomicOperation({
    repo: deps.repo,
    operationType: "REVERSAL",
    idempotencyKey: input.idempotency_key,
    actorId: input.user_id,
    actorRole: input.role || "STAFF",
    correlationId: input.correlation_id,
    lockKeys,
    auditAction: "STOCK_REVERSAL",
    warehouseId: originalMovements[0]?.warehouse_id || "",
    payload: input,
    execute: async ({ repo }) => {
      const existsIdempotency =
        (await repo.movements.existsByIdempotencyKey(input.idempotency_key)) ||
        (await repo.movements.existsByIdempotencyKey(`${input.idempotency_key}-0`));
      if (existsIdempotency) {
        throw new StockConflictError("รายการนี้ถูกบันทึกไปแล้ว (idempotency_key ซ้ำ)");
      }

      // 5. Check stock balance for reversal of incoming movements (which will deduct stock)
      for (const mov of originalMovements) {
        if (mov.qty_change > 0) {
          const currentBalance = await repo.movements.getBalance(
            mov.product_id,
            mov.warehouse_id,
            mov.location_id
          );
          if (currentBalance < mov.qty_change) {
            throw new InsufficientStockError(
              `ยอดคงเหลือในตำแหน่งปัจจุบันไม่เพียงพอสำหรับกลับยอด`
            );
          }
        }
      }

      // 6. Create reversal document
      const reversalDoc = await repo.documents.create({
        document_type: "REVERSAL",
        reference_no: originalDoc.document_no,
        document_date: new Date().toISOString().slice(0, 10),
        status: "POSTED",
        note: `กลับยอดเอกสาร ${originalDoc.document_no}: ${input.note || ""}`.trim(),
        created_by: input.user_id,
      });

      // 7. Mirror all movements with opposite sign
      const reversalMovements: Omit<StockMovement, "movement_id" | "created_at">[] =
        originalMovements.map((m: StockMovement, i: number) => ({
          document_id: reversalDoc.document_id,
          product_id: m.product_id,
          warehouse_id: m.warehouse_id,
          location_id: m.location_id,
          qty_change: -m.qty_change,
          movement_type: "REVERSAL",
          idempotency_key: `${input.idempotency_key}-${i}`,
          created_by: input.user_id,
        }));

      const created = await repo.movements.batchCreate(reversalMovements);

      // 8. Update Stock Summary
      await repo.stockSummary.applyChanges(
        created.map((m: StockMovement) => ({
          productId: m.product_id,
          warehouseId: m.warehouse_id,
          locationId: m.location_id,
          delta: m.qty_change,
        }))
      );

      // 9. Keep the warehouse sheet tabs synced via repository adapter (Zero Sheets imports)
      if (repo.warehouseSync) {
        for (const movement of originalMovements) {
          const reversalDelta = -movement.qty_change;
          if (reversalDelta < 0) {
            const product =
              (await repo.products.findById(movement.product_id)) ||
              (await repo.products.findBySku(movement.product_id.replace(/^prod-/, "")));
            await repo.warehouseSync.syncDeduct(
              movement.warehouse_id,
              product?.sku || movement.product_id,
              Math.abs(reversalDelta),
              movement.location_id
            );
          } else if (reversalDelta > 0) {
            const rawSku = movement.product_id.replace(/^prod-/, "");
            const product =
              (await repo.products.findById(movement.product_id)) ||
              (await repo.products.findBySku(rawSku));
            await repo.warehouseSync.syncAdd(
              movement.warehouse_id,
              {
                sku: product?.sku || rawSku,
                barcode: product?.barcode || rawSku,
                product_name: product?.product_name || rawSku,
                category: product?.category || "ทั่วไป",
                base_unit: product?.base_unit || "ชิ้น",
                supplier: product?.supplier || "กลับยอด",
              },
              reversalDelta,
              movement.location_id
            );
          }
        }
      }

      return reversalDoc;
    }
  });
}

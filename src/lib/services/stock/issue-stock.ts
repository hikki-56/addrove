import type { Document, StockMovement } from "@/types/models";
import { formatStockLockKey } from "@/lib/locking";
import {
  IssueStockSchema,
  IssueLineSchema,
  type IssueStockInput,
  type IssueLineInput,
} from "@/types/api";
import {
  StockUseCaseDeps,
  cleanLocCode,
  cleanSkuCode,
  findWarehouse,
} from "./shared";
import {
  StockConflictError,
  StockNotFoundError,
  InsufficientStockError,
} from "./stock-errors";
import { executeAtomicOperation } from "./atomic-stock-executor";

export { IssueStockSchema, IssueLineSchema, type IssueStockInput, type IssueLineInput };

export async function issueStock(
  deps: StockUseCaseDeps,
  input: IssueStockInput & { user_id: string; role?: string; correlation_id?: string }
): Promise<Document> {
  const lockKeys = input.lines.map((l) =>
    formatStockLockKey(input.warehouse_id, l.location_id, l.product_id)
  );

  return executeAtomicOperation({
    repo: deps.repo,
    operationType: "ISSUE",
    idempotencyKey: input.idempotency_key,
    actorId: input.user_id,
    actorRole: input.role || "STAFF",
    correlationId: input.correlation_id,
    lockKeys,
    auditAction: "STOCK_ISSUE",
    warehouseId: input.warehouse_id,
    payload: input,
    execute: async ({ repo }) => {
      const [exists, warehouse] = await Promise.all([
        Promise.all([
          repo.movements.existsByIdempotencyKey(input.idempotency_key),
          repo.movements.existsByIdempotencyKey(`${input.idempotency_key}-0`),
        ]).then((results) => results.some(Boolean)),
        findWarehouse(repo, input.warehouse_id),
      ]);
      if (exists) {
        throw new StockConflictError("รายการนี้ถูกบันทึกไปแล้ว (idempotency_key ซ้ำ)");
      }

      // 2. Warehouse existence check
      if (!warehouse) {
        throw new StockNotFoundError("ไม่พบโกดังที่ระบุ");
      }

      // Combine repeated stock positions before validating, so separate lines
      // cannot each pass against the same balance and overdraw their total.
      const grouped = new Map<string, { product_id: string; location_id: string; qty: number }>();
      for (const line of input.lines) {
        const key = JSON.stringify([cleanSkuCode(line.product_id), cleanLocCode(line.location_id)]);
        const existing = grouped.get(key);
        if (existing) existing.qty += line.qty;
        else grouped.set(key, { ...line });
      }
      const stockLines = [...grouped.values()];
      // Bound concurrent reads to avoid a large document flooding the adapter.
      // All reads finish before any document or stock writes start.
      for (let i = 0; i < stockLines.length; i += 4) {
        const batch = stockLines.slice(i, i + 4);
        const balances = await Promise.all(batch.map((line) => repo.movements.getBalance(
          line.product_id, warehouse.warehouse_id, line.location_id
        )));
        for (let j = 0; j < batch.length; j++) {
          if (balances[j] < batch[j].qty) {
            throw new InsufficientStockError(
              `สินค้าในตำแหน่งนี้มีไม่เพียงพอ (ต้องการ ${batch[j].qty} แต่มี ${balances[j]})`
            );
          }
        }
      }

      // 4. Create document
      const doc = await repo.documents.create({
        document_type: "ISSUE",
        reference_no: input.reference_no,
        document_date: input.document_date,
        status: "POSTED",
        note: input.note,
        created_by: input.user_id,
      });

      // 5. Create movements
      const movements: Omit<StockMovement, "movement_id" | "created_at">[] =
        input.lines.map((line, i) => ({
          document_id: doc.document_id,
          product_id: line.product_id,
          warehouse_id: warehouse.warehouse_id,
          location_id: line.location_id,
          qty_change: -line.qty,
          movement_type: "ISSUE_OUT",
          idempotency_key: `${input.idempotency_key}-${i}`,
          created_by: input.user_id,
        }));

      const createdMovements = await repo.movements.batchCreate(movements);

      // 6. Update Stock Summary
      await repo.stockSummary.applyChanges(
        createdMovements.map((m: StockMovement) => ({
          productId: m.product_id,
          warehouseId: m.warehouse_id,
          locationId: m.location_id,
          delta: m.qty_change,
        }))
      );

      // 7. Synchronize deduction via repository adapter
      if (repo.warehouseSync) {
        for (const line of stockLines) {
          const product =
            (await repo.products.findById(line.product_id)) ||
            (await repo.products.findBySku(line.product_id));
          await repo.warehouseSync.syncDeduct(
            warehouse.warehouse_id,
            product?.sku || line.product_id,
            line.qty,
            line.location_id
          );
        }
      }

      return doc;
    }
  });
}

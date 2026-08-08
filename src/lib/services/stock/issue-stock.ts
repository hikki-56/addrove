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
      const exists =
        (await repo.movements.existsByIdempotencyKey(input.idempotency_key)) ||
        (await repo.movements.existsByIdempotencyKey(`${input.idempotency_key}-0`));
      if (exists) {
        throw new StockConflictError("รายการนี้ถูกบันทึกไปแล้ว (idempotency_key ซ้ำ)");
      }

      // 2. Warehouse existence check
      const warehouse = await findWarehouse(repo, input.warehouse_id);
      if (!warehouse) {
        throw new StockNotFoundError("ไม่พบโกดังที่ระบุ");
      }

      // 3. Check stock balance for each line
      for (const line of input.lines) {
        const balance = await repo.movements.getBalance(
          line.product_id,
          warehouse.warehouse_id,
          line.location_id
        );
        if (balance < line.qty) {
          throw new InsufficientStockError(
            `สินค้าในตำแหน่งนี้มีไม่เพียงพอ (ต้องการ ${line.qty} แต่มี ${balance})`
          );
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
        for (const line of input.lines) {
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

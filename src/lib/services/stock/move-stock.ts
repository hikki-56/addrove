import type { Document, StockMovement } from "@/types/models";
import { formatStockLockKey } from "@/lib/locking";
import {
  MoveStockSchema,
  type MoveStockInput,
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

export { MoveStockSchema, type MoveStockInput };

export async function moveStock(
  deps: StockUseCaseDeps,
  input: MoveStockInput & { user_id: string; role?: string; correlation_id?: string }
): Promise<Document> {
  const fromLoc = (input.from_location_id || "").trim();
  const toLoc = input.to_location_id;

  const lockKeys = [
    ...(fromLoc ? [formatStockLockKey(input.warehouse_id, fromLoc, input.product_id)] : []),
    formatStockLockKey(input.warehouse_id, toLoc, input.product_id),
  ];

  return executeAtomicOperation({
    repo: deps.repo,
    operationType: "MOVE",
    idempotencyKey: input.idempotency_key,
    actorId: input.user_id,
    actorRole: input.role || "STAFF",
    correlationId: input.correlation_id,
    lockKeys,
    auditAction: "STOCK_MOVE",
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

      // 3. Check stock balance at from_location_id if specified
      if (input.from_location_id) {
        const balance = await repo.movements.getBalance(
          input.product_id,
          warehouse.warehouse_id,
          fromLoc
        );
        if (balance < input.qty) {
          throw new InsufficientStockError(
            `สินค้าในตำแหน่งต้นทางมีไม่เพียงพอ (ต้องการ ${input.qty} แต่มี ${balance})`
          );
        }
      }

      // 4. Create document
      const doc = await repo.documents.create({
        document_type: "MOVE",
        reference_no: input.reference_no,
        document_date: input.document_date,
        status: "POSTED",
        note: input.note,
        created_by: input.user_id,
      });

      // 5. Create movements (OUT from fromLoc if specified, IN to to_location_id)
      const movements: Omit<StockMovement, "movement_id" | "created_at">[] = [
        ...(fromLoc
          ? [
              {
                document_id: doc.document_id,
                product_id: input.product_id,
                warehouse_id: warehouse.warehouse_id,
                location_id: fromLoc,
                qty_change: -input.qty,
                movement_type: "MOVE_OUT" as const,
                idempotency_key: `${input.idempotency_key}-0`,
                created_by: input.user_id,
              },
            ]
          : []),
        {
          document_id: doc.document_id,
          product_id: input.product_id,
          warehouse_id: warehouse.warehouse_id,
          location_id: input.to_location_id,
          qty_change: input.qty,
          movement_type: "MOVE_IN" as const,
          idempotency_key: `${input.idempotency_key}-1`,
          created_by: input.user_id,
        },
      ];

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

      // 7. Synchronize move via repository adapter
      if (repo.warehouseSync) {
        const product =
          (await repo.products.findById(input.product_id)) ||
          (await repo.products.findBySku(input.product_id));

        await repo.warehouseSync.syncMove(
          warehouse.warehouse_id,
          product?.sku || input.product_id,
          input.qty,
          fromLoc,
          input.to_location_id
        );
      }

      return doc;
    }
  });
}

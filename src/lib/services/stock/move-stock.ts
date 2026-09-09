import type { Document, StockMovement } from "@/types/models";
import { formatStockLockKey } from "@/lib/locking";
import {
  MoveStockSchema,
  type MoveStockInput,
} from "@/types/api";
import {
  StockUseCaseDeps,
  findWarehouse,
  cleanLocCode,
} from "./shared";
import {
  StockConflictError,
  StockNotFoundError,
  StockValidationError,
  InsufficientStockError,
  InvalidStockLocationError,
} from "./stock-errors";
import { executeAtomicOperation } from "./atomic-stock-executor";
import { logAudit } from "@/lib/audit";

export { MoveStockSchema, type MoveStockInput };

export async function moveStock(
  deps: StockUseCaseDeps,
  input: MoveStockInput & { user_id: string; role?: string; correlation_id?: string }
): Promise<Document> {
  const fromLoc = (input.from_location_id || "").trim();
  const toLoc = input.to_location_id;

  // Moving to the same location is a no-op that only pollutes the ledger
  if (fromLoc && cleanLocCode(fromLoc) && cleanLocCode(fromLoc) === cleanLocCode(toLoc)) {
    throw new StockValidationError("ตำแหน่งต้นทางและปลายทางต้องไม่เหมือนกัน");
  }

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

      // 2b. Destination location must exist inside THIS warehouse (skipped when the
      // location master is unavailable so moves never block on a master-data outage)
      if (repo.locations) {
        const allLocations = await repo.locations.findAll().catch(() => []);
        if (Array.isArray(allLocations) && allLocations.length > 0) {
          const whLocations = allLocations.filter(
            (l: any) =>
              !l?.warehouse_id ||
              l.warehouse_id === warehouse.warehouse_id ||
              l.warehouse_id === warehouse.warehouse_id.replace(/^wh-0*(\d+)$/, "wh-$1")
          );
          const cleanTarget = cleanLocCode(toLoc);
          const matchedTo = whLocations.find((l: any) => {
            const candidates = [cleanLocCode(l.location_id), cleanLocCode(l.location_code), cleanLocCode((l as any).shelf_code)];
            return candidates.filter(Boolean).some((c) => c === cleanTarget);
          });
          if (!matchedTo) {
            throw new InvalidStockLocationError(
              `ตำแหน่งปลายทาง ${toLoc} ไม่มีอยู่ในโกดังนี้ กรุณาเช็ค QR ชั้นวางหรือเพิ่มตำแหน่งในระบบก่อน`
            );
          }
        }
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

      // 7. Synchronize move via repository adapter — a sync failure must be visible
      // (audit FAILURE), never silently swallowed
      if (repo.warehouseSync) {
        const cleanSku = input.product_id.replace(/^prod-/, "");
        try {
          await repo.warehouseSync.syncMove(
            warehouse.warehouse_id,
            cleanSku || input.product_id,
            input.qty,
            input.from_location_id,
            input.to_location_id
          );
        } catch (syncErr) {
          console.error("[MoveStock] Physical sheet sync failed:", syncErr);
          await logAudit(repo.audit, {
            idempotencyKey: input.idempotency_key,
            actorId: input.user_id,
            actorRole: input.role || "STAFF",
            action: "STOCK_MOVE_SHEET_SYNC",
            resourceType: "Document",
            resourceId: doc.document_id,
            warehouseId: warehouse.warehouse_id,
            outcome: "FAILURE",
            errorCode: "SYNC_FAILED",
            metadata: { error: syncErr instanceof Error ? syncErr.message : String(syncErr) },
          }).catch(() => {});
        }
      }

      return doc;
    }
  });
}

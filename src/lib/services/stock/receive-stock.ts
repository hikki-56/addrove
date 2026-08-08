import type { Document } from "@/types/models";
import { formatStockLockKey } from "@/lib/locking";
import {
  ReceiveStockSchema,
  ReceiveLineSchema,
  type ReceiveStockInput,
  type ReceiveLineInput,
} from "@/types/api";
import {
  StockUseCaseDeps,
  findWarehouse,
} from "./shared";
import {
  StockConflictError,
  StockNotFoundError,
  StockValidationError,
} from "./stock-errors";
import { executeAtomicOperation } from "./atomic-stock-executor";

export { ReceiveStockSchema, ReceiveLineSchema, type ReceiveStockInput, type ReceiveLineInput };

export async function receiveStock(
  deps: StockUseCaseDeps,
  input: ReceiveStockInput & { user_id: string; role?: string; correlation_id?: string }
): Promise<Document> {
  const lockKeys = input.lines.map((l) =>
    formatStockLockKey(input.warehouse_id, l.location_id || "loc-14A1", l.product_id)
  );

  return executeAtomicOperation({
    repo: deps.repo,
    operationType: "RECEIVE",
    idempotencyKey: input.idempotency_key,
    actorId: input.user_id,
    actorRole: input.role || "STAFF",
    correlationId: input.correlation_id,
    lockKeys,
    auditAction: "STOCK_RECEIVE",
    warehouseId: input.warehouse_id,
    payload: input,
    execute: async ({ repo }) => {
      // Legacy / movement idempotency check
      const exists =
        (await repo.movements.existsByIdempotencyKey(input.idempotency_key)) ||
        (await repo.movements.existsByIdempotencyKey(`${input.idempotency_key}-0`));
      if (exists) {
        throw new StockConflictError("รายการนี้ถูกบันทึกไปแล้ว (idempotency_key ซ้ำ)");
      }

      // Check existing documents for idempotency key
      const allDocs = await repo.documents.findAll({ page: 1, limit: 9999 });
      const docWithKey = allDocs.data.find((d: Document) => {
        try {
          if (d.note && d.note.startsWith("{")) {
            const parsed = JSON.parse(d.note);
            return parsed.idempotency_key === input.idempotency_key;
          }
        } catch {}
        return false;
      });
      if (docWithKey) {
        throw new StockConflictError("รายการนี้ถูกบันทึกไปแล้ว (idempotency_key ซ้ำ)");
      }

      // 2. Warehouse existence and active check
      const warehouse = await findWarehouse(repo, input.warehouse_id);
      if (!warehouse) {
        throw new StockNotFoundError("ไม่พบโกดังที่ระบุ");
      }
      if (warehouse.active === false) {
        throw new StockValidationError("โกดังถูกปิดใช้งาน");
      }

      // 3. Encode payload for approval workflow
      const notePayload = JSON.stringify({
        warehouse_id: warehouse.warehouse_id,
        product_id: input.lines[0]?.product_id,
        qty: input.lines[0]?.qty,
        location_id: input.lines[0]?.location_id || "loc-14A1",
        idempotency_key: input.idempotency_key,
        note: input.note,
        lines: input.lines,
      });

      // 4. Create PENDING document waiting for Admin approval
      const doc = await repo.documents.create({
        document_type: "RECEIVE",
        reference_no: input.reference_no,
        document_date: input.document_date,
        status: "PENDING",
        note: notePayload,
        created_by: input.user_id,
      });

      return doc;
    }
  });
}

import { z } from "zod";
import { todayBangkokIsoDate } from "@/lib/express-status-utils";
import { formatStockLockKey, withStockLocks } from "@/server/locking";
import type { IStockRepository } from "@/server/repositories/interfaces";
import type { Actor } from "@/server/security";
import type { IssueLineInput } from "@/types/api";
import { getOfficeProducts } from "./office.service";
import { executeAtomicOperation } from "./stock/atomic-stock-executor";
import { postStockIssue } from "./stock/issue-stock";
import { InsufficientStockError, StockValidationError } from "./stock/stock-errors";

export const OfficeStockCutSchema = z.strictObject({
  idempotency_key: z.uuid(),
  note: z.string().trim().max(500, "หมายเหตุต้องไม่เกิน 500 ตัวอักษร").default(""),
  lines: z.array(z.strictObject({
    product_id: z.string().min(1),
    quantity: z.number().positive("จำนวนต้องมากกว่า 0").multipleOf(0.001, "ระบุจำนวนได้ไม่เกิน 3 ตำแหน่งทศนิยม"),
  })).min(1, "กรุณาเลือกสินค้าอย่างน้อยหนึ่งรายการ"),
});

export async function cutOfficeStock(repo: IStockRepository, officeId: string, input: z.infer<typeof OfficeStockCutSchema>, actor: Actor) {
  const key = `office-cut-${input.idempotency_key}`;
  return executeAtomicOperation({
    repo, operationType: "OFFICE_STOCK_CUT", idempotencyKey: key,
    actorId: actor.id, actorRole: actor.role, correlationId: actor.correlationId,
    warehouseId: officeId, auditAction: "STOCK_OFFICE_CUT",
    payload: { warehouse_id: officeId, actor_id: actor.id, note: input.note, lines: JSON.stringify(input.lines) },
    lockKeys: input.lines.map(line => formatStockLockKey(officeId, "*", line.product_id)),
    execute: async () => {
      const positions = await getOfficeProducts(repo, officeId);
      const lines: IssueLineInput[] = [];
      const locationCodes = new Map<string, string>();
      for (const item of input.lines) {
        const sources = positions.filter(row => row.product_id === item.product_id);
        if (!sources.length) throw new StockValidationError("เลือกได้เฉพาะสินค้าบาร์โค้ด 13 หลักที่มีสต็อกในสำนักงานใหญ่");
        let remaining = item.quantity;
        for (const source of sources) {
          const qty = Math.min(remaining, source.quantity);
          if (qty <= 0) continue;
          lines.push({ product_id: item.product_id, location_id: source.location_id, qty });
          locationCodes.set(source.location_id, source.location_code);
          source.quantity = Math.round((source.quantity - qty) * 1000) / 1000;
          remaining = Math.round((remaining - qty) * 1000) / 1000;
          if (!remaining) break;
        }
        if (remaining > 0) throw new InsufficientStockError(`สต็อกสำนักงานใหญ่ของ ${sources[0].product_name} ไม่เพียงพอ`);
      }
      const locks = lines.map(line => formatStockLockKey(officeId, line.location_id, line.product_id));
      return withStockLocks(locks, () => postStockIssue({ repo }, {
        lines, warehouse_id: officeId, user_id: actor.id, note: input.note,
        document_date: todayBangkokIsoDate(), reference_no: "OFFICE-CUT", idempotency_key: key,
      }, locationCodes));
    },
  });
}

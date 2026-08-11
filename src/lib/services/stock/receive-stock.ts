import type { Document } from "@/types/models";
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

export { ReceiveStockSchema, ReceiveLineSchema, type ReceiveStockInput, type ReceiveLineInput };

/**
 * Receive Stock — Creates a PENDING document for Admin approval.
 * This does NOT modify stock balances. It only creates a document
 * that appears on the /approvals page for Admin to approve.
 */
export async function receiveStock(
  deps: StockUseCaseDeps,
  input: ReceiveStockInput & { user_id: string; role?: string; correlation_id?: string }
): Promise<Document> {
  const repo = deps.repo;

  // 1. Idempotency Check
  if (input.idempotency_key) {
    const existsInMovements =
      (await repo.movements.existsByIdempotencyKey(input.idempotency_key)) ||
      (await repo.movements.existsByIdempotencyKey(`${input.idempotency_key}-0`));
    if (existsInMovements) {
      throw new StockConflictError("รายการนี้ถูกบันทึกไปแล้ว (idempotency_key ซ้ำ)");
    }

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
  }

  // 2. Resolve warehouse & validate existence
  const warehouse = await findWarehouse(repo, input.warehouse_id);
  if (!warehouse) {
    throw new StockNotFoundError("ไม่พบโกดังที่ระบุ");
  }
  if (warehouse.active === false) {
    throw new StockValidationError("โกดังถูกปิดใช้งาน");
  }
  const warehouseName = warehouse.warehouse_name || `โกดัง${input.warehouse_id.replace(/^wh-0?/, "")}`;


  // 2. Build approval payload with product/location details
  let allProducts: any[] = [];
  let allLocations: any[] = [];
  try {
    allProducts = await repo.products.findAll().catch(() => []);
    allLocations = await repo.locations.findAll().catch(() => []);
  } catch {
    // Non-critical: approval page will still work with raw IDs
  }

  const approvalRows = input.lines.map((l) => {
    const prod = allProducts.find((p: any) => p.product_id === l.product_id || p.sku === l.product_id);
    const loc = allLocations.find((locItem: any) => locItem.location_id === l.location_id || locItem.location_code === l.location_id);
    const extraLocs = Array.isArray((l as any).extra_locations)
      ? (l as any).extra_locations.filter((x: string) => Boolean(x && x.trim()))
      : [];
    const rawLoc = (l.location_id || "").trim();
    const locCode = loc?.location_code || rawLoc;
    const fullLocDisplay = [locCode, ...extraLocs].filter(Boolean).join(", ");

    const supplierVal = prod?.supplier || (prod?.description ? prod.description.replace(/^ผู้จำหน่าย:\s*/, "") : "") || "-";

    return [
      prod?.sku || l.product_id,
      fullLocDisplay,
      l.barcode || prod?.barcode || prod?.sku || "",
      prod?.product_name || "สินค้า",
      l.qty,
      warehouseName,
      supplierVal,
      new Date().toISOString(),
    ];
  });

  const notePayload = JSON.stringify({
    warehouse_id: input.warehouse_id,
    target_sheet: warehouseName,
    product_id: input.lines[0]?.product_id,
    qty: input.lines[0]?.qty,
    location_id: input.lines[0]?.location_id || "",
    idempotency_key: input.idempotency_key,
    note: input.note,
    lines: input.lines,
    rows: approvalRows,
  });

  // 3. Create PENDING document — this is the only write operation
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

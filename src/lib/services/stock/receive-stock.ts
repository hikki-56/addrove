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
  input: ReceiveStockInput & { user_id: string; role?: string; correlation_id?: string; user_name?: string; created_by_name?: string }
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

  const approvalRows: any[] = [];
  const expandedLines: any[] = [];

  for (const l of input.lines) {
    const prod = allProducts.find((p: any) => p.product_id === l.product_id || p.sku === l.product_id);
    const supplierVal = prod?.supplier || (prod?.description ? prod.description.replace(/^ผู้จำหน่าย:\s*/, "") : "") || "-";
    const barcodeVal = l.barcode || prod?.barcode || prod?.sku || "";
    const prodName = prod?.product_name || "สินค้า";

    const extraLocs: string[] = Array.isArray((l as any).extra_locations)
      ? (l as any).extra_locations.filter((x: string) => Boolean(x && x.trim()))
      : [];
    const extraQtys: number[] = Array.isArray((l as any).extra_qtys) ? (l as any).extra_qtys : [];

    // Resolve location allocations
    const allocations: Array<{ location_id: string; qty: number }> = [];

    if (Array.isArray((l as any).location_allocations) && (l as any).location_allocations.length > 0) {
      for (const alloc of (l as any).location_allocations) {
        if (alloc.location_id && String(alloc.location_id).trim()) {
          allocations.push({
            location_id: String(alloc.location_id).trim(),
            qty: Number(alloc.qty) || 1,
          });
        }
      }
    } else if (extraLocs.length > 0) {
      const totalExtraQty = extraQtys.reduce((sum, q) => sum + (Number(q) || 1), 0);
      const primaryQty = typeof (l as any).primary_qty === "number" && (l as any).primary_qty > 0
        ? (l as any).primary_qty
        : Math.max(1, Number(l.qty) - totalExtraQty > 0 ? Number(l.qty) - totalExtraQty : Number(l.qty));
      allocations.push({ location_id: (l.location_id || "").trim(), qty: primaryQty });

      for (let i = 0; i < extraLocs.length; i++) {
        allocations.push({
          location_id: extraLocs[i].trim(),
          qty: Number(extraQtys[i]) || 1,
        });
      }
    } else {
      allocations.push({
        location_id: (l.location_id || "").trim(),
        qty: Number(l.qty) || 1,
      });
    }

    for (const alloc of allocations) {
      const loc = allLocations.find(
        (locItem: any) =>
          (locItem.shelf_code && locItem.shelf_code.toLowerCase() === alloc.location_id.toLowerCase()) ||
          (locItem.location_code && locItem.location_code.toLowerCase() === alloc.location_id.toLowerCase()) ||
          (locItem.location_id && locItem.location_id.toLowerCase() === alloc.location_id.toLowerCase())
      );

      const locCode =
        loc?.shelf_code && loc.shelf_code.toLowerCase() === alloc.location_id.toLowerCase()
          ? loc.shelf_code
          : loc?.location_code && loc.location_code.toLowerCase() === alloc.location_id.toLowerCase()
          ? loc.location_code
          : alloc.location_id || loc?.location_code || "ตำแหน่งเริ่มต้น";

      approvalRows.push([
        prod?.sku || l.product_id,
        locCode,
        barcodeVal,
        prodName,
        alloc.qty,
        warehouseName,
        supplierVal,
        new Date().toISOString(),
      ]);

      expandedLines.push({
        product_id: l.product_id,
        location_id: locCode,
        qty: alloc.qty,
        boxes: Number(l.boxes) || 1,
        barcode: barcodeVal,
      });
    }
  }

  const creatorName =
    input.created_by_name ||
    input.user_name ||
    (input.role === "ADMIN" ? "ผู้ดูแลระบบ (Admin)" : "พนักงานรับสินค้า");

  const notePayload = JSON.stringify({
    warehouse_id: input.warehouse_id,
    target_sheet: warehouseName,
    created_by_name: creatorName,
    product_id: expandedLines[0]?.product_id || input.lines[0]?.product_id,
    qty: expandedLines.reduce((acc, curr) => acc + (Number(curr.qty) || 0), 0),
    location_id: expandedLines[0]?.location_id || input.lines[0]?.location_id || "",
    idempotency_key: input.idempotency_key,
    note: input.note,
    lines: expandedLines,
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
    created_by_name: creatorName,
  });

  return doc;
}

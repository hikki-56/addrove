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
import {
  applyReceivingPlanReceipt,
  assertLinesInPlan,
  loadPlanForReceive,
  type LoadPlanForReceiveResult,
} from "./receiving-plan";

export { ReceiveStockSchema, ReceiveLineSchema, type ReceiveStockInput, type ReceiveLineInput };

/**
 * Receive Stock — Creates a PENDING document for Admin approval.
 * This does NOT modify stock balances. It only creates a document
 * that appears on the /approvals page for Admin to approve.
 * Wrapped in executeAtomicOperation (lock + idempotency claim + journal) like issue/move
 * so concurrent double-submits cannot create duplicate PENDING documents.
 */
export async function receiveStock(
  deps: StockUseCaseDeps,
  input: ReceiveStockInput & { user_id: string; role?: string; correlation_id?: string; user_name?: string; created_by_name?: string }
): Promise<Document> {
  const lockKeys = input.lines.map((l) =>
    formatStockLockKey(input.warehouse_id, l.location_id, l.product_id)
  );
  // รับตามแผน → ล็อกระดับแผนด้วย เพื่อกันการอัปเดต progress ของแผนเดียวกันพร้อมกัน
  const planDocumentId = (input as any).plan_document_id?.trim() || "";
  if (planDocumentId) {
    lockKeys.push(`plan:${planDocumentId}`);
  }

  return executeAtomicOperation({
    repo: deps.repo,
    operationType: "RECEIVE",
    idempotencyKey: input.idempotency_key,
    actorId: input.user_id,
    actorRole: input.role || "STAFF",
    correlationId: input.correlation_id,
    lockKeys,
    auditAction: "STOCK_RECEIVE_SUBMIT",
    warehouseId: input.warehouse_id,
    payload: input,
    execute: async ({ repo }) => {
      // 1. Idempotency Check (kept as fast-path guard on legacy stores)
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

      // 3. Build approval payload with product/location details
      let allProducts: any[] = [];
      let allLocations: any[] = [];
      try {
        allProducts = await repo.products.findAll().catch(() => []);
        allLocations = await repo.locations.findAll().catch(() => []);
      } catch {
        // Non-critical: approval page will still work with raw IDs
      }

      // 3.1 รับตามแผนรับสินค้า — ตรวจแผน + บังคับนโยบาย "รับได้เฉพาะสินค้าในแผน"
      let planCtx: LoadPlanForReceiveResult | null = null;
      if (planDocumentId) {
        planCtx = await loadPlanForReceive(repo, planDocumentId, warehouse.warehouse_id);
        assertLinesInPlan(
          planCtx.payload,
          input.lines,
          (pid) =>
            allProducts.find((p: any) => p.product_id === pid || p.sku === pid) || null
        );
      }

      // Locations of this warehouse only — reject allocations pointing at another
      // warehouse or a non-existent shelf (skipped when the location master is
      // unavailable/empty so receiving never blocks on a master-data outage)
      const warehouseLocations = allLocations.filter(
        (locItem: any) =>
          !locItem?.warehouse_id ||
          locItem.warehouse_id === warehouse.warehouse_id ||
          locItem.warehouse_id === warehouse.warehouse_id.replace(/^wh-0*(\d+)$/, "wh-$1")
      );

      const resolveLocation = (code: string) => {
        const cleanCode = code.trim().toLowerCase();
        if (!cleanCode) return undefined;
        return warehouseLocations.find(
          (locItem: any) =>
            (locItem.shelf_code && locItem.shelf_code.toLowerCase() === cleanCode) ||
            (locItem.location_code && locItem.location_code.toLowerCase() === cleanCode) ||
            (locItem.location_id && locItem.location_id.toLowerCase() === cleanCode)
        );
      };

      if (warehouseLocations.length > 0) {
        for (const l of input.lines) {
          const candidateCodes: string[] = [];
          if (Array.isArray((l as any).location_allocations)) {
            for (const alloc of (l as any).location_allocations) {
              if (alloc?.location_id && String(alloc.location_id).trim()) {
                candidateCodes.push(String(alloc.location_id).trim());
              }
            }
          }
          if (Array.isArray((l as any).extra_locations)) {
            for (const extra of (l as any).extra_locations) {
              if (extra && extra.trim()) candidateCodes.push(extra.trim());
            }
          }
          if (l.location_id && l.location_id.trim()) candidateCodes.push(l.location_id.trim());

          for (const code of candidateCodes) {
            if (!resolveLocation(code)) {
              throw new StockValidationError(
                `ไม่พบตำแหน่ง ${code} ใน${warehouseName} กรุณาตรวจสอบ QR ชั้นวางหรือเพิ่มตำแหน่งในระบบก่อน`
              );
            }
          }
        }
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
          const loc = resolveLocation(alloc.location_id);

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
        ...(planCtx
          ? { plan_document_id: planCtx.doc.document_id, plan_document_no: planCtx.doc.document_no }
          : {}),
      });

      // 4. Create PENDING document — this is the only write operation
      const doc = await repo.documents.create({
        document_type: "RECEIVE",
        // รับตามแผน: ถ้าผู้ใช้ไม่ได้กรอกเลขอ้างอิงเอง ใช้เลขที่แผนเป็นอ้างอิง
        reference_no: input.reference_no || planCtx?.doc.document_no || "",
        document_date: input.document_date,
        status: "PENDING",
        note: notePayload,
        created_by: input.user_id,
        created_by_name: creatorName,
      });

      // 5. อัปเดตความคืบหน้าของแผน (append receipt log + สถานะ PROCESSING/COMPLETED)
      //    ทำภายใต้ lock เดียวกัน — ถ้าแผนอัปเดตไม่สำเร็จ ให้ fail ทั้ง op เพื่อไม่ให้
      //    เอกสารรับเข้าหลุดจากแผน (idempotency key เดิม retry ได้)
      if (planCtx) {
        const receivedByProduct = new Map<string, number>();
        for (const expanded of expandedLines) {
          const prod = allProducts.find(
            (p: any) => p.product_id === expanded.product_id || p.sku === expanded.product_id
          );
          const canonicalId = prod?.product_id || expanded.product_id;
          receivedByProduct.set(
            canonicalId,
            (receivedByProduct.get(canonicalId) || 0) + (Number(expanded.qty) || 0)
          );
        }
        await applyReceivingPlanReceipt(
          { repo },
          {
            plan: planCtx.doc,
            receipt: {
              document_id: doc.document_id,
              document_no: doc.document_no,
              received_at: new Date().toISOString(),
              received_by_name: creatorName,
            },
            lines: Array.from(receivedByProduct.entries()).map(([product_id, qty]) => ({
              product_id,
              qty,
            })),
          }
        );
      }

      return doc;
    },
  });
}

import { NextRequest } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { createActorFromSession, authorize, PERMISSIONS } from "@/lib/security";
import { getRepository } from "@/lib/repositories";
import { withStockLocks, formatStockLockKey } from "@/lib/locking";
import { logAudit } from "@/lib/audit";
import type { StockMovement } from "@/types/models";
import {
  successResponse,
  notFoundResponse,
  unauthorizedResponse,
  forbiddenResponse,
  conflictResponse,
  serverErrorResponse,
} from "@/lib/api-response";
import { setDocumentStatus } from "@/lib/document-status-store";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getAuthSession(req);
    const actor = await createActorFromSession(req, session);
    if (!actor) return unauthorizedResponse();

    try {
      authorize(actor, PERMISSIONS.DOCUMENT_APPROVE);
    } catch (authErr: unknown) {
      if (authErr && typeof authErr === "object" && "statusCode" in authErr && (authErr as any).statusCode === 401) {
        return unauthorizedResponse((authErr as any).message);
      }
      return forbiddenResponse(authErr instanceof Error ? authErr.message : "คุณไม่มีสิทธิ์อนุมัติเอกสารนี้");
    }

    const rawBody = await req.json().catch(() => ({}));
    const { id } = await params;
    const decodedId = decodeURIComponent(id).trim();

    setDocumentStatus(decodedId, "POSTED");

    const repo = getRepository();
    let doc =
      (await repo.documents.findById(decodedId)) ||
      (await repo.documents.findByNo(decodedId));

    if (!doc && (rawBody.document_id || rawBody.document_no || (rawBody.rows && rawBody.rows.length > 0))) {
      const docNo = rawBody.document_no || decodedId;
      const targetSheet = rawBody.target_sheet || "โกดัง1";
      const whId = rawBody.warehouse_id || (targetSheet.includes("4") ? "wh-04" : "wh-01");

      doc = {
        document_id: rawBody.document_id || decodedId || `doc-${Date.now()}`,
        document_no: docNo,
        document_type: "RECEIVE",
        reference_no: "",
        document_date: rawBody.document_date || new Date().toISOString().slice(0, 10),
        status: "PENDING",
        note: JSON.stringify({
          warehouse_id: whId,
          target_sheet: targetSheet,
          rows: rawBody.rows || [],
          lines: rawBody.lines || [],
        }),
        created_by: rawBody.created_by || actor.id,
        created_at: rawBody.created_at || new Date().toISOString(),
      };

      try {
        await repo.documents.create(doc);
      } catch (err) {
        console.warn("[Approve Route] Failed to auto-persist missing document:", err);
      }
    }

    if (!doc) {
      const allDocsResult = await repo.documents.findAll({ page: 1, limit: 9999 });
      doc =
        allDocsResult.data.find(
          (d) =>
            d.document_id.trim().toLowerCase() === decodedId.toLowerCase() ||
            d.document_no.trim().toLowerCase() === decodedId.toLowerCase() ||
            d.document_id.includes(decodedId) ||
            d.document_no.includes(decodedId)
        ) || null;
    }

    if (!doc) {
      return notFoundResponse("ไม่พบเอกสารขอรับสินค้านี้");
    }

    if (doc.status !== "PENDING" && doc.status !== "DRAFT" && doc.status !== "NEW") {
      return conflictResponse(
        doc.status === "POSTED"
          ? "เอกสารนี้ถูกอนุมัติไปแล้ว"
          : `ไม่สามารถอนุมัติเอกสารสถานะ ${doc.status || "ไม่ทราบสถานะ"}`
      );
    }

    let parsedPayload = {
      warehouse_id: "wh-1",
      lines: [] as Array<{ product_id: string; location_id?: string; qty: number; barcode?: string; boxes?: number }>,
      rows: [] as Array<(string | number)[]>,
    };

    if (doc.note && doc.note.startsWith("{")) {
      try {
        parsedPayload = { ...parsedPayload, ...JSON.parse(doc.note) };
      } catch {
        throw new Error("ข้อมูลรายการรับสินค้าในเอกสารไม่ถูกต้อง");
      }
    }

    const warehouseId = parsedPayload.warehouse_id || "wh-1";
    const lockKeys = [formatStockLockKey(warehouseId, "any", "any")];

    return await withStockLocks(lockKeys, async () => {
      const existingMovements = await repo.movements.findByDocumentId(doc.document_id);
      if (existingMovements.length > 0) {
        throw new Error("เอกสารนี้มี StockMovement แล้ว ต้องตรวจสอบก่อนดำเนินการซ้ำ");
      }

      const movementInputs: Omit<StockMovement, "movement_id" | "created_at">[] = [];

      if (parsedPayload.lines && parsedPayload.lines.length > 0) {
        for (let idx = 0; idx < parsedPayload.lines.length; idx++) {
          const line = parsedPayload.lines[idx];
          movementInputs.push({
            document_id: doc.document_id,
            product_id: line.product_id,
            warehouse_id: warehouseId,
            location_id: line.location_id || "",
            qty_change: Number(line.qty),
            movement_type: "RECEIVE",
            idempotency_key: `approval-${doc.document_id}-${idx}`,
            created_by: doc.created_by || actor.id,
          });
        }
      } else if (parsedPayload.rows && parsedPayload.rows.length > 0) {
        for (let idx = 0; idx < parsedPayload.rows.length; idx++) {
          const row = parsedPayload.rows[idx];
          const sku = String(row[0] ?? "").trim();
          const loc = String(row[1] ?? "").trim();
          movementInputs.push({
            document_id: doc.document_id,
            product_id: sku.startsWith("prod-") ? sku : `prod-${sku}`,
            warehouse_id: warehouseId,
            location_id: loc,
            qty_change: Number(row[4] || row[5] || 0),
            movement_type: "RECEIVE",
            idempotency_key: `approval-${doc.document_id}-${idx}`,
            created_by: doc.created_by || actor.id,
          });
        }
      }

      if (movementInputs.length === 0) {
        throw new Error("เอกสารนี้ไม่มีรายการสินค้าที่อนุมัติได้");
      }

      const createdMovements = await repo.movements.batchCreate(movementInputs);

      try {
        await repo.stockSummary.applyChanges(
          createdMovements.map((movement: StockMovement) => ({
            productId: movement.product_id,
            warehouseId: movement.warehouse_id,
            locationId: movement.location_id,
            delta: movement.qty_change,
          }))
        );
      } catch (sumErr) {
        console.warn("[Approve Route] stockSummary.applyChanges warning:", sumErr);
      }

      await repo.documents.updateStatus(doc.document_id, "POSTED");

      // Synchronize via repository adapter
      if (repo.warehouseSync) {
        for (const mov of createdMovements) {
          try {
            const prod =
              (await repo.products.findById(mov.product_id)) ||
              (await repo.products.findBySku(mov.product_id.replace(/^prod-/, "")));

            await repo.warehouseSync.syncAdd(
              warehouseId,
              {
                sku: prod?.sku || mov.product_id.replace(/^prod-/, ""),
                barcode: prod?.barcode || prod?.sku || mov.product_id,
                product_name: prod?.product_name || mov.product_id,
                category: prod?.category || "ทั่วไป",
                base_unit: prod?.base_unit || "ชิ้น",
                supplier: prod?.supplier || "รับสินค้าเข้าคลัง",
              },
              mov.qty_change,
              mov.location_id
            );
          } catch (syncErr) {
            console.warn("[Approve Route] warehouseSync.syncAdd warning:", syncErr);
          }
        }
      }

      await logAudit(repo.audit, {
        actorId: actor.id,
        actorRole: actor.role,
        action: "STOCK_RECEIVE",
        resourceType: "Document",
        resourceId: doc.document_id,
        warehouseId,
        outcome: "SUCCESS",
        metadata: {
          approved_movements_count: createdMovements.length,
        },
      });

      return successResponse({ id: doc.document_id, status: "POSTED" }, "อนุมัติรายการและบันทึกเข้าโกดังเรียบร้อยแล้ว");
    });
  } catch (e) {
    return serverErrorResponse(e);
  }
}

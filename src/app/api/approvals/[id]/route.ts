import { NextRequest } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { createActorFromSession, authorize, PERMISSIONS } from "@/lib/security";
import { getRepository } from "@/lib/repositories";
import { logAudit } from "@/lib/audit";
import {
  successResponse,
  notFoundResponse,
  unauthorizedResponse,
  forbiddenResponse,
  conflictResponse,
  serverErrorResponse,
  errorResponse,
} from "@/lib/api-response";

export async function PUT(
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
      return forbiddenResponse(authErr instanceof Error ? authErr.message : "คุณไม่มีสิทธิ์แก้ไขเอกสารนี้");
    }

    const { id } = await params;
    const decodedId = decodeURIComponent(id).trim();
    const rawBody = await req.json().catch(() => ({}));

    const repo = getRepository();
    let doc =
      (await repo.documents.findById(decodedId)) ||
      (await repo.documents.findByNo(decodedId));

    if (!doc) {
      const allDocsResult = await repo.documents.findAll({ page: 1, limit: 9999 });
      doc =
        allDocsResult.data.find(
          (d) =>
            d.document_id.trim().toLowerCase() === decodedId.toLowerCase() ||
            d.document_no.trim().toLowerCase() === decodedId.toLowerCase()
        ) || null;
    }

    if (!doc) {
      return notFoundResponse("ไม่พบเอกสารขอรับสินค้านี้");
    }

    const currentStatus = String(doc.status || "").toUpperCase();
    if (currentStatus !== "PENDING" && currentStatus !== "DRAFT" && currentStatus !== "NEW") {
      return conflictResponse(
        `ไม่สามารถแก้ไขเอกสารสถานะ ${doc.status || "ไม่ทราบสถานะ"} (ต้องเป็นเอกสารรออนุมัติเท่านั้น)`
      );
    }

    if (!Array.isArray(rawBody.rows) || rawBody.rows.length === 0) {
      return errorResponse("เอกสารต้องมีรายการสินค้าอย่างน้อย 1 รายการ");
    }

    let existingPayload: any = {};
    if (doc.note && doc.note.startsWith("{")) {
      try {
        existingPayload = JSON.parse(doc.note);
      } catch {}
    }

    const updatedRows = rawBody.rows.map((row: any[]) => {
      const sku = String(row[0] ?? "").trim();
      const location = String(row[1] ?? "-").trim() || "-";
      const barcode = String(row[2] ?? "").trim() || sku;
      const productName = String(row[3] ?? "").trim() || sku;
      const qtyNum = parseFloat(String(row[4] ?? "1").replace(/,/g, "").trim());
      const qty = !isNaN(qtyNum) && qtyNum > 0 ? qtyNum : 1;
      const warehouse = String(row[5] ?? rawBody.target_sheet ?? existingPayload.target_sheet ?? "โกดัง1").trim();
      const supplier = String(row[6] ?? "-").trim() || "-";
      const timestamp = String(row[7] ?? new Date().toISOString());

      return [sku, location, barcode, productName, qty, warehouse, supplier, timestamp];
    });

    const updatedLines = updatedRows.map((r: any[]) => ({
      product_id: r[0],
      location_id: r[1],
      qty: r[4],
      boxes: 1,
      barcode: r[2],
    }));

    const targetSheet = String(rawBody.target_sheet || existingPayload.target_sheet || "โกดัง1").trim();
    const warehouseId = String(rawBody.warehouse_id || existingPayload.warehouse_id || "wh-1").trim();
    const docDate = String(rawBody.document_date || doc.document_date || new Date().toISOString().slice(0, 10)).trim();

    const updatedPayload = {
      ...existingPayload,
      target_sheet: targetSheet,
      warehouse_id: warehouseId,
      rows: updatedRows,
      lines: updatedLines,
      qty: updatedRows.reduce((sum: number, r: any[]) => sum + Number(r[4] || 0), 0),
      updated_by: actor.id,
      updated_at: new Date().toISOString(),
    };

    const newNote = JSON.stringify(updatedPayload);

    if (typeof repo.documents.updateDoc === "function") {
      await repo.documents.updateDoc(doc.document_id, {
        note: newNote,
        document_date: docDate,
      });
    } else {
      await repo.documents.updateNote(doc.document_id, newNote);
    }

    await logAudit(repo.audit, {
      actorId: actor.id,
      actorRole: actor.role,
      action: "STOCK_RECEIVE",
      resourceType: "Document",
      resourceId: doc.document_id,
      outcome: "SUCCESS",
      metadata: {
        action: "EDIT_PENDING_RECEIVE",
        document_no: doc.document_no,
        itemsCount: updatedRows.length,
      },
    });

    return successResponse(
      {
        document_id: doc.document_id,
        document_no: doc.document_no,
        target_sheet: targetSheet,
        warehouse_id: warehouseId,
        document_date: docDate,
        rows: updatedRows,
      },
      "บันทึกการแก้ไขเอกสารสำเร็จ"
    );
  } catch (e) {
    console.error("[PUT /api/approvals/[id]] Error:", e);
    return serverErrorResponse(e);
  }
}

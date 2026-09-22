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
import { appendRows, SHEETS } from "@/lib/google-sheets/client";
import { to8DigitBarcode } from "@/lib/barcode-utils";
import { expressStatusMap } from "@/app/api/express-import/status/route";
import { cleanExpressCode, expressItemKey, todayBangkokIsoDate } from "@/lib/express-status-utils";

export const maxDuration = 60;

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

    // หมายเหตุ: ห้ามตั้งสถานะ POSTED ใน memory ณ จุดนี้ — ต้องรอให้เขียน movement/
    // อัปเดตสถานะในชีตสำเร็จก่อน มิฉะนั้นถ้า approve ล้มเหลว เอกสารจะหายจากคิว
    // /approvals และประวัติรับเข้าทั้งที่ชีตยังเป็น PENDING (setDocumentStatus
    // ถูกเรียกเฉพาะหลัง updateStatus(..., "POSTED") สำเร็จเท่านั้น)

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

    const currentStatus = String(doc.status || "").toUpperCase();
    if (currentStatus !== "PENDING" && currentStatus !== "DRAFT" && currentStatus !== "NEW") {
      return conflictResponse(
        currentStatus === "POSTED" || currentStatus === "APPROVED"
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
        // เอกสารนี้บันทึกสต๊อกไปแล้ว แต่สถานะในชีตยังเป็น PENDING (เขียนสถานะไม่สำเร็จในรอบก่อน)
        // สรุปสถานะเป็น POSTED ให้เลย — ไม่เช่นนั้นเอกสารจะติดหน้ารออนุมัติและกดอนุมัติซ้ำไม่ได้ตลอดไป
        // (ถึงจุดนี้ currentStatus ต้องเป็น PENDING/DRAFT/NEW เท่านั้น เพราะ POSTED ถูกตัดไปแล้วด้านบน)
        await repo.documents.updateStatus(doc.document_id, "POSTED");
        setDocumentStatus(doc.document_id, "POSTED");
        setDocumentStatus(doc.document_no, "POSTED");

        // ครั้งก่อนค้างอยู่: ถ้ามีรายการที่เคยเขียนลงชีตโกดังไม่สำเร็จ (จดไว้ใน note)
        // ให้ไล่เขียนให้ครบก่อนปิดเอกสาร — กันสต็อกในระบบกับชีตไม่ตรงกันถาวร
        if (repo.warehouseSync) {
          let staleMeta: Record<string, any> = {};
          try {
            if (doc.note && doc.note.startsWith("{")) staleMeta = JSON.parse(doc.note);
          } catch {}
          const failedLines: Array<Record<string, any>> = Array.isArray(staleMeta.warehouse_sync_failures)
            ? staleMeta.warehouse_sync_failures
            : [];
          if (failedLines.length > 0) {
            const stillFailed: Array<Record<string, any>> = [];
            for (const line of failedLines) {
              try {
                const prod =
                  (await repo.products.findById(String(line.product_id || "")).catch(() => null)) ||
                  (await repo.products.findBySku(String(line.sku || "")).catch(() => null));
                await repo.warehouseSync.syncAdd(
                  String(line.target_sheet || staleMeta.target_sheet || warehouseId),
                  {
                    sku: line.sku || prod?.sku || line.product_id,
                    barcode: prod?.barcode || line.sku || line.product_id,
                    product_name: line.product_name || prod?.product_name || line.sku,
                    category: prod?.category || "ทั่วไป",
                    base_unit: prod?.base_unit || "ชิ้น",
                    supplier: prod?.supplier || "รับสินค้าเข้าคลัง",
                  },
                  Number(line.qty) || 0,
                  String(line.location_id || "")
                );
              } catch (retryErr) {
                console.error("[Approve Route] retry warehouseSync.syncAdd error:", retryErr);
                stillFailed.push(line);
              }
            }
            try {
              const meta = { ...staleMeta };
              if (stillFailed.length > 0) {
                meta.warehouse_sync_failures = stillFailed;
              } else {
                delete meta.warehouse_sync_failures;
                delete meta.warehouse_sync_failed_at;
              }
              await repo.documents.updateNote(doc.document_id, JSON.stringify(meta));
            } catch (noteErr) {
              console.error("[Approve Route] clear warehouse_sync_failures note failed:", noteErr);
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
            reconciled: true,
            existing_movements: existingMovements.length,
          },
        });

        return successResponse(
          { id: doc.document_id, status: "POSTED", reconciled: true },
          "เอกสารนี้บันทึกเข้าโกดังไว้แล้ว ระบบปรับสถานะเป็นอนุมัติให้เรียบร้อย"
        );
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

      // สถานะเขียนชีตสำเร็จแล้วจึงตั้ง override ใน memory ให้ /approvals กับ
      // ประวัติรับเข้าเห็น POSTED ทันที (set ทั้ง id และ เลขที่เอกสาร เผื่อผู้เรียก
      // อ้างอิงเอกสารด้วยค่าใดค่าหนึ่ง)
      setDocumentStatus(doc.document_id, "POSTED");
      setDocumentStatus(doc.document_no, "POSTED");

      // ซิงก์ลงแท็บโกดัง "ทีละรายการ" เท่านั้น — เขียนขนานพร้อมกันทีเดียวทั้งเอกสาร
      // (แบบเดิม) ทำให้ Apps Script รับงานพร้อมกันหลายงานและมีรายการถูกทิ้ง
      // โดยไม่มี error เกิดขึ้น (เกิดขึ้นจริงกับ RCV ที่มีหลายสิบรายการ: หาย 5 จาก 14)
      // รายการที่ syncAdd retry ครบแล้วยังล้มจะถูกจดไว้ใน note ของเอกสารเพื่อไล่แก้ทีหลัง
      const warehouseSyncFailures: Array<{
        product_id: string;
        sku: string;
        product_name: string;
        qty: number;
        location_id: string;
        target_sheet: string;
        error: string;
      }> = [];

      if (repo.warehouseSync) {
        const targetWh = (doc.note && doc.note.includes("target_sheet") ? JSON.parse(doc.note).target_sheet : null) || warehouseId;

        for (let idx = 0; idx < createdMovements.length; idx++) {
          const mov = createdMovements[idx];
          let skuVal = mov.product_id.replace(/^prod-/, "");
          let nameVal = skuVal;
          try {
            const prod =
              (await repo.products.findById(mov.product_id)) ||
              (await repo.products.findBySku(mov.product_id.replace(/^prod-/, "")));

            const rowData = parsedPayload.rows && parsedPayload.rows[idx] ? parsedPayload.rows[idx] : null;

            skuVal = prod?.sku || (rowData ? String(rowData[0] ?? "") : mov.product_id.replace(/^prod-/, ""));
            nameVal = prod?.product_name || (rowData ? String(rowData[3] ?? "") : skuVal);
            const barcodeVal = prod?.barcode || (rowData ? String(rowData[2] ?? "") : skuVal);
            const supplierVal = prod?.supplier || (rowData ? String(rowData[6] ?? "") : "รับสินค้าเข้าคลัง");
            const locVal = mov.location_id || (rowData ? String(rowData[1] ?? "") : "");

            await repo.warehouseSync!.syncAdd(
              targetWh,
              {
                sku: skuVal,
                barcode: barcodeVal,
                product_name: nameVal,
                category: prod?.category || "ทั่วไป",
                base_unit: prod?.base_unit || "ชิ้น",
                supplier: supplierVal,
              },
              mov.qty_change,
              locVal
            );
          } catch (syncErr) {
            console.error("[Approve Route] warehouseSync.syncAdd error:", syncErr);
            warehouseSyncFailures.push({
              product_id: mov.product_id,
              sku: skuVal,
              product_name: nameVal,
              qty: Number(mov.qty_change) || 0,
              location_id: mov.location_id || "",
              target_sheet: targetWh,
              error: syncErr instanceof Error ? syncErr.message : String(syncErr),
            });
          }
        }
      }

      // Automatically record into Google Sheets Tab: "รับสินค้าเข้าExpress" / "นำเข้าสินค้าเข้าExpress"
      try {
        const targetWh = (doc.note && doc.note.includes("target_sheet") ? JSON.parse(doc.note).target_sheet : null) || warehouseId;
        const nowIso = new Date().toISOString();
        // วันที่เอกสารตามเวลาไทย — เดิมใช้ UTC ทำให้รายการก่อน 07:00 น. ตกเป็นวันก่อนหน้าแล้วหลุดกรอง "วันนี้"
        const nowDate = doc.document_date || todayBangkokIsoDate();
        const expressReceiveRows: any[][] = [];
        const expressSkus: string[] = [];
        const docNoVal = doc.document_no || doc.document_id;

        for (let idx = 0; idx < createdMovements.length; idx++) {
          const mov = createdMovements[idx];
          const prod =
            (await repo.products.findById(mov.product_id).catch(() => null)) ||
            (await repo.products.findBySku(mov.product_id.replace(/^prod-/, "")).catch(() => null));
          const rowData = parsedPayload.rows && parsedPayload.rows[idx] ? parsedPayload.rows[idx] : null;

          const skuVal = prod?.sku || (rowData ? String(rowData[0] ?? "") : mov.product_id.replace(/^prod-/, ""));
          let rawBarcode = prod?.barcode || (rowData ? String(rowData[2] ?? "") : "");
          if (!rawBarcode || rawBarcode === "-" || rawBarcode === "ทั่วไป") {
            rawBarcode = to8DigitBarcode("", skuVal) || skuVal;
          }
          const barcodeVal = to8DigitBarcode(rawBarcode, skuVal) || rawBarcode || skuVal;
          const nameVal = prod?.product_name || (rowData ? String(rowData[3] ?? "") : skuVal);
          const locVal = mov.location_id || (rowData ? String(rowData[1] ?? "") : "-");
          const qtyVal = Number(mov.qty_change) || 1;

          // Row format matching User's Express sheet columns:
          // [รหัสสินค้า, ตำแหน่ง, เลขที่เอกสาร, โกดัง, วันที่เอกสาร, ชื่อสินค้า, สถานะการนำเข้า, จำนวน, บาร์โค้ด]
          expressReceiveRows.push([
            skuVal,
            locVal || "-",
            docNoVal,
            targetWh || "โกดัง1",
            nowDate,
            nameVal,
            "รอนำเข้า Express",
            qtyVal,
            barcodeVal,
          ]);
          expressSkus.push(skuVal);
        }

        // await จริง — เดิม fire-and-forget บน serverless อาจถูก freeze ก่อนเขียนชีตเสร็จ
        // แถว Express หายเงียบ ๆ ทั้งที่เอกสารถือว่า sync แล้ว
        let expressSheetSynced = true;
        let expressSheetError = "";
        if (expressReceiveRows.length > 0) {
          try {
            await appendRows(SHEETS.EXPRESS_RECEIVE, expressReceiveRows);
          } catch (appendErr) {
            expressSheetSynced = false;
            expressSheetError = appendErr instanceof Error ? appendErr.message : String(appendErr);
            console.warn("[approve] appendRows to EXPRESS_RECEIVE failed:", appendErr);
          }
        }

        // Update document note with express metadata
        let currentMeta: Record<string, any> = {};
        try {
          if (doc.note && doc.note.startsWith("{")) {
            currentMeta = JSON.parse(doc.note);
          }
        } catch {}
        currentMeta.express_tag = "นำเข้าสินค้าเข้าExpress";
        currentMeta.express_status = "PENDING";
        currentMeta.express_status_text = "รอนำเข้า Express";
        currentMeta.express_synced_at = nowIso;
        // สถานะเก็บระดับรายรายการด้วย — ทุก SKU เริ่มที่ "รอนำเข้า" ตอนอนุมัติ
        // (กดนำเข้าทีละรายการที่หน้า Express จะได้ไม่พากันทั้งเอกสาร)
        const expressItemsMap: Record<string, string> = { ...(currentMeta.express_items || {}) };
        expressSkus.forEach((s) => {
          expressItemsMap[cleanExpressCode(s)] = "PENDING";
        });
        currentMeta.express_items = expressItemsMap;
        currentMeta.express_sheet_synced = expressSheetSynced;
        if (!expressSheetSynced) {
          currentMeta.express_sheet_error = expressSheetError;
          currentMeta.express_sheet_failed_at = nowIso;
        }
        await repo.documents.updateNote(doc.document_id, JSON.stringify(currentMeta)).catch(() => {});

        // Update in-memory expressStatusMap — ระดับรายการ (docno|sku) คือตัวตัดสินแสดงผล
        const entry = {
          status: "PENDING" as const,
          type: "RECEIVE",
          updated_at: nowIso,
          document_no: docNoVal,
        };
        if (docNoVal) expressStatusMap.set(docNoVal.trim().toLowerCase(), entry);
        if (doc.document_id) expressStatusMap.set(doc.document_id.trim().toLowerCase(), entry);
        expressSkus.forEach((s) => {
          expressStatusMap.set(expressItemKey(docNoVal, s), { ...entry, sku: s });
        });
      } catch (sheetErr) {
        console.warn("[approve] Auto-append to EXPRESS_RECEIVE sheet warning:", sheetErr);
      }

      // จดรายการที่ซิงก์ลงแท็บโกดังไม่สำเร็จไว้ในเอกสาร — กันข้อมูลหายเงียบ ๆ
      // (อ่าน note ล่าสุดจากชีตมา merge เพราะบล็อก Express เพิ่งเขียน note ไป)
      if (warehouseSyncFailures.length > 0) {
        try {
          const freshDoc =
            (await repo.documents.findById(doc.document_id)) ||
            (await repo.documents.findByNo(doc.document_no || "").catch(() => null));
          let meta: Record<string, any> = {};
          try {
            if (freshDoc?.note && freshDoc.note.startsWith("{")) meta = JSON.parse(freshDoc.note);
          } catch {}
          meta.warehouse_sync_failures = warehouseSyncFailures;
          meta.warehouse_sync_failed_at = new Date().toISOString();
          await repo.documents.updateNote(doc.document_id, JSON.stringify(meta));
        } catch (noteErr) {
          console.error("[Approve Route] record warehouse_sync_failures failed:", noteErr);
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
          ...(warehouseSyncFailures.length > 0
            ? { warehouse_sync_failed_count: warehouseSyncFailures.length }
            : {}),
        },
      });

      if (warehouseSyncFailures.length > 0) {
        return successResponse(
          {
            id: doc.document_id,
            status: "POSTED",
            warehouse_sync_failed_count: warehouseSyncFailures.length,
          },
          `อนุมัติและบันทึกสต็อกระบบเรียบร้อย แต่มี ${warehouseSyncFailures.length} รายการที่ยังเขียนลงชีตโกดังไม่สำเร็จ (ระบบบันทึกรายการไว้ในเอกสารแล้ว — ต้องตรวจสอบชีตอีกครั้ง)`
        );
      }

      return successResponse({ id: doc.document_id, status: "POSTED" }, "อนุมัติรายการและบันทึกเข้าโกดังเรียบร้อยแล้ว");
    });
  } catch (e) {
    return serverErrorResponse(e);
  }
}

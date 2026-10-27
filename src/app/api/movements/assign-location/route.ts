import { withStorageRequest } from "@/server/storage-transaction";
import { NextRequest } from "next/server";
import { z } from "zod";
import { getAuthSession } from "@/server/auth-session";
import { createActorFromSession, authorize, PERMISSIONS } from "@/server/security";
import { getRepository } from "@/server/repositories";
import { moveStock, mapStockErrorToResponse, getStockBalances } from "@/server/services/stock";
import { canAssignLocation, validateAssignRows, splitAssignQty } from "@/lib/assign-location";
import { normalizeWarehouseId } from "@/lib/warehouse-utils";
import {
  successResponse,
  errorResponse,
  unauthorizedResponse,
  forbiddenResponse,
  serverErrorResponse,
} from "@/server/api-response";

export const maxDuration = 60;

const BodySchema = z.object({
  warehouse_id: z.string().min(1, "กรุณาเลือกโกดัง"),
  product_id: z.string().min(1, "กรุณาเลือกสินค้า"),
  idempotency_key: z.string().min(1),
  note: z.string().max(500).default(""),
  rows: z
    .array(z.object({ to_location_id: z.string().trim().min(1), qty: z.number().int().positive() }))
    .min(1)
    .max(50),
});

/**
 * ระบุตำแหน่งสินค้า: ย้ายจากตำแหน่ง "ไม่ระบุ" ไปยังแต่ละตำแหน่ง
 * ส่วนที่เกินยอด "ไม่ระบุ" บันทึก ADJUST เข้าตำแหน่งนั้นโดยตรง (ระบุตำแหน่ง (เพิ่มส่วนเกิน))
 * ทั้ง MOVE และ ADJUST อยู่ในทรานแซกชันเดียว (withStorageRequest)
 */
async function handlePOST(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    const actor = await createActorFromSession(req, session);
    if (!session?.user?.id || !actor) return unauthorizedResponse();

    let email: string | null = null;
    if (actor.role === "ADMIN") {
      const dbUser = await getRepository().users.findById(session.user.id).catch(() => null);
      if (!dbUser?.active) return forbiddenResponse("เมนูระบุตำแหน่งสินค้าใช้ได้เฉพาะบัญชีที่กำหนด");
      email = dbUser.email;
    }
    if (!canAssignLocation(actor.role, email)) {
      return forbiddenResponse("เมนูระบุตำแหน่งสินค้าใช้ได้เฉพาะพนักงานและบัญชีผู้ดูแลที่กำหนด");
    }

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return mapStockErrorToResponse(parsed.error);
    const input = parsed.data;

    try {
      authorize(actor, PERMISSIONS.STOCK_MOVE, input.warehouse_id);
    } catch (authErr: any) {
      if (authErr.statusCode === 401) return unauthorizedResponse(authErr.message);
      return forbiddenResponse(authErr.message);
    }

    const repo = getRepository();
    const [balances, rawLocs] = await Promise.all([
      getStockBalances({ repo }),
      repo.locations.findAll().catch(() => []),
    ]);
    const codeById = new Map<string, string>();
    for (const l of Array.isArray(rawLocs) ? rawLocs : []) {
      if (l?.location_id) codeById.set(l.location_id, (l.location_code || "").trim());
    }
    const wh = normalizeWarehouseId(input.warehouse_id);
    let remaining = (balances.find((b) => b.product_id === input.product_id)?.by_warehouse || [])
      .filter((e) => normalizeWarehouseId(e.warehouse_id) === wh)
      .filter((e) => !e.location_id || codeById.get(e.location_id) === "" || e.location_name.trim() === "ไม่ระบุ")
      .reduce((s, e) => s + e.quantity, 0);
    const errors = validateAssignRows(input.rows);
    if (errors.length) return errorResponse(errors.join("\n"));

    const today = new Date().toISOString().slice(0, 10);
    const documents = [];
    for (const [i, row] of input.rows.entries()) {
      try {
        const loc = row.to_location_id.toUpperCase();
        const { move, adjust } = splitAssignQty(row.qty, remaining);
        remaining = Math.max(0, remaining - move);
        let moveDocId: string | undefined;
        let adjustDocId: string | undefined;

        if (move > 0) {
          const doc = await moveStock(
            { repo },
            {
              warehouse_id: input.warehouse_id,
              product_id: input.product_id,
              from_location_id: "",
              to_location_id: loc,
              qty: move,
              reference_no: "",
              document_date: today,
              note: input.note || "ระบุตำแหน่งสินค้า",
              idempotency_key: `${input.idempotency_key}:r${i + 1}`,
              user_id: actor.id,
              role: actor.role,
              correlation_id: actor.correlationId,
            }
          );
          moveDocId = doc.document_id;
        }

        if (adjust > 0) {
          const doc = await repo.documents.create({
            document_type: "ADJUST",
            reference_no: "",
            document_date: today,
            status: "POSTED",
            note: input.note || "ระบุตำแหน่ง (เพิ่มส่วนเกิน)",
            created_by: actor.id,
          });
          await repo.movements.batchCreate([
            {
              document_id: doc.document_id,
              product_id: input.product_id,
              warehouse_id: input.warehouse_id,
              location_id: loc,
              qty_change: adjust,
              movement_type: "ADJUST",
              idempotency_key: `${input.idempotency_key}:r${i + 1}:adj`,
              created_by: actor.id,
            },
          ]);
          await repo.stockSummary.applyChanges([
            {
              productId: input.product_id,
              warehouseId: input.warehouse_id,
              locationId: loc,
              delta: adjust,
            },
          ]);
          adjustDocId = doc.document_id;
        }

        documents.push({
          to_location_id: row.to_location_id,
          qty: row.qty,
          moved: move,
          adjusted: adjust,
          document_id: moveDocId || adjustDocId,
          adjust_document_id: adjustDocId,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "บันทึกไม่สำเร็จ";
        const res = mapStockErrorToResponse(e);
        const status = res?.status && res.status >= 400 ? res.status : 400;
        return errorResponse(`แถวที่ ${i + 1} (${row.to_location_id}) ไม่สำเร็จ: ${msg} — ยังไม่มีรายการใดถูกบันทึก`, status);
      }
    }
    return successResponse({ documents }, "ระบุตำแหน่งสินค้าเรียบร้อยแล้ว", 201);
  } catch (e) {
    console.error("[API AssignLocation] Error:", e);
    return mapStockErrorToResponse(e) || serverErrorResponse(e);
  }
}

export const POST = withStorageRequest(handlePOST);

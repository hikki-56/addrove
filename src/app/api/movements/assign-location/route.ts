import { withStorageRequest } from "@/server/storage-transaction";
import { NextRequest } from "next/server";
import { z } from "zod";
import { getAuthSession } from "@/server/auth-session";
import { createActorFromSession, authorize, PERMISSIONS } from "@/server/security";
import { getRepository } from "@/server/repositories";
import { mapStockErrorToResponse } from "@/server/services/stock";
import { canAssignLocation, validateAssignRows, assignAdjustDelta } from "@/lib/assign-location";
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
 * ระบุตำแหน่งสินค้า: ตั้งยอด stock_summary ของแต่ละตำแหน่ง = จำนวนที่กรอก
 * โดย ADJUST ส่วนต่าง (entered − current) ที่ตำแหน่งนั้น — ไม่ดึงจาก "ไม่ระบุ" และไม่บวกทับยอดเดิม
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

    const errors = validateAssignRows(input.rows);
    if (errors.length) return errorResponse(errors.join("\n"));

    const repo = getRepository();
    const today = new Date().toISOString().slice(0, 10);
    const documents = [];

    for (const [i, row] of input.rows.entries()) {
      try {
        const loc = row.to_location_id.toUpperCase();
        const current = Number(
          await repo.movements.getBalance(input.product_id, input.warehouse_id, loc)
        ) || 0;
        const delta = assignAdjustDelta(row.qty, current);
        if (delta === 0) {
          documents.push({
            to_location_id: row.to_location_id,
            qty: row.qty,
            previous_qty: current,
            delta: 0,
            document_id: null,
          });
          continue;
        }

        const doc = await repo.documents.create({
          document_type: "ADJUST",
          reference_no: "",
          document_date: today,
          status: "POSTED",
          note: input.note || "ระบุตำแหน่ง (ตั้งยอดตามที่นับ)",
          created_by: actor.id,
        });
        await repo.movements.batchCreate([
          {
            document_id: doc.document_id,
            product_id: input.product_id,
            warehouse_id: input.warehouse_id,
            location_id: loc,
            qty_change: delta,
            movement_type: "ADJUST",
            idempotency_key: `${input.idempotency_key}:r${i + 1}`,
            created_by: actor.id,
          },
        ]);
        await repo.stockSummary.applyChanges([
          {
            productId: input.product_id,
            warehouseId: input.warehouse_id,
            locationId: loc,
            delta,
          },
        ]);
        documents.push({
          to_location_id: row.to_location_id,
          qty: row.qty,
          previous_qty: current,
          delta,
          document_id: doc.document_id,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "บันทึกไม่สำเร็จ";
        const res = mapStockErrorToResponse(e);
        const status = res?.status && res.status >= 400 ? res.status : 400;
        return errorResponse(
          `แถวที่ ${i + 1} (${row.to_location_id}) ไม่สำเร็จ: ${msg} — ยังไม่มีรายการใดถูกบันทึก`,
          status
        );
      }
    }
    return successResponse({ documents }, "ระบุตำแหน่งสินค้าเรียบร้อยแล้ว", 201);
  } catch (e) {
    console.error("[API AssignLocation] Error:", e);
    return mapStockErrorToResponse(e) || serverErrorResponse(e);
  }
}

export const POST = withStorageRequest(handlePOST);

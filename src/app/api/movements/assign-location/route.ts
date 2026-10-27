import { withStorageRequest } from "@/server/storage-transaction";
import { NextRequest } from "next/server";
import { z } from "zod";
import { getAuthSession } from "@/server/auth-session";
import { createActorFromSession, authorize, PERMISSIONS } from "@/server/security";
import { getRepository } from "@/server/repositories";
import { mapStockErrorToResponse } from "@/server/services/stock";
import {
  canAssignLocation,
  validateAssignRows,
  buildAssignSnapshot,
} from "@/lib/assign-location";
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
 * ระบุตำแหน่งสินค้า: สแนปช็อตยอดในโกดัง — ตำแหน่งที่กรอก = จำนวนที่กรอก
 * ตำแหน่งอื่นของสินค้าในโกดังเดียวกัน (รวม "ไม่ระบุ") = 0
 * บันทึก ADJUST ส่วนต่างต่อตำแหน่งในทรานแซกชันเดียว
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
    const wh = normalizeWarehouseId(input.warehouse_id);
    const [summaries, rawLocs] = await Promise.all([
      repo.stockSummary.findAll(input.warehouse_id),
      repo.locations.findAll(input.warehouse_id).catch(() => []),
    ]);
    const codeById = new Map<string, string>();
    for (const l of Array.isArray(rawLocs) ? rawLocs : []) {
      if (l?.location_id) codeById.set(l.location_id, (l.location_code || "").trim().toUpperCase());
    }
    const currents = summaries
      .filter((s) => s.product_id === input.product_id && normalizeWarehouseId(s.warehouse_id) === wh)
      .map((s) => ({
        location_id: s.location_id,
        location_key: codeById.get(s.location_id) ?? "",
        quantity: Number(s.quantity) || 0,
      }));

    const plan = buildAssignSnapshot(input.rows, currents);
    const today = new Date().toISOString().slice(0, 10);
    const documents = [];
    let i = 0;
    for (const step of plan) {
      i += 1;
      if (step.delta === 0) {
        documents.push({
          to_location_id: step.location_key || step.location_id,
          qty: step.target,
          previous_qty: step.current,
          delta: 0,
          document_id: null,
        });
        continue;
      }
      try {
        const loc = step.location_key || step.location_id;
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
            qty_change: step.delta,
            movement_type: "ADJUST",
            idempotency_key: `${input.idempotency_key}:s${i}`,
            created_by: actor.id,
          },
        ]);
        await repo.stockSummary.applyChanges([
          {
            productId: input.product_id,
            warehouseId: input.warehouse_id,
            locationId: loc,
            delta: step.delta,
          },
        ]);
        documents.push({
          to_location_id: loc,
          qty: step.target,
          previous_qty: step.current,
          delta: step.delta,
          document_id: doc.document_id,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "บันทึกไม่สำเร็จ";
        const res = mapStockErrorToResponse(e);
        const status = res?.status && res.status >= 400 ? res.status : 400;
        return errorResponse(
          `ตำแหน่ง ${step.location_key || step.location_id} ไม่สำเร็จ: ${msg} — ยังไม่มีรายการใดถูกบันทึก`,
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

import { withStorageRequest } from "@/server/storage-transaction";
import { NextRequest } from "next/server";
import { z } from "zod";
import { getAuthSession } from "@/server/auth-session";
import { createActorFromSession, authorize, PERMISSIONS } from "@/server/security";
import { getRepository } from "@/server/repositories";
import { moveStock, mapStockErrorToResponse, getStockBalances } from "@/server/services/stock";
import { canAssignLocation, validateAssignRows } from "@/lib/assign-location";
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
 * ระบุตำแหน่งสินค้า: ย้ายจำนวนจากตำแหน่ง "ไม่ระบุ" ไปยังแต่ละตำแหน่ง
 * ใช้ moveStock เดิมทีละแถวในทรานแซกชันเดียว (withStorageRequest)
 * (from_location_id = "" = ตำแหน่งไม่ระบุ) ยอดรวมจึงไม่เปลี่ยน
 */
async function handlePOST(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    const actor = await createActorFromSession(req, session);
    if (!session?.user?.id || !actor) return unauthorizedResponse();

    // ADMIN: ตรวจอีเมลจากฐานข้อมูล (ไม่เชื่อ token อย่างเดียว) — เหมือนเมนูแก้ไขสูตร BOM
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
    // ตรวจยอดรวมกับยอด "ไม่ระบุ" ก่อนบันทึกแถวแรก กันบันทึกได้บางส่วน
    const [balances, rawLocs] = await Promise.all([
      getStockBalances({ repo }),
      repo.locations.findAll().catch(() => []),
    ]);
    const codeById = new Map<string, string>();
    for (const l of Array.isArray(rawLocs) ? rawLocs : []) {
      if (l?.location_id) codeById.set(l.location_id, (l.location_code || "").trim());
    }
    const wh = normalizeWarehouseId(input.warehouse_id);
    const available = (balances.find((b) => b.product_id === input.product_id)?.by_warehouse || [])
      .filter((e) => normalizeWarehouseId(e.warehouse_id) === wh)
      .filter((e) => !e.location_id || codeById.get(e.location_id) === "" || e.location_name.trim() === "ไม่ระบุ")
      .reduce((s, e) => s + e.quantity, 0);
    const errors = validateAssignRows(input.rows, available);
    if (errors.length) return errorResponse(errors.join("\n"));

    const today = new Date().toISOString().slice(0, 10);
    const documents = [];
    for (const [i, row] of input.rows.entries()) {
      try {
        const doc = await moveStock(
          { repo },
          {
            warehouse_id: input.warehouse_id,
            product_id: input.product_id,
            from_location_id: "",
            to_location_id: row.to_location_id.toUpperCase(),
            qty: row.qty,
            reference_no: "",
            document_date: today,
            note: input.note || "ระบุตำแหน่งสินค้า",
            idempotency_key: `${input.idempotency_key}:r${i + 1}`,
            user_id: actor.id,
            role: actor.role,
            correlation_id: actor.correlationId,
          }
        );
        documents.push({ to_location_id: row.to_location_id, qty: row.qty, document_id: doc.document_id });
      } catch (e) {
        // withStorageRequest ย้อนกลับทุกแถวเมื่อคืน 4xx/5xx — ไม่มีการบันทึกบางส่วน
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

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
import { createAssignRequests, AssignRequestError } from "@/server/services/location-assign-requests";
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
 * ไม่เขียนสต็อกทันที — สร้างคำขอรออนุมัติ; อนุมัติแล้วจึง ADJUST ตั้งยอด (ดู requests/[id]/approve)
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
    // ไม่เขียนสต็อก — สร้างคำขอรออนุมัติ 1 แถวต่อ ตำแหน่งที่ยอดจะเปลี่ยน (รวมแถวที่ถูกตั้งเป็น 0)
    try {
      const requests = await createAssignRequests({
        warehouse_id: input.warehouse_id,
        product_id: input.product_id,
        plan,
        note: input.note,
        actor_id: actor.id,
        idempotency_key: input.idempotency_key,
      });
      if (!requests.length) return successResponse({ requests: [] }, "ยอดตรงกับที่นับอยู่แล้ว ไม่ต้องขออนุมัติ", 200);
      return successResponse({ requests }, `ส่งคำขอแล้ว ${requests.length} รายการ — รออนุมัติ`, 201);
    } catch (e) {
      if (e instanceof AssignRequestError) return errorResponse(e.message, e.status);
      throw e;
    }
  } catch (e) {
    console.error("[API AssignLocation] Error:", e);
    return mapStockErrorToResponse(e) || serverErrorResponse(e);
  }
}

export const POST = withStorageRequest(handlePOST);

// คำขอระบุตำแหน่งสินค้า: บันทึก = สร้างคำขอ (ยังไม่แตะสต็อก), อนุมัติ = ADJUST ตั้งยอดตามจริง ณ ตอนอนุมัติ
import { randomUUID } from "node:crypto";
import { query, withDatabaseTransaction } from "@/server/repositories/postgres/database";
import { getRepository } from "@/server/repositories";
import { normalizeWarehouseId } from "@/lib/warehouse-utils";
import { assignAdjustDelta, type SnapshotTarget } from "@/lib/assign-location";

export type AssignRequestStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

export interface AssignRequest {
  request_id: string;
  batch_id: string;
  warehouse_id: string;
  product_id: string;
  location_id: string;
  location_code: string;
  target_qty: number;
  qty_at_request: number;
  status: AssignRequestStatus;
  note: string;
  requested_by: string;
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string;
  qty_at_decision: number | null;
  document_id: string | null;
  idempotency_key: string;
  // joined
  sku?: string;
  barcode?: string;
  product_name?: string;
  warehouse_name?: string;
  requested_by_name?: string;
  decided_by_name?: string;
  current_qty?: number;
  edit_count?: number;
}

export class AssignRequestError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const num = (v: unknown) => Number(v) || 0;

/** สร้างคำขอจากแผนสแนปช็อต — 1 แถวต่อ ตำแหน่งที่ยอดเปลี่ยน (delta ≠ 0) */
export async function createAssignRequests(input: {
  warehouse_id: string;
  product_id: string;
  plan: SnapshotTarget[];
  note: string;
  actor_id: string;
  idempotency_key: string;
}): Promise<AssignRequest[]> {
  const steps = input.plan.filter((s) => s.delta !== 0);
  if (!steps.length) return [];
  return withDatabaseTransaction(async () => {
    // idempotent: ถ้าเคยส่งแล้ว คืนชุดเดิม
    const existing = await query<AssignRequest>(
      "SELECT * FROM location_assign_requests WHERE idempotency_key LIKE $1 ORDER BY idempotency_key",
      [`${input.idempotency_key}:%`]
    );
    if (existing.length) return existing;
    const pending = await query<{ location_id: string; location_code: string }>(
      "SELECT location_id, location_code FROM location_assign_requests WHERE status='PENDING' AND warehouse_id=$1 AND product_id=$2 AND location_id = ANY($3)",
      [input.warehouse_id, input.product_id, steps.map((s) => s.location_id)]
    );
    if (pending.length) {
      const codes = pending.map((p) => p.location_code || "ไม่ระบุ").join(", ");
      throw new AssignRequestError(`มีคำขอรออนุมัติอยู่แล้วสำหรับตำแหน่ง ${codes} — รออนุมัติ/ปฏิเสธก่อน`, 409);
    }
    const batch = randomUUID();
    const out: AssignRequest[] = [];
    let i = 0;
    for (const s of steps) {
      i += 1;
      const [row] = await query<AssignRequest>(
        `INSERT INTO location_assign_requests
           (request_id,batch_id,warehouse_id,product_id,location_id,location_code,target_qty,qty_at_request,note,requested_by,idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [
          `lar-${randomUUID()}`,
          batch,
          input.warehouse_id,
          input.product_id,
          s.location_id,
          s.location_key || "",
          s.target,
          s.current,
          input.note,
          input.actor_id,
          `${input.idempotency_key}:${i}`,
        ]
      );
      out.push(row);
    }
    return out;
  });
}

export async function listAssignRequests(filter: {
  status?: AssignRequestStatus | "ALL";
  warehouse_id?: string | null;
  requested_by?: string | null;
  limit?: number;
}): Promise<AssignRequest[]> {
  const where: string[] = [];
  const vals: unknown[] = [];
  if (filter.status && filter.status !== "ALL") {
    vals.push(filter.status);
    where.push(`r.status=$${vals.length}`);
  }
  if (filter.warehouse_id) {
    vals.push(filter.warehouse_id);
    where.push(`r.warehouse_id=$${vals.length}`);
  }
  if (filter.requested_by) {
    vals.push(filter.requested_by);
    where.push(`r.requested_by=$${vals.length}`);
  }
  vals.push(Math.min(Math.max(filter.limit ?? 300, 1), 1000));
  const rows = await query<AssignRequest>(
    `SELECT r.*, p.sku, p.barcode, p.product_name, w.warehouse_name,
            coalesce(u.full_name, r.requested_by) AS requested_by_name,
            coalesce(u2.full_name, r.decided_by) AS decided_by_name,
            coalesce((SELECT s.quantity FROM stock_summary s
                       LEFT JOIN locations l ON l.location_id = s.location_id
                      WHERE s.product_id=r.product_id AND s.warehouse_id=r.warehouse_id
                        AND (s.location_id=r.location_id OR (r.location_code<>'' AND upper(l.location_code)=upper(r.location_code)))
                      LIMIT 1),0) AS current_qty
       FROM location_assign_requests r
       LEFT JOIN products p ON p.product_id=r.product_id
       LEFT JOIN warehouses w ON w.warehouse_id=r.warehouse_id
       LEFT JOIN users u ON u.user_id=r.requested_by
       LEFT JOIN users u2 ON u2.user_id=r.decided_by
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY r.requested_at DESC, r.location_code
      LIMIT $${vals.length}`,
    vals
  );
  // จำนวนครั้งที่แก้ไข (อ่านอย่างเดียว) — ใช้แสดงชิป "แก้ไขแล้ว"; ตารางประวัติไม่พร้อม = ข้าม
  const editCount = new Map<string, number>();
  if (rows.length) {
    try {
      const counts = await query<{ request_id: string; n: string }>(
        "SELECT request_id, count(*) AS n FROM location_assign_request_edits WHERE request_id = ANY($1) GROUP BY request_id",
        [rows.map((r) => r.request_id)]
      );
      for (const c of counts) editCount.set(c.request_id, num(c.n));
    } catch {
      // ไม่มีตาราง/สิทธิ์ — แสดงรายการได้ตามปกติ
    }
  }
  return rows.map((r) => ({
    ...r,
    edit_count: editCount.get(r.request_id) ?? 0,
    target_qty: num(r.target_qty),
    qty_at_request: num(r.qty_at_request),
    qty_at_decision: r.qty_at_decision == null ? null : num(r.qty_at_decision),
    current_qty: num(r.current_qty),
  }));
}

async function lockPending(id: string): Promise<AssignRequest> {
  const [row] = await query<AssignRequest>(
    "SELECT * FROM location_assign_requests WHERE request_id=$1 FOR UPDATE",
    [id]
  );
  if (!row) throw new AssignRequestError("ไม่พบคำขอนี้", 404);
  if (row.status !== "PENDING") throw new AssignRequestError(`คำขอนี้${row.status === "APPROVED" ? "อนุมัติ" : "ปิด"}ไปแล้ว`, 409);
  return row;
}

/**
 * อนุมัติ: อ่านยอดปัจจุบัน ณ ตอนอนุมัติ แล้ว ADJUST ให้ = target_qty (ส่วนต่างคิดใหม่)
 * ทั้งหมดในทรานแซกชันเดียว — ล้มเหลว = ไม่มีอะไรถูกบันทึก
 */
export async function approveAssignRequest(id: string, actorId: string, decisionNote = "") {
  return withDatabaseTransaction(async () => {
    const req = await lockPending(id);
    const repo = getRepository();
    const target = num(req.target_qty);
    // ยอด ณ ตอนอนุมัติ (ล็อกแถว stock_summary ถ้ามี)
    const cur = await query<{ location_id: string; quantity: string }>(
      `SELECT s.location_id, s.quantity FROM stock_summary s
         LEFT JOIN locations l ON l.location_id=s.location_id
        WHERE s.product_id=$1 AND s.warehouse_id=$2
          AND (s.location_id=$3 OR ($4<>'' AND upper(l.location_code)=upper($4)))
        LIMIT 1 FOR UPDATE OF s`,
      [req.product_id, req.warehouse_id, req.location_id, req.location_code]
    );
    const current = cur.length ? num(cur[0].quantity) : 0;
    const locationId = cur.length ? cur[0].location_id : req.location_id;
    const delta = assignAdjustDelta(target, current);
    let documentId: string | null = null;
    if (delta !== 0) {
      const doc = await repo.documents.create({
        document_type: "ADJUST",
        reference_no: req.request_id,
        document_date: new Date().toISOString().slice(0, 10),
        status: "POSTED",
        note: "ระบุตำแหน่ง (อนุมัติคำขอ)",
        created_by: actorId,
      });
      await repo.movements.batchCreate([
        {
          document_id: doc.document_id,
          product_id: req.product_id,
          warehouse_id: req.warehouse_id,
          location_id: locationId,
          qty_change: delta,
          movement_type: "ADJUST",
          idempotency_key: `${req.idempotency_key}:approve`,
          created_by: actorId,
        },
      ]);
      await repo.stockSummary.applyChanges([
        { productId: req.product_id, warehouseId: req.warehouse_id, locationId, delta },
      ]);
      documentId = doc.document_id;
    }
    const [row] = await query<AssignRequest>(
      `UPDATE location_assign_requests
          SET status='APPROVED', decided_by=$2, decided_at=now(), decision_note=$3,
              qty_at_decision=$4, document_id=$5
        WHERE request_id=$1 RETURNING *`,
      [id, actorId, decisionNote, current, documentId]
    );
    return { request: row, previous_qty: current, delta, document_id: documentId };
  });
}

export async function rejectAssignRequest(id: string, actorId: string, decisionNote = "") {
  return withDatabaseTransaction(async () => {
    await lockPending(id);
    const [row] = await query<AssignRequest>(
      `UPDATE location_assign_requests
          SET status='REJECTED', decided_by=$2, decided_at=now(), decision_note=$3
        WHERE request_id=$1 RETURNING *`,
      [id, actorId, decisionNote]
    );
    return row;
  });
}

export const sameWarehouse = (a: string, b: string) => normalizeWarehouseId(a) === normalizeWarehouseId(b);

// ---------- แก้ไขคำขอ (เฉพาะ PENDING) ----------

export interface AssignRequestEdit {
  edit_id: string;
  request_id: string;
  edited_by: string;
  edited_by_name?: string;
  edited_at: string;
  old_target_qty: number;
  new_target_qty: number;
  old_note: string;
  new_note: string;
  old_location_id: string;
  new_location_id: string;
  old_location_code: string;
  new_location_code: string;
}

const EDITS_TABLE_MISSING = "ยังไม่ได้สร้างตารางประวัติการแก้ไข (location_assign_request_edits) — แจ้งผู้ดูแลให้รัน migration";
const pgCode = (e: unknown) => (e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "");

/**
 * แก้ไขคำขอที่ยัง PENDING: target_qty / note / ตำแหน่ง
 * - ล็อกแถว FOR UPDATE + ตรวจสถานะ
 * - ผู้แก้ไข: ผู้ขอเอง หรือ ADMIN (ตรวจที่ route)
 * - เปลี่ยนตำแหน่ง: resolve รหัสในโกดังเดียวกันแบบเดียวกับตอนสร้าง, ห้ามชนคำขอ PENDING อื่น / แถวอื่นในชุดเดียวกัน
 * - บันทึกประวัติในทรานแซกชันเดียวกัน — ถ้าตารางประวัติยังไม่มี ทั้งหมด rollback (ไม่แตะสต็อกอยู่แล้ว)
 */
export async function editAssignRequest(
  id: string,
  actor: { id: string; isAdmin: boolean },
  changes: { target_qty?: number; note?: string; location_code?: string }
) {
  return withDatabaseTransaction(async () => {
    const req = await lockPending(id);
    if (!actor.isAdmin && req.requested_by !== actor.id) {
      throw new AssignRequestError("แก้ไขได้เฉพาะผู้ขอหรือผู้ดูแลระบบ (ADMIN)", 403);
    }
    const oldTarget = num(req.target_qty);
    const newTarget = changes.target_qty ?? oldTarget;
    const newNote = changes.note ?? req.note;
    let newLocId = req.location_id;
    let newCode = req.location_code;
    let newQtyAtRequest = num(req.qty_at_request);

    if (changes.location_code !== undefined) {
      const code = changes.location_code.trim().toUpperCase();
      if (code !== (req.location_code || "").toUpperCase()) {
        if (!code) throw new AssignRequestError("เปลี่ยนเป็น 'ไม่ระบุ' ไม่ได้ — ใช้การปฏิเสธแล้วขอใหม่แทน");
        // resolve แบบเดียวกับตอนสร้าง: ตำแหน่งที่มีอยู่ในโกดัง → location_id จริง, ไม่มี → ใช้รหัส (resolve ตอนอนุมัติ)
        const [loc] = await query<{ location_id: string }>(
          "SELECT location_id FROM locations WHERE warehouse_id=$1 AND upper(trim(location_code))=$2 LIMIT 1",
          [req.warehouse_id, code]
        );
        newLocId = loc?.location_id ?? code;
        newCode = code;
        const clash = await query<{ request_id: string; batch_id: string; status: string }>(
          `SELECT request_id, batch_id, status FROM location_assign_requests
            WHERE warehouse_id=$1 AND product_id=$2 AND request_id<>$3
              AND (location_id=$4 OR upper(location_code)=$5)
              AND (status='PENDING' OR batch_id=$6)`,
          [req.warehouse_id, req.product_id, id, newLocId, code, req.batch_id]
        );
        if (clash.length) {
          throw new AssignRequestError(`ตำแหน่ง ${code} มีคำขออยู่แล้ว (รออนุมัติหรืออยู่ในชุดเดียวกัน)`, 409);
        }
        const [cur] = await query<{ quantity: number }>(
          `SELECT s.quantity FROM stock_summary s LEFT JOIN locations l ON l.location_id=s.location_id
            WHERE s.product_id=$1 AND s.warehouse_id=$2 AND (s.location_id=$3 OR upper(l.location_code)=$4) LIMIT 1`,
          [req.product_id, req.warehouse_id, newLocId, code]
        );
        newQtyAtRequest = cur ? num(cur.quantity) : 0;
      }
    }

    if (newTarget === oldTarget && newNote === req.note && newLocId === req.location_id) {
      throw new AssignRequestError("ไม่มีการเปลี่ยนแปลง");
    }

    try {
      await query(
        `INSERT INTO location_assign_request_edits
           (edit_id,request_id,edited_by,old_target_qty,new_target_qty,old_note,new_note,
            old_location_id,new_location_id,old_location_code,new_location_code,old_qty_at_request,new_qty_at_request)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          `lare-${randomUUID()}`, id, actor.id, oldTarget, newTarget, req.note, newNote,
          req.location_id, newLocId, req.location_code, newCode, num(req.qty_at_request), newQtyAtRequest,
        ]
      );
    } catch (e) {
      if (pgCode(e) === "42P01" || pgCode(e) === "42501") throw new AssignRequestError(EDITS_TABLE_MISSING, 503);
      throw e;
    }
    try {
      const [row] = await query<AssignRequest>(
        `UPDATE location_assign_requests
            SET target_qty=$2, note=$3, location_id=$4, location_code=$5, qty_at_request=$6
          WHERE request_id=$1 AND status='PENDING' RETURNING *`,
        [id, newTarget, newNote, newLocId, newCode, newQtyAtRequest]
      );
      return row;
    } catch (e) {
      if (pgCode(e) === "23505") throw new AssignRequestError("ตำแหน่งนี้มีคำขอรออนุมัติอยู่แล้ว", 409);
      throw e;
    }
  });
}

export async function listAssignRequestEdits(id: string): Promise<AssignRequestEdit[]> {
  try {
    const rows = await query<AssignRequestEdit>(
      `SELECT e.*, coalesce(u.full_name, e.edited_by) AS edited_by_name
         FROM location_assign_request_edits e LEFT JOIN users u ON u.user_id=e.edited_by
        WHERE e.request_id=$1 ORDER BY e.edited_at DESC`,
      [id]
    );
    return rows.map((r) => ({ ...r, old_target_qty: num(r.old_target_qty), new_target_qty: num(r.new_target_qty) }));
  } catch (e) {
    if (pgCode(e) === "42P01" || pgCode(e) === "42501") throw new AssignRequestError(EDITS_TABLE_MISSING, 503);
    throw e;
  }
}

export async function getAssignRequest(id: string): Promise<AssignRequest | null> {
  const [row] = await query<AssignRequest>("SELECT * FROM location_assign_requests WHERE request_id=$1", [id]);
  return row ?? null;
}

// ---------- ทำงานทั้งชุด (1 แถวบนจอ = batch_id + สินค้า) ----------

async function lockBatch(batchId: string): Promise<AssignRequest[]> {
  const rows = await query<AssignRequest>(
    "SELECT * FROM location_assign_requests WHERE batch_id=$1 ORDER BY location_code FOR UPDATE",
    [batchId]
  );
  if (!rows.length) throw new AssignRequestError("ไม่พบคำขอนี้", 404);
  if (new Set(rows.map((r) => `${r.warehouse_id}|${r.product_id}`)).size > 1) {
    throw new AssignRequestError("ชุดคำขอนี้มีหลายสินค้า/โกดัง — ไม่รองรับ", 409);
  }
  if (rows.some((r) => r.status !== "PENDING")) {
    throw new AssignRequestError("ชุดคำขอนี้ไม่ได้อยู่ในสถานะรออนุมัติทั้งหมดแล้ว", 409);
  }
  return rows;
}

export async function getAssignBatch(batchId: string): Promise<AssignRequest[]> {
  return query<AssignRequest>("SELECT * FROM location_assign_requests WHERE batch_id=$1 ORDER BY location_code", [batchId]);
}

/** อนุมัติทั้งชุดในทรานแซกชันเดียว — แถวใดล้มเหลว = ไม่มีอะไรถูกบันทึกเลย */
export async function approveAssignBatch(batchId: string, actorId: string, decisionNote = "") {
  return withDatabaseTransaction(async () => {
    const rows = await lockBatch(batchId);
    const results = [];
    for (const r of rows) results.push(await approveAssignRequest(r.request_id, actorId, decisionNote));
    return { batch_id: batchId, lines: results.map((x) => ({ request_id: x.request.request_id, location_code: x.request.location_code, previous_qty: x.previous_qty, target_qty: num(x.request.target_qty), delta: x.delta, document_id: x.document_id })) };
  });
}

export async function rejectAssignBatch(batchId: string, actorId: string, decisionNote = "") {
  return withDatabaseTransaction(async () => {
    await lockBatch(batchId);
    const rows = await query<AssignRequest>(
      `UPDATE location_assign_requests SET status='REJECTED', decided_by=$2, decided_at=now(), decision_note=$3
        WHERE batch_id=$1 AND status='PENDING' RETURNING *`,
      [batchId, actorId, decisionNote]
    );
    return { batch_id: batchId, rejected: rows.length };
  });
}

/** แก้ไขทั้งชุด (PENDING เท่านั้น): จำนวน/ตำแหน่งรายแถว + หมายเหตุของชุด, เก็บประวัติรายแถว */
export async function editAssignBatch(
  batchId: string,
  actor: { id: string; isAdmin: boolean },
  input: { note?: string; lines: { request_id: string; target_qty?: number; location_code?: string }[] }
) {
  return withDatabaseTransaction(async () => {
    const rows = await lockBatch(batchId);
    if (!actor.isAdmin && rows.some((r) => r.requested_by !== actor.id)) {
      throw new AssignRequestError("แก้ไขได้เฉพาะผู้ขอหรือผู้ดูแลระบบ (ADMIN)", 403);
    }
    const byId = new Map(rows.map((r) => [r.request_id, r]));
    for (const l of input.lines) if (!byId.has(l.request_id)) throw new AssignRequestError("แถวไม่อยู่ในชุดคำขอนี้");
    // ห้ามตั้งรหัสซ้ำกันภายในชุด
    const codes = rows.map((r) => {
      const l = input.lines.find((x) => x.request_id === r.request_id);
      return (l?.location_code ?? r.location_code).trim().toUpperCase();
    });
    if (new Set(codes).size !== codes.length) throw new AssignRequestError("ตำแหน่งในชุดเดียวกันซ้ำกัน");
    let changed = 0;
    for (const r of rows) {
      const l = input.lines.find((x) => x.request_id === r.request_id);
      const ch = {
        target_qty: l?.target_qty,
        location_code: l?.location_code,
        note: input.note,
      };
      const same =
        (ch.target_qty === undefined || ch.target_qty === num(r.target_qty)) &&
        (ch.location_code === undefined || ch.location_code.trim().toUpperCase() === (r.location_code || "").toUpperCase()) &&
        (ch.note === undefined || ch.note === r.note);
      if (same) continue;
      await editAssignRequest(r.request_id, actor, ch);
      changed += 1;
    }
    if (!changed) throw new AssignRequestError("ไม่มีการเปลี่ยนแปลง");
    return { batch_id: batchId, changed, requests: await getAssignBatch(batchId) };
  });
}

export async function listAssignBatchEdits(batchId: string): Promise<AssignRequestEdit[]> {
  try {
    const rows = await query<AssignRequestEdit>(
      `SELECT e.*, coalesce(u.full_name, e.edited_by) AS edited_by_name
         FROM location_assign_request_edits e
         JOIN location_assign_requests r ON r.request_id=e.request_id
         LEFT JOIN users u ON u.user_id=e.edited_by
        WHERE r.batch_id=$1 ORDER BY e.edited_at DESC`,
      [batchId]
    );
    return rows.map((r) => ({ ...r, old_target_qty: num(r.old_target_qty), new_target_qty: num(r.new_target_qty) }));
  } catch (e) {
    if (pgCode(e) === "42P01" || pgCode(e) === "42501") throw new AssignRequestError(EDITS_TABLE_MISSING, 503);
    throw e;
  }
}

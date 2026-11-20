import { z } from "zod";
import { normalizeReceiveScanCode } from "@/features/receive/utils";
import { query, withDatabaseTransaction } from "@/server/repositories/postgres/database";
import { authorize, PERMISSIONS, type Actor } from "@/server/security";
import type { CountEntry, CountProduct, CountRound, RoundReport, ScannedCountProduct } from "@/types/count-round";

const context = { warehouse: z.string().trim().min(1), round: z.uuid() };
const shelf = z.string().trim().min(1).max(200);
const item = { ...context, shelf, product: z.string().min(1) };
const quantity = z.number().min(0).max(99999999999.999).multipleOf(0.001);
export const countCommand = z.discriminatedUnion("action", [
  z.object({ ...context, action: z.literal("start") }),
  z.object({ ...item, action: z.literal("claim") }),
  z.object({ ...item, action: z.literal("scan"), request: z.uuid(), quantity }),
  z.object({ ...item, action: z.literal("save"), request: z.uuid(), previous: z.uuid().nullable(),
    mode: z.enum(["set", "add"]), quantity }),
  z.object({ ...context, action: z.literal("finish"), shelf }),
  z.object({ ...context, action: z.literal("close") }),
]);

export class CountProblem extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}

export async function listRounds(warehouse: string) {
  return query<CountRound>("select * from stock_count_rounds where warehouse_id=$1 order by opened_at desc", [warehouse]);
}

async function findRound(warehouse: string, id: string) {
  const [round] = await query<CountRound>("select * from stock_count_rounds where warehouse_id=$1 and round_id=$2", [warehouse, id]);
  if (!round) throw new CountProblem("ไม่พบรอบตรวจนับในโกดังนี้", 404);
  return round;
}

export async function findCountProduct(scan: string) {
  const products = await query<ScannedCountProduct>(`select product_id, sku, product_name, base_unit, barcode from products
    where active and (upper(sku)=upper($1) or barcode=$1) limit 2`, [normalizeReceiveScanCode(scan)]);
  if (products.length !== 1) throw new CountProblem(products.length ? "รหัสตรงกับสินค้ามากกว่าหนึ่งรายการ" : "ไม่พบสินค้าที่เปิดใช้งานตามรหัสนี้", 400);
  return products[0];
}

export async function roundReport(warehouse: string, id: string): Promise<RoundReport> {
  const round = await findRound(warehouse, id);
  const entries = await query<RoundReport["entries"][number]>(`select distinct on (e.shelf_code, e.product_id)
      e.shelf_code, e.product_id, e.request_id, e.sku, e.product_name, e.base_unit,
      e.quantity, e.counter_name, e.counted_at, p.barcode
      from stock_count_entries e join products p on p.product_id = e.product_id
      where e.round_id=$1 order by e.shelf_code, e.product_id, e.revision desc`, [id]);
  // Older open tabs still read the shelves array.
  return { round, entries, shelves: [] };
}

// The shared write transaction serializes competing writers across app instances.
// Round closure, revision checks and the receipt commit together.
export function runCountCommand(cmd: z.infer<typeof countCommand>, actor: Actor) {
  authorize(actor, PERMISSIONS.STOCK_COUNT, cmd.warehouse);
  return withDatabaseTransaction(async () => {
    const { round: id, warehouse } = cmd;
    if (cmd.action === "start") {
      const [wh] = await query("select 1 from warehouses where active and warehouse_id=$1", [warehouse]);
      if (!wh) throw new CountProblem("ไม่พบโกดังที่เปิดใช้งาน", 400);
      await query(`insert into stock_count_rounds(round_id, warehouse_id, opened_by)
        values($1,$2,$3) on conflict do nothing`, [id, warehouse, actor.id]);
      const [round] = await query<CountRound>(`select * from stock_count_rounds where warehouse_id=$1
        and (round_id=$2 or closed_at is null) order by (round_id=$2) desc limit 1`, [warehouse, id]);
      if (!round) throw new CountProblem("กรุณาโหลดรายการรอบใหม่");
      return round;
    }
    const round = await findRound(warehouse, id);
    if (cmd.action === "save" || cmd.action === "scan") {
      const [receipt] = await query("select * from stock_count_entries where request_id=$1", [cmd.request]);
      if (receipt) {
        if (receipt.round_id !== id || receipt.counted_by !== actor.id || receipt.shelf_code.toUpperCase() !== cmd.shelf.toUpperCase() ||
          receipt.product_id !== cmd.product || receipt.entered_qty !== cmd.quantity || receipt.mode !== (cmd.action === "scan" ? "add" : cmd.mode) ||
          (cmd.action === "save" && receipt.previous_id !== cmd.previous)) throw new CountProblem("รหัสคำขอนี้ถูกใช้กับข้อมูลอื่นแล้ว");
        return receipt;
      }
    }
    if (round.closed_at) throw new CountProblem("รอบนี้จบแล้ว กรุณาโหลดรอบใหม่");
    if (cmd.action === "close") {
      if (round.opened_by !== actor.id) authorize(actor, PERMISSIONS.STOCK_COUNT_APPROVE, warehouse);
      await query("update stock_count_rounds set closed_at=now() where round_id=$1", [id]);
      return { closed: true };
    }
    if (cmd.action === "finish") {
      // Compatibility for clients that still offer a finish-shelf button.
      return { shelf_code: cmd.shelf };
    }
    const [product] = await query<CountProduct>("select product_id, sku, product_name, base_unit from products where active and product_id=$1", [cmd.product]);
    if (!product) throw new CountProblem("ไม่พบสินค้าที่เปิดใช้งาน", 400);
    const codes = await query<{ code: string }>(`select location_id, location_code as code from locations
      where warehouse_id=$1 and active and upper(location_code)=upper($2)
      union select l.location_id, s.shelf_code from shelves s join locations l using(location_id)
      where l.warehouse_id=$1 and l.active and s.active and upper(s.shelf_code)=upper($2)`, [warehouse, cmd.shelf]);
    if (codes.length !== 1) throw new CountProblem(codes.length ? "รหัสชั้นซ้ำในโกดัง กรุณาตรวจสอบป้าย" : "ไม่พบชั้นที่เปิดใช้งานในโกดังนี้", 400);
    const code = codes[0].code;
    const [previous] = await latestEntry(id, code, cmd.product);
    if (cmd.action === "claim") return { shelf: code, previous: previous ?? null };
    if (cmd.action === "save" && (previous?.request_id ?? null) !== cmd.previous) {
      throw new CountProblem("ยอดเดิมเปลี่ยนแล้ว กรุณาสแกนชั้นใหม่เพื่อดูยอดล่าสุด");
    }
    const mode = cmd.action === "scan" ? "add" : cmd.mode;
    const total = mode === "add" ? Math.round(((previous?.quantity ?? 0) + cmd.quantity) * 1000) / 1000 : cmd.quantity;
    if (total > 99999999999.999) throw new CountProblem("จำนวนรวมเกินที่รองรับ", 400);
    // The existing receipt schema references one shelf row per round.
    await query(`insert into stock_count_shelves(round_id,shelf_code,counted_by,counter_name,expires_at,finished_at)
      values($1,$2,$3,$4,now(),now()) on conflict(round_id,shelf_code) do nothing`, [id, code, actor.id, actor.username]);
    const [saved] = await query<CountEntry>(`insert into stock_count_entries(request_id, round_id, shelf_code, product_id,
      sku, product_name, base_unit, quantity, entered_qty, mode, previous_id, revision, counted_by, counter_name)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning *`,
      [cmd.request, id, code, product.product_id, product.sku, product.product_name, product.base_unit, total,
        cmd.quantity, mode, previous?.request_id ?? null, (previous?.revision ?? 0) + 1, actor.id, actor.username]);
    return saved;
  });
}

function latestEntry(round: string, code: string, product: string) {
  return query<CountEntry & { revision: number }>(`select * from stock_count_entries where round_id=$1
    and shelf_code=$2 and product_id=$3 order by revision desc limit 1`, [round, code, product]);
}

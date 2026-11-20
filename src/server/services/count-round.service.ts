import { z } from "zod";
import { normalizeReceiveScanCode } from "@/features/receive/utils";
import { query, withDatabaseTransaction } from "@/server/repositories/postgres/database";
import { authorize, PERMISSIONS, type Actor } from "@/server/security";
import type { CountEntry, CountProduct, CountRound, CountShelf, RoundReport, ScannedCountProduct } from "@/types/count-round";

const context = { warehouse: z.string().trim().min(1), round: z.uuid() };
const shelf = z.string().trim().min(1).max(200);
const item = { ...context, shelf, product: z.string().min(1) };
export const countCommand = z.discriminatedUnion("action", [
  z.object({ ...context, action: z.literal("start") }),
  z.object({ ...item, action: z.literal("claim") }),
  z.object({ ...item, action: z.literal("save"), request: z.uuid(), previous: z.uuid().nullable(),
    mode: z.enum(["set", "add"]), quantity: z.number().min(0).max(99999999999.999).multipleOf(0.001) }),
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
  const [entries, shelves] = await Promise.all([
    query<RoundReport["entries"][number]>(`select distinct on (e.shelf_code, e.product_id)
      e.shelf_code, e.product_id, e.request_id, e.sku, e.product_name, e.base_unit,
      e.quantity, e.counter_name, e.counted_at, p.barcode
      from stock_count_entries e join products p on p.product_id = e.product_id
      where e.round_id=$1 order by e.shelf_code, e.product_id, e.revision desc`, [id]),
    query<CountShelf>(`select shelf_code, counted_by, counter_name, finished_at,
      finished_at is null and expires_at > now() as occupied from stock_count_shelves where round_id=$1 order by shelf_code`, [id]),
  ]);
  return { round, shelves, entries };
}

// The shared write transaction serializes competing writers across app instances.
// Round closure, lease ownership, revision checks and the receipt commit together.
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
    if (cmd.action === "save") {
      const [receipt] = await query("select * from stock_count_entries where request_id=$1", [cmd.request]);
      if (receipt) {
        if (receipt.round_id !== id || receipt.counted_by !== actor.id || receipt.shelf_code !== cmd.shelf ||
          receipt.product_id !== cmd.product || receipt.entered_qty !== cmd.quantity || receipt.mode !== cmd.mode ||
          receipt.previous_id !== cmd.previous) throw new CountProblem("รหัสคำขอนี้ถูกใช้กับข้อมูลอื่นแล้ว");
        return receipt;
      }
    }
    if (round.closed_at) throw new CountProblem("รอบนี้จบแล้ว กรุณาโหลดรอบใหม่");
    if (cmd.action === "close") {
      if (round.opened_by !== actor.id) authorize(actor, PERMISSIONS.STOCK_COUNT_APPROVE, warehouse);
      const [busy] = await query("select shelf_code from stock_count_shelves where round_id=$1 and finished_at is null and expires_at>now() limit 1", [id]);
      if (busy) throw new CountProblem(`ยังมีผู้ตรวจนับชั้น ${busy.shelf_code} กรุณาจบงานที่ชั้นก่อน`);
      await query("update stock_count_rounds set closed_at=now() where round_id=$1", [id]);
      return { closed: true };
    }
    if (cmd.action === "finish") {
      const [owned] = await query("update stock_count_shelves set finished_at=now() where round_id=$1 and shelf_code=$2 and counted_by=$3 returning shelf_code", [id, cmd.shelf, actor.id]);
      if (!owned) throw new CountProblem("ชั้นนี้อยู่กับผู้ตรวจนับคนอื่น");
      return owned;
    }
    const [product] = await query<CountProduct>("select product_id, sku, product_name, base_unit from products where active and product_id=$1", [cmd.product]);
    if (!product) throw new CountProblem("ไม่พบสินค้าที่เปิดใช้งาน", 400);
    if (cmd.action === "claim") {
      const codes = await query<{ code: string }>(`select location_id, location_code as code from locations
        where warehouse_id=$1 and active and upper(location_code)=upper($2)
        union select l.location_id, s.shelf_code from shelves s join locations l using(location_id)
        where l.warehouse_id=$1 and l.active and s.active and upper(s.shelf_code)=upper($2)`, [warehouse, cmd.shelf]);
      if (codes.length !== 1) throw new CountProblem(codes.length ? "รหัสชั้นซ้ำในโกดัง กรุณาตรวจสอบป้าย" : "ไม่พบชั้นที่เปิดใช้งานในโกดังนี้", 400);
      const code = codes[0].code;
      const [claim] = await query(`insert into stock_count_shelves(round_id,shelf_code,counted_by,counter_name,expires_at)
        values($1,$2,$3,$4,now()+interval '30 minutes') on conflict(round_id,shelf_code) do update
        set counted_by=excluded.counted_by,counter_name=excluded.counter_name,expires_at=excluded.expires_at,finished_at=null
        where stock_count_shelves.counted_by=$3 or stock_count_shelves.finished_at is not null
          or stock_count_shelves.expires_at<=now() returning shelf_code`, [id, code, actor.id, actor.username]);
      if (!claim) {
        const [owner] = await query("select counter_name from stock_count_shelves where round_id=$1 and shelf_code=$2", [id, code]);
        throw new CountProblem(`${owner.counter_name} กำลังนับชั้น ${code}`);
      }
      const [previous] = await latestEntry(id, code, cmd.product);
      return { shelf: code, previous: previous ?? null };
    }
    const [lease] = await query(`update stock_count_shelves set expires_at=now()+interval '30 minutes'
      where round_id=$1 and shelf_code=$2 and counted_by=$3 and finished_at is null and expires_at>now() returning shelf_code`,
      [id, cmd.shelf, actor.id]);
    if (!lease) throw new CountProblem("สิทธิ์นับชั้นหมดอายุ กรุณาสแกนชั้นอีกครั้ง");
    const [previous] = await latestEntry(id, cmd.shelf, cmd.product);
    if ((previous?.request_id ?? null) !== cmd.previous) throw new CountProblem("ยอดเดิมเปลี่ยนแล้ว กรุณาสแกนชั้นใหม่เพื่อดูยอดล่าสุด");
    const total = cmd.mode === "add" ? Math.round(((previous?.quantity ?? 0) + cmd.quantity) * 1000) / 1000 : cmd.quantity;
    if (total > 99999999999.999) throw new CountProblem("จำนวนรวมเกินที่รองรับ", 400);
    const [saved] = await query<CountEntry>(`insert into stock_count_entries(request_id, round_id, shelf_code, product_id,
      sku, product_name, base_unit, quantity, entered_qty, mode, previous_id, revision, counted_by, counter_name)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning *`,
      [cmd.request, id, cmd.shelf, product.product_id, product.sku, product.product_name, product.base_unit, total,
        cmd.quantity, cmd.mode, cmd.previous, (previous?.revision ?? 0) + 1, actor.id, actor.username]);
    return saved;
  });
}

function latestEntry(round: string, code: string, product: string) {
  return query<CountEntry & { revision: number }>(`select * from stock_count_entries where round_id=$1
    and shelf_code=$2 and product_id=$3 order by revision desc limit 1`, [round, code, product]);
}

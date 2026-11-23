import { z } from "zod";
import { getCountPositions } from "@/lib/stock-count-positions";
import { normalizeReceiveScanCode } from "@/features/receive/utils";
import { query, withDatabaseTransaction } from "@/server/repositories/postgres/database";
import { authorize, PERMISSIONS, type Actor } from "@/server/security";
import type { CountEntry, CountProduct, CountReportEntry, ScannedCountProduct } from "@/types/count-round";

export const countSubmission = z.object({
  action: z.literal("submit"),
  warehouse: z.string().trim().min(1),
  shelf: z.string().trim().min(1).max(200),
  product: z.string().min(1),
  quantity: z.number().min(0).max(99999999999.999).multipleOf(0.001),
  request: z.uuid(),
});

export class CountProblem extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}

export async function findCountProduct(scan: string) {
  const products = await query<ScannedCountProduct>(`select product_id, sku, product_name, base_unit, barcode from products
    where active and (upper(sku)=upper($1) or barcode=$1) limit 2`, [normalizeReceiveScanCode(scan)]);
  if (products.length !== 1) throw new CountProblem(products.length ? "รหัสตรงกับสินค้ามากกว่าหนึ่งรายการ" : "ไม่พบสินค้าที่เปิดใช้งานตามรหัสนี้", 400);
  return products[0];
}

export async function findCountLocation(warehouse: string, scan: string) {
  if (getCountPositions(warehouse)?.includes(scan)) return scan;
  const codes = await query<{ code: string }>(`select location_id, location_code as code from locations
    where warehouse_id=$1 and active and upper(location_code)=upper($2)
    union select l.location_id, s.shelf_code from shelves s join locations l using(location_id)
    where l.warehouse_id=$1 and l.active and s.active and upper(s.shelf_code)=upper($2)`, [warehouse, scan]);
  if (codes.length !== 1) throw new CountProblem(codes.length ? "รหัสตำแหน่งซ้ำในโกดัง กรุณาตรวจสอบป้าย" : "ไม่พบตำแหน่งในโกดังนี้", 400);
  return codes[0].code;
}

export function countReport(warehouse: string, date: string) {
  return query<CountReportEntry>(`select e.request_id, e.shelf_code, e.product_id, e.sku, e.product_name,
      e.base_unit, e.entered_qty as quantity, e.counter_name, e.counted_at, p.barcode
    from stock_count_entries e join stock_count_rounds r using(round_id)
    join products p on p.product_id=e.product_id
    where r.warehouse_id=$1 and e.counted_at >= ($2::date::timestamp at time zone 'Asia/Bangkok')
      and e.counted_at < (($2::date + 1)::timestamp at time zone 'Asia/Bangkok')
    order by e.counted_at desc, e.request_id`, [warehouse, date]);
}

export function submitCount(cmd: z.infer<typeof countSubmission>, actor: Actor) {
  authorize(actor, PERMISSIONS.STOCK_COUNT, cmd.warehouse);
  return withDatabaseTransaction(async () => {
    const [receipt] = await query<CountEntry & { counted_by: string; warehouse_id: string }>(`select e.counted_by, e.product_id, e.shelf_code,
      e.entered_qty as quantity, r.warehouse_id from stock_count_entries e join stock_count_rounds r using(round_id)
      where e.request_id=$1`, [cmd.request]);
    if (receipt) {
      if (receipt.counted_by !== actor.id || receipt.warehouse_id !== cmd.warehouse ||
        receipt.product_id !== cmd.product || receipt.shelf_code.toUpperCase() !== cmd.shelf.toUpperCase() ||
        receipt.quantity !== cmd.quantity) throw new CountProblem("รหัสคำขอนี้ถูกใช้กับข้อมูลอื่นแล้ว");
      return { quantity: receipt.quantity };
    }

    const [product] = await query<CountProduct>("select product_id, sku, product_name, base_unit from products where active and product_id=$1", [cmd.product]);
    if (!product) throw new CountProblem("ไม่พบสินค้าที่เปิดใช้งาน", 400);
    const [warehouse] = await query("select 1 from warehouses where active and warehouse_id=$1", [cmd.warehouse]);
    if (!warehouse) throw new CountProblem("ไม่พบโกดังที่เปิดใช้งาน", 400);
    const code = await findCountLocation(cmd.warehouse, cmd.shelf);
    const [round] = await query<{ round_id: string }>("select round_id from stock_count_rounds where warehouse_id=$1 and closed_at is null", [cmd.warehouse]);
    const id = round?.round_id ?? cmd.request;
    if (!round) await query("insert into stock_count_rounds(round_id,warehouse_id,opened_by) values($1,$2,$3)", [id, cmd.warehouse, actor.id]);
    await query(`insert into stock_count_shelves(round_id,shelf_code,counted_by,counter_name,expires_at,finished_at)
      values($1,$2,$3,$4,now(),now()) on conflict(round_id,shelf_code) do nothing`, [id, code, actor.id, actor.username]);
    const [previous] = await query<{ request_id: string; revision: number }>(`select request_id, revision from stock_count_entries
      where round_id=$1 and shelf_code=$2 and product_id=$3 order by revision desc limit 1`, [id, code, cmd.product]);
    await query(`insert into stock_count_entries(request_id, round_id, shelf_code, product_id, sku, product_name,
      base_unit, quantity, entered_qty, mode, previous_id, revision, counted_by, counter_name)
      values($1,$2,$3,$4,$5,$6,$7,$8,$8,'set',$9,$10,$11,$12)`,
      [cmd.request, id, code, product.product_id, product.sku, product.product_name, product.base_unit,
        cmd.quantity, previous?.request_id ?? null, (previous?.revision ?? 0) + 1, actor.id, actor.username]);
    return { quantity: cmd.quantity };
  });
}

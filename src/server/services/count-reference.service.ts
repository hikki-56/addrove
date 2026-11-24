import { isForeignWarehouseRow } from "@/lib/warehouse-utils";
import { query } from "@/server/repositories/postgres/database";
import { ensurePostgresTab, postgresTabId } from "@/server/repositories/postgres/tab-adapter";
import { randomUUID } from "node:crypto";
import { CountProblem } from "./count-problem";
import type { CountReferenceFile, CountReferenceRow, ProductComparison, DailyCountReport } from "@/types/count-round";
import { z } from "zod";

const field = z.string().trim().min(1).max(200);
export const referenceImport = z.object({
  action: z.literal("reference"), warehouse: field, name: z.string().trim().min(1).max(255),
  rows: z.array(z.object({row: z.int().positive(), code: field, shelf: z.string().trim().max(200),
    quantity: z.number().min(0).max(99999999999.999).multipleOf(0.001), warehouse: field.optional()})).min(1).max(10000)
});

const NORM = "upper(regexp_replace(trim(both from %s), '\\s+', '', 'g'))";
function normSql(expr: string) {
  return NORM.replace("%s", expr);
}

export async function warehouseReference(warehouse: string, date?: string) {
  const [file] = await query<CountReferenceFile>(`select (r.cells->>0)::bigint id, r.cells->>1 file_name,
    (r.cells->>2)::int row_count,
    case when r.cells->>4 ~ '^[0-9]+$' then (r.cells->>4)::int end as unmatched_count
    from storage_rows r join storage_tabs t using(tab_id)
    where t.name=$1 and ($2::date is null or (r.cells->>3)::date <= $2::date)
    order by row_no desc limit 1`, [`StockCountReferences/${warehouse}`, date ?? null]);
  return file ?? null;
}

// Store every product row as count-reference data only (no product/stock/Express writes).
// Unmatched or ambiguous codes stay keyed by the raw file code and are reported as a warning.
export async function importCountReference(warehouse: string, name: string, rows: CountReferenceRow[]) {
  const [wh] = await query<{ warehouse_name: string; warehouse_code: string }>(
    "select warehouse_name, warehouse_code from warehouses where warehouse_id=$1 and active", [warehouse]);
  if (!wh) throw new CountProblem("ไม่พบโกดังที่เปิดใช้งาน", 400);
  const accepted = rows.filter(r => !isForeignWarehouseRow(r.warehouse, warehouse, wh.warehouse_code, wh.warehouse_name));
  if (!accepted.length) throw new CountProblem("ไม่มีรายการสินค้าในไฟล์", 400);

  const resolved = await query<{ row: number; code: string; product_id: string | null; shelf_code: string | null; quantity: number }>(`
    with src as (select * from jsonb_to_recordset($1::jsonb) as r(row int, code text, shelf text, quantity numeric)),
    products_by_code as (
      select ${normSql("sku")} code, product_id from products where active
      union all
      select ${normSql("barcode")} code, product_id from products
        where active and coalesce(trim(barcode), '') <> ''
    ),
    unique_codes as (
      select code, min(product_id) product_id from products_by_code
      where code <> ''
      group by code having count(distinct product_id)=1
    )
    select src.row, src.code, u.product_id, src.shelf shelf_code, src.quantity from src
      left join unique_codes u on u.code=${normSql("src.code")}
    order by src.row`, [JSON.stringify(accepted)]);
  const stored = resolved.map(item => ({
    product_id: item.product_id ?? item.code.trim(),
    shelf_code: item.shelf_code ?? "",
    quantity: item.quantity,
  }));
  const unmatched_count = resolved.filter(item => !item.product_id).length;
  const registry = await ensurePostgresTab(`StockCountReferences/${warehouse}`, ["file_id", "file_name", "row_count", "import_date"]);
  const items = await ensurePostgresTab(`StockCountReferenceItems/${randomUUID()}`, ["product_id", "shelf_code", "expected_qty"]);
  const id = await postgresTabId(items);
  if (!id) throw new Error("สร้างไฟล์เทียบยอดไม่สำเร็จ");
  const file: CountReferenceFile = { id, file_name: name, row_count: accepted.length, unmatched_count };
  await query(`insert into storage_rows(tab_id,row_no,cells)
    select $1, 1 + row_number() over(order by product_id,shelf_code), jsonb_build_array(product_id,shelf_code,sum(quantity))
    from jsonb_to_recordset($2::jsonb) as r(product_id text, shelf_code text, quantity numeric)
    group by product_id, shelf_code`, [id, JSON.stringify(stored)]);
  await query(`insert into storage_rows(tab_id,row_no,cells)
    select $1, coalesce(max(row_no),1)+1, jsonb_build_array($2::bigint,$3::text,$4::int,(now() at time zone 'Asia/Bangkok')::date,$5::int)
    from storage_rows where tab_id=$1`, [await postgresTabId(registry), id, name, accepted.length, unmatched_count]);
  return file;
}

export async function productComparison(warehouse: string, product: string): Promise<ProductComparison> {
  const file = await warehouseReference(warehouse);
  if (!file) return { hasReference: false, shelves: [] };
  const shelves = await query<ProductComparison["shelves"][number]>(`
    with scanned as (
      select product_id, ${normSql("sku")} sku,
        nullif(${normSql("barcode")}, '') barcode
      from products where product_id=$2
    ),
    expected as (
      select i.cells->>1 shelf_code, (i.cells->>2)::numeric expected_qty
      from storage_rows i
      join scanned s on i.cells->>0 = s.product_id
        or ${normSql("i.cells->>0")} = s.sku
        or (s.barcode is not null and ${normSql("i.cells->>0")} = s.barcode)
      where i.tab_id=$1
    ),
    counted as (select e.shelf_code, sum(e.entered_qty) counted_qty from stock_count_entries e
      join stock_count_rounds r using(round_id) where r.warehouse_id=$3 and e.product_id=$2
      and e.counted_at >= (date_trunc('day', now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok')
      group by e.shelf_code)
    select shelf_code, expected_qty, counted_qty from expected full join counted using(shelf_code) order by shelf_code`,
    [file.id, product, warehouse]);
  return { hasReference: true, shelves };
}

export async function dailyComparison(warehouse: string, date: string, entries: DailyCountReport["entries"]): Promise<DailyCountReport> {
  const reference = await warehouseReference(warehouse, date);
  if (!reference) return { entries, reference, totals: [] };
  const expected = await query<DailyCountReport["totals"][number]>(`
    with file_rows as (
      select trim(cells->>0) code, ${normSql("cells->>0")} ncode, sum((cells->>2)::numeric) qty
      from storage_rows where tab_id=$1
      group by 1, 2
    ),
    matched as (
      select ncode, min(product_id) product_id, count(distinct product_id) hits
      from (
        select f.ncode, p.product_id
        from file_rows f
        join products p on p.active and (
          p.product_id = f.code
          or ${normSql("p.sku")} = f.ncode
          or (coalesce(trim(p.barcode), '') <> '' and ${normSql("p.barcode")} = f.ncode)
        )
      ) x
      group by ncode
    )
    select coalesce(p.product_id, f.code) product_id,
      coalesce(p.sku, f.code) sku,
      coalesce(p.product_name, f.code) product_name,
      coalesce(p.base_unit, '') base_unit,
      f.qty expected, null::numeric counted
    from file_rows f
    left join matched m on m.ncode = f.ncode and m.hits = 1
    left join products p on p.product_id = m.product_id
    order by coalesce(p.sku, f.code)`, [reference.id]);
  const totals = new Map(expected.map(row => [row.product_id, row]));
  for (const row of entries) {
    const total = totals.get(row.product_id) ?? { product_id: row.product_id, sku: row.sku, product_name: row.product_name,
      base_unit: row.base_unit, expected: null, counted: null };
    total.counted = Math.round(((total.counted ?? 0) + row.quantity) * 1000) / 1000;
    totals.set(row.product_id, total);
  }
  return { reference, entries, totals: [...totals.values()] };
}

import { isForeignWarehouseRow } from "@/lib/warehouse-utils";
import { query } from "@/server/repositories/postgres/database";
import { ensurePostgresTab, postgresTabId } from "@/server/repositories/postgres/tab-adapter";
import { randomUUID } from "node:crypto";
import { CountProblem } from "./count-problem";
import type { CountReferenceFile, CountReferenceRow, ProductComparison, DailyCountReport } from "@/types/count-round";
import { z } from "zod";

const field = z.string().trim().min(1).max(200);
const optionalCode = z.string().trim().max(200).optional().transform(value => value || undefined);
export const referenceImport = z.object({
  action: z.literal("reference"), warehouse: field, name: z.string().trim().min(1).max(255),
  rows: z.array(z.object({row: z.int().positive(), code: field, shelf: z.string().trim().max(200),
    quantity: z.number().min(0).max(99999999999.999).multipleOf(0.001), warehouse: field.optional(),
    barcode: optionalCode})).min(1).max(10000)
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
// Lookup uses the file code and optional barcode column against sku and every product barcode.
export async function importCountReference(warehouse: string, name: string, rows: CountReferenceRow[]) {
  const [wh] = await query<{ warehouse_name: string; warehouse_code: string }>(
    "select warehouse_name, warehouse_code from warehouses where warehouse_id=$1 and active", [warehouse]);
  if (!wh) throw new CountProblem("ไม่พบโกดังที่เปิดใช้งาน", 400);
  const accepted = rows.filter(r => !isForeignWarehouseRow(r.warehouse, warehouse, wh.warehouse_code, wh.warehouse_name));
  if (!accepted.length) throw new CountProblem("ไม่มีรายการสินค้าในไฟล์", 400);

  const resolved = await query<{ row: number; code: string; barcode: string | null; product_id: string | null; shelf_code: string | null; quantity: number }>(`
    with src as (select * from jsonb_to_recordset($1::jsonb) as r(row int, code text, shelf text, quantity numeric, barcode text)),
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
    ),
    looked_up as (
      select src.row, src.code, nullif(trim(src.barcode), '') barcode, src.shelf shelf_code, src.quantity,
        uc.product_id code_pid, ub.product_id bar_pid
      from src
      left join unique_codes uc on uc.code=${normSql("src.code")}
      left join unique_codes ub on nullif(trim(src.barcode), '') is not null and ub.code=${normSql("src.barcode")}
    )
    select row, code, barcode, shelf_code, quantity,
      case
        when code_pid is not null and bar_pid is not null and code_pid <> bar_pid then null
        else coalesce(code_pid, bar_pid)
      end as product_id
    from looked_up
    order by row`, [JSON.stringify(accepted)]);
  const stored = resolved.map(item => ({
    product_id: item.product_id ?? item.code.trim(),
    shelf_code: item.shelf_code ?? "",
    quantity: item.quantity,
    barcode: item.barcode?.trim() ?? "",
  }));
  const unmatched_count = resolved.filter(item => !item.product_id).length;
  const registry = await ensurePostgresTab(`StockCountReferences/${warehouse}`, ["file_id", "file_name", "row_count", "import_date"]);
  const items = await ensurePostgresTab(`StockCountReferenceItems/${randomUUID()}`, ["product_id", "shelf_code", "expected_qty", "barcode"]);
  const id = await postgresTabId(items);
  if (!id) throw new Error("สร้างไฟล์เทียบยอดไม่สำเร็จ");
  const file: CountReferenceFile = { id, file_name: name, row_count: accepted.length, unmatched_count };
  await query(`insert into storage_rows(tab_id,row_no,cells)
    select $1, 1 + row_number() over(order by product_id,shelf_code), jsonb_build_array(product_id,shelf_code,sum(quantity),nullif(max(barcode),''))
    from jsonb_to_recordset($2::jsonb) as r(product_id text, shelf_code text, quantity numeric, barcode text)
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
      select i.cells->>1 shelf_code, sum((i.cells->>2)::numeric) expected_qty
      from storage_rows i
      join scanned s on i.cells->>0 = s.product_id
        or ${normSql("i.cells->>0")} = s.sku
        or (s.barcode is not null and ${normSql("i.cells->>0")} = s.barcode)
        or (nullif(trim(i.cells->>3), '') is not null and (
          i.cells->>3 = s.product_id
          or ${normSql("i.cells->>3")} = s.sku
          or (s.barcode is not null and ${normSql("i.cells->>3")} = s.barcode)
        ))
      where i.tab_id=$1
      group by i.cells->>1
    ),
    counted as (select e.shelf_code, sum(e.entered_qty) counted_qty from stock_count_entries e
      join stock_count_rounds r using(round_id) where r.warehouse_id=$3 and e.product_id=$2
      and (r.closed_at is null
        or e.counted_at >= (date_trunc('day', now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok'))
      group by e.shelf_code)
    select shelf_code, expected_qty, counted_qty from expected full join counted using(shelf_code) order by shelf_code`,
    [file.id, product, warehouse]);
  return { hasReference: true, shelves };
}

async function referenceForComparison(warehouse: string, date: string) {
  const asOfDate = await warehouseReference(warehouse, date);
  if (asOfDate) return asOfDate;
  const latest = await warehouseReference(warehouse);
  if (!latest) return null;
  const [eligible] = await query<{ ok: boolean }>(`select exists (
      select 1 where $2::date = (now() at time zone 'Asia/Bangkok')::date
      or exists (
        select 1 from stock_count_entries e
        join stock_count_rounds r using(round_id)
        where r.warehouse_id=$1 and r.closed_at is null
          and e.counted_at >= ($2::date::timestamp at time zone 'Asia/Bangkok')
          and e.counted_at < (($2::date + 1)::timestamp at time zone 'Asia/Bangkok')
      )
    ) as ok`, [warehouse, date]);
  return eligible?.ok ? latest : null;
}

export async function dailyComparison(warehouse: string, date: string, entries: DailyCountReport["entries"]): Promise<DailyCountReport> {
  const reference = await referenceForComparison(warehouse, date);
  if (!reference) return { entries, reference, totals: [] };
  const expected = await query<DailyCountReport["totals"][number]>(`
    with file_rows as (
      select row_number() over () as id, trim(cells->>0) code, nullif(trim(cells->>3), '') barcode,
        sum((cells->>2)::numeric) qty
      from storage_rows where tab_id=$1
      group by trim(cells->>0), nullif(trim(cells->>3), '')
    ),
    catalog_keys as (
      select p.product_id, k.kind, k.value
      from products p
      cross join lateral (values
        ('id', p.product_id),
        ('code', ${normSql("p.sku")}),
        ('code', nullif(${normSql("p.barcode")}, ''))
      ) as k(kind, value)
      where p.active and k.value is not null
    ),
    file_keys as (
      select f.id, k.kind, k.value
      from file_rows f
      cross join lateral (values
        ('id', f.code), ('id', f.barcode),
        ('code', ${normSql("f.code")}), ('code', ${normSql("f.barcode")})
      ) as k(kind, value)
      where k.value is not null
    ),
    matched as (
      select f.id, min(c.product_id) product_id
      from file_keys f join catalog_keys c using(kind, value)
      group by f.id having count(distinct c.product_id) = 1
    )
    select coalesce(p.product_id, f.code) product_id,
      coalesce(p.sku, f.code) sku,
      coalesce(p.product_name, f.code) product_name,
      coalesce(p.base_unit, '') base_unit,
      f.qty expected, null::numeric counted
    from file_rows f
    left join matched m on m.id = f.id
    left join products p on p.product_id = m.product_id
    order by coalesce(p.sku, f.code)`, [reference.id]);
  const countedRows = await query<{ product_id: string; sku: string; product_name: string; base_unit: string; quantity: number }>(`
    select e.product_id, e.sku, e.product_name, e.base_unit, e.entered_qty as quantity
    from stock_count_entries e
    join stock_count_rounds r using(round_id)
    where r.warehouse_id=$1 and (
      (e.counted_at >= ($2::date::timestamp at time zone 'Asia/Bangkok')
        and e.counted_at < (($2::date + 1)::timestamp at time zone 'Asia/Bangkok'))
      or (
        r.closed_at is null
        and (
          $2::date = (now() at time zone 'Asia/Bangkok')::date
          or exists (
            select 1 from stock_count_entries e2
            where e2.round_id = r.round_id
              and e2.counted_at >= ($2::date::timestamp at time zone 'Asia/Bangkok')
              and e2.counted_at < (($2::date + 1)::timestamp at time zone 'Asia/Bangkok')
          )
        )
      )
    )`, [warehouse, date]);
  const totals = new Map<string, DailyCountReport["totals"][number]>();
  for (const row of expected) {
    const existing = totals.get(row.product_id);
    if (existing) {
      existing.expected = Math.round((((existing.expected ?? 0) + (row.expected ?? 0)) * 1000)) / 1000;
    } else {
      totals.set(row.product_id, { ...row });
    }
  }
  for (const row of countedRows) {
    const total = totals.get(row.product_id) ?? { product_id: row.product_id, sku: row.sku, product_name: row.product_name,
      base_unit: row.base_unit, expected: null, counted: null };
    total.counted = Math.round(((total.counted ?? 0) + row.quantity) * 1000) / 1000;
    totals.set(row.product_id, total);
  }
  return { reference, entries, totals: [...totals.values()] };
}

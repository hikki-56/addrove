// Prepare a reviewable, data-only import. Does not connect to or write a database.
// Usage: node scripts/database/prepare-pack-import.mjs <source.xlsx> <products.json> <output-dir> [--database-sku]
// products.json must contain sku, barcode, base_unit, active, units_per_carton.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import XLSX from 'xlsx';

const [source, snapshot, output] = process.argv.slice(2);
// Only enable after the user resolves conflicting identifiers in favor of the
// database SKU. This never changes database identifiers or follows a file barcode.
const databaseSku = process.argv.includes('--database-sku');
if (!source || !snapshot || !output) throw new Error('Supply workbook, product snapshot and output directory');
const workbook = XLSX.readFile(source);
const products = JSON.parse(fs.readFileSync(snapshot, 'utf8'));
const accepted = [], pending = [], seen = new Set();
for (const sheet of workbook.SheetNames) {
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheet], { header: 1, defval: '' });
  if (rows[0]?.[0] !== 'รหัสสินค้า') continue;
  if (rows[0][2] !== 'Pack (ชิ้น/Pack)' || rows[0][9] !== 'Barcode') throw new Error(`Unexpected columns in ${sheet}`);
  for (const [index, cells] of rows.slice(1).entries()) {
    const sku = String(cells[0]).trim(), barcode = String(cells[9]).trim(), pack = cells[2];
    if (!sku) continue;
    const entry = { sheet, row: index + 2, sku, name: cells[1], barcode, pack };
    const reject = reason => pending.push({ ...entry, reason });
    if (seen.has(sku.toLowerCase())) throw new Error(`Duplicate source SKU: ${sku}`);
    seen.add(sku.toLowerCase());
    if (pack === '' || pack === null) { reject('missing_pack'); continue; }
    if (!Number.isInteger(pack) || pack <= 0 || pack > 2147483647) { reject('invalid_pack'); continue; }
    const matches = products.filter(p => p.sku.trim().toLowerCase() === sku.toLowerCase());
    if (matches.length !== 1) { reject(matches.length ? 'ambiguous_sku' : 'missing_product'); continue; }
    const product = matches[0];
    entry.database_sku = product.sku;
    entry.database_barcode = product.barcode;
    entry.base_unit = product.base_unit;
    // Never use a conflicting barcode to silently redirect a pack to another SKU.
    if ((!barcode || barcode !== product.barcode) && !databaseSku) { reject('barcode_mismatch'); continue; }
    if (!product.active) { reject('inactive_product'); continue; }
    // Panels may contain multiple pieces; the workbook only specifies pieces.
    if (product.base_unit === 'แผง') { reject('confirm_pieces_per_panel'); continue; }
    if (product.units_per_carton != null && product.units_per_carton !== pack) { reject('existing_pack_conflict'); continue; }
    accepted.push({ ...entry, previous: product.units_per_carton });
  }
}
if (!accepted.length) throw new Error('No safe matches');
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
const values = accepted.map(r => `(${quote(r.database_sku)},${quote(r.database_barcode)},${quote(r.base_unit)},${r.pack})`).join(',\n');
// The update uses optimistic checks against the reviewed snapshot; no stock or
// document table is modified. Replays preserve identical existing pack values.
const sql = `WITH source(sku,barcode,base_unit,pack) AS (VALUES\n${values}\n), updated AS (\nUPDATE products p SET units_per_carton=s.pack FROM source s\nWHERE p.sku=s.sku AND p.barcode=s.barcode AND p.base_unit=s.base_unit AND p.active\nAND p.units_per_carton IS NULL RETURNING p.sku\n) SELECT (select count(*) from source) planned, count(*) updated FROM updated;\n`;
const report = {
  source: path.basename(source), sha256: crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex'),
  match_policy: databaseSku ? 'database_sku_keep_database_barcode' : 'sku_and_barcode',
  total: seen.size, accepted: accepted.length, pending: pending.length,
  reasons: pending.reduce((counts, r) => { counts[r.reason] = (counts[r.reason] || 0) + 1; return counts; }, {}),
};
fs.mkdirSync(output, { recursive: true });
for (const [name, value] of Object.entries({ 'accepted.json': accepted, 'pending.json': pending, 'report.json': report })) {
  fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n');
}
fs.writeFileSync(path.join(output, 'apply.sql'), sql);
const reasons = {
  missing_pack: 'ยังไม่มีจำนวนแพ็ก', invalid_pack: 'จำนวนแพ็กไม่ถูกต้อง',
  ambiguous_sku: 'รหัสสินค้าซ้ำในฐานข้อมูล', missing_product: 'ไม่พบรหัสสินค้าในฐานข้อมูล',
  barcode_mismatch: 'บาร์โค้ดในไฟล์ไม่ตรงกับรหัสสินค้าในฐานข้อมูล',
  inactive_product: 'สินค้าไม่ได้เปิดใช้งาน', confirm_pieces_per_panel: 'ต้องยืนยันจำนวนชิ้นต่อแผง',
  existing_pack_conflict: 'จำนวนแพ็กขัดแย้งกับค่าที่มีอยู่',
};
const review = pending.map(r => ({
  'ผู้จำหน่าย': r.sheet, 'แถวในไฟล์': r.row, 'SKU ในไฟล์': r.sku,
  'ชื่อสินค้า': r.name, 'จำนวนต่อแพ็ก': r.pack, 'บาร์โค้ดในไฟล์': r.barcode,
  'SKU ในฐานข้อมูล': r.database_sku || '', 'บาร์โค้ดในฐานข้อมูล': r.database_barcode || '',
  'หน่วยเดิม': r.base_unit || '', 'เหตุผล': reasons[r.reason],
}));
fs.writeFileSync(path.join(output, 'pending.csv'), '\uFEFF' + XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(review)));
console.log(JSON.stringify(report, null, 2));

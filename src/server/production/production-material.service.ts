import { query } from "@/server/repositories/postgres/database";
import { getStorageDriver } from "@/server/repositories/storage-driver";
import { getReservedEntries } from "@/server/services/outbound/stock-reservation.service";
import type { IStockRepository } from "@/server/repositories/interfaces";
import type { Document } from "@/types/models";
import type { ProductionJob, ProductionReport } from "@/types/production";
import type { ProductionBomSelection, ProductionCapacity, ProductionMaterialActual, ProductionMaterialPlan, ProductionMaterialStockLocation } from "@/types/production-bom";
import { previewProductionBom, isValidProductionStockQuantity, productionMainCapacity } from "@/lib/production-bom";
import { listProductionBoms } from "@/server/production/production-bom.service";
import { ProductionError } from "@/server/production/production-error";
import { getProductionMaterialWarehouseId, scopeProductionMaterials } from "@/server/production/production-warehouse";

const round = (n: number) => Math.round(n * 1000) / 1000;
const enabled = () => getStorageDriver() === "postgres";

export async function attachMaterialPlans(jobs: ProductionJob[]): Promise<void> {
  if (!enabled() || !jobs.length) return;
  const warehouseId = await getProductionMaterialWarehouseId();
  const rows = await query(`SELECT p.*,c.job_no AS backorder_job_no FROM production_material_plans p
    LEFT JOIN (SELECT child.* FROM production_material_plans child JOIN production_jobs j ON j.job_no=child.job_no WHERE j.deleted_at IS NULL AND j.status<>'CANCELLED') c ON c.parent_job_no=p.job_no
    WHERE p.job_no=ANY($1::text[])`, [jobs.map(j => j.job_no)]);
  for (const j of jobs) {
    const p = rows.find(p => p.job_no === j.job_no);
    if (p) j.material_plan = { snapshot: scopeProductionMaterials(p.snapshot, warehouseId), selection: p.selection, parent_job_no: p.parent_job_no || undefined, backorder_job_no: p.backorder_job_no || undefined };
  }
  const productIds = [...new Set(jobs.flatMap(j => j.material_plan?.snapshot.items.map(i => i.product_id) || []))];
  if (!productIds.length) return;
  const locations = await query<ProductionMaterialStockLocation>(`SELECT s.product_id,l.location_id,coalesce(l.location_code,'') AS location_code,coalesce(l.location_name,'') AS location_name,s.quantity
    FROM stock_summary s JOIN locations l USING(location_id)
    WHERE s.warehouse_id=$1 AND l.warehouse_id=$1 AND l.active AND s.quantity>0 AND s.product_id=ANY($2::text[])
    ORDER BY s.product_id,(l.location_code=''),l.location_code,l.location_id`, [warehouseId, productIds]);
  for (const j of jobs) {
    if (!j.material_plan) continue;
    const materials = new Set(j.material_plan.snapshot.items.map(i => i.product_id));
    j.material_plan.stock_locations = locations.filter(l => materials.has(l.product_id));
  }
}

export async function getMaterialPlan(jobNo: string): Promise<ProductionMaterialPlan | null> {
  if (!enabled()) return null;
  const [p] = await query("SELECT * FROM production_material_plans WHERE job_no=$1", [jobNo]);
  return p ? { snapshot: scopeProductionMaterials(p.snapshot, await getProductionMaterialWarehouseId()), selection: p.selection, parent_job_no: p.parent_job_no || undefined } : null;
}

export async function saveMaterialPlan(job: Pick<ProductionJob, "job_no" | "product_id" | "target_qty">, selection?: ProductionBomSelection): Promise<ProductionMaterialPlan | null> {
  if (!enabled()) return null;
  if (!selection) return getMaterialPlan(job.job_no);
  const formula = (await listProductionBoms(job.product_id)).find(f => f.bom_id === selection.bom_id);
  if (!formula) throw new ProductionError("ไม่พบสูตรที่เปิดใช้งานสำหรับสินค้าที่เลือก");
  if (selection.revision && selection.revision !== formula.revision) throw new ProductionError("สูตรเปลี่ยนหลังจากเปิดฟอร์ม กรุณาโหลดสูตรใหม่ก่อนบันทึก", 409);
  const preview = previewProductionBom(formula, job.target_qty, selection);
  if (preview.issues.length) throw new ProductionError(preview.issues.join(" · "));
  await query(`INSERT INTO production_material_plans(job_no,snapshot,selection) VALUES($1,$2::jsonb,$3::jsonb)
    ON CONFLICT(job_no) DO UPDATE SET snapshot=excluded.snapshot,selection=excluded.selection`, [job.job_no, JSON.stringify(formula), JSON.stringify(selection)]);
  return { snapshot: formula, selection };
}

export async function cloneMaterialPlan(parentNo: string, childNo: string, reportId: string): Promise<void> {
  await query(`INSERT INTO production_material_plans(job_no,snapshot,selection,parent_job_no,backorder_report_id)
    SELECT $2,snapshot,selection,job_no,$3 FROM production_material_plans WHERE job_no=$1`, [parentNo, childNo, reportId]);
}

export async function releaseMaterialReservations(jobNo: string): Promise<void> {
  if (enabled()) await query("DELETE FROM production_material_reservations WHERE job_no=$1", [jobNo]);
}

async function availableStock(repo: IStockRepository, productId: string, warehouseId: string, excludeJob: string): Promise<number> {
  const [row] = await query(`SELECT
    coalesce((SELECT sum(s.quantity) FROM stock_summary s JOIN locations l USING(location_id) WHERE s.product_id=$1 AND s.warehouse_id=$2 AND l.active),0)
    -coalesce((SELECT sum(quantity) FROM production_material_reservations WHERE product_id=$1 AND warehouse_id=$2 AND job_no<>$3),0) AS available`, [productId, warehouseId, excludeJob]);
  // Outbound reservations are warehouse-wide; subtract conservatively from this source.
  const outbound = (await getReservedEntries(repo)).filter(e => e.product_id === productId).reduce((n, e) => n + e.qty, 0);
  return round(Number(row.available) - outbound);
}

export async function reserveJobMaterials(repo: IStockRepository, job: Pick<ProductionJob, "job_no" | "remaining_qty">, strict = true): Promise<void> {
  if (!enabled()) return;
  const p = await getMaterialPlan(job.job_no);
  if (!p) throw new ProductionError(`${job.job_no}: กรุณาเปิดแก้ไขงาน ระบบจะจับคู่สูตรจากสินค้าให้อัตโนมัติ แล้วตรวจวัตถุดิบและระบุอัตราแปลงหน่วยที่ยังขาดก่อนส่งผลิต`);
  await releaseMaterialReservations(job.job_no);
  if (job.remaining_qty <= 0) return;
  const preview = previewProductionBom(p.snapshot, job.remaining_qty, p.selection);
  if (preview.issues.length) throw new ProductionError(preview.issues.join(" · "));
  const totals = new Map<string, { product_id: string; warehouse_id: string; qty: number; sku: string }>();
  for (const i of preview.materials) {
    const key = i.product_id + "\0" + i.warehouse_id;
    const old = totals.get(key);
    totals.set(key, { product_id: i.product_id, warehouse_id: i.warehouse_id, qty: round((old?.qty || 0) + i.stock_qty!), sku: i.sku });
  }
  for (const i of totals.values()) {
    const available = Math.max(0, await availableStock(repo, i.product_id, i.warehouse_id, job.job_no));
    if (strict && available < i.qty) throw new ProductionError(`${i.sku}: วัตถุดิบพร้อมใช้ ${available} ต้องการ ${i.qty} ยังขาด ${round(i.qty - available)}`);
    await query("INSERT INTO production_material_reservations(job_no,product_id,warehouse_id,quantity) VALUES($1,$2,$3,$4)", [job.job_no, i.product_id, i.warehouse_id, Math.min(available, i.qty)]);
  }
}

export async function listProductionCapacities(repo: IStockRepository, excludeJob = ""): Promise<ProductionCapacity[]> {
  if (!enabled()) return [];
  const formulas = await listProductionBoms();
  const warehouseId = await getProductionMaterialWarehouseId();
  const [stocks, reservations, outbound, saved] = await Promise.all([
    query("SELECT s.product_id,sum(s.quantity) AS quantity FROM stock_summary s JOIN locations l USING(location_id) WHERE s.warehouse_id=$1 AND l.active GROUP BY s.product_id", [warehouseId]),
    query("SELECT product_id,sum(quantity) AS quantity FROM production_material_reservations WHERE warehouse_id=$1 AND job_no<>$2 GROUP BY product_id", [warehouseId, excludeJob]),
    getReservedEntries(repo),
    excludeJob ? getMaterialPlan(excludeJob) : Promise.resolve(null),
  ]);
  const available = new Map<string, number>(stocks.map(i => [String(i.product_id), Number(i.quantity)]));
  for (const i of reservations) available.set(String(i.product_id), (available.get(String(i.product_id)) || 0) - Number(i.quantity));
  for (const i of outbound) available.set(i.product_id, (available.get(i.product_id) || 0) - i.qty);
  const products = new Map<string, ProductionCapacity>();
  for (const formula of formulas) {
    if (products.has(formula.product_id)) continue;
    const matching = saved?.snapshot.bom_id === formula.bom_id ? saved : null;
    products.set(formula.product_id, { product_id: formula.product_id, bom_id: formula.bom_id, unit: matching?.snapshot.unit || formula.unit,
      quantity: productionMainCapacity(matching?.snapshot || formula, matching?.selection || {}, (id, wh) => wh === warehouseId ? available.get(id) || 0 : 0) });
  }
  return [...products.values()];
}

export async function previewMaterialAvailability(repo: IStockRepository, productId: string, targetQty: number, selection: ProductionBomSelection, excludeJob = "") {
  const formula = (await listProductionBoms(productId)).find(f => f.bom_id === selection.bom_id);
  if (!formula) throw new ProductionError("ไม่พบสูตรสำหรับสินค้านี้");
  const preview = previewProductionBom(formula, targetQty, selection);
  for (const i of preview.materials) {
    const [onhand] = await query("SELECT coalesce(sum(s.quantity),0) AS qty FROM stock_summary s JOIN locations l USING(location_id) WHERE s.product_id=$1 AND s.warehouse_id=$2 AND l.active", [i.product_id, i.warehouse_id]);
    i.on_hand = Number(onhand.qty);
    i.available = Math.max(0, await availableStock(repo, i.product_id, i.warehouse_id, excludeJob));
    i.reserved = round(i.on_hand - i.available);
    i.shortage = i.stock_qty === null ? undefined : Math.max(0, round(i.stock_qty - i.available));
  }
  preview.main_capacity = productionMainCapacity(formula, selection, (id, wh) => preview.materials.find(i => i.product_id === id && i.warehouse_id === wh)?.available || 0);
  return preview;
}

export async function assertMaterialReplay(jobNo: string, reportId: string, request: unknown): Promise<void> {
  if (!enabled()) return;
  const [row] = await query("SELECT request=$2::jsonb AS same FROM production_material_reports WHERE report_id=$1", [reportId, JSON.stringify(request)]);
  if (row && !row.same) throw new ProductionError("รหัสยืนยันนี้ใช้กับข้อมูลรายงานอื่นแล้ว กรุณาส่งรายการใหม่", 409);
  const plan = await getMaterialPlan(jobNo);
  if (plan && !row) throw new ProductionError("ไม่พบรายละเอียดวัตถุดิบของรายงาน กรุณาตรวจสอบก่อนยืนยันซ้ำ", 409);
}

export interface MaterialReportInput {
  materials?: ProductionMaterialActual[];
  receipt_location_id?: string;
  material_reason?: string;
}

export async function postMaterialReport(repo: IStockRepository, job: ProductionJob, report: ProductionReport, input: MaterialReportInput, request: unknown, actorId: string): Promise<Document> {
  const plan = await getMaterialPlan(job.job_no);
  if (!plan) throw new ProductionError("งานนี้ยังไม่มีสูตรวัตถุดิบ กรุณาให้ Admin ผูกสูตรก่อนรายงานผล");
  if (!isValidProductionStockQuantity(report.good_qty, plan.snapshot.unit) || !isValidProductionStockQuantity(report.defect_qty, plan.snapshot.unit)) throw new ProductionError(`จำนวนสินค้าดีและสินค้าที่เสียไม่ถูกต้องตามหน่วย ${plan.snapshot.unit}`);
  const preview = previewProductionBom(plan.snapshot, report.good_qty, plan.selection, { allowZero: true }); // ตัดวัตถุดิบตามยอดผลิตดีเท่านั้น
  // A close-only report consumes no default materials, but still validates the frozen units.
  if (preview.issues.length) throw new ProductionError(preview.issues.join(" · "));
  const actual = input.materials || [];
  if (actual.length !== plan.snapshot.items.length || new Set(actual.map(i => i.item_id)).size !== actual.length) throw new ProductionError("กรุณาระบุยอดใช้จริงและของเสียให้ครบทุกวัตถุดิบ ห้ามมีรายการซ้ำ");
  const details = preview.materials.map(i => {
    const a = actual.find(a => a.item_id === i.item_id);
    if (!a || !isValidProductionStockQuantity(a.used_qty, i.stock_unit) || !isValidProductionStockQuantity(a.scrap_qty, i.stock_unit)) throw new ProductionError(`${i.sku}: จำนวนใช้จริงหรือของเสียไม่ถูกต้องตามหน่วยสต็อก`);
    if (a.scrap_qty > 0 && !a.scrap_cause.trim()) throw new ProductionError(`${i.sku}: มีวัตถุดิบเสียต้องระบุสาเหตุ`);
    const expected = report.good_qty > 0 ? i.stock_qty! : 0;
    // ยอดเบิก (used_qty) รวมของเสียไว้แล้ว: ตัดสต็อกเท่ายอดเบิก, ส่วนที่ใช้ได้ = เบิก − เสีย
    if (a.scrap_qty > a.used_qty) throw new ProductionError(`${i.sku}: ของเสียมากกว่ายอดเบิกไม่ได้`);
    if (round(a.used_qty - a.scrap_qty) !== expected && !input.material_reason?.trim()) throw new ProductionError("ยอดใช้จริงต่างจากสูตร ต้องระบุเหตุผล");
    return { ...i, ...a, expected_qty: expected, total_qty: round(a.used_qty) };
  });
  const registry = await query("SELECT product_id,base_unit,active FROM products WHERE product_id=ANY($1::text[])", [[job.product_id, ...details.map(i => i.product_id)]]);
  for (const i of details) if (!registry.some(p => p.product_id === i.product_id && p.active && p.base_unit === i.stock_unit)) throw new ProductionError(`${i.sku}: หน่วยหรือสถานะวัตถุดิบเปลี่ยนหลังวางแผน กรุณาตรวจสอบ`);
  if (!registry.some(p => p.product_id === job.product_id && p.active && p.base_unit === plan.snapshot.stock_unit)) throw new ProductionError("หน่วยหรือสถานะสินค้าสำเร็จรูปเปลี่ยนหลังวางแผน");
  const warehouses = await repo.warehouses.findAll();
  const receiveWarehouse = warehouses.find(w => w.active && (w.warehouse_name === "โกดัง2" || /^wh-0?2$/.test(w.warehouse_id)));
  if (!receiveWarehouse) throw new ProductionError("ไม่พบคลังรับสินค้าสำเร็จรูปโกดัง 2");
  let location: { location_id: string } | undefined;
  if (report.good_qty > 0) {
    [location] = await query<{ location_id: string }>("SELECT location_id FROM locations WHERE warehouse_id=$1 AND active AND (location_id=$2 OR location_code=$2)", [receiveWarehouse.warehouse_id, input.receipt_location_id || ""]);
    if (!location) throw new ProductionError("กรุณาเลือกตำแหน่งเก็บสินค้าดีที่มีอยู่ในโกดัง 2");
  }
  const totals = new Map<string, { qty: number; product_id: string; warehouse_id: string; sku: string }>();
  for (const i of details) {
    const key = i.product_id + "\0" + i.warehouse_id, old = totals.get(key);
    totals.set(key, { qty: round((old?.qty || 0) + i.total_qty), product_id: i.product_id, warehouse_id: i.warehouse_id, sku: i.sku });
  }
  for (const i of totals.values()) if (i.qty > await availableStock(repo, i.product_id, i.warehouse_id, job.job_no)) throw new ProductionError(`${i.sku}: วัตถุดิบไม่พอหรือถูกจองให้งานอื่นแล้ว`);
  // Convert this job's reservation into actual usage inside the caller's writer
  // transaction. Other jobs remain protected; rollback restores this reservation.
  await releaseMaterialReservations(job.job_no);
  const doc: Document = { document_id: `doc-${report.report_id}`, document_no: `${job.job_no}-R${report.report_no}`, document_type: report.good_qty > 0 ? "RECEIVE" : "ISSUE", reference_no: job.job_no,
    document_date: report.reported_at.slice(0, 10), status: "POSTED", note: JSON.stringify({ kind: "PRODUCTION_RESULT", job_no: job.job_no, report_id: report.report_id, bom_id: plan.snapshot.bom_id }), created_by: actorId, created_at: report.reported_at };
  await repo.documents.create(doc);
  for (const i of details) {
    if (i.total_qty === 0) continue;
    if (!repo.stockSummary.allocateTransferSources) throw new ProductionError("ระบบจัดสรรวัตถุดิบจากตำแหน่งเก็บยังไม่พร้อม");
    const allocations = await repo.stockSummary.allocateTransferSources(i.product_id, i.warehouse_id, i.total_qty, "");
    await repo.stockSummary.applyChanges(allocations.map(a => ({ productId: i.product_id, warehouseId: i.warehouse_id, locationId: a.location_id, delta: -a.qty })));
    await repo.movements.batchCreate(allocations.map(a => ({ document_id: doc.document_id, product_id: i.product_id, warehouse_id: i.warehouse_id, location_id: a.location_id, qty_change: -a.qty, movement_type: "ISSUE", idempotency_key: `mfg-${report.report_id}-${i.item_id}-${a.location_id}`, created_by: actorId })));
  }
  if (location && report.good_qty > 0) {
    const qty = round(report.good_qty * preview.fg_factor!);
    await repo.stockSummary.applyChanges([{ productId: job.product_id, warehouseId: receiveWarehouse.warehouse_id, locationId: location.location_id, delta: qty }]);
    await repo.movements.batchCreate([{ document_id: doc.document_id, product_id: job.product_id, warehouse_id: receiveWarehouse.warehouse_id, location_id: location.location_id, qty_change: qty, movement_type: "RECEIVE", idempotency_key: `mfg-${report.report_id}-good`, created_by: actorId }]);
  }
  await query("INSERT INTO production_material_reports(report_id,receipt_location_id,materials,request,reason) VALUES($1,$2,$3::jsonb,$4::jsonb,$5)", [report.report_id, location?.location_id || null, JSON.stringify(details), JSON.stringify(request), input.material_reason || ""]);
  return doc;
}

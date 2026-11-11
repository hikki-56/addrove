import { z } from "zod";
import type { IStockRepository } from "@/server/repositories/interfaces";
import type { Document, StockMovement } from "@/types/models";
import type { OfficeHistoryRow, OfficeProduct } from "@/types/office";
import { MovementFilterSchema, CreateLocationSchema } from "@/types/api";
import { isOfficeWarehouse, hasOfficeBarcode } from "@/lib/office";
import { executeAtomicOperation } from "@/server/services/stock/atomic-stock-executor";
import { formatStockLockKey } from "@/server/locking";
import { StockNotFoundError, StockValidationError, InsufficientStockError } from "@/server/services/stock/stock-errors";
import { withStorageTransaction } from "@/server/storage-transaction";
import { todayBangkokIsoDate } from "@/lib/express-status-utils";

export const OfficeTransferSchema = z.object({
  from_warehouse_id: z.string().trim().min(1),
  idempotency_key: z.string().trim().min(8).max(200),
  lines: z.array(z.object({
    product_id: z.string().trim().min(1),
    quantity: z.number().finite().positive("จำนวนต้องมากกว่า 0").multipleOf(0.001).max(100000000),
    location_code: z.string().trim().min(1, "กรุณาระบุตำแหน่งออฟฟิศ").max(100).transform((value) => value.toUpperCase()),
  })).min(1, "กรุณาเพิ่มสินค้า").max(100),
});

const OfficeNoteSchema = z.object({
  kind: z.literal("office_transfer"),
  from_warehouse_id: z.string(),
  from_warehouse_name: z.string(),
  to_warehouse_id: z.string(),
  created_by_name: z.string(),
  items: z.array(z.object({
    product_id: z.string(), sku: z.string(), barcode: z.string(), product_name: z.string(),
    base_unit: z.string(), quantity: z.number(), location_id: z.string(), location_code: z.string(),
  })),
});

export async function getOfficeSetup(repo: IStockRepository) {
  const warehouses = await repo.warehouses.findAll();
  const office = warehouses.find((w) => w.active && isOfficeWarehouse(w)) ?? null;
  const locations = office ? (await repo.locations.findAll(office.warehouse_id))
    .filter((l) => l.active && l.location_code.trim()) : [];
  return { warehouses: warehouses.filter((w) => w.active && !isOfficeWarehouse(w)), office, locations };
}

export async function getOfficeProducts(repo: IStockRepository, warehouseId: string, groupProducts = false): Promise<OfficeProduct[]> {
  const [products, summaries, locations] = await Promise.all([
    repo.products.findAll({ activeOnly: true }), repo.stockSummary.findAll(warehouseId), repo.locations.findAll(warehouseId),
  ]);
  const productMap = new Map(products.filter((p) => p.active && hasOfficeBarcode(p.barcode)).map((p) => [p.product_id, p]));
  const locationMap = new Map(locations.filter((l) => l.active).flatMap((l) => [[l.location_id, l], [l.location_code, l]] as const));
  const result = new Map<string, OfficeProduct>();
  for (const stock of summaries) {
    const product = productMap.get(stock.product_id);
    const location = locationMap.get(stock.location_id);
    if (!product || !location || Number(stock.quantity) <= 0) continue;
    const key = groupProducts ? product.product_id : JSON.stringify([product.product_id, stock.location_id]);
    const existing = result.get(key);
    if (existing) existing.quantity += Number(stock.quantity);
    else result.set(key, {
      product_id: product.product_id, sku: product.sku, barcode: product.barcode.trim(),
      product_name: product.product_name, base_unit: product.base_unit || "ชิ้น",
      quantity: Number(stock.quantity), location_id: location.location_id, location_code: location.location_code,
    });
  }
  return [...result.values()].sort((a, b) => a.location_code.localeCompare(b.location_code, "th", { numeric: true }) || a.sku.localeCompare(b.sku));
}

export async function getOfficeHistory(repo: IStockRepository, dateFrom?: string): Promise<OfficeHistoryRow[]> {
  const rows: OfficeHistoryRow[] = [];
  for (let page = 1; ; page++) {
    const batch = await repo.documents.findAll(MovementFilterSchema.parse({ document_type: "TRANSFER", date_from: dateFrom, page, limit: 100 }));
    for (const doc of batch.data) {
      if (doc.status !== "COMPLETED") continue;
      let raw: unknown;
      try { raw = JSON.parse(doc.note); } catch { continue; }
      const parsed = OfficeNoteSchema.safeParse(raw);
      if (!parsed.success) continue;
      const note = parsed.data;
      for (const item of note.items) rows.push({
        ...item, document_id: doc.document_id, document_no: doc.document_no.replace(/^[^-]+/, "OF"),
        created_at: doc.created_at, created_by_name: note.created_by_name,
        from_warehouse_id: note.from_warehouse_id, from_warehouse_name: note.from_warehouse_name,
      });
    }
    if (!batch.data.length || page * 100 >= batch.total) break;
  }
  return rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function transferToOffice(repo: IStockRepository, raw: z.infer<typeof OfficeTransferSchema>, actor: { id: string; name: string; role: string; correlationId?: string }): Promise<Document> {
  const input = OfficeTransferSchema.parse(raw);
  const { warehouses, office } = await getOfficeSetup(repo);
  const source = warehouses.find((w) => w.warehouse_id === input.from_warehouse_id);
  if (!source || !office) throw new StockNotFoundError("ไม่พบโกดังต้นทางหรือออฟฟิศที่เปิดใช้งาน");
  return withStorageTransaction(() => executeAtomicOperation({
    repo, operationType: "OFFICE_TRANSFER", idempotencyKey: input.idempotency_key,
    actorId: actor.id, actorRole: actor.role, correlationId: actor.correlationId,
    lockKeys: input.lines.flatMap((line) => [formatStockLockKey(source.warehouse_id, "*", line.product_id), formatStockLockKey(office.warehouse_id, "*", line.product_id), `office-location:${office.warehouse_id}:${line.location_code}`]),
    auditAction: "STOCK_OFFICE_TRANSFER", warehouseId: source.warehouse_id,
    payload: { ...input, actor_id: actor.id, lines_signature: JSON.stringify(input.lines) },
    execute: async () => {
      const [products, stocks, sourceLocations, officeLocations] = await Promise.all([
        repo.products.findAll({ activeOnly: true }), repo.stockSummary.findAll(source.warehouse_id), repo.locations.findAll(source.warehouse_id), repo.locations.findAll(office.warehouse_id),
      ]);
      const activeSources = new Set(sourceLocations.filter((l) => l.active).flatMap((l) => [l.location_id, l.location_code]));
      const available = stocks.filter((s) => activeSources.has(s.location_id) && Number(s.quantity) > 0)
        .map((s) => ({ ...s, quantity: Number(s.quantity) }));
      const items: OfficeProduct[] = [];
      const deductions: Array<{ product_id: string; location_id: string; qty: number }> = [];
      // Validate and allocate the entire batch before writing. Repeated SKUs share
      // the same remaining balances, including lines going to different shelves.
      for (const line of input.lines) {
        const product = products.find((p) => p.active && p.product_id === line.product_id);
        const location = officeLocations.find((l) => l.location_code.toUpperCase() === line.location_code);
        if (!product) throw new StockNotFoundError("ไม่พบสินค้าที่เปิดใช้งาน");
        if (!hasOfficeBarcode(product.barcode)) throw new StockValidationError("เบิกได้เฉพาะสินค้าที่มีบาร์โค้ด 13 หลักเท่านั้น");
        if (location && !location.active) throw new StockValidationError("ตำแหน่งออฟฟิศนี้ปิดใช้งาน กรุณาระบุตำแหน่งอื่น");
        let remaining = line.quantity;
        for (const stock of available.filter((s) => s.product_id === product.product_id)) {
          if (remaining <= 0) break;
          const qty = Math.min(stock.quantity, remaining);
          if (qty <= 0) continue;
          deductions.push({ product_id: product.product_id, location_id: stock.location_id, qty });
          stock.quantity -= qty;
          remaining = Math.round((remaining - qty) * 1000) / 1000;
        }
        if (remaining > 0) throw new InsufficientStockError(`${product.product_name}: สต็อกต้นทางไม่เพียงพอ กรุณาโหลดข้อมูลใหม่`);
        items.push({ ...line, location_id: location?.location_id || "", sku: product.sku, barcode: product.barcode.trim(), product_name: product.product_name,
          base_unit: product.base_unit || "ชิ้น", location_code: location?.location_code || line.location_code });
      }
      for (const item of items) {
        if (item.location_id) continue;
        let location = officeLocations.find((l) => l.location_code.toUpperCase() === item.location_code.toUpperCase());
        if (!location) {
          location = await repo.locations.create(CreateLocationSchema.parse({ warehouse_id: office.warehouse_id, location_code: item.location_code, location_name: item.location_code }));
          officeLocations.push(location);
        }
        item.location_id = location.location_id;
      }
      const doc = await repo.documents.create({
        document_type: "TRANSFER", reference_no: "OFFICE", document_date: todayBangkokIsoDate(), status: "COMPLETED", created_by: actor.id,
        note: JSON.stringify({ kind: "office_transfer", from_warehouse_id: source.warehouse_id, from_warehouse_name: source.warehouse_name,
          to_warehouse_id: office.warehouse_id, created_by_name: actor.name, idempotency_key: input.idempotency_key, items }),
      });
      const movements: Omit<StockMovement, "movement_id" | "created_at">[] = [
        ...deductions.map((d) => ({ product_id: d.product_id, warehouse_id: source.warehouse_id, location_id: d.location_id, qty_change: -d.qty, movement_type: "TRANSFER_OUT" as const })),
        ...items.map((item) => ({ product_id: item.product_id, warehouse_id: office.warehouse_id, location_id: item.location_id, qty_change: item.quantity, movement_type: "TRANSFER_IN" as const })),
      ].map((m, i) => ({ ...m, document_id: doc.document_id, created_by: actor.id, idempotency_key: `${input.idempotency_key}-${i}` }));
      const created = await repo.movements.batchCreate(movements);
      await repo.stockSummary.applyChanges(created.map((m) => ({ productId: m.product_id, warehouseId: m.warehouse_id, locationId: m.location_id, delta: m.qty_change })));
      for (const d of deductions) {
        const sourceLocation = sourceLocations.find((l) => l.location_id === d.location_id || l.location_code === d.location_id);
        await repo.warehouseSync.syncDeduct(source.warehouse_id, products.find((p) => p.product_id === d.product_id)!.sku, d.qty, sourceLocation?.location_code || d.location_id);
      }
      for (const item of items) {
        const product = products.find((p) => p.product_id === item.product_id)!;
        await repo.warehouseSync.syncAdd(office.warehouse_id, { sku: product.sku, barcode: product.barcode, product_name: product.product_name,
          category: product.category, base_unit: product.base_unit, supplier: product.supplier || "" }, item.quantity, item.location_code);
      }
      return doc;
    },
  }));
}

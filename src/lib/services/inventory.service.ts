import type { IStockRepository } from "@/lib/repositories/interfaces";
import type {
  ReceiveInput,
  IssueInput,
  MoveInput,
  TransferInput,
  ReversalInput,
} from "@/lib/repositories/interfaces";
import type { Document, StockMovement } from "@/types/models";

// Default warehouse/location IDs used by frontend when Google Sheets has no data
const DEFAULT_WAREHOUSE_IDS = ["wh-1", "wh-2", "wh-3", "wh-4", "wh-5"];
function isDefaultWarehouse(id: string) { return DEFAULT_WAREHOUSE_IDS.includes(id); }
function isDefaultLocation(id: string) { return id.startsWith("loc-"); }

// ============================================================
// InventoryService — Core Business Logic
// ============================================================

export class InventoryService {
  constructor(private readonly repo: IStockRepository) {}

  // ------ RECEIVE ------
  async receive(input: ReceiveInput): Promise<Document> {
    // Idempotency check
    const existsIdempotency =
      (await this.repo.movements.existsByIdempotencyKey(input.idempotency_key)) ||
      (await this.repo.movements.existsByIdempotencyKey(`${input.idempotency_key}-0`));
    if (existsIdempotency) {
      throw new Error("รายการนี้ถูกบันทึกไปแล้ว (idempotency_key ซ้ำ)");
    }

    // Warehouse access is checked at API layer
    // Validate warehouse (skip for default hardcoded warehouses)
    if (!isDefaultWarehouse(input.warehouse_id)) {
      const warehouse = await this.repo.warehouses.findById(input.warehouse_id);
      if (!warehouse || !warehouse.active) {
        throw new Error("ไม่พบโกดังหรือโกดังถูกปิดใช้งาน");
      }
    }

    // Validate each line
    for (const line of input.lines) {
      if (line.qty <= 0) {
        throw new Error("จำนวนรับเข้าต้องมากกว่า 0");
      }
      const product = await this.repo.products.findById(line.product_id);
      if (!product) throw new Error(`ไม่พบสินค้า ID: ${line.product_id}`);
      if (!product.active) {
        throw new Error(`สินค้า "${product.product_name}" ถูกปิดใช้งานแล้ว`);
      }
      // Skip location validation for default hardcoded locations
      if (!isDefaultLocation(line.location_id)) {
        const location = await this.repo.locations.findById(line.location_id);
        if (!location || location.warehouse_id !== input.warehouse_id) {
          throw new Error(
            `ตำแหน่ง ${line.location_id} ไม่อยู่ในโกดังที่เลือก`
          );
        }
        if (!location.active) {
          throw new Error(`ตำแหน่ง "${location.location_code}" ถูกปิดใช้งาน`);
        }
      }
    }

    // Create document
    const doc = await this.repo.documents.create({
      document_type: "RECEIVE",
      reference_no: input.reference_no,
      document_date: input.document_date,
      status: "POSTED",
      note: input.note,
      created_by: input.user_id,
    });

    // Create movements (batch)
    const movements: Omit<StockMovement, "movement_id" | "created_at">[] =
      input.lines.map((line, i) => ({
        document_id: doc.document_id,
        product_id: line.product_id,
        warehouse_id: input.warehouse_id,
        location_id: line.location_id,
        qty_change: line.qty,
        movement_type: "RECEIVE",
        idempotency_key: `${input.idempotency_key}-${i}`,
        created_by: input.user_id,
      }));

    const created = await this.repo.movements.batchCreate(movements);

    // Update stock summary
    await this.repo.stockSummary.applyChanges(
      created.map((m) => ({
        productId: m.product_id,
        warehouseId: m.warehouse_id,
        locationId: m.location_id,
        delta: m.qty_change,
      }))
    );

    return doc;
  }

  // ------ ISSUE ------
  async issue(input: IssueInput): Promise<Document> {
    const existsIdempotency =
      (await this.repo.movements.existsByIdempotencyKey(input.idempotency_key)) ||
      (await this.repo.movements.existsByIdempotencyKey(`${input.idempotency_key}-0`));
    if (existsIdempotency) {
      throw new Error("รายการนี้ถูกบันทึกไปแล้ว (idempotency_key ซ้ำ)");
    }

    if (!isDefaultWarehouse(input.warehouse_id)) {
      const warehouse = await this.repo.warehouses.findById(input.warehouse_id);
      if (!warehouse || !warehouse.active) {
        throw new Error("ไม่พบโกดังหรือโกดังถูกปิดใช้งาน");
      }
    }

    // Check each line: product active, location in warehouse, sufficient stock
    for (const line of input.lines) {
      if (line.qty <= 0) throw new Error("จำนวนเบิกออกต้องมากกว่า 0");
      const product = await this.repo.products.findById(line.product_id);
      if (!product) throw new Error(`ไม่พบสินค้า ID: ${line.product_id}`);
      if (!product.active) {
        throw new Error(`สินค้า "${product.product_name}" ถูกปิดใช้งานแล้ว`);
      }
      if (!isDefaultLocation(line.location_id)) {
        const location = await this.repo.locations.findById(line.location_id);
        if (!location || location.warehouse_id !== input.warehouse_id) {
          throw new Error(`ตำแหน่งไม่อยู่ในโกดังที่เลือก`);
        }
      }

      // Check balance (server-side, latest)
      const balance = await this.repo.movements.getBalance(
        line.product_id,
        input.warehouse_id,
        line.location_id
      );
      if (balance < line.qty) {
        const locCode = location ? (location as { location_code?: string }).location_code || line.location_id : line.location_id;
        throw new Error(
          `สินค้า "${product.product_name}" ในตำแหน่ง "${locCode}" มีเพียง ${balance} ${product.base_unit} ไม่เพียงพอสำหรับเบิก ${line.qty} ${product.base_unit}`
        );
      }
    }

    const doc = await this.repo.documents.create({
      document_type: "ISSUE",
      reference_no: input.reference_no,
      document_date: input.document_date,
      status: "POSTED",
      note: input.note,
      created_by: input.user_id,
    });

    const movements: Omit<StockMovement, "movement_id" | "created_at">[] =
      input.lines.map((line, i) => ({
        document_id: doc.document_id,
        product_id: line.product_id,
        warehouse_id: input.warehouse_id,
        location_id: line.location_id,
        qty_change: -line.qty, // negative for issue
        movement_type: "ISSUE",
        idempotency_key: `${input.idempotency_key}-${i}`,
        created_by: input.user_id,
      }));

    const created = await this.repo.movements.batchCreate(movements);

    await this.repo.stockSummary.applyChanges(
      created.map((m) => ({
        productId: m.product_id,
        warehouseId: m.warehouse_id,
        locationId: m.location_id,
        delta: m.qty_change,
      }))
    );

    return doc;
  }

  // ------ MOVE (same warehouse, different location) ------
  async move(input: MoveInput): Promise<Document> {
    const existsIdempotency = await this.repo.movements.existsByIdempotencyKey(
      input.idempotency_key
    );
    if (existsIdempotency) {
      throw new Error("รายการนี้ถูกบันทึกไปแล้ว (idempotency_key ซ้ำ)");
    }

    if (input.qty <= 0) throw new Error("จำนวนย้ายต้องมากกว่า 0");
    if (input.from_location_id === input.to_location_id) {
      throw new Error("ตำแหน่งต้นทางและปลายทางต้องไม่เหมือนกัน");
    }

    const product = await this.repo.products.findById(input.product_id);
    if (!product || !product.active) {
      throw new Error("ไม่พบสินค้าหรือสินค้าถูกปิดใช้งาน");
    }

    const fromLocation = await this.repo.locations.findById(
      input.from_location_id
    );
    const toLocation = await this.repo.locations.findById(input.to_location_id);

    if (!fromLocation || fromLocation.warehouse_id !== input.warehouse_id) {
      throw new Error("ตำแหน่งต้นทางไม่อยู่ในโกดังที่เลือก");
    }
    if (!toLocation || toLocation.warehouse_id !== input.warehouse_id) {
      throw new Error("ตำแหน่งปลายทางไม่อยู่ในโกดังที่เลือก");
    }

    // Check source balance
    const sourceBalance = await this.repo.movements.getBalance(
      input.product_id,
      input.warehouse_id,
      input.from_location_id
    );
    if (sourceBalance < input.qty) {
      throw new Error(
        `สินค้าในตำแหน่งต้นทาง "${fromLocation.location_code}" มีเพียง ${sourceBalance} ${product.base_unit} ไม่เพียงพอสำหรับย้าย ${input.qty} ${product.base_unit}`
      );
    }

    const doc = await this.repo.documents.create({
      document_type: "MOVE",
      reference_no: input.reference_no,
      document_date: input.document_date,
      status: "POSTED",
      note: input.note,
      created_by: input.user_id,
    });

    const movements: Omit<StockMovement, "movement_id" | "created_at">[] = [
      {
        document_id: doc.document_id,
        product_id: input.product_id,
        warehouse_id: input.warehouse_id,
        location_id: input.from_location_id,
        qty_change: -input.qty,
        movement_type: "MOVE_OUT",
        idempotency_key: `${input.idempotency_key}-out`,
        created_by: input.user_id,
      },
      {
        document_id: doc.document_id,
        product_id: input.product_id,
        warehouse_id: input.warehouse_id,
        location_id: input.to_location_id,
        qty_change: input.qty,
        movement_type: "MOVE_IN",
        idempotency_key: `${input.idempotency_key}-in`,
        created_by: input.user_id,
      },
    ];

    const created = await this.repo.movements.batchCreate(movements);

    await this.repo.stockSummary.applyChanges(
      created.map((m) => ({
        productId: m.product_id,
        warehouseId: m.warehouse_id,
        locationId: m.location_id,
        delta: m.qty_change,
      }))
    );

    return doc;
  }

  // ------ TRANSFER (cross-warehouse) ------
  async transfer(input: TransferInput): Promise<Document> {
    const existsIdempotency = await this.repo.movements.existsByIdempotencyKey(
      input.idempotency_key
    );
    if (existsIdempotency) {
      throw new Error("รายการนี้ถูกบันทึกไปแล้ว (idempotency_key ซ้ำ)");
    }

    if (input.qty <= 0) throw new Error("จำนวนโอนต้องมากกว่า 0");
    if (input.from_warehouse_id === input.to_warehouse_id) {
      throw new Error("โกดังต้นทางและปลายทางต้องไม่เหมือนกัน กรุณาใช้ฟังก์ชันย้ายตำแหน่งแทน");
    }

    const product = await this.repo.products.findById(input.product_id);
    if (!product || !product.active) {
      throw new Error("ไม่พบสินค้าหรือสินค้าถูกปิดใช้งาน");
    }

    const fromWarehouse = await this.repo.warehouses.findById(
      input.from_warehouse_id
    );
    const toWarehouse = await this.repo.warehouses.findById(
      input.to_warehouse_id
    );
    if (!fromWarehouse || !fromWarehouse.active) {
      throw new Error("โกดังต้นทางไม่พบหรือถูกปิดใช้งาน");
    }
    if (!toWarehouse || !toWarehouse.active) {
      throw new Error("โกดังปลายทางไม่พบหรือถูกปิดใช้งาน");
    }

    // Check warehouse-level balance for source
    const warehouseBalance = await this.repo.movements.getWarehouseBalance(
      input.product_id,
      input.from_warehouse_id
    );
    if (warehouseBalance < input.qty) {
      throw new Error(
        `สินค้าในโกดัง "${fromWarehouse.warehouse_name}" มีเพียง ${warehouseBalance} ${product.base_unit} ไม่เพียงพอสำหรับโอน ${input.qty} ${product.base_unit}`
      );
    }

    // Check location balance
    const locationBalance = await this.repo.movements.getBalance(
      input.product_id,
      input.from_warehouse_id,
      input.from_location_id
    );
    if (locationBalance < input.qty) {
      throw new Error(
        `สินค้าในตำแหน่งต้นทางมีเพียง ${locationBalance} ${product.base_unit} ไม่เพียงพอ`
      );
    }

    const doc = await this.repo.documents.create({
      document_type: "TRANSFER",
      reference_no: input.reference_no,
      document_date: input.document_date,
      status: "POSTED",
      note: input.note,
      created_by: input.user_id,
    });

    // Both movements must succeed — if batchCreate fails, both fail atomically
    const movements: Omit<StockMovement, "movement_id" | "created_at">[] = [
      {
        document_id: doc.document_id,
        product_id: input.product_id,
        warehouse_id: input.from_warehouse_id,
        location_id: input.from_location_id,
        qty_change: -input.qty,
        movement_type: "TRANSFER_OUT",
        idempotency_key: `${input.idempotency_key}-out`,
        created_by: input.user_id,
      },
      {
        document_id: doc.document_id,
        product_id: input.product_id,
        warehouse_id: input.to_warehouse_id,
        location_id: input.to_location_id,
        qty_change: input.qty,
        movement_type: "TRANSFER_IN",
        idempotency_key: `${input.idempotency_key}-in`,
        created_by: input.user_id,
      },
    ];

    const created = await this.repo.movements.batchCreate(movements);

    await this.repo.stockSummary.applyChanges(
      created.map((m) => ({
        productId: m.product_id,
        warehouseId: m.warehouse_id,
        locationId: m.location_id,
        delta: m.qty_change,
      }))
    );

    return doc;
  }

  // ------ REVERSAL ------
  async reversal(input: ReversalInput): Promise<Document> {
    const existsIdempotency = await this.repo.movements.existsByIdempotencyKey(
      input.idempotency_key
    );
    if (existsIdempotency) {
      throw new Error("รายการนี้ถูกบันทึกไปแล้ว (idempotency_key ซ้ำ)");
    }

    const originalDoc = await this.repo.documents.findById(
      input.original_document_id
    );
    if (!originalDoc) {
      throw new Error("ไม่พบเอกสารที่ต้องการกลับยอด");
    }
    if (originalDoc.status !== "POSTED") {
      throw new Error("สามารถกลับยอดได้เฉพาะเอกสารที่มีสถานะ POSTED เท่านั้น");
    }

    // Check if already reversed
    const allDocs = await this.repo.documents.findAll({ page: 1, limit: 9999 });
    const alreadyReversed = allDocs.data.some(
      (d) =>
        d.document_type === "REVERSAL" &&
        d.reference_no === originalDoc.document_no
    );
    if (alreadyReversed) {
      throw new Error("เอกสารนี้ถูกกลับยอดไปแล้ว");
    }

    // Get original movements
    const originalMovements = await this.repo.movements.findByDocumentId(
      originalDoc.document_id
    );
    if (originalMovements.length === 0) {
      throw new Error("ไม่พบรายการเคลื่อนไหวของเอกสารนี้");
    }

    // For ISSUE reversal: check that we won't go negative after reversal
    for (const mov of originalMovements) {
      if (mov.qty_change < 0) {
        // This was an outgoing movement, reversal will add stock back - always OK
      } else {
        // This was an incoming movement, reversal will deduct stock
        const currentBalance = await this.repo.movements.getBalance(
          mov.product_id,
          mov.warehouse_id,
          mov.location_id
        );
        if (currentBalance < mov.qty_change) {
          throw new Error(
            `ยอดคงเหลือในตำแหน่งปัจจุบันไม่เพียงพอสำหรับกลับยอด`
          );
        }
      }
    }

    const reversalDoc = await this.repo.documents.create({
      document_type: "REVERSAL",
      reference_no: originalDoc.document_no,
      document_date: new Date().toISOString().slice(0, 10),
      status: "POSTED",
      note: `กลับยอดเอกสาร ${originalDoc.document_no}: ${input.note}`,
      created_by: input.user_id,
    });

    // Mirror all movements with opposite sign
    const reversalMovements: Omit<
      StockMovement,
      "movement_id" | "created_at"
    >[] = originalMovements.map((m, i) => ({
      document_id: reversalDoc.document_id,
      product_id: m.product_id,
      warehouse_id: m.warehouse_id,
      location_id: m.location_id,
      qty_change: -m.qty_change,
      movement_type: "REVERSAL",
      idempotency_key: `${input.idempotency_key}-${i}`,
      created_by: input.user_id,
    }));

    const created = await this.repo.movements.batchCreate(reversalMovements);

    await this.repo.stockSummary.applyChanges(
      created.map((m) => ({
        productId: m.product_id,
        warehouseId: m.warehouse_id,
        locationId: m.location_id,
        delta: m.qty_change,
      }))
    );

    return reversalDoc;
  }

  // ------ Get Stock Balance ------
  async getStockBalance(
    warehouseId?: string
  ) {
    const [summaries, products, warehouses, locations] = await Promise.all([
      this.repo.stockSummary.findAll(warehouseId),
      this.repo.products.findAll(),
      this.repo.warehouses.findAll(),
      this.repo.locations.findAll(),
    ]);

    const warehouseMap = new Map(warehouses.map((w) => [w.warehouse_id, w]));
    const locationMap = new Map(locations.map((l) => [l.location_id, l]));
    const productMap = new Map(products.map((p) => [p.product_id, p]));

    // Group by product
    const productBalances = new Map<
      string,
      {
        total: number;
        byWarehouse: Map<
          string,
          { total: number; byLocation: Map<string, number> }
        >;
      }
    >();

    for (const s of summaries) {
      if (!productBalances.has(s.product_id)) {
        productBalances.set(s.product_id, {
          total: 0,
          byWarehouse: new Map(),
        });
      }
      const pb = productBalances.get(s.product_id)!;
      pb.total += s.quantity;

      if (!pb.byWarehouse.has(s.warehouse_id)) {
        pb.byWarehouse.set(s.warehouse_id, { total: 0, byLocation: new Map() });
      }
      const wb = pb.byWarehouse.get(s.warehouse_id)!;
      wb.total += s.quantity;
      wb.byLocation.set(
        s.location_id,
        (wb.byLocation.get(s.location_id) ?? 0) + s.quantity
      );
    }

    return products
      .filter((p) => p.active || productBalances.has(p.product_id))
      .map((p) => {
        const pb = productBalances.get(p.product_id);
        const total_quantity = pb?.total ?? 0;
        let status: "NORMAL" | "LOW" | "OUT" | "NEGATIVE" = "NORMAL";
        if (total_quantity < 0) status = "NEGATIVE";
        else if (total_quantity === 0) status = "OUT";
        else if (total_quantity <= p.minimum_stock) status = "LOW";

        return {
          product_id: p.product_id,
          sku: p.sku,
          product_name: p.product_name,
          base_unit: p.base_unit,
          minimum_stock: p.minimum_stock,
          total_quantity,
          status,
          by_warehouse: Array.from(pb?.byWarehouse.entries() ?? []).map(
            ([wid, wb]) => ({
              warehouse_id: wid,
              warehouse_name: warehouseMap.get(wid)?.warehouse_name ?? wid,
              quantity: wb.total,
              by_location: Array.from(wb.byLocation.entries()).map(
                ([lid, qty]) => ({
                  location_id: lid,
                  location_code: locationMap.get(lid)?.location_code ?? lid,
                  quantity: qty,
                })
              ),
            })
          ),
        };
      });
  }
}

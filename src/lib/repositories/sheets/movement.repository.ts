import { v4 as uuidv4 } from "uuid";
import {
  readSheet,
  appendRows,
  batchAppendRows,
  SHEETS,
} from "@/lib/google-sheets/client";
import type { IStockMovementRepository } from "../interfaces";
import type { StockMovement, MovementWithDetails, MovementType } from "@/types/models";
import type { MovementFilterInput } from "@/types/api";

// Columns: movement_id, document_id, product_id, warehouse_id, location_id, qty_change, movement_type, idempotency_key, created_by, created_at
function rowToMovement(row: string[]): StockMovement {
  return {
    movement_id: row[0] ?? "",
    document_id: row[1] ?? "",
    product_id: row[2] ?? "",
    warehouse_id: row[3] ?? "",
    location_id: row[4] ?? "",
    qty_change: parseFloat(row[5] ?? "0") || 0,
    movement_type: (row[6] as MovementType) ?? "RECEIVE",
    idempotency_key: row[7] ?? "",
    created_by: row[8] ?? "",
    created_at: row[9] ?? "",
  };
}

function movementToRow(m: StockMovement): (string | number)[] {
  return [
    m.movement_id,
    m.document_id,
    m.product_id,
    m.warehouse_id,
    m.location_id,
    m.qty_change,
    m.movement_type,
    m.idempotency_key,
    m.created_by,
    m.created_at,
  ];
}

export class SheetsStockMovementRepository
  implements IStockMovementRepository
{
  private async getAllRows(): Promise<string[][]> {
    return readSheet(SHEETS.STOCK_MOVEMENTS, "A2:J");
  }

  async findByDocumentId(documentId: string): Promise<StockMovement[]> {
    const rows = await this.getAllRows();
    return rows.filter((r) => r[1] === documentId).map(rowToMovement);
  }

  async findAll(
    filters: MovementFilterInput
  ): Promise<{ data: MovementWithDetails[]; total: number }> {
    // Load all data in batch
    const [movRows, docRows, productRows, warehouseRows, locationRows, userRows] =
      await Promise.all([
        readSheet(SHEETS.STOCK_MOVEMENTS, "A2:J"),
        readSheet(SHEETS.DOCUMENTS, "A2:I"),
        readSheet(SHEETS.PRODUCTS, "A2:K"),
        readSheet(SHEETS.WAREHOUSES, "A2:G"),
        readSheet(SHEETS.LOCATIONS, "A2:L"),
        readSheet(SHEETS.USERS, "A2:H"),
      ]);

    const docMap = new Map(docRows.filter((r) => r[0]).map((r) => [r[0], r]));
    const productMap = new Map(productRows.filter((r) => r[0]).map((r) => [r[0], r]));
    const warehouseMap = new Map(warehouseRows.filter((r) => r[0]).map((r) => [r[0], r]));
    const locationMap = new Map(locationRows.filter((r) => r[0]).map((r) => [r[0], r]));
    const userMap = new Map(userRows.filter((r) => r[0]).map((r) => [r[0], r]));

    let movements: MovementWithDetails[] = movRows
      .filter((r) => r[0])
      .map((r) => {
        const mov = rowToMovement(r);
        const doc = docMap.get(mov.document_id);
        const product = productMap.get(mov.product_id);
        const warehouse = warehouseMap.get(mov.warehouse_id);
        const location = locationMap.get(mov.location_id);
        const user = userMap.get(mov.created_by);
        return {
          ...mov,
          document_no: doc?.[1] ?? "",
          document_type: (doc?.[2] ?? "RECEIVE") as MovementWithDetails["document_type"],
          product_name: product?.[3] ?? "",
          sku: product?.[1] ?? "",
          warehouse_name: warehouse?.[2] ?? "",
          location_code: location?.[7] ?? "",
          created_by_name: user?.[1] ?? mov.created_by,
        };
      });

    // Apply filters
    if (filters.warehouse_id) {
      movements = movements.filter((m) => m.warehouse_id === filters.warehouse_id);
    }
    if (filters.location_id) {
      movements = movements.filter((m) => m.location_id === filters.location_id);
    }
    if (filters.document_type) {
      movements = movements.filter((m) => m.document_type === filters.document_type);
    }
    if (filters.sku) {
      movements = movements.filter((m) =>
        m.sku.toLowerCase().includes(filters.sku!.toLowerCase())
      );
    }
    if (filters.product_name) {
      movements = movements.filter((m) =>
        m.product_name.toLowerCase().includes(filters.product_name!.toLowerCase())
      );
    }
    if (filters.document_no) {
      movements = movements.filter((m) =>
        m.document_no.toLowerCase().includes(filters.document_no!.toLowerCase())
      );
    }
    if (filters.created_by) {
      movements = movements.filter((m) => m.created_by === filters.created_by);
    }
    if (filters.date_from) {
      movements = movements.filter(
        (m) => m.created_at >= filters.date_from!
      );
    }
    if (filters.date_to) {
      movements = movements.filter(
        (m) => m.created_at <= filters.date_to! + "T23:59:59"
      );
    }

    // Sort by created_at descending
    movements.sort((a, b) => b.created_at.localeCompare(a.created_at));

    const total = movements.length;
    const start = (filters.page - 1) * filters.limit;
    return { data: movements.slice(start, start + filters.limit), total };
  }

  async getBalance(
    productId: string,
    warehouseId: string,
    locationId: string
  ): Promise<number> {
    const rows = await this.getAllRows();
    return rows
      .filter(
        (r) =>
          r[2] === productId && r[3] === warehouseId && r[4] === locationId
      )
      .reduce((sum, r) => sum + (parseFloat(r[5]) || 0), 0);
  }

  async getWarehouseBalance(
    productId: string,
    warehouseId: string
  ): Promise<number> {
    const rows = await this.getAllRows();
    return rows
      .filter((r) => r[2] === productId && r[3] === warehouseId)
      .reduce((sum, r) => sum + (parseFloat(r[5]) || 0), 0);
  }

  async existsByIdempotencyKey(key: string): Promise<boolean> {
    const rows = await this.getAllRows();
    return rows.some((r) => r[7] === key);
  }

  async batchCreate(
    movements: Omit<StockMovement, "movement_id" | "created_at">[]
  ): Promise<StockMovement[]> {
    const now = new Date().toISOString();
    const created: StockMovement[] = movements.map((m) => ({
      ...m,
      movement_id: uuidv4(),
      created_at: now,
    }));
    await batchAppendRows(
      SHEETS.STOCK_MOVEMENTS,
      created.map(movementToRow)
    );
    return created;
  }
}

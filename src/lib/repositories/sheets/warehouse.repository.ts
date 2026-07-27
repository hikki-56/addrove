import { v4 as uuidv4 } from "uuid";
import {
  readSheet,
  appendRows,
  updateRow,
  SHEETS,
  parseBoolean,
  formatBoolean,
} from "@/lib/google-sheets/client";
import type { IWarehouseRepository } from "../interfaces";
import type { Warehouse } from "@/types/models";
import type { CreateWarehouseInput } from "@/types/api";

// Columns: warehouse_id, warehouse_code, warehouse_name, address, active, created_at, updated_at
function rowToWarehouse(row: string[]): Warehouse {
  return {
    warehouse_id: row[0] ?? "",
    warehouse_code: row[1] ?? "",
    warehouse_name: row[2] ?? "",
    address: row[3] ?? "",
    active: parseBoolean(row[4]),
    created_at: row[5] ?? "",
    updated_at: row[6] ?? "",
  };
}

function warehouseToRow(w: Warehouse): (string | boolean)[] {
  return [
    w.warehouse_id,
    w.warehouse_code,
    w.warehouse_name,
    w.address,
    formatBoolean(w.active),
    w.created_at,
    w.updated_at,
  ];
}

export class SheetsWarehouseRepository implements IWarehouseRepository {
  private async getAllRows(): Promise<{ data: Warehouse[]; rows: string[][] }> {
    const rows = await readSheet(SHEETS.WAREHOUSES, "A2:G");
    return { data: rows.filter(r => r[0]).map(rowToWarehouse), rows };
  }

  async findAll(): Promise<Warehouse[]> {
    const { data } = await this.getAllRows();
    return data;
  }

  async findById(id: string): Promise<Warehouse | null> {
    const { data } = await this.getAllRows();
    return data.find((w) => w.warehouse_id === id) ?? null;
  }

  async findByCode(code: string): Promise<Warehouse | null> {
    const { data } = await this.getAllRows();
    return data.find((w) => w.warehouse_code === code) ?? null;
  }

  async create(input: CreateWarehouseInput): Promise<Warehouse> {
    const now = new Date().toISOString();
    const warehouse: Warehouse = {
      warehouse_id: uuidv4(),
      warehouse_code: input.warehouse_code,
      warehouse_name: input.warehouse_name,
      address: input.address,
      active: true,
      created_at: now,
      updated_at: now,
    };
    await appendRows(SHEETS.WAREHOUSES, [warehouseToRow(warehouse)]);
    return warehouse;
  }

  async setActive(id: string, active: boolean): Promise<void> {
    const rows = await readSheet(SHEETS.WAREHOUSES, "A2:G");
    const idx = rows.findIndex((r) => r[0] === id);
    if (idx === -1) throw new Error("ไม่พบโกดัง");
    const rowNumber = idx + 2;
    const warehouse = rowToWarehouse(rows[idx]);
    warehouse.active = active;
    warehouse.updated_at = new Date().toISOString();
    await updateRow(SHEETS.WAREHOUSES, rowNumber, warehouseToRow(warehouse));
  }
}

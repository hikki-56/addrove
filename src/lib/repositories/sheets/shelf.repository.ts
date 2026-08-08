import {
  readSheet,
  appendRows,
  updateRow,
  SHEETS,
  parseBoolean,
  formatBoolean,
} from "@/lib/google-sheets/client";
import type { IShelfRepository } from "../interfaces";
import type { Shelf } from "@/types/models";
import type { CreateShelfInput, UpdateShelfInput } from "@/types/api";

function generateUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

// Columns: shelf_id, location_id, shelf_code, shelf_name, shelf_level, active, created_at, updated_at
function rowToShelf(row: string[]): Shelf {
  return {
    shelf_id: row[0] ?? "",
    location_id: row[1] ?? "",
    shelf_code: row[2] ?? "",
    shelf_name: row[3] ?? "",
    shelf_level: row[4] ?? "1",
    active: parseBoolean(row[5]),
    created_at: row[6] ?? "",
    updated_at: row[7] ?? "",
  };
}

function shelfToRow(s: Shelf): (string | boolean)[] {
  return [
    s.shelf_id,
    s.location_id,
    s.shelf_code,
    s.shelf_name,
    s.shelf_level,
    formatBoolean(s.active),
    s.created_at,
    s.updated_at,
  ];
}

export class SheetsShelfRepository implements IShelfRepository {
  async findAll(locationId?: string): Promise<Shelf[]> {
    const rows = await readSheet(SHEETS.SHELVES, "A2:H");
    const shelves = rows.filter((r) => r[0]).map(rowToShelf);
    return locationId
      ? shelves.filter((s) => s.location_id === locationId)
      : shelves;
  }

  async findById(id: string): Promise<Shelf | null> {
    const rows = await readSheet(SHEETS.SHELVES, "A2:H");
    const row = rows.find((r) => r[0] === id);
    return row ? rowToShelf(row) : null;
  }

  async findByCode(code: string): Promise<Shelf | null> {
    const rows = await readSheet(SHEETS.SHELVES, "A2:H");
    const row = rows.find((r) => r[2] === code);
    return row ? rowToShelf(row) : null;
  }

  async create(input: CreateShelfInput): Promise<Shelf> {
    const now = new Date().toISOString();
    const shelf: Shelf = {
      shelf_id: `sh-${generateUuid()}`,
      location_id: input.location_id,
      shelf_code: input.shelf_code,
      shelf_name: input.shelf_name,
      shelf_level: input.shelf_level || "1",
      active: true,
      created_at: now,
      updated_at: now,
    };
    await appendRows(SHEETS.SHELVES, [shelfToRow(shelf)]);
    return shelf;
  }

  async update(id: string, input: UpdateShelfInput): Promise<Shelf | null> {
    const rows = await readSheet(SHEETS.SHELVES, "A2:H");
    const idx = rows.findIndex((r) => r[0] === id);
    if (idx === -1) return null;
    const current = rowToShelf(rows[idx]);
    const updated: Shelf = {
      ...current,
      ...input,
      shelf_id: current.shelf_id,
      updated_at: new Date().toISOString(),
    };
    await updateRow(SHEETS.SHELVES, idx + 2, shelfToRow(updated));
    return updated;
  }
}

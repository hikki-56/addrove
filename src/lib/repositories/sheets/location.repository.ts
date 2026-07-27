import { v4 as uuidv4 } from "uuid";
import {
  readSheet,
  appendRows,
  updateRow,
  SHEETS,
  parseBoolean,
  formatBoolean,
} from "@/lib/google-sheets/client";
import type { ILocationRepository } from "../interfaces";
import type { Location } from "@/types/models";
import type { CreateLocationInput, UpdateLocationInput } from "@/types/api";

// Columns: location_id, warehouse_id, zone, aisle, rack, shelf, bin, location_code, description, active, created_at, updated_at
function rowToLocation(row: string[]): Location {
  return {
    location_id: row[0] ?? "",
    warehouse_id: row[1] ?? "",
    zone: row[2] ?? "",
    aisle: row[3] ?? "",
    rack: row[4] ?? "",
    shelf: row[5] ?? "",
    bin: row[6] ?? "",
    location_code: row[7] ?? "",
    description: row[8] ?? "",
    active: parseBoolean(row[9]),
    created_at: row[10] ?? "",
    updated_at: row[11] ?? "",
  };
}

function locationToRow(l: Location): (string | boolean)[] {
  return [
    l.location_id,
    l.warehouse_id,
    l.zone,
    l.aisle,
    l.rack,
    l.shelf,
    l.bin,
    l.location_code,
    l.description,
    formatBoolean(l.active),
    l.created_at,
    l.updated_at,
  ];
}

function buildLocationCode(
  warehouseCode: string,
  zone: string,
  aisle: string,
  rack: string,
  shelf: string,
  bin: string
): string {
  return `${warehouseCode}-Z${zone}-${aisle}-R${rack}-S${shelf}-B${bin}`;
}

export class SheetsLocationRepository implements ILocationRepository {
  async findAll(warehouseId?: string): Promise<Location[]> {
    const rows = await readSheet(SHEETS.LOCATIONS, "A2:L");
    const locations = rows.filter((r) => r[0]).map(rowToLocation);
    return warehouseId
      ? locations.filter((l) => l.warehouse_id === warehouseId)
      : locations;
  }

  async findById(id: string): Promise<Location | null> {
    const rows = await readSheet(SHEETS.LOCATIONS, "A2:L");
    const row = rows.find((r) => r[0] === id);
    return row ? rowToLocation(row) : null;
  }

  async findByCode(code: string): Promise<Location | null> {
    const rows = await readSheet(SHEETS.LOCATIONS, "A2:L");
    const row = rows.find((r) => r[7] === code);
    return row ? rowToLocation(row) : null;
  }

  async create(input: CreateLocationInput): Promise<Location> {
    // Build location_code — need warehouse code
    // For simplicity, use warehouse_id prefix + zone/aisle/rack/shelf/bin
    const code = `${input.warehouse_id.substring(0, 4)}-Z${input.zone}-${input.aisle}-R${input.rack}-S${input.shelf}-B${input.bin}`;
    const now = new Date().toISOString();
    const location: Location = {
      location_id: uuidv4(),
      warehouse_id: input.warehouse_id,
      zone: input.zone,
      aisle: input.aisle,
      rack: input.rack,
      shelf: input.shelf,
      bin: input.bin,
      location_code: code,
      description: input.description,
      active: true,
      created_at: now,
      updated_at: now,
    };
    await appendRows(SHEETS.LOCATIONS, [locationToRow(location)]);
    return location;
  }

  async update(id: string, input: UpdateLocationInput): Promise<Location | null> {
    const rows = await readSheet(SHEETS.LOCATIONS, "A2:L");
    const idx = rows.findIndex((r) => r[0] === id);
    if (idx === -1) return null;
    const location = rowToLocation(rows[idx]);
    const updated: Location = {
      ...location,
      ...input,
      location_id: location.location_id,
      updated_at: new Date().toISOString(),
    };
    await updateRow(SHEETS.LOCATIONS, idx + 2, locationToRow(updated));
    return updated;
  }
}

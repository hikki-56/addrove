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
import { normalizeWarehouseId } from "@/lib/warehouse-utils";

function generateUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

// Columns: location_id (รหัสอ้างอิงตำแหน่ง), warehouse_id (รหัสอ้างอิงโกดัง), location_code (รหัสตำแหน่ง), location_name (ชื่อตำแหน่ง), description (รายละเอียด), active (สถานะ), created_at (วันที่สร้าง), updated_at (วันที่แก้ไข)
function rowToLocation(row: string[]): Location {
  // Check if legacy 12-column layout (where row[7] is location_code)
  const isLegacy = row.length >= 12 && Boolean(row[7]);
  if (isLegacy) {
    return {
      location_id: row[0] ?? "",
      warehouse_id: row[1] ?? "",
      zone: row[2] ?? "",
      aisle: row[3] ?? "",
      rack: row[4] ?? "",
      shelf: row[5] ?? "",
      bin: row[6] ?? "",
      location_code: row[7] ?? "",
      location_name: row[7] ?? "",
      description: row[8] ?? "",
      active: parseBoolean(row[9]),
      created_at: row[10] ?? "",
      updated_at: row[11] ?? "",
    };
  }

  return {
    location_id: row[0] ?? "",
    warehouse_id: row[1] ?? "",
    location_code: row[2] ?? "",
    location_name: row[3] ?? row[2] ?? "",
    description: row[4] ?? "",
    active: parseBoolean(row[5]),
    created_at: row[6] ?? "",
    updated_at: row[7] ?? "",
  };
}

function locationToRow(l: Location): (string | boolean)[] {
  return [
    l.location_id,
    l.warehouse_id,
    l.location_code,
    l.location_name || l.location_code,
    l.description || "",
    formatBoolean(l.active),
    l.created_at,
    l.updated_at,
  ];
}
export class SheetsLocationRepository implements ILocationRepository {
  async findAll(warehouseId?: string): Promise<Location[]> {
    const [locRows1, locRows2, locRows3, shelfRows, shelvesTableRows] = await Promise.all([
      readSheet(SHEETS.LOCATIONS, "A2:H").catch(() => []),
      readSheet("LOCATIONS", "A2:H").catch(() => []),
      readSheet("LocationsTable", "A2:H").catch(() => []),
      readSheet(SHEETS.SHELVES, "A2:F").catch(() => []),
      readSheet("ShelvesTable", "A2:F").catch(() => []),
    ]);

    const locRows = locRows1.length > 0 ? locRows1 : locRows2.length > 0 ? locRows2 : locRows3;
    const allShelves = [...(shelfRows || []), ...(shelvesTableRows || [])];
    const shelfMapByLocId = new Map<string, { shelf_code: string; shelf_name: string; shelf_level: string }>();

    for (const r of allShelves) {
      if (!r || !r[1]) continue;
      // Col 0: slf-id, Col 1: loc-id, Col 2: shelf_code (SH-A1-L1), Col 3: shelf_name (ชั้นที่ 1), Col 4: shelf_level (1)
      const locId = r[1].trim();
      const code = r[2]?.trim() || "";
      const name = r[3]?.trim() || "";
      const level = r[4]?.trim() || "";

      if (locId) {
        const info = { shelf_code: code, shelf_name: name, shelf_level: level };
        shelfMapByLocId.set(locId, info);
        shelfMapByLocId.set(locId.toLowerCase(), info);
      }
    }

    const locations = locRows.filter((r) => r[0]).map((r) => {
      const loc = rowToLocation(r);
      const shelfData = shelfMapByLocId.get(loc.location_id) || shelfMapByLocId.get(loc.location_id.toLowerCase());
      if (shelfData) {
        if (shelfData.shelf_code) loc.shelf_code = shelfData.shelf_code;
        if (shelfData.shelf_name) loc.shelf_name = shelfData.shelf_name;
      }
      return loc;
    });

    if (warehouseId) {
      const targetWh = normalizeWarehouseId(warehouseId);
      return locations.filter((l) => normalizeWarehouseId(l.warehouse_id) === targetWh);
    }

    return locations;
  }

  async findById(id: string): Promise<Location | null> {
    const rows = await readSheet(SHEETS.LOCATIONS, "A2:H");
    const row = rows.find((r) => r[0] === id);
    return row ? rowToLocation(row) : null;
  }

  async findByCode(code: string): Promise<Location | null> {
    const rows = await readSheet(SHEETS.LOCATIONS, "A2:H");
    const row = rows.find((r) => r[2] === code || r[7] === code);
    return row ? rowToLocation(row) : null;
  }

  async create(input: CreateLocationInput): Promise<Location> {
    const code = input.location_code || (input.zone ? `${input.warehouse_id.substring(0, 4)}-Z${input.zone}-${input.aisle}-R${input.rack}-S${input.shelf}-B${input.bin}` : `LOC-${Date.now().toString().slice(-6)}`);
    const name = input.location_name || code;
    const now = new Date().toISOString();
    const location: Location = {
      location_id: `loc-${generateUuid()}`,
      warehouse_id: input.warehouse_id,
      location_code: code,
      location_name: name,
      zone: input.zone,
      aisle: input.aisle,
      rack: input.rack,
      shelf: input.shelf,
      bin: input.bin,
      description: input.description,
      active: true,
      created_at: now,
      updated_at: now,
    };
    await appendRows(SHEETS.LOCATIONS, [locationToRow(location)]);
    return location;
  }

  async update(id: string, input: UpdateLocationInput): Promise<Location | null> {
    const rows = await readSheet(SHEETS.LOCATIONS, "A2:H");
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

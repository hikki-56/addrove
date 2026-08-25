import { readSheet, appendRows, updateRow, SHEETS, clearSheetCache } from "@/lib/google-sheets/client";
import type { BomItem, BomFormula } from "@/types/models";

// Columns in Sheet 'BOM':
// [0] bom_id, [1] fg_sku, [2] fg_barcode, [3] fg_name, [4] fg_unit, [5] base_qty,
// [6] rm_sku, [7] rm_barcode, [8] rm_name, [9] rm_wh, [10] rm_qty_required,
// [11] rm_unit, [12] waste_percentage, [13] note, [14] active, [15] updated_at

export function rowToBomItem(row: string[]): BomItem {
  return {
    bom_id: row[0] ?? "",
    fg_sku: row[1] ?? "",
    fg_barcode: row[2] ?? "",
    fg_name: row[3] ?? "",
    fg_unit: row[4] ?? "ชุด",
    base_qty: Number(row[5]) || 1,
    rm_sku: row[6] ?? "",
    rm_barcode: row[7] ?? "",
    rm_name: row[8] ?? "",
    rm_wh: row[9] ?? "โกดัง2",
    rm_qty_required: Number(row[10]) || 1,
    rm_unit: row[11] ?? "ชิ้น",
    waste_percentage: Number(row[12]) || 0,
    note: row[13] ?? "",
    active: row[14] !== "FALSE" && row[14] !== "false",
    updated_at: row[15] ?? new Date().toISOString(),
  };
}

export function bomItemToRow(item: BomItem): (string | number | boolean)[] {
  return [
    item.bom_id,
    item.fg_sku,
    item.fg_barcode,
    item.fg_name,
    item.fg_unit,
    item.base_qty,
    item.rm_sku,
    item.rm_barcode,
    item.rm_name,
    item.rm_wh,
    item.rm_qty_required,
    item.rm_unit,
    item.waste_percentage,
    item.note,
    item.active ? "TRUE" : "FALSE",
    item.updated_at,
  ];
}

export function isBomHeaderRow(str: string): boolean {
  const s = (str || "").toLowerCase().trim();
  return (
    s === "bom_id" ||
    s === "fg_sku" ||
    s === "rm_sku" ||
    s === "sku" ||
    s === "รหัส bom" ||
    s === "รหัสสินค้า" ||
    s === "รหัส sku วัตถุดิบ" ||
    s === "ชื่อสินค้า" ||
    s === "บาร์โค้ด" ||
    (s.includes("รหัส") && s.includes("bom"))
  );
}

export class SheetsBomRepository {
  async getAllItems(): Promise<BomItem[]> {
    try {
      const rows = await readSheet(SHEETS.BOM);
      return rows
        .map(rowToBomItem)
        .filter((i) => i.bom_id && i.fg_sku && !isBomHeaderRow(i.bom_id) && !isBomHeaderRow(i.fg_sku));
    } catch {
      return [];
    }
  }

  async getAllFormulas(): Promise<BomFormula[]> {
    // 1. Try relational tabs: BOM_Headers + BOM_Items
    try {
      const [headerRows, itemRows] = await Promise.all([
        readSheet(SHEETS.BOM_HEADERS, undefined, { forceFresh: true }).catch(() => []),
        readSheet(SHEETS.BOM_ITEMS, undefined, { forceFresh: true }).catch(() => []),
      ]);

      if (headerRows.length > 0 && itemRows.length > 0) {
        const formulaMap = new Map<string, BomFormula>();

        // Process Headers: [0] bom_id, [1] fg_sku, [2] fg_barcode, [3] fg_name, [4] fg_unit, [5] base_qty, [6] image, [7] active, [8] updated_at
        headerRows.forEach((row) => {
          const bomId = (row[0] ?? "").trim();
          const fgSku = (row[1] ?? "").trim();
          if (!bomId || !fgSku || isBomHeaderRow(bomId) || isBomHeaderRow(fgSku)) return;

          formulaMap.set(bomId, {
            bom_id: bomId,
            fg_sku: fgSku,
            fg_barcode: (row[2] ?? "").trim(),
            fg_name: (row[3] ?? "").trim() || fgSku,
            fg_unit: (row[4] ?? "ชุด").trim(),
            base_qty: Number(row[5]) || 1,
            active: row[7] !== "FALSE" && row[7] !== "false",
            updated_at: row[8] ?? new Date().toISOString(),
            items: [],
          });
        });

        // Process Items: [0] bom_id, [1] rm_sku, [2] rm_barcode, [3] rm_name, [4] rm_wh, [5] rm_qty_required, [6] rm_unit, [7] waste_percentage, [8] note, [9] updated_at
        itemRows.forEach((row) => {
          const bomId = (row[0] ?? "").trim();
          const rmSku = (row[1] ?? "").trim();
          if (!bomId || !rmSku || isBomHeaderRow(bomId) || isBomHeaderRow(rmSku)) return;

          const formula = formulaMap.get(bomId);
          if (formula) {
            formula.items.push({
              rm_sku: rmSku,
              rm_barcode: (row[2] ?? "").trim(),
              rm_name: (row[3] ?? "").trim() || rmSku,
              rm_wh: (row[4] ?? "โกดัง2").trim(),
              rm_qty_required: Number(row[5]) || 1,
              rm_unit: (row[6] ?? "ชิ้น").trim(),
              waste_percentage: Number(row[7]) || 0,
              note: (row[8] ?? "").trim(),
            });
          }
        });

        const list = Array.from(formulaMap.values()).filter((f) => f.items.length > 0);
        if (list.length > 0) {
          return list;
        }
      }
    } catch (e) {
      console.warn("[SheetsBomRepository] Failed reading BOM_Headers/BOM_Items, trying fallback:", e);
    }

    // 2. Fallback to single sheet tab 'BOM'
    const items = await this.getAllItems();
    const map = new Map<string, BomFormula>();

    for (const item of items) {
      if (isBomHeaderRow(item.bom_id) || isBomHeaderRow(item.fg_sku)) continue;

      if (!map.has(item.bom_id)) {
        map.set(item.bom_id, {
          bom_id: item.bom_id,
          fg_sku: item.fg_sku,
          fg_barcode: item.fg_barcode,
          fg_name: item.fg_name,
          fg_unit: item.fg_unit,
          base_qty: item.base_qty,
          active: item.active,
          updated_at: item.updated_at,
          items: [],
        });
      }

      map.get(item.bom_id)!.items.push({
        rm_sku: item.rm_sku,
        rm_barcode: item.rm_barcode,
        rm_name: item.rm_name,
        rm_wh: item.rm_wh,
        rm_qty_required: item.rm_qty_required,
        rm_unit: item.rm_unit,
        waste_percentage: item.waste_percentage,
        note: item.note,
      });
    }

    return Array.from(map.values());
  }

  async getFormulaBySku(fgSku: string): Promise<BomFormula | null> {
    const all = await this.getAllFormulas();
    return all.find((f) => f.fg_sku.toLowerCase() === fgSku.toLowerCase()) || null;
  }
}

export const bomRepository = new SheetsBomRepository();

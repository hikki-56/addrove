import {
  readSheet,
  appendRows,
  updateRow,
  deleteRows,
  SHEETS,
  clearSheetCache,
} from "@/lib/google-sheets/client";
import type { BomItem, BomFormula } from "@/types/models";

// วัตถุดิบหนึ่งรายการที่ส่งมาแก้ไขในสูตร
export type BomItemInput = Pick<
  BomItem,
  | "rm_sku"
  | "rm_barcode"
  | "rm_name"
  | "rm_wh"
  | "is_primary"
  | "rm_qty_required"
  | "rm_unit"
  | "waste_percentage"
  | "note"
>;

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

function parseItemColIndices(headerRow: string[] = []) {
  const norm = headerRow.map((c) => (c || "").trim().toLowerCase());
  const findIndex = (predicate: (s: string) => boolean) => norm.findIndex(predicate);

  const bomIdIdx = findIndex((s) => s.includes("bom"));
  const rmSkuIdx = findIndex((s) => s.includes("sku"));
  const rmBarcodeIdx = findIndex((s) => s.includes("barcode") || s.includes("บาร์โค้ด"));
  const rmNameIdx = findIndex((s) => s.includes("ชื่อ") || s.includes("name"));
  const isPrimaryIdx = findIndex((s) => s.includes("ตัวหลัก") || s.includes("หลัก") || s.includes("primary"));
  const rmWhIdx = findIndex((s) => s.includes("คลัง") || s.includes("โกดัง") || s.includes("wh"));
  const qtyIdx = findIndex((s) => s.includes("จำนวน") || s.includes("qty"));
  const unitIdx = findIndex((s) => s.includes("หน่วย") || s.includes("unit"));
  const wasteIdx = findIndex((s) => s.includes("สูญเสีย") || s.includes("waste"));
  const noteIdx = findIndex((s) => s.includes("หมายเหตุ") || s.includes("note"));

  return {
    bomId: bomIdIdx >= 0 ? bomIdIdx : 0,
    rmSku: rmSkuIdx >= 0 ? rmSkuIdx : 1,
    rmBarcode: rmBarcodeIdx >= 0 ? rmBarcodeIdx : 2,
    rmName: rmNameIdx >= 0 ? rmNameIdx : 3,
    isPrimary: isPrimaryIdx,
    rmWh: rmWhIdx,
    qty: qtyIdx >= 0 ? qtyIdx : 5,
    unit: unitIdx >= 0 ? unitIdx : 6,
    waste: wasteIdx,
    note: noteIdx >= 0 ? noteIdx : 7,
  };
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
        // แคชสั้น 30 วิ — สูตรเปลี่ยนน้อย และทุก path เขียน (append/update/delete) เคลียร์แคชให้อยู่แล้ว
        readSheet(SHEETS.BOM_HEADERS, undefined, { maxAgeMs: 30_000 }).catch(() => []),
        readSheet(SHEETS.BOM_ITEMS, undefined, { maxAgeMs: 30_000 }).catch(() => []),
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

        // Dynamic header mapping for items
        const headerRow = itemRows.find((r) => r.some((c) => isBomHeaderRow(c))) || itemRows[0];
        const colMap = parseItemColIndices(headerRow);

        // Process Items
        itemRows.forEach((row) => {
          const bomId = (row[colMap.bomId] ?? "").trim();
          const rmSku = (row[colMap.rmSku] ?? "").trim();
          if (!bomId || !rmSku || isBomHeaderRow(bomId) || isBomHeaderRow(rmSku)) return;

          const formula = formulaMap.get(bomId);
          if (formula) {
            const rawPrimary = colMap.isPrimary >= 0 ? (row[colMap.isPrimary] ?? "").trim() : "";
            const isPrimary = rawPrimary === "1" || rawPrimary.toLowerCase() === "true" ? 1 : 0;

            formula.items.push({
              rm_sku: rmSku,
              rm_barcode: (row[colMap.rmBarcode] ?? "").trim(),
              rm_name: (row[colMap.rmName] ?? "").trim() || rmSku,
              rm_wh: (colMap.rmWh >= 0 ? row[colMap.rmWh] : "โกดัง2")?.trim() || "โกดัง2",
              is_primary: isPrimary,
              rm_qty_required: Number(row[colMap.qty]) || 1,
              rm_unit: (row[colMap.unit] ?? "ชิ้น").trim(),
              waste_percentage: colMap.waste >= 0 ? Number(row[colMap.waste]) || 0 : 0,
              note: (colMap.note >= 0 ? row[colMap.note] ?? "" : "").trim(),
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
        is_primary: item.is_primary ?? 0,
        note: item.note,
      });
    }

    return Array.from(map.values());
  }

  async getFormulaBySku(fgSku: string): Promise<BomFormula | null> {
    const all = await this.getAllFormulas();
    return all.find((f) => f.fg_sku.toLowerCase() === fgSku.toLowerCase()) || null;
  }

  /**
   * แทนที่วัตถุดิบทั้งหมดของสูตร (bomId) ในชีต BOM_Items
   * กลยุทธ์: ลบแถวเดิมของสูตรแล้ว append แถวใหม่ที่ท้ายชีต —
   * reader จับกลุ่มด้วย bom_id จึงไม่มีผลต่อการอ่านไม่ว่าแถวอยู่ตรงไหน
   */
  async updateFormulaItems(bomId: string, items: BomItemInput[]): Promise<void> {
    // อ่านแบบ raw (คง header ไว้) เพื่อให้ index ของ array ตรงกับแถวจริงของชีต
    const itemRows = await readSheet(SHEETS.BOM_ITEMS, undefined, {
      forceFresh: true,
      keepHeader: true,
    });

    const headerIdx = itemRows.findIndex((r) => r.some((c) => isBomHeaderRow(c)));
    const headerRow = headerIdx >= 0 ? itemRows[headerIdx] : itemRows[0];
    const colMap = parseItemColIndices(headerRow);

    // หาแถวเดิมของสูตรนี้ทั้งหมด (ข้ามแถวหัวตาราง)
    const existingRowIdx: number[] = [];
    itemRows.forEach((row, idx) => {
      if (idx === headerIdx) return;
      const rowBomId = (row[colMap.bomId] ?? "").trim();
      if (rowBomId === bomId && !isBomHeaderRow(rowBomId)) {
        existingRowIdx.push(idx);
      }
    });

    const colCount = Math.max(
      headerRow?.length ?? 0,
      colMap.bomId + 1,
      colMap.rmSku + 1,
      colMap.rmBarcode + 1,
      colMap.rmName + 1,
      colMap.qty + 1,
      colMap.unit + 1,
      colMap.isPrimary + 1,
      colMap.rmWh + 1,
      colMap.waste + 1,
      colMap.note + 1
    );

    const buildRow = (item: BomItemInput): (string | number)[] => {
      const row: (string | number)[] = new Array(colCount).fill("");
      row[colMap.bomId] = bomId;
      row[colMap.rmSku] = item.rm_sku;
      row[colMap.rmBarcode] = item.rm_barcode || "";
      row[colMap.rmName] = item.rm_name || item.rm_sku;
      if (colMap.rmWh >= 0) row[colMap.rmWh] = item.rm_wh || "โกดัง2";
      if (colMap.isPrimary >= 0) row[colMap.isPrimary] = item.is_primary === 1 ? "1" : "0";
      row[colMap.qty] = item.rm_qty_required;
      row[colMap.unit] = item.rm_unit || "ชิ้น";
      if (colMap.waste >= 0) row[colMap.waste] = item.waste_percentage || 0;
      if (colMap.note >= 0) row[colMap.note] = item.note || "";
      return row;
    };

    // 1. เพิ่มวัตถุดิบชุดใหม่ต่อท้ายชีตก่อน — ถ้าขั้นถัดไปพลาด ข้อมูลเดิมยังอยู่ครบ
    //    (failure mode เป็นแถวซ้ำที่กู้คืนได้ แทนที่จะเป็นสูตรหายถาวร)
    if (items.length > 0) {
      await appendRows(SHEETS.BOM_ITEMS, items.map(buildRow));
    }

    // 2. ลบแถวเดิมทั้งหมดของสูตร (deleteRows เรียง index มากไปน้อยให้เองภายใน call เดียว
    //    และ append ไม่ขยับตำแหน่งแถวเดิม จึงใช้ index ที่คำนวณไว้ก่อนหน้าได้)
    if (existingRowIdx.length > 0) {
      await deleteRows(SHEETS.BOM_ITEMS, existingRowIdx);
    }

    // 3. อัปเดต updated_at ของสูตรใน BOM_Headers ([8] updated_at)
    try {
      const headerSheetRows = await readSheet(SHEETS.BOM_HEADERS, undefined, {
        forceFresh: true,
        keepHeader: true,
      });
      const hIdx = headerSheetRows.findIndex(
        (r) => (r[0] ?? "").trim() === bomId && !isBomHeaderRow(r[0] ?? "")
      );
      if (hIdx >= 0) {
        const row = [...(headerSheetRows[hIdx] ?? [])];
        while (row.length < 9) row.push("");
        row[8] = new Date().toISOString();
        await updateRow(SHEETS.BOM_HEADERS, hIdx + 1, row);
      }
    } catch (e) {
      // ไม่ถือว่าเป็นความล้มเหลวของการแก้ไข ถ้าอัปเดต timestamp ไม่ได้
      console.warn("[SheetsBomRepository] Failed updating BOM_Headers.updated_at:", e);
      clearSheetCache(SHEETS.BOM_HEADERS);
    }
  }
}

export const bomRepository = new SheetsBomRepository();

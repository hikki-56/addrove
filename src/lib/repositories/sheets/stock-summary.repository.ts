import {
  readSheet,
  appendRows,
  batchUpdateRows,
  deleteRows,
  SHEETS,
} from "@/lib/google-sheets/client";
import type { IStockSummaryRepository } from "../interfaces";
import type { StockSummary } from "@/types/models";
import { withKeyedLock } from "@/lib/keyed-lock";

// Columns: product_id, warehouse_id, location_id, quantity, last_updated
function rowToSummary(row: string[]): StockSummary {
  return {
    product_id: row[0] ?? "",
    warehouse_id: row[1] ?? "",
    location_id: row[2] ?? "",
    quantity: parseFloat(row[3] ?? "0") || 0,
    last_updated: row[4] ?? "",
  };
}

export class SheetsStockSummaryRepository implements IStockSummaryRepository {
  private async getAllRows(): Promise<string[][]> {
    return readSheet(SHEETS.STOCK_SUMMARY, "A2:E");
  }

  async findAll(warehouseId?: string): Promise<StockSummary[]> {
    const rows = await this.getAllRows();
    const summaries = rows.filter((r) => r[0]).map(rowToSummary);
    return warehouseId
      ? summaries.filter((s) => s.warehouse_id === warehouseId)
      : summaries;
  }

  async findByProductAndLocation(
    productId: string,
    warehouseId: string,
    locationId: string
  ): Promise<StockSummary | null> {
    const rows = await this.getAllRows();
    const row = rows.find(
      (r) => r[0] === productId && r[1] === warehouseId && r[2] === locationId
    );
    return row ? rowToSummary(row) : null;
  }

  async applyChanges(
    changes: {
      productId: string;
      warehouseId: string;
      locationId: string;
      delta: number;
    }[]
  ): Promise<void> {
    try {
      await withKeyedLock("stock-summary", async () => {
        const rows = await this.getAllRows().catch(() => []);
        const now = new Date().toISOString();
        const updates: { rowNumber: number; values: (string | number)[] }[] = [];
        const newRows: (string | number)[][] = [];

        const aggregated = new Map<
          string,
          { productId: string; warehouseId: string; locationId: string; delta: number }
        >();
        for (const change of changes) {
          const key = `${change.productId}|${change.warehouseId}|${change.locationId}`;
          const current = aggregated.get(key);
          if (current) current.delta += change.delta;
          else aggregated.set(key, { ...change });
        }

        // Build fast lookup Map from existing rows: key -> rowIndex
        const rowIndexMap = new Map<string, number>();
        rows.forEach((r, idx) => {
          if (r[0]) {
            const key = `${r[0]}|${r[1]}|${r[2]}`;
            rowIndexMap.set(key, idx);
          }
        });

        for (const change of aggregated.values()) {
          const key = `${change.productId}|${change.warehouseId}|${change.locationId}`;
          const idx = rowIndexMap.get(key);

          if (idx !== undefined && idx !== -1) {
            const current = parseFloat(rows[idx][3] ?? "0") || 0;
            const newQty = current + change.delta;
            rows[idx][3] = String(newQty);
            rows[idx][4] = now;
            updates.push({
              rowNumber: idx + 2,
              values: [
                change.productId,
                change.warehouseId,
                change.locationId,
                newQty,
                now,
              ],
            });
          } else {
            newRows.push([
              change.productId,
              change.warehouseId,
              change.locationId,
              change.delta,
              now,
            ]);
          }
        }

        if (updates.length > 0) {
          // Do not swallow: summary drift makes stock numbers lie silently
          await batchUpdateRows(SHEETS.STOCK_SUMMARY, updates);
        }
        if (newRows.length > 0) {
          await appendRows(SHEETS.STOCK_SUMMARY, newRows);
        }
      });
    } catch (err) {
      console.error("[SheetsStockSummaryRepository] applyChanges error:", err);
      throw err;
    }
  }

  async rebuild(): Promise<void> {
    try {
      await withKeyedLock("stock-summary", async () => {
        // อ่าน movement ทั้งหมดแล้วคำนวณยอดคงเหลือใหม่ (qty_change บันทึกแบบมีเครื่องหมายอยู่แล้ว)
        const movRows = await readSheet(SHEETS.STOCK_MOVEMENTS, "A2:J");
        if (movRows.length === 0) {
          throw new Error(
            "Rebuild ถูกยกเลิก: StockMovements ว่างเปล่า — ไม่ปลอดภัยที่จะสร้าง StockSummary ใหม่จากประวัติที่ไม่มีข้อมูล"
          );
        }

        const balanceMap = new Map<string, number>();
        const now = new Date().toISOString();

        for (const row of movRows.filter((r) => r[0] && r[0] !== "product_id")) {
          const key = `${row[2]}|${row[3]}|${row[4]}`;
          const qty = parseFloat(row[5] ?? "0") || 0;
          balanceMap.set(key, (balanceMap.get(key) ?? 0) + qty);
        }

        // ห้ามบันทึกยอดติดลบ — ถ้าประวัติไม่สมดุลให้ clamp เป็น 0 พร้อม log เตือน
        // Map key เดียวต่อ product|warehouse|location จึงไม่มีแถวซ้ำ
        const newSummaries: { key: string; values: (string | number)[] }[] = [];
        for (const [key, qty] of balanceMap) {
          if (qty < 0) {
            console.warn(
              `[SheetsStockSummaryRepository] rebuild: ยอดคงเหลือติดลบ (${qty}) ที่ "${key}" จากประวัติ StockMovements — บันทึกเป็น 0`
            );
          }
          const [productId, warehouseId, locationId] = key.split("|");
          newSummaries.push({
            key,
            values: [productId, warehouseId, locationId, Math.max(0, qty), now],
          });
        }

        if (newSummaries.length === 0) {
          throw new Error("Rebuild ถูกยกเลิก: คำนวณยอดคงเหลือจาก StockMovements ไม่ได้ผลลัพธ์");
        }

        const currentRows = await this.getAllRows();
        const existingIndexByKey = new Map<string, number>();
        currentRows.forEach((r, idx) => {
          if (!r[0]) return;
          const key = `${r[0]}|${r[1]}|${r[2]}`;
          // แถวซ้ำในชีตเดิม: จับคู่กับแถวแรกไว้ ส่วนที่เหลือถือเป็น stale (ถูกลบตอนท้าย)
          if (!existingIndexByKey.has(key)) {
            existingIndexByKey.set(key, idx);
          }
        });

        // upsert: แก้แถวเดิมให้ตรง key / เพิ่มเฉพาะ key ที่ยังไม่มี
        const updates: { rowNumber: number; values: (string | number)[] }[] = [];
        const inserts: (string | number)[][] = [];
        for (const item of newSummaries) {
          const existingIdx = existingIndexByKey.get(item.key);
          if (existingIdx !== undefined) {
            updates.push({ rowNumber: existingIdx + 2, values: item.values });
          } else {
            inserts.push(item.values);
          }
        }

        // เขียนข้อมูลใหม่ก่อน — ยังไม่ลบอะไรทิ้ง
        if (updates.length > 0) {
          await batchUpdateRows(SHEETS.STOCK_SUMMARY, updates);
        }
        if (inserts.length > 0) {
          await appendRows(SHEETS.STOCK_SUMMARY, inserts);
        }

        // ยืนยันว่าข้อมูลใหม่ถูกอ่านกลับมาได้ครบและถูกต้อง ก่อนแตะข้อมูลเดิมเพิ่ม
        const verifyRows = await this.getAllRows();
        const verifiedByKey = new Map<string, number>();
        verifyRows.forEach((r) => {
          if (!r[0]) return;
          verifiedByKey.set(`${r[0]}|${r[1]}|${r[2]}`, parseFloat(r[3] ?? "0") || 0);
        });
        const verifyOk = newSummaries.every((item) => {
          const expectedQty = item.values[3] as number;
          return verifiedByKey.get(item.key) === expectedQty;
        });

        if (!verifyOk) {
          // rollback: คืนค่าแถวที่ update เป็นค่าเดิม และลบเฉพาะแถวที่เพิ่มใหม่ — ข้อมูลเดิมต้องอยู่ครบ
          try {
            if (updates.length > 0) {
              await batchUpdateRows(
                SHEETS.STOCK_SUMMARY,
                updates.map((u) => ({
                  rowNumber: u.rowNumber,
                  values: currentRows[u.rowNumber - 2] ?? u.values,
                }))
              );
            }
            if (inserts.length > 0) {
              const appendedIndices: number[] = [];
              verifyRows.forEach((r, idx) => {
                const key = `${r[0]}|${r[1]}|${r[2]}`;
                if (r[4] === now && !existingIndexByKey.has(key)) appendedIndices.push(idx + 1);
              });
              await deleteRows(SHEETS.STOCK_SUMMARY, appendedIndices);
            }
          } catch (rollbackErr) {
            console.error(
              `[SheetsStockSummaryRepository] rebuild rollback ล้มเหลวสำหรับชีต "${SHEETS.STOCK_SUMMARY}" — ต้องตรวจสอบชีตด้วยตนเอง:`,
              rollbackErr
            );
          }
          throw new Error(
            "Rebuild ถูกยกเลิก: ยืนยันข้อมูลใหม่ไม่สำเร็จ — ข้อมูล StockSummary เดิมถูกคืนค่าแล้ว"
          );
        }

        // ลบแถวที่เกิน/ล้าสมัยเป็นขั้นสุดท้าย:
        // (a) key ที่ไม่มีใน movement history (เช่น product_id รูปแบบเก่าที่จับคู่ไม่ได้)
        // (b) แถวซ้ำของ key เดียวกัน — เหลือแถวแรกเท่านั้น เพื่อไม่ให้ยอดถูกนับซ้ำ
        const liveKeys = new Set(newSummaries.map((item) => item.key));
        const firstOccurrenceByKey = new Map<string, number>();
        verifyRows.forEach((r, idx) => {
          if (!r[0]) return;
          const key = `${r[0]}|${r[1]}|${r[2]}`;
          if (!firstOccurrenceByKey.has(key)) firstOccurrenceByKey.set(key, idx);
        });
        const staleRowIndices: number[] = [];
        verifyRows.forEach((r, idx) => {
          if (!r[0]) return;
          const key = `${r[0]}|${r[1]}|${r[2]}`;
          if (!liveKeys.has(key) || firstOccurrenceByKey.get(key) !== idx) {
            staleRowIndices.push(idx + 1);
          }
        });
        if (staleRowIndices.length > 0) {
          await deleteRows(SHEETS.STOCK_SUMMARY, staleRowIndices);
        }
      });
    } catch (err) {
      console.error(`[SheetsStockSummaryRepository] rebuild error บนชีต "${SHEETS.STOCK_SUMMARY}":`, err);
      throw err;
    }
  }
}

import {
  SHEETS,
  readSheet,
  appendRows,
  updateRow,
  batchUpdateRows,
  ensureSheetTabExists,
} from "@/lib/google-sheets/client";
import type { OutboundBillItem, BillQAssignment } from "@/types/models";

export const Q_ITEMS_SHEET_HEADERS = [
  "รหัสกล่อง",
  "เลขที่บิล",
  "ลูกค้า",
  "รหัสสินค้า (SKU)",
  "ชื่อสินค้า",
  "ตำแหน่งชั้นวาง",
  "จำนวนต้องหยิบ",
  "หยิบได้จริง",
  "สถานะรายการ",
  "บาร์โค้ด",
  "วันที่นำเข้า",
];

function clean(v?: string): string {
  return (v ?? "").trim().toLowerCase().replace(/[\s\-_#]/g, "");
}

function formatNowThai(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

export interface SyncBillEntry {
  express_bill_no: string;
  customer?: string;
  items: OutboundBillItem[];
  q_assignments?: BillQAssignment[];
  imported_at?: string;
}

/**
 * บันทึกรายการสินค้าที่ถูกจัดลงกล่อง Q ทั้งหมดลงแท็บ "รายการสินค้ากล่อง_Q" ใน Google Sheets
 */
export async function syncBillQAssignmentsToSheet(bills: SyncBillEntry[]): Promise<void> {
  try {
    const rowsToAppend: (string | number)[][] = [];
    const defaultDate = formatNowThai();

    for (const b of bills) {
      if (!b.q_assignments || b.q_assignments.length === 0) continue;

      const itemsMap = new Map<string, OutboundBillItem>();
      for (const it of b.items) {
        itemsMap.set(clean(it.sku), it);
        if (it.barcode) itemsMap.set(clean(it.barcode), it);
      }

      const importedDate = b.imported_at ? b.imported_at.replace("T", " ").slice(0, 19) : defaultDate;

      for (const q of b.q_assignments) {
        for (const qItem of q.items) {
          const detail = itemsMap.get(clean(qItem.sku));
          rowsToAppend.push([
            q.q_code,                                                   // A: รหัสกล่อง
            b.express_bill_no,                                          // B: เลขที่บิล
            b.customer || "",                                           // C: ลูกค้า
            detail?.sku || qItem.sku,                                   // D: รหัสสินค้า (SKU)
            detail?.product_name || "",                                 // E: ชื่อสินค้า
            detail?.location_hint || detail?.location_id || "",         // F: ตำแหน่งชั้นวาง
            qItem.qty,                                                  // G: จำนวนต้องหยิบ
            0,                                                          // H: หยิบได้จริง (เริ่มต้น 0)
            "รอหยิบ",                                                   // I: สถานะรายการ
            detail?.barcode || "",                                      // J: บาร์โค้ด
            importedDate,                                               // K: วันที่นำเข้า
          ]);
        }
      }
    }

    if (rowsToAppend.length === 0) return;

    // ตรวจสอบและสร้างแท็บพร้อมหัวตารางหากยังไม่มี
    await ensureSheetTabExists(SHEETS.OUTBOUND_Q_ITEMS, Q_ITEMS_SHEET_HEADERS);
    // เพิ่มแถวรายการสินค้า
    await appendRows(SHEETS.OUTBOUND_Q_ITEMS, rowsToAppend);
  } catch (err) {
    console.error("[q-sheets-sync] syncBillQAssignmentsToSheet failed:", err);
  }
}

/**
 * อัปเดตจำนวนที่หยิบได้และสถานะของรายการในกล่อง Q หลังพนักงานสแกนหยิบของ
 */
export async function updateQItemScanInSheet(params: {
  q_code: string;
  scanned: string;
  qtyPicked: number;
  qtyRequired?: number;
  status?: string;
}): Promise<void> {
  try {
    const rawRows = await readSheet(SHEETS.OUTBOUND_Q_ITEMS, undefined, { forceFresh: true });
    if (!rawRows || rawRows.length <= 1) return;

    const scanClean = clean(params.scanned);
    const qCodeTarget = params.q_code.trim().toUpperCase();

    for (let r = rawRows.length - 1; r >= 1; r--) {
      const row = rawRows[r];
      const rowQ = (row[0] ?? "").trim().toUpperCase();
      const rowSku = clean(row[3]);
      const rowBarcode = clean(row[9]);
      const rowStatus = row[8] ?? "";

      if (rowQ === qCodeTarget && rowStatus !== "แพ็กเสร็จแล้ว") {
        if (rowSku === scanClean || rowBarcode === scanClean || scanClean.includes(rowSku)) {
          const qtyRequired = params.qtyRequired ?? (Number(row[6]) || 1);
          const qtyPicked = params.qtyPicked;

          let newStatusText = "กำลังหยิบ";
          if (params.status === "SHORTAGE") {
            newStatusText = "ของไม่ครบ";
          } else if (qtyPicked >= qtyRequired) {
            newStatusText = "หยิบครบ";
          }

          const updatedRow = [...row];
          while (updatedRow.length < 11) updatedRow.push("");
          updatedRow[7] = String(qtyPicked);
          updatedRow[8] = newStatusText;

          await updateRow(SHEETS.OUTBOUND_Q_ITEMS, r + 1, updatedRow);
          return;
        }
      }
    }
  } catch (err) {
    console.error("[q-sheets-sync] updateQItemScanInSheet failed:", err);
  }
}

/**
 * อัปเดตสถานะของกล่อง Q ทั้งกล่อง (เช่น เริ่มหยิบ = "กำลังหยิบ" หรือ แพ็กเสร็จ = "แพ็กเสร็จแล้ว")
 */
export async function markQBoxStatusInSheet(params: {
  q_code: string;
  newStatus: "กำลังหยิบ" | "แพ็กเสร็จแล้ว" | "รอหยิบ";
  billNo?: string;
}): Promise<void> {
  try {
    const rawRows = await readSheet(SHEETS.OUTBOUND_Q_ITEMS, undefined, { forceFresh: true });
    if (!rawRows || rawRows.length <= 1) return;

    const qCodeTarget = params.q_code.trim().toUpperCase();
    const updates: { rowNumber: number; values: (string | number | boolean)[] }[] = [];

    for (let r = 1; r < rawRows.length; r++) {
      const row = rawRows[r];
      const rowQ = (row[0] ?? "").trim().toUpperCase();
      const rowBill = (row[1] ?? "").trim();
      const rowStatus = row[8] ?? "";

      if (rowQ === qCodeTarget) {
        if (params.billNo && rowBill !== params.billNo.trim()) continue;
        if (rowStatus === "แพ็กเสร็จแล้ว" && params.newStatus !== "แพ็กเสร็จแล้ว") continue;

        const updatedRow = [...row];
        while (updatedRow.length < 11) updatedRow.push("");
        if (params.newStatus === "กำลังหยิบ" && rowStatus === "หยิบครบ") continue;

        updatedRow[8] = params.newStatus;
        updates.push({ rowNumber: r + 1, values: updatedRow });
      }
    }

    if (updates.length > 0) {
      await batchUpdateRows(SHEETS.OUTBOUND_Q_ITEMS, updates);
    }
  } catch (err) {
    console.error("[q-sheets-sync] markQBoxStatusInSheet failed:", err);
  }
}
// Helpers กลางสำหรับอ่าน/จับคู่ข้อมูลใบผลิตจากแท็บชีต
// ใช้ร่วมระหว่าง /api/production/orders และ /api/production/orders/[order_no]/review

import { readSheet, SHEETS } from "@/lib/google-sheets/client";
import { getWarehouseName } from "@/lib/warehouse-utils";
import type {
  ProductionOrderRecord,
  ProductionOrderItem,
  InspectionRound,
  InspectionMaterialResult,
} from "@/types/production";

export function cleanCode(str?: string): string {
  if (!str) return "";
  return String(str)
    .trim()
    .toLowerCase()
    .replace(/^prod-/, "")
    .replace(/[\s\-_]/g, "");
}

/**
 * ตรวจว่าเอกสารในแท็บ Documents เป็นใบผลิตหรือไม่
 * ใบผลิตรุ่นเก่าถูกบันทึก document_type เป็น "RECEIVE" ตอนสร้าง — ต้องอาศัยสัญญาณอื่น
 * (เลขเอกสาร PRD- / id ของเอกสาร / type ใน note) เพื่อกันไม่ให้หลุดเข้าคิวอนุมัติและประวัติการรับเข้า
 */
export function isProductionOrderDocument(doc: {
  document_id?: string | null;
  document_no?: string | null;
  reference_no?: string | null;
  note?: string | null;
}): boolean {
  const identifiers = [doc.document_no, doc.reference_no]
    .filter(Boolean)
    .map((v) => String(v).trim().toUpperCase());
  if (identifiers.some((v) => v.startsWith("PRD-"))) return true;
  if (String(doc.document_id || "").toLowerCase().includes("doc-prd-")) return true;
  return String(doc.note || "").includes('"type":"PRODUCTION_ORDER"');
}

/** แปลงคอลัมน์ "วัตถุดิบใช้จริง/เสียจริง (JSON)" ของแถวแรกในรอบ → รายการวัตถุดิบที่รายงาน */
export function parseReportedMaterials(raw: string | undefined): InspectionMaterialResult[] | undefined {
  const text = String(raw || "").trim();
  if (!text.startsWith("[")) return undefined;
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return undefined;
    const items = parsed
      .map((m: any) => ({
        rm_sku: String(m?.rm_sku || "").trim(),
        rm_name: String(m?.rm_name || m?.rm_sku || "").trim(),
        used_qty: Math.max(0, Number(m?.used_qty) || 0),
        wasted_qty: Math.max(0, Number(m?.wasted_qty) || 0),
      }))
      .filter((m: InspectionMaterialResult) => m.rm_sku && m.used_qty + m.wasted_qty > 0);
    return items.length > 0 ? items : undefined;
  } catch {
    return undefined;
  }
}

/**
 * อ่านใบผลิตจากระบบใหม่ (แท็บ "ใบผลิต" + "ใบผลิต_วัตถุดิบ" + "ตรวจการผลิต")
 * คืน Map ที่ key ด้วย order_no ตัวพิมพ์เล็ก
 */
export async function loadProductionOrdersFromSheets(): Promise<
  Map<string, ProductionOrderRecord>
> {
  const orderMap = new Map<string, ProductionOrderRecord>();

  const [orderRows, materialRows, inspectionRows] = await Promise.all([
    readSheet(SHEETS.PRODUCTION_ORDERS, "A2:P").catch(() => [] as string[][]),
    readSheet(SHEETS.PRODUCTION_MATERIALS, "A2:I").catch(() => [] as string[][]),
    readSheet(SHEETS.PRODUCTION_INSPECTIONS, "A2:R").catch(() => [] as string[][]),
  ]);

  // 1. แท็บ "ใบผลิต" — หนึ่งแถวต่อใบ × รายการสินค้า
  for (const r of orderRows) {
    if (!r || !r[0] || !r[4]) continue;
    const orderNo = String(r[0]).trim();
    if (!orderNo) continue;
    const key = orderNo.toLowerCase();
    const ordered = Number(r[7]) || 0;
    const produced = Number(r[8]) || 0;
    const defect = Number(r[9]) || 0;
    const fgSku = String(r[4]).trim();
    const tableNo = Math.floor(Number(r[15]) || 0);

    const item: ProductionOrderItem = {
      fg_sku: fgSku,
      fg_barcode: "",
      fg_name: String(r[5] || `สินค้า ${fgSku}`),
      fg_unit: String(r[6] || "ชิ้น"),
      table_no: tableNo >= 1 && tableNo <= 5 ? tableNo : undefined,
      quantity: ordered,
      produced_qty: produced,
      defect_qty: defect,
      image: `/products/${fgSku}.jpg`,
      target_warehouse_id: "wh-02",
      target_warehouse_name: "โกดัง 2 (สินค้าสำเร็จรูป)",
      materials: [],
    };

    const existing = orderMap.get(key);
    if (existing) {
      // แถวถัดไปของใบเดิม — เติมรายการสินค้า (สินค้าเดียวกันคนละโต๊ะ = คนละรายการ)
      if (!existing.items.some((i) => cleanCode(i.fg_sku) === cleanCode(fgSku) && i.table_no === item.table_no)) {
        existing.items.push(item);
        existing.total_fg_qty += ordered;
      }
    } else {
      const leftoverWh = String(r[13] || "").trim();
      const leftoverLoc = String(r[14] || "").trim();
      orderMap.set(key, {
        id: String(r[1] || orderNo),
        order_no: orderNo,
        document_id: String(r[1] || orderNo),
        reference_no: orderNo,
        status: (String(r[3] || "PENDING").trim() || "PENDING") as ProductionOrderRecord["status"],
        items: [item],
        total_fg_qty: ordered,
        total_materials_count: 0,
        created_by: "admin",
        created_by_name: String(r[10] || "ผู้ดูแลระบบ (Admin)"),
        created_at: String(r[11] || ""),
        document_date: String(r[2] || "").slice(0, 10),
        note: String(r[12] || "") || undefined,
        leftover_destination:
          leftoverWh || leftoverLoc
            ? {
                warehouse_id: leftoverWh,
                warehouse_name: leftoverWh ? getWarehouseName(leftoverWh) : undefined,
                location: leftoverLoc,
              }
            : null,
      });
    }
  }

  // 2. แท็บ "ใบผลิต_วัตถุดิบ" — สรุปวัตถุดิบรวมต่อใบ
  for (const r of materialRows) {
    if (!r || !r[0] || !r[1]) continue;
    const key = String(r[0]).trim().toLowerCase();
    const order = orderMap.get(key);
    if (!order) continue;
    if (!order.materials_summary) order.materials_summary = [];
    if (order.materials_summary.some((m) => cleanCode(m.rm_sku) === cleanCode(String(r[1])))) continue;
    order.materials_summary.push({
      rm_sku: String(r[1]),
      rm_name: String(r[2] || r[1]),
      rm_unit: String(r[3] || "ชิ้น"),
      planned_qty: Number(r[4]) || 0,
      used_qty: Number(r[5]) || 0,
      wasted_qty: Number(r[8]) || 0,
      leftover_qty: Number(r[6]) || 0,
    });
    order.total_materials_count = order.materials_summary.length;
  }

  // 3. แท็บ "ตรวจการผลิต" — ประวัติรอบการตรวจ (18 คอลัมน์)
  for (const r of inspectionRows) {
    if (!r || !r[0] || !r[1]) continue;
    const key = String(r[0]).trim().toLowerCase();
    const order = orderMap.get(key);
    if (!order) continue;
    const roundNo = Number(r[1]) || 1;
    const fgSku = String(r[3] || "").trim();
    if (!order.inspections) order.inspections = [];
    let round = order.inspections.find((x) => x.round_no === roundNo);
    if (!round) {
      const closeFlag = String(r[14] || "").trim().toUpperCase();
      const leftoverWh = String(r[15] || "").trim();
      const leftoverLoc = String(r[16] || "").trim();
      round = {
        round_no: roundNo,
        inspected_at: String(r[2] || ""),
        inspected_by: "",
        inspected_by_name: String(r[8] || ""),
        note: String(r[9] || "") || undefined,
        items: [],
        materials: parseReportedMaterials(r[17]),
        status: (String(r[10] || "SUBMITTED").trim() || "SUBMITTED") as NonNullable<InspectionRound["status"]>,
        reviewed_by_name: String(r[11] || "") || undefined,
        reviewed_at: String(r[12] || "") || undefined,
        review_note: String(r[13] || "") || undefined,
        close_order: closeFlag === "TRUE" || closeFlag === "ใช่" || closeFlag === "1",
        leftover_destination:
          leftoverWh || leftoverLoc
            ? {
                warehouse_id: leftoverWh,
                warehouse_name: leftoverWh ? getWarehouseName(leftoverWh) : undefined,
                location: leftoverLoc,
              }
            : null,
      };
      order.inspections.push(round);
    }
    if (fgSku && !round.items.some((i) => cleanCode(i.fg_sku) === cleanCode(fgSku))) {
      const whId = String(r[6] || "wh-02").trim();
      const orderItem = order.items.find((i) => cleanCode(i.fg_sku) === cleanCode(fgSku));
      round.items.push({
        fg_sku: fgSku,
        fg_name: orderItem?.fg_name || `สินค้า ${fgSku}`,
        good_qty: Number(r[4]) || 0,
        defect_qty: Number(r[5]) || 0,
        warehouse_id: whId,
        warehouse_name: getWarehouseName(whId),
        location: String(r[7] || ""),
      });
    }
  }
  // เรียงรอบตรวจจากน้อยไปมาก
  for (const order of orderMap.values()) {
    order.inspections?.sort((a, b) => a.round_no - b.round_no);
  }

  return orderMap;
}

/** หาแถวสินค้าในชีตโกดังด้วย SKU → บาร์โค้ด → ชื่อ (คืน index ใน array ที่อ่านจาก A2:Z) */
export function findWarehouseRowIndex(
  rows: string[][],
  sku: string,
  barcode?: string,
  name?: string
): number {
  const all = findAllWarehouseRowIndexes(rows, sku, barcode, name);
  return all.length > 0 ? all[0] : -1;
}

/** หาทุกแถวที่ตรงกับสินค้านี้ (สินค้าหนึ่งชนิดอาจวางหลายตำแหน่ง = หลายแถว) */
export function findAllWarehouseRowIndexes(
  rows: string[][],
  sku: string,
  barcode?: string,
  name?: string
): number[] {
  const normSku = cleanCode(sku);
  const normBarcode = barcode ? cleanCode(barcode) : "";
  const normName = name ? cleanCode(name) : "";
  const matches = new Set<number>();

  // Pass 1: SKU
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[0]) continue;
    if (cleanCode(r[0]) === normSku) matches.add(i);
  }
  // Pass 2: Barcode
  if (normBarcode) {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r || !r[1]) continue;
      if (cleanCode(r[1]) === normBarcode) matches.add(i);
    }
  }
  // Pass 3: ชื่อ — ใช้เมื่อยังไม่เจอเลย
  if (matches.size === 0 && normName) {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r || !r[2]) continue;
      if (cleanCode(r[2]) === normName) matches.add(i);
    }
  }

  return Array.from(matches).sort((a, b) => a - b);
}

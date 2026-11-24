import type { CountReferenceRow } from "@/types/count-round";

function amount(text: string | undefined, row: number) {
  const value = text?.trim() ?? "";
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(value))
    throw new Error(`แถว ${row} อ่านจำนวนในรายงานคลังไม่ได้`);
  return Number(value.replaceAll(",", ""));
}

function norm(text: string | undefined) {
  return (text ?? "").replace(/^\uFEFF/, "").replace(/\s+/g, " ").trim();
}

function cellName(text: string | undefined) {
  return norm(text).replace(/\s*[(（].*$/, "");
}

function col(header: string[], name: string) {
  return header.findIndex(v => cellName(v) === name);
}

export function readWarehouseStockReport(table: string[][]): CountReferenceRow[] | undefined {
  const header = table.findIndex(r => col(r, "คลัง") >= 0 && col(r, "รหัสสินค้า") >= 0 &&
    col(r, "หน่วยใหญ่") >= 0 && col(r, "หน่วยย่อย") >= 0);
  if (header < 0) return undefined;

  const head = table[header];
  const iWarehouse = col(head, "คลัง");
  const iCode = col(head, "รหัสสินค้า");
  const iName = col(head, "ชื่อสินค้า");
  const iLarge = col(head, "หน่วยใหญ่");
  const iSmall = col(head, "หน่วยย่อย");
  const iUnit = iLarge + 1 === iSmall ? -1 : iLarge + 1;
  const iPacked = iName >= 0 ? iName : iCode + 1;
  const iTotalWarehouses = iWarehouse + 1;

  const rows: CountReferenceRow[] = [];
  let warehouse = "";
  let largeSum = 0;
  let smallSum = 0;
  let checked = false;
  for (let i = header + 1; i < table.length; i++) {
    const r = table[i];
    const label = cellName(r[iWarehouse]);
    const code = r[iCode]?.trim();
    if (label === "รวมคลัง") {
      if (!warehouse || Number(code) !== Number(warehouse.slice(3)) || rows.length !== amount(r[iPacked], i + 1) ||
        largeSum !== Math.round(amount(r[iLarge], i + 1) * 1000) || smallSum !== Math.round(amount(r[iSmall], i + 1) * 1000))
        throw new Error(`แถว ${i + 1} จำนวนรายการหรือยอดรวมที่อ่านได้ไม่ตรงกับบรรทัดรวมคลัง`);
      checked = true;
      continue;
    }
    if (label === "รวมทั้งสิ้น") {
      if (amount(r[iTotalWarehouses], i + 1) !== 1) throw new Error("กรุณาใช้รายงานของโกดังเดียวต่อไฟล์");
      break;
    }
    if (label && /^\d+$/.test(label) && !code) {
      if (!/^0?[1-6]$/.test(label)) throw new Error(`แถว ${i + 1} ไม่รู้จักรหัสคลัง ${label}`);
      const id = `wh-${label.padStart(2, "0")}`;
      if (warehouse && warehouse !== id) throw new Error("กรุณาใช้รายงานของโกดังเดียวต่อไฟล์");
      warehouse = id;
      continue;
    }
    if (!code || (label === "คลัง" && cellName(code) === "รหัสสินค้า")) continue;
    if (!warehouse || checked) throw new Error(`แถว ${i + 1} พบสินค้านอกส่วนข้อมูลของโกดัง`);
    let large = r[iLarge], unit = iUnit >= 0 ? r[iUnit] : "", small = r[iSmall];
    // Some exports pack the five empty columns, quantity and unit into a quoted inch-size description.
    if (!large?.trim() && !unit?.trim()) {
      const packed = r[iPacked]?.match(/"(?:,"){5},([\d,.]+),([^",]+)"$/);
      if (packed) { large = packed[1]; unit = packed[2]; small = r[iPacked + 1]; }
    }
    const factor = unit?.trim().match(/[x×]\s*(\d+(?:\.\d+)?)$/i);
    if (!factor || Number(factor[1]) <= 0) throw new Error(`แถว ${i + 1} อ่านตัวคูณหน่วยใหญ่ของ ${code} ไม่ได้`);
    const largeQty = amount(large, i + 1);
    const smallQty = amount(small, i + 1);
    const total = largeQty * Number(factor[1]) + smallQty;
    const quantity = Number(total.toFixed(3));
    if (Math.abs(quantity - total) > 0.000001 || quantity > 99999999999.999)
      throw new Error(`แถว ${i + 1} จำนวนในหน่วยย่อยเกินช่วงหรือความละเอียดที่รองรับ`);
    rows.push({ row: i + 1, code, quantity, warehouse, shelf: "" });
    largeSum += Math.round(largeQty * 1000);
    smallSum += Math.round(smallQty * 1000);
  }
  if (!rows.length || !checked) throw new Error("ข้อมูลรายงานไม่ครบ กรุณาตรวจสอบรายการสินค้าและบรรทัดรวมคลัง");
  return rows;
}

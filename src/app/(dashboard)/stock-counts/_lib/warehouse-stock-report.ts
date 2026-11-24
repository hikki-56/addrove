import type { CountReferenceRow } from "@/types/count-round";

function amount(text: string | undefined, row: number) {
  const value = text?.trim() ?? "";
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(value))
    throw new Error(`แถว ${row} อ่านจำนวนในรายงานคลังไม่ได้`);
  return Number(value.replaceAll(",", ""));
}

export function readWarehouseStockReport(table: string[][]): CountReferenceRow[] | undefined {
  const header = table.findIndex(r => r[0]?.trim() === "คลัง" && r[2]?.trim() === "รหัสสินค้า" &&
    r[9]?.trim() === "หน่วยใหญ่" && r[11]?.trim() === "หน่วยย่อย");
  if (header < 0) return undefined;

  const rows: CountReferenceRow[] = [];
  let warehouse = "";
  let largeSum = 0;
  let smallSum = 0;
  let checked = false;
  for (let i = header + 1; i < table.length; i++) {
    const r = table[i];
    const label = r[0]?.trim();
    const code = r[2]?.trim();
    if (label === "รวมคลัง") {
      if (!warehouse || Number(code) !== Number(warehouse.slice(3)) || rows.length !== amount(r[3], i + 1) ||
        largeSum !== Math.round(amount(r[9], i + 1) * 1000) || smallSum !== Math.round(amount(r[11], i + 1) * 1000))
        throw new Error(`แถว ${i + 1} จำนวนรายการหรือยอดรวมที่อ่านได้ไม่ตรงกับบรรทัดรวมคลัง`);
      checked = true;
      continue;
    }
    if (label === "รวมทั้งสิ้น") {
      if (amount(r[1], i + 1) !== 1) throw new Error("กรุณาใช้รายงานของโกดังเดียวต่อไฟล์");
      break;
    }
    if (label && /^\d+$/.test(label) && !code) {
      if (!/^0?[1-6]$/.test(label)) throw new Error(`แถว ${i + 1} ไม่รู้จักรหัสคลัง ${label}`);
      const id = `wh-${label.padStart(2, "0")}`;
      if (warehouse && warehouse !== id) throw new Error("กรุณาใช้รายงานของโกดังเดียวต่อไฟล์");
      warehouse = id;
      continue;
    }
    if (!code || (label === "คลัง" && code === "รหัสสินค้า")) continue;
    if (!warehouse || checked) throw new Error(`แถว ${i + 1} พบสินค้านอกส่วนข้อมูลของโกดัง`);
    let large = r[9], unit = r[10], small = r[11];
    // Some exports pack the five empty columns, quantity and unit into a quoted inch-size description.
    if (!large?.trim() && !unit?.trim()) {
      const packed = r[3]?.match(/"(?:,"){5},([\d,.]+),([^",]+)"$/);
      if (packed) { large = packed[1]; unit = packed[2]; small = r[4]; }
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

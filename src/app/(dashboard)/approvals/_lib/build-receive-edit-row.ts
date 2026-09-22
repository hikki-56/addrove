// สร้างแถวรายการสินค้าสำหรับ modal แก้ไขเอกสารรับเข้าจากสินค้าที่เลือกจากช่องค้นหา
// กรอกข้อมูลให้ครบทุกช่อง ยกเว้นช่องจำนวน (index 4) ที่เว้นว่างไว้ให้ผู้ใช้กรอกเอง
// แยกเป็น pure function เพื่อทดสอบ logic การกรอกอัตโนมัติได้โดยไม่ต้อง render React
import type { Product } from "@/types/models";

// โครงสร้างแถวรายการสินค้า 8 ช่อง:
// 0=SKU, 1=ตำแหน่ง, 2=บาร์โค้ด, 3=ชื่อสินค้า, 4=จำนวน, 5=โกดัง, 6=ผู้จำหน่าย, 7=timestamp (ISO string)
export type ReceiveEditRow = [string, string, string, string, string, string, string, string];

// เทียบชื่อโกดังแบบไม่สนช่องว่าง: sheet ใช้ "โกดัง1" แต่ breakdown ใช้ "โกดัง 1"
const normWarehouseName = (s?: string) => (s || "").replace(/\s+/g, "");

// เลือกตำแหน่งเริ่มต้นของสินค้า: เอาตำแหน่งแรกในโกดังเป้าหมายของเอกสารก่อน
// เพื่อไม่ชี้ไปที่ตำแหน่งของโกดังอื่น ถ้าไม่มีจึง fallback เป็นตำแหน่งรวมทุกโกดัง ("14A1, 15B2" → "14A1")
function pickDefaultLocation(product: Product, warehouse: string): string {
  const target = normWarehouseName(warehouse);
  const fromTargetWarehouse = (product.locations_breakdown || []).find(
    (b) =>
      normWarehouseName(b.warehouse_name) === target &&
      b.location && b.location.trim() !== "" && b.location.trim() !== "-"
  );
  if (fromTargetWarehouse) return fromTargetWarehouse.location.trim();
  return (product.location || "").split(",").map((s) => s.trim()).filter((s) => s && s !== "-")[0] || "-";
}

export function buildReceiveEditRow(product: Product, warehouse: string): ReceiveEditRow {
  return [
    product.sku || "",
    pickDefaultLocation(product, warehouse),
    product.barcode || "",
    product.product_name || "",
    "",
    warehouse || "โกดัง1",
    product.supplier && product.supplier.trim() !== "" ? product.supplier.trim() : "-",
    new Date().toISOString(),
  ];
}

import type { IDocumentRepository } from "@/lib/repositories/interfaces";

/**
 * Abstraction ของ "รหัสหน่วยขนส่ง" (logistic unit) = กล่อง/พาเลท/หน่วยที่ขึ้นรถ
 * วันนี้ใช้รหัสภายในบริษัทรูปแบบ BX-YYYYMMDD-NNNNNN (= document_no ของ
 * OUTBOUND_BOX ที่สร้างโดย Documents repository พร้อม lock กันเลขซ้ำ)
 *
 * ห้าม hard-code รูปแบบ BX กระจายตาม codebase — ทุกที่ต้องสร้าง/ตรวจ/
 * แยกส่วนรหัสกล่อง ให้เรียก function ในไฟล์นี้เท่านั้น เพื่อวันหนึ่งสลับไป
 * มาตรฐาน GS1 SSCC (เช่น 188549110000000001) เพื่อแลกข้อมูลกับ 3PL/ขนส่ง
 * ได้โดยไม่ต้องรื้อ Pack/Load
 */

export type LogisticUnitIdFormat = "INTERNAL_BX" | "SSCC";

export interface LogisticUnitId {
  id: string;
  format: LogisticUnitIdFormat;
}

const INTERNAL_BX_PATTERN = /^BX-\d{8}-\d{6}$/;
const SSCC_PATTERN = /^\d{18}$/;

export function isLogisticUnitId(value: string): boolean {
  return parseLogisticUnitId(value) !== null;
}

export function parseLogisticUnitId(value: string): LogisticUnitId | null {
  const v = String(value ?? "").trim().toUpperCase();
  if (INTERNAL_BX_PATTERN.test(v)) return { id: v, format: "INTERNAL_BX" };
  // SSCC ต้องขึ้นด้วย 00-04 (extension digit ตาม GS1) — รองรับล่วงหน้า
  if (SSCC_PATTERN.test(v) && /^[0-4]/.test(v)) return { id: v, format: "SSCC" };
  return null;
}

/**
 * สร้างรหัสกล่องใหม่ — ปัจจุบัน delegate ให้ตัวเลขเอกสารของระบบ
 * (มี per-type lock + fresh read กันเลขซ้ำอยู่แล้วใน Documents repository)
 */
export async function generateLogisticUnitId(
  documents: Pick<IDocumentRepository, "generateDocumentNo">
): Promise<LogisticUnitId> {
  const id = await documents.generateDocumentNo("OUTBOUND_BOX");
  return { id, format: "INTERNAL_BX" };
}

/** ค่าที่เข้ารหัสลงบาร์โค้ด Code128 บนสติกเกอร์กล่อง */
export function logisticUnitBarcodeValue(unit: LogisticUnitId): string {
  return unit.id;
}

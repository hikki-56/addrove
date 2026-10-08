// ตัวกรองเอกสารใบผลิตระบบเก่า (PRD-) ที่ยังหลงเหลือในแท็บ Documents
// ระบบผลิตถูกลบออกแล้ว แต่ข้อมูลเอกสารเก่ายังอยู่ในชีต — ต้องกันไม่ให้
// หลุดเข้าคิวอนุมัติ / ประวัติการรับเข้า / ยอด dashboard ของระบบปกติ
// (ใบผลิตรุ่นเก่าถูกบันทึก document_type เป็น "RECEIVE" ตอนสร้าง จึงต้องอาศัยสัญญาณอื่น)
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

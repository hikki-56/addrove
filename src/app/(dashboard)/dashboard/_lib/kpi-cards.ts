// ข้อความ/ค่าของการ์ด KPI หน้า Admin Dashboard — แยกเป็น pure function
// เพื่อให้ทดสอบชื่อการ์ด ค่า และหน่วยได้โดยไม่ต้อง render React

export interface KpiNumbers {
  totalRemaining: number;
  receivedToday: number;
  receivedDocumentCountToday: number;
  issuedToday: number;
  issuedDocumentCountToday: number;
  producedToday: number;
  productionOrderCountToday: number;
}

export interface KpiCard {
  title: string;
  value: number;
  // หน่วยแสดงถัดจากตัวเลข เช่น "ชิ้น", "SKU" — "" เมื่อหน่วยอยู่ในชื่อการ์ดแล้ว
  unit: string;
  caption: string;
}

export function buildKpiCards(kpi: KpiNumbers): KpiCard[] {
  return [
    {
      title: "สินค้าทั้งหมด",
      value: kpi.totalRemaining,
      unit: "ชิ้น",
      caption: "จำนวนคงเหลือรวมทุกโกดัง",
    },
    {
      title: "รับเข้าวันนี้",
      value: kpi.receivedToday,
      unit: "ชิ้น",
      caption: `จาก ${kpi.receivedDocumentCountToday.toLocaleString()} รายการรับเข้า`,
    },
    {
      title: "เบิกวันนี้",
      value: kpi.issuedToday,
      unit: "ชิ้น",
      caption: `จาก ${kpi.issuedDocumentCountToday.toLocaleString()} รายการเบิก`,
    },
    {
      title: "ผลิตวันนี้",
      value: kpi.producedToday,
      unit: "ชิ้น",
      caption: `จาก ${kpi.productionOrderCountToday.toLocaleString()} คำสั่งผลิต`,
    },
  ];
}

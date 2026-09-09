// ============================================================
// Unit Tests — การ์ด KPI หน้า Admin Dashboard (_lib/kpi-cards.ts)
// 4 การ์ด: สินค้าทั้งหมด / รับเข้าวันนี้ / เบิกวันนี้ / ผลิตวันนี้
// เลขหลักเป็น "จำนวนชิ้น" ส่วนจำนวนเอกสาร/คำสั่งผลิตอยู่ใน caption
// ============================================================
import { buildKpiCards, type KpiNumbers } from "@/app/(dashboard)/dashboard/_lib/kpi-cards";

const zeroKpi: KpiNumbers = {
  totalRemaining: 0,
  receivedToday: 0,
  receivedDocumentCountToday: 0,
  issuedToday: 0,
  issuedDocumentCountToday: 0,
  producedToday: 0,
  productionOrderCountToday: 0,
};

describe("buildKpiCards — การ์ด KPI หน้า Admin Dashboard", () => {
  it('การ์ดที่ 1 "สินค้าทั้งหมด" ใช้ total_remaining_quantity หน่วย "ชิ้น"', () => {
    const [card] = buildKpiCards({ ...zeroKpi, totalRemaining: 1234 });

    expect(card.title).toBe("สินค้าทั้งหมด");
    expect(card.value).toBe(1234);
    expect(card.unit).toBe("ชิ้น");
    expect(card.caption).toBe("จำนวนคงเหลือรวมทุกโกดัง");
  });

  it('การ์ดที่ 2 "รับเข้าวันนี้" — เลขหลักเป็นชิ้น, caption แสดงจำนวนรายการรับเข้า', () => {
    const [, card] = buildKpiCards({
      ...zeroKpi,
      receivedToday: 450,
      receivedDocumentCountToday: 12,
    });

    expect(card.title).toBe("รับเข้าวันนี้");
    expect(card.value).toBe(450);
    expect(card.unit).toBe("ชิ้น");
    expect(card.caption).toBe("จาก 12 รายการรับเข้า");
  });

  it('การ์ดที่ 3 "เบิกวันนี้" — เลขหลักเป็นชิ้น, caption แสดงจำนวนรายการเบิก', () => {
    const cards = buildKpiCards({
      ...zeroKpi,
      issuedToday: 80,
      issuedDocumentCountToday: 8,
    });

    expect(cards[2].title).toBe("เบิกวันนี้");
    expect(cards[2].value).toBe(80);
    expect(cards[2].unit).toBe("ชิ้น");
    expect(cards[2].caption).toBe("จาก 8 รายการเบิก");
  });

  it('การ์ดที่ 4 "ผลิตวันนี้" — เลขหลักเป็นชิ้น, caption แสดงจำนวนคำสั่งผลิต', () => {
    const cards = buildKpiCards({
      ...zeroKpi,
      producedToday: 300,
      productionOrderCountToday: 3,
    });

    expect(cards[3].title).toBe("ผลิตวันนี้");
    expect(cards[3].value).toBe(300);
    expect(cards[3].unit).toBe("ชิ้น");
    expect(cards[3].caption).toBe("จาก 3 คำสั่งผลิต");
  });

  it("ค่าติดลบของ total_remaining_quantity ส่งต่อตามจริง (ไม่ clamp เป็น 0)", () => {
    const [card] = buildKpiCards({ ...zeroKpi, totalRemaining: -15 });

    expect(card.value).toBe(-15);
    expect(card.unit).toBe("ชิ้น");
  });

  it("จำนวนเอกสารใน caption format ด้วย toLocaleString รองรับเลขหลักพัน", () => {
    const [, card] = buildKpiCards({
      ...zeroKpi,
      receivedDocumentCountToday: 1200,
    });

    expect(card.caption).toBe(`จาก ${(1200).toLocaleString()} รายการรับเข้า`);
  });
});

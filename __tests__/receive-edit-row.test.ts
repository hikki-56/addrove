// ============================================================
// Unit Tests — กรอกรายการรับเข้าอัตโนมัติจากการค้นหาสินค้า
// (src/app/(dashboard)/approvals/_lib/build-receive-edit-row.ts)
// โครงสร้างแถว 8 ช่อง: 0=SKU, 1=ตำแหน่ง, 2=บาร์โค้ด, 3=ชื่อสินค้า,
// 4=จำนวน, 5=โกดัง, 6=ผู้จำหน่าย, 7=timestamp (ISO string)
// ============================================================
import { buildReceiveEditRow } from "@/app/(dashboard)/approvals/_lib/build-receive-edit-row";
import type { Product } from "@/types/models";

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    product_id: "prod-001",
    sku: "SKU-1001",
    barcode: "8851234567890",
    product_name: "สกรูหัวกลม 1 ซม.",
    category: "วัสดุ",
    base_unit: "ชิ้น",
    minimum_stock: 10,
    description: "-",
    supplier: "บริษัท ตัวอย่าง จำกัด",
    location: "14A1",
    active: true,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildReceiveEditRow — สร้างแถวรับเข้าจากสินค้าที่เลือกจากช่องค้นหา", () => {
  it("สินค้าครบทุก field → กรอกครบทุกช่องถูกต้องตาม index", () => {
    const row = buildReceiveEditRow(makeProduct(), "โกดัง2");

    expect(row).toHaveLength(8);
    expect(row[0]).toBe("SKU-1001");
    expect(row[1]).toBe("14A1");
    expect(row[2]).toBe("8851234567890");
    expect(row[3]).toBe("สกรูหัวกลม 1 ซม.");
    expect(row[5]).toBe("โกดัง2");
    expect(row[6]).toBe("บริษัท ตัวอย่าง จำกัด");
  });

  it("location หลายตำแหน่ง '14A1, 15B2' → เอาตำแหน่งแรก '14A1'", () => {
    const row = buildReceiveEditRow(makeProduct({ location: "14A1, 15B2" }), "โกดัง1");
    expect(row[1]).toBe("14A1");
  });

  it("location มีช่องว่างรอบ comma เช่น ' 14A1 ,15B2 ' → trim แล้วได้ '14A1'", () => {
    const row = buildReceiveEditRow(makeProduct({ location: " 14A1 ,15B2 " }), "โกดัง1");
    expect(row[1]).toBe("14A1");
  });

  it("location เป็น '-' หรือ '' หรือ undefined → ได้ '-'", () => {
    expect(buildReceiveEditRow(makeProduct({ location: "-" }), "โกดัง1")[1]).toBe("-");
    expect(buildReceiveEditRow(makeProduct({ location: "" }), "โกดัง1")[1]).toBe("-");
    expect(buildReceiveEditRow(makeProduct({ location: undefined }), "โกดัง1")[1]).toBe("-");
  });

  it("location ตำแหน่งแรกเป็น '-' → ข้ามไปเอาตำแหน่งถัดไปที่มีค่า", () => {
    const row = buildReceiveEditRow(makeProduct({ location: "-, 15B2" }), "โกดัง1");
    expect(row[1]).toBe("15B2");
  });

  it("มี breakdown ของโกดังเป้าหมาย → ใช้ตำแหน่งในโกดังนั้น แม้ตำแหน่งรวมจะชี้ที่อื่น", () => {
    const row = buildReceiveEditRow(
      makeProduct({
        location: "14A1, 15B2",
        locations_breakdown: [
          { warehouse_id: "wh-1", warehouse_name: "โกดัง 1", location: "14A1", quantity: 3 },
          { warehouse_id: "wh-2", warehouse_name: "โกดัง 2", location: "22C4", quantity: 5 },
        ],
      }),
      "โกดัง2"
    );
    expect(row[1]).toBe("22C4");
  });

  it("breakdown มีแต่โกดังอื่น (ไม่ตรงเป้าหมาย) → fallback ตำแหน่งรวมแรก", () => {
    const row = buildReceiveEditRow(
      makeProduct({
        location: "14A1, 15B2",
        locations_breakdown: [
          { warehouse_id: "wh-3", warehouse_name: "โกดัง 3", location: "31D2", quantity: 7 },
        ],
      }),
      "โกดัง2"
    );
    expect(row[1]).toBe("14A1");
  });

  it("breakdown ตรงโกดังเป้าหมายแต่ location เป็น '-' → ข้ามไป fallback ตำแหน่งรวม", () => {
    const row = buildReceiveEditRow(
      makeProduct({
        location: "14A1",
        locations_breakdown: [
          { warehouse_id: "wh-2", warehouse_name: "โกดัง 2", location: "-", quantity: 0 },
          { warehouse_id: "wh-1", warehouse_name: "โกดัง 1", location: "14A1", quantity: 2 },
        ],
      }),
      "โกดัง2"
    );
    expect(row[1]).toBe("14A1");
  });

  it("supplier ว่าง หรือ undefined หรือเว้นว่าง → ได้ '-'", () => {
    expect(buildReceiveEditRow(makeProduct({ supplier: "" }), "โกดัง1")[6]).toBe("-");
    expect(buildReceiveEditRow(makeProduct({ supplier: undefined }), "โกดัง1")[6]).toBe("-");
    expect(buildReceiveEditRow(makeProduct({ supplier: "   " }), "โกดัง1")[6]).toBe("-");
  });

  it("supplier มีค่า → ได้ค่าที่ trim แล้ว", () => {
    const row = buildReceiveEditRow(makeProduct({ supplier: "  บริษัท เอบีซี จำกัด  " }), "โกดัง1");
    expect(row[6]).toBe("บริษัท เอบีซี จำกัด");
  });

  it("barcode/sku/ชื่อสินค้าขาด → ได้ \"\" ในช่องนั้น", () => {
    const row = buildReceiveEditRow(makeProduct({ sku: "", barcode: "", product_name: "" }), "โกดัง1");
    expect(row[0]).toBe("");
    expect(row[2]).toBe("");
    expect(row[3]).toBe("");
  });

  it("ช่องจำนวน (index 4) เว้นว่างเสมอให้ผู้ใช้กรอกเอง", () => {
    const row = buildReceiveEditRow(makeProduct(), "โกดัง1");
    expect(row[4]).toBe("");
  });

  it("warehouse ว่าง → fallback เป็น 'โกดัง1' / warehouse ปกติ → ใช้ค่านั้น", () => {
    expect(buildReceiveEditRow(makeProduct(), "")[5]).toBe("โกดัง1");
    expect(buildReceiveEditRow(makeProduct(), "โกดัง3")[5]).toBe("โกดัง3");
  });

  it("timestamp (index 7) เป็น ISO date ที่ parse ได้", () => {
    const row = buildReceiveEditRow(makeProduct(), "โกดัง1");
    expect(Number.isNaN(new Date(row[7]).getTime())).toBe(false);
    expect(row[7]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

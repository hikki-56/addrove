import * as XLSX from "xlsx";
import {
  analyzeWorkbook,
  suggestMapping,
  parseBills,
  parseQty,
  matchProducts,
} from "@/lib/services/outbound/bill-import.service";
import type { Product } from "@/types/models";

function makeXlsxBuffer(rows: unknown[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

const SAMPLE_ROWS: unknown[][] = [
  ["รายงานใบสั่งขาย", "", "", ""],
  ["เลขที่เอกสาร", "รหัสสินค้า", "ชื่อสินค้า", "จำนวน"],
  ["INV-001", "SKU-A", "สินค้า A", 5],
  ["INV-001", "SKU-B", "สินค้า B", "1,000"],
  ["INV-002", "SKU-A", "สินค้า A", 3],
];

const PRODUCTS: Product[] = [
  {
    product_id: "prod-a",
    sku: "SKU-A",
    barcode: "20001",
    product_name: "สินค้า A",
    category: "ทั่วไป",
    base_unit: "ชิ้น",
    minimum_stock: 0,
    description: "",
    active: true,
    created_at: "",
    updated_at: "",
  },
  {
    product_id: "prod-b",
    sku: "SKU-B",
    barcode: "20002",
    product_name: "สินค้า B",
    category: "ทั่วไป",
    base_unit: "ชิ้น",
    minimum_stock: 0,
    description: "",
    active: true,
    created_at: "",
    updated_at: "",
  },
] as unknown as Product[];

describe("suggestMapping — auto-detect คอลัมน์จากหัวตาไทย/อังกฤษ", () => {
  it("เจอเลขที่เอกสาร/รหัสสินค้า/จำนวน จากหัวตาไทย", () => {
    const m = suggestMapping(["เลขที่เอกสาร", "รหัสสินค้า", "ชื่อสินค้า", "จำนวน"]);
    expect(m).not.toBeNull();
    expect(m!.bill_no).toBe("เลขที่เอกสาร");
    expect(m!.sku).toBe("รหัสสินค้า");
    expect(m!.qty).toBe("จำนวน");
    expect(m!.product_name).toBe("ชื่อสินค้า");
  });

  it("เจอจากหัวตาอังกฤษ", () => {
    const m = suggestMapping(["Bill No.", "Item Code", "Description", "Quantity"]);
    expect(m).not.toBeNull();
    expect(m!.bill_no).toBe("Bill No.");
    expect(m!.sku).toBe("Item Code");
    expect(m!.qty).toBe("Quantity");
  });

  it("ขาดคอลัมน์บังคับ → null", () => {
    expect(suggestMapping(["รหัสสินค้า", "จำนวน"])).toBeNull();
    expect(suggestMapping([])).toBeNull();
  });
});

describe("parseQty — รับจำนวนหลายรูปแบบ", () => {
  it.each([
    ["1,500", 1500],
    ["1 500", 1500],
    [12, 12],
    ["12.0", 12],
    ["", 0],
    ["abc", 0],
    [-5, 0],
  ])("%j → %i", (input, expected) => {
    expect(parseQty(input)).toBe(expected);
  });
});

describe("analyzeWorkbook", () => {
  it("หา sheet + แถวหัวตาอัตโนมัติ (ข้ามแถวหัวกระดาษ)", () => {
    const result = analyzeWorkbook(makeXlsxBuffer(SAMPLE_ROWS), "test.xlsx");
    expect(result.suggestedSheet).toBe("Sheet1");
    const sheet = result.sheets[0];
    expect(sheet.suggestedHeaderRow).toBe(2);
    expect(result.suggestedMapping?.bill_no).toBe("เลขที่เอกสาร");
    expect(sheet.totalRows).toBe(3);
  });
});

describe("parseBills", () => {
  const mapping = {
    bill_no: "เลขที่เอกสาร",
    sku: "รหัสสินค้า",
    qty: "จำนวน",
    product_name: "ชื่อสินค้า",
    location: "",
    customer: "",
    date: "",
  };

  it("รวมแถวเป็นบิลตามเลขที่เอกสาร + แปลงจำนวน '1,000' ได้", () => {
    const bills = parseBills(makeXlsxBuffer(SAMPLE_ROWS), "Sheet1", 2, mapping);
    expect(bills).toHaveLength(2);
    const inv1 = bills.find((b) => b.express_bill_no === "INV-001")!;
    expect(inv1.items).toHaveLength(2);
    expect(inv1.items.find((i) => i.sku === "SKU-B")!.qty).toBe(1000);
    expect(inv1.items.find((i) => i.sku === "SKU-A")!.qty).toBe(5);
  });

  it("แถวไม่มีเลขบิล → error ชี้แถว", () => {
    const bad = [
      ["เลขที่เอกสาร", "รหัสสินค้า", "จำนวน"],
      ["", "SKU-A", 1],
    ];
    expect(() => parseBills(makeXlsxBuffer(bad), "Sheet1", 1, mapping)).toThrow(/แถวที่ 2/);
  });

  it("จำนวน 0/ติดลบ → error", () => {
    const bad = [
      ["เลขที่เอกสาร", "รหัสสินค้า", "จำนวน"],
      ["INV-9", "SKU-A", 0],
    ];
    expect(() => parseBills(makeXlsxBuffer(bad), "Sheet1", 1, mapping)).toThrow(/จำนวนไม่ถูกต้อง/);
  });

  it("ชื่อ sheet ผิด → error", () => {
    expect(() => parseBills(makeXlsxBuffer(SAMPLE_ROWS), "Nope", 2, mapping)).toThrow(/ไม่พบชีต/);
  });
});

describe("matchProducts", () => {
  it("จับคู่ด้วย SKU และรวมรายการ SKU ซ้ำในบิลเดียวกัน", () => {
    const bills = [
      {
        express_bill_no: "INV-001",
        items: [
          { sku: "SKU-A", qty: 5 },
          { sku: "sku-a ", qty: 2 }, // ซ้ำ (ต่าง case/whitespace) ต้องรวมเป็น 7
          { sku: "UNKNOWN-1", qty: 1 },
        ],
      },
    ];
    const previews = matchProducts(bills, PRODUCTS);
    expect(previews).toHaveLength(1);
    const items = previews[0].items;
    expect(items.find((i) => i.sku === "SKU-A")!.qty).toBe(7);
    expect(items.find((i) => i.sku === "SKU-A")!.matched).toBe(true);
    expect(previews[0].unmatched_count).toBe(1);
    expect(previews[0].total_qty).toBe(8);
  });

  it("จับคู้ด้วยบาร์โค้ดแทน SKU ได้", () => {
    const bills = [{ express_bill_no: "INV-B", items: [{ sku: "20002", qty: 1 }] }];
    const previews = matchProducts(bills, PRODUCTS);
    expect(previews[0].items[0].matched).toBe(true);
    expect(previews[0].items[0].product?.sku).toBe("SKU-B");
  });
});

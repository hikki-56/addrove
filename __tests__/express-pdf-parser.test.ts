import * as fs from "fs";
import { parseExpressPdfText, fixThaiPua, parseThaiDate } from "@/lib/services/outbound/express-pdf-parser";
import { matchProducts } from "@/lib/services/outbound/bill-import.service";
import type { Product } from "@/types/models";

/**
 * ข้อความดิบจากไฟล์จริง 9090957.pdf (สกัดด้วย pdf-parse)
 * สังเกต: วรรณยุกต์ไทยเป็นรหัส private-use \uf704 \uf705 \uf70a \uf70b \uf70c \uf70e
 */
const REAL_TEXT = [
  "09-\u0E2A-06",
  "\u0E23\uf70b\u0E32\u0E19 \u0E2A\u0E27\u0E35\u0E17\u0E42\u0E2E\u0E21\u0E2E\u0E32\u0E23\uf70e\u0E14\u0E41\u0E27\u0E23\uf70e",
  "66/1-3 \u0E2B\u0E21\u0E394 \t\u0E16.\u0E28\u0E32\u0E25\u0E32\u0E22\u0E32-\u0E19\u0E04\u0E23\u0E0A\u0E31\u0E22\u0E28\u0E23\u0E35 \u0E15.\u0E28\u0E32\u0E25\u0E32\u0E22\u0E32 \tIV9090957",
  "\u0E2D.\u0E1E\u0E38\u0E17\u0E18\u0E21\u0E13\u0E11\u0E25 \u0E08.\u0E19\u0E04\u0E23\u0E1B\u0E10\u0E21 \t73170",
  "02-889-2043,02-8892044 \t12/09/69 \t( \t08:45:26)",
  "\u0E2D\uf70a\u0E32\u0E07\u0E2D\u0E34\u0E07",
  "11/11/69 \t60 \t\u0E27\u0E31\u0E19 \tB-09-\u0E04\u0E38\u0E13\u0E2D\u0E32\u0E17\u0E34\u0E15\u0E22\uf70e \u0E2A\u0E38\u0E14\u0E22\u0E2D\u0E14\u0E14\u0E35 \t(\u0E14\u0E31\u0E21)",
  "1 \t1203 \t#B-04 \u0E2A\u0E30\u0E14\u0E37\u0E2D\u0E2D\uf70a\u0E32\u0E07\u0E17/\u0E25 \t\u0E44\u0E2E\u0E42\u0E1F\uf705 \t22.00 \t\u0E0A\u0E38\u0E14 \t125.00 \t2,750.00",
  "2 \t1203 \t#B-04 \u0E2A\u0E30\u0E14\u0E37\u0E2D\u0E2D\uf70a\u0E32\u0E07\u0E17/\u0E25 \t\u0E44\u0E2E\u0E42\u0E1F\uf705 \t2.00 \t\u0E0A\u0E38\u0E14",
  "3 \tD4204 #K-300 \u0E2A\u0E32\u0E22\u0E19\u0E49\u0E33\u0E17\u0E34\u0E49\u0E07 \t\u0E2A\u0E35\u0E40\u0E17\u0E32 \t20.00 \t\u0E40\u0E2A\uf70b\u0E19 \t140.00 \t45% \t1,540.00",
  "4 \tD4198 #M-13 \u0E01\uf70c\u0E2D\u0E01\u0E2D\uf70a\u0E32\u0E07\u0E0B\u0E34\u0E07\u0E04\uf70e \t12.00 \t\u0E15\u0E31\u0E27 \t195.00 \t15% \t1,989.00",
  "5 \t0350#KJ35MM S \t\u0E01\u0E38\u0E0D\u0E41\u0E08\u0E23\u0E30\u0E1A\u0E1A\u0E25\u0E39\u0E01\u0E1B\uf704\u0E19 \t35 \tmm. \t12.00 \t\u0E0A\u0E38\u0E14 \t58.00 \t10% \t626.40",
  "6 \t0367#KJ35MM L \t\u0E01\u0E38\u0E0D\u0E41\u0E08\u0E23\u0E30\u0E1A\u0E1A\u0E25\u0E39\u0E01\u0E1B\uf704\u0E19 \t35 \tmml. \t12.00 \t\u0E0A\u0E38\u0E14 \t61.00 \t10% \t658.80",
  "9,216.60",
  "0.00",
  "\u0E20\u0E32\u0E29\u0E35 \t7.00% \t0.00",
  "(\u0E40\u0E01\uf70b\u0E32\u0E1E\u0E31\u0E19\u0E2A\u0E2D\u0E07\u0E23\uf70b\u0E2D\u0E22\u0E2A\u0E34\u0E1A\u0E2B\u0E01\u0E1A\u0E32\u0E17\u0E2B\u0E01\u0E2A\u0E34\u0E1A\u0E2A\u0E15\u0E32\u0E07\u0E04\uf70e). \t9,216.60",
  "\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01\u0E42\u0E14\u0E22 CROCHET",
].join("\n");

describe("fixThaiPua — แปลงรหัส private-use กลับเป็นไทย", () => {
  it("แปลงวรรณยุกต์ที่พิสูจน์แล้วถูกต้อง", () => {
    expect(fixThaiPua("\u0E23\uf70b\u0E32\u0E19")).toBe("ร้าน");
    expect(fixThaiPua("\u0E40\u0E2A\uf70b\u0E19")).toBe("เส้น");
    expect(fixThaiPua("\u0E2D\uf70a\u0E32\u0E07")).toBe("อ้าง");
    expect(fixThaiPua("\u0E01\uf70c\u0E2D\u0E01")).toBe("ก๊อก");
    expect(fixThaiPua("\u0E0B\u0E34\u0E07\u0E04\uf70e")).toBe("ซิงค์");
    expect(fixThaiPua("\u0E1B\uf704\u0E19")).toBe("ปืน");
    expect(fixThaiPua("\u0E44\u0E2E\u0E42\u0E1F\uf705")).toBe("ไฮโฟ่");
  });
  it("รหัสที่ไม่รู้จัก → ตัดทิ้ง (ไม่ทิ้งขยะ)", () => {
    expect(fixThaiPua("ก\uF7FFา")).toBe("กา");
  });
});

describe("parseThaiDate — พ.ศ. → ISO", () => {
  it("12/09/69 → 2026-09-12 (พ.ศ. 2569)", () => {
    expect(parseThaiDate("โทร 12/09/69 (08:45:26)")).toBe("2026-09-12");
  });
  it("ปี 4 หลักทั้ง พ.ศ./ค.ศ.", () => {
    expect(parseThaiDate("1/1/2569")).toBe("2026-01-01");
    expect(parseThaiDate("31/12/2026")).toBe("2026-12-31");
  });
  it("ไม่มีวันที่ → undefined", () => {
    expect(parseThaiDate("ไม่มี")).toBeUndefined();
  });
});

describe("parseExpressPdfText — เอกสาร Express จริง", () => {
  const bill = parseExpressPdfText(REAL_TEXT);

  it("หัวเอกสาร: เลข IV เป็นเลขบิลหลัก + เลขเอกสาร + ลูกค้า + วันที่", () => {
    expect(bill.iv_no).toBe("IV9090957");
    expect(bill.express_bill_no).toBe("IV9090957");
    expect(bill.doc_no).toBe("09-ส-06");
    expect(bill.customer).toContain("สวีทโฮม");
    expect(bill.date).toBe("2026-09-12");
  });

  it("แยกรายการครบทุกบรรทัดที่ฝังไว้ (แถวต่อเนื่องรวมอยู่)", () => {
    expect(bill.items).toHaveLength(6);
  });

  it("แยกกลุ่มรหัส/ชื่อ/จำนวน ถูกต้อง — รวมแถวที่ชื่อมีตัวเลข (35 mm.)", () => {
    const first = bill.items[0];
    expect(first.sku).toBe("1203 #B-04");
    expect(first.qty).toBe(22);
    expect(first.product_name).toContain("สะดือ");

    const kj = bill.items.find((it) => it.sku === "0350#KJ35MM S");
    expect(kj).toBeDefined();
    expect(kj!.qty).toBe(12);
    expect(kj!.product_name).toContain("กุญแจ");
    expect(kj!.product_name).toContain("35 mm.");
  });

  it("แถวต่อเนื่อง (ไม่มีราคา) นับเป็นรายการของ SKU เดิม", () => {
    const rows1203 = bill.items.filter((it) => it.sku === "1203 #B-04");
    expect(rows1203).toHaveLength(2);
    expect(rows1203[1].qty).toBe(2);
  });

  it("ไม่อ่านยอดรวม/ภาษี/บาทตัวอักษรเป็นรายการสินค้า", () => {
    const skus = bill.items.map((it) => it.sku);
    expect(skus.some((s) => s.includes("9,216"))).toBe(false);
    expect(skus.some((s) => s.includes("CROCHET"))).toBe(false);
  });

  it("PDF ที่ไม่มีรายการ → throw พร้อมข้อความชัดเจน", () => {
    expect(() => parseExpressPdfText("สวัสดี\nไม่มีตาราง")).toThrow(/ไม่พบรายการสินค้า/);
  });
});

describe("matchProducts — จับคู้ด้วยต้นรายละเอียด (PDF Express)", () => {
  const products = [
    { product_id: "p1", sku: "B04", barcode: "8854911001203", product_name: "1203 #B-04 สะดืออ่างท/ล ไฮโฟ่" },
    { product_id: "p2", sku: "KJ35M", barcode: "8854911000350", product_name: "0350#KJ35MM S กุญแจระบบลูกปืน 35 mm." },
  ] as unknown as Product[];

  it('รหัสบรรทัด PDF "1203 #B-04" จับกับสินค้าที่รายละเอียดขึ้นต้นเหมือนกัน (SKU จริง B04)', () => {
    const bill = parseExpressPdfText(REAL_TEXT);
    const [preview] = matchProducts(
      [{ express_bill_no: bill.express_bill_no, items: bill.items.slice(0, 1) }],
      products
    );
    expect(preview.items[0].matched).toBe(true);
    expect(preview.items[0].product?.sku).toBe("B04");
  });

  it('"0350#KJ35MM S" จับกับ KJ35M แม้ต้นรายละเอียดมีช่องว่างต่างกัน', () => {
    const [preview] = matchProducts(
      [{ express_bill_no: "X", items: [{ sku: "0350#KJ35MM S", qty: 12 }] }],
      products
    );
    expect(preview.items[0].product?.sku).toBe("KJ35M");
  });

  it("รหัสที่ไม่ตรงอะไรเลย → unmatched", () => {
    const [preview] = matchProducts([{ express_bill_no: "X", items: [{ sku: "9999#NOPE", qty: 1 }] }], products);
    expect(preview.items[0].matched).toBe(false);
    expect(preview.unmatched_count).toBe(1);
  });
});

// ---- ไฟล์จริง: เปิดเฉพาะเมื่อระบุ REAL_PDF_FIXTURE และรัน jest ด้วย
// NODE_OPTIONS=--experimental-vm-modules (pdf.js ใน jest ปกติ import ไม่ได้
// แต่ใน Next.js server จริงใช้งานได้ปกติ) ----
const REAL_PDF = process.env.REAL_PDF_FIXTURE || "";
(fs.existsSync(REAL_PDF) ? describe : describe.skip)("parseExpressPdf — ไฟล์จริง", () => {
  it("สกัดข้อความด้วย pdf-parse แล้ว parse ผ่านทุกข้อ", async () => {
    const { parseExpressPdf } = await import("@/lib/services/outbound/express-pdf-parser");
    const buf = fs.readFileSync(REAL_PDF);
    const bill = await parseExpressPdf(buf);
    expect(bill.express_bill_no).toBe("IV9090957");
    expect(bill.items.length).toBeGreaterThanOrEqual(9);
    expect(bill.items[0].sku).toBe("1203 #B-04");
    expect(bill.date).toBe("2026-09-12");
    expect(bill.customer).toContain("สวีทโฮม");
  });
});

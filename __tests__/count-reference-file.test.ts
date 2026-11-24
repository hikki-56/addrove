import * as XLSX from "xlsx";
import { readReferenceFile } from "@/app/(dashboard)/stock-counts/_lib/reference-file";
import { countComparisonLabel, productTotals } from "@/lib/count-comparison";
import { readWarehouseStockReport } from "@/app/(dashboard)/stock-counts/_lib/warehouse-stock-report";

test("warehouse report uses the quantity columns and converts major units before comparing stock", () => {
  const sheet = [
    ["สินค้าคงเหลือ แยกตามคลังสินค้า"],
    ["คลัง", "", "รหัสสินค้า", "ชื่อสินค้า", "", "", "", "", "", "หน่วยใหญ่", "", "หน่วยย่อย"],
    ["5", "โกดัง 5"],
    ["", "", "001", "กล่อง", "", "", "", "", "", "2", "กล่องx12.0000", "3", "ชิ้น", "750"],
    ["", "", "002", 'สาย 1/2",",",",",",8,เส้นx1.0000"', "0", "เส้น", "400"],
    ["รวมคลัง", "", "5", "2", "สินค้า", "", "", "", "", "10", "", "3"],
    ["รวมทั้งสิ้น", "1", "คลัง", "2", "สินค้า"],
  ];
  expect(readWarehouseStockReport(sheet)).toEqual([
    { row: 4, warehouse: "wh-05", code: "001", shelf: "", quantity: 27 },
    { row: 5, warehouse: "wh-05", code: "002", shelf: "", quantity: 8 },
  ]);
  sheet[5][9] = "11";
  expect(() => readWarehouseStockReport(sheet)).toThrow("ไม่ตรงกับบรรทัดรวมคลัง");
});

test("a two-column Excel file preserves formatted barcodes and the underlying quantity", async () => {
  const sheet = XLSX.utils.aoa_to_sheet([["บาร์โค้ด", "จำนวน"], [123, 1.125]]);
  sheet.A2.z = "00000";
  sheet.B2.z = "0";
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "โกดัง");
  const bytes = XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  expect(await readReferenceFile(new File([bytes], "reference.xlsx"))).toEqual([
    { row: 2, code: "00123", quantity: 1.125, shelf: "" },
  ]);
});

test("a blank quantity rejects the entire CSV and identifies the row", async () => {
  const input = new File(["SKU,qty\n0008,0\n0009,\n"], "reference.csv");
  await expect(readReferenceFile(input)).rejects.toThrow("แถว 3");
});

test("compare quantities across shelves, preserving zero and distinguishing an absent product", () => {
  const totals = productTotals({ hasReference: true, shelves: [
    { shelf_code: "A", counted_qty: null, expected_qty: 0.3 },
    { shelf_code: "B", counted_qty: 0.1, expected_qty: null },
    { shelf_code: "C", counted_qty: 0.2, expected_qty: null },
  ] });
  expect(countComparisonLabel(totals.expected, totals.counted)).toBe("ตรงกับไฟล์");
  expect(countComparisonLabel(0, null)).toBe("ยังไม่ได้นับ");
  expect(countComparisonLabel(null, 0)).toContain("ไม่พบสินค้า");
});

import * as XLSX from "xlsx";
import { readReferenceFile } from "@/app/(dashboard)/stock-counts/_lib/reference-file";
import { countComparisonLabel, productTotals } from "@/lib/count-comparison";
import { readWarehouseStockReport } from "@/app/(dashboard)/stock-counts/_lib/warehouse-stock-report";

function workbook(sheets: Record<string, (string | number)[][]>, name = "reference.xlsx") {
  const book = XLSX.utils.book_new();
  for (const [sheetName, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), sheetName);
  }
  return new File([XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer], name);
}

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

test("skips title and blank rows before the header", async () => {
  expect(await readReferenceFile(workbook({
    Sheet1: [["สินค้าคงเหลือ โกดัง 5"], ["วันที่ 24/11/2569"], [], ["รหัสสินค้า", "จำนวน"], ["A01", 4]],
  }))).toEqual([{ row: 5, code: "A01", quantity: 4, shelf: "" }]);
});

test("reads Stockify warehouse tab and count result exports, including a title row", async () => {
  await expect(readReferenceFile(workbook({
    โกดัง: [
      ["รหัสสินค้า", "บาร์โค้ด", "ชื่อสินค้า", "หมวดสินค้า", "หน่วย", "จำนวนคงเหลือ", "ตำแหน่ง", "ผู้จัดจำหน่าย", "อัปเดตเมื่อ"],
      ["A01", "123", "น็อต", "ทั่วไป", "ชิ้น", 7, "A-1", "", ""],
    ],
  }))).resolves.toEqual([{ row: 2, code: "A01", quantity: 7, shelf: "A-1" }]);
  await expect(readReferenceFile(workbook({
    ผลตรวจนับ: [
      ["รายงานผลตรวจนับ"],
      ["โกดัง", "รหัสสินค้า", "เลขบาร์โค้ด", "ชื่อสินค้า", "จำนวนที่นับได้", "หน่วย", "ผู้ตรวจนับ", "เวลาบันทึก (ไทย)"],
      ["โกดัง 5", "A01", "123", "น็อต", 3, "ชิ้น", "สมชาย", ""],
    ],
  }))).resolves.toEqual([{ row: 3, code: "A01", quantity: 3, shelf: "", warehouse: "โกดัง 5" }]);
});

test("accepts a UTF-8 BOM, wrapped parentheses in headers, and Thai or English aliases", async () => {
  await expect(readReferenceFile(new File(["\uFEFFรหัส,คงเหลือ\nB02,6\n"], "reference.csv"))).resolves.toEqual([
    { row: 2, code: "B02", quantity: 6, shelf: "" },
  ]);
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([["Item Code", "qty"], ["C03", 2]]);
  sheet.B1.v = "จำนวน\n(กล่อง)";
  sheet.B1.w = "จำนวน\n(กล่อง)";
  XLSX.utils.book_append_sheet(book, sheet, "โกดัง");
  const bytes = XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  expect(await readReferenceFile(new File([bytes], "reference.xlsx"))).toEqual([
    { row: 2, code: "C03", quantity: 2, shelf: "" },
  ]);
});

test("uses the pieces column when a file has both boxes and pieces", async () => {
  expect(await readReferenceFile(workbook({
    Sheet1: [["รหัสสินค้า", "จำนวนกล่อง", "จำนวนชิ้น"], ["D04", 2, 15]],
  }))).toEqual([{ row: 2, code: "D04", quantity: 15, shelf: "" }]);
});

test("reads data from a later sheet when the first sheet is a summary", async () => {
  expect(await readReferenceFile(workbook({
    สรุป: [["รายงานคลัง"], ["รวม", "10"]],
    รายการ: [["บาร์โค้ด", "จำนวน"], ["555", 9]],
  }))).toEqual([{ row: 2, code: "555", quantity: 9, shelf: "" }]);
});

test("warehouse report still works when a leading column is inserted and headers have spaces", () => {
  const sheet = [
    ["สินค้าคงเหลือ แยกตามคลังสินค้า"],
    ["", "คลัง", "", "รหัสสินค้า", "ชื่อสินค้า", "", "", "", "", "", "หน่วยใหญ่ ", "", "หน่วยย่อย"],
    ["", "5", "โกดัง 5"],
    ["", "", "", "001", "กล่อง", "", "", "", "", "", "2", "กล่องx12.0000", "3", "ชิ้น", "750"],
    ["", "รวมคลัง", "", "5", "1", "สินค้า", "", "", "", "", "2", "", "3"],
    ["", "รวมทั้งสิ้น", "1", "คลัง", "2", "สินค้า"],
  ];
  expect(readWarehouseStockReport(sheet)).toEqual([
    { row: 4, warehouse: "wh-05", code: "001", shelf: "", quantity: 27 },
  ]);
});

test("header errors mention the columns that were actually found", async () => {
  await expect(readReferenceFile(new File(["วันที่,โกดัง 5,ผู้พิมพ์\n24/11/2569,5,สมชาย\n"], "reference.csv")))
    .rejects.toThrow(/หัวที่พบ: วันที่, โกดัง 5, ผู้พิมพ์/);
});

import * as XLSX from "xlsx";
import { readReferenceFile } from "@/app/(dashboard)/stock-counts/_lib/reference-file";
import { readWarehouseStockReport } from "@/app/(dashboard)/stock-counts/_lib/warehouse-stock-report";

function workbook(sheets: Record<string, (string | number)[][]>, name = "reference.xlsx") {
  const book = XLSX.utils.book_new();
  for (const [sheetName, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), sheetName);
  }
  return new File([XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer], name);
}

const NAME_904 = 'D0904#50-904 ชุดข้อต่อสายยาง 1/2 แบบแยก 2 ทาง"';
const NAME_904_MID = 'D0904#50-904 ชุดข้อต่อสายยาง 1/2" แบบแยก 2 ทาง';
const NAME_737 = 'D0737#50-737 ข้อต่อแบบสวมเร็ว 1/2 3/4""';
const EXPECTED_904_737 = [
  { row: 3, code: "50-904", shelf: "", quantity: 2088 },
  { row: 4, code: "50-737", shelf: "", quantity: 1920 },
];

function warehouseHeader() {
  return ["คลัง", "", "รหัสสินค้า", "ชื่อสินค้า", "", "", "", "", "", "หน่วยใหญ่", "", "หน่วยย่อย"] as string[];
}

function warehouseTotals(count: string, large: string, small: string) {
  return [
    ["รวมคลัง", "", "5", count, "สินค้า", "", "", "", "", large, "", small],
    ["รวมทั้งสิ้น", "1", "คลัง", "2", "สินค้า"],
  ];
}

function warehouseCsv(productLines: string[], total = ["2", "4008", "0"]) {
  return [
    "คลัง,,รหัสสินค้า,ชื่อสินค้า,,,,,,หน่วยใหญ่,,หน่วยย่อย",
    "5,โกดัง 5",
    ...productLines,
    `รวมคลัง,,5,${total[0]},สินค้า,,,,,${total[1]},,${total[2]}`,
    "รวมทั้งสิ้น,1,คลัง,2,สินค้า",
  ].join("\n");
}

function q(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function qBroken(value: string) {
  return `"${value}"`;
}

test("warehouse report unpacks 50-904 when Excel packs only the large quantity after an inch quote", () => {
  const sheet = [
    warehouseHeader(),
    ["5", "โกดัง 5"],
    ["", "", "50-904", `${NAME_904}",",",",",",2088"`, "ตัวx1.0000", "0", "ตัว", "62640"],
    ["", "", "50-737", NAME_737, "", "", "", "", "", "1920", "ตัวx1.0000", "0", "ตัว", "11520"],
    ...warehouseTotals("2", "4008", "0"),
  ];
  expect(readWarehouseStockReport(sheet)).toEqual(EXPECTED_904_737);
});

test("warehouse report unpacks a fully packed large, unit, and small remainder in one cell", () => {
  const sheet = [
    warehouseHeader(),
    ["5", "โกดัง 5"],
    ["", "", "50-904", `${NAME_904}",",",",",",2088,ตัวx1.0000,0,ตัว,62640"`],
    ["", "", "50-737", NAME_737, "", "", "", "", "", "1920", "ตัวx1.0000", "0", "ตัว", "11520"],
    ...warehouseTotals("2", "4008", "0"),
  ];
  expect(readWarehouseStockReport(sheet)).toEqual(EXPECTED_904_737);
});

test("warehouse report joins a large quantity split left by a quoted 2,088", () => {
  const sheet = [
    warehouseHeader(),
    ["5", "โกดัง 5"],
    ["", "", "50-904", `${NAME_904}",",",",",",2`, '088"', "ตัวx1.0000", "0", "ตัว", "62640"],
    ["", "", "50-737", NAME_737, "", "", "", "", "", "1920", "ตัวx1.0000", "0", "ตัว", "11520"],
    ...warehouseTotals("2", "4008", "0"),
  ];
  expect(readWarehouseStockReport(sheet)).toEqual(EXPECTED_904_737);
});

test("warehouse report keeps 50-737 with a doubled inch quote and a mid-name inch quote", () => {
  const sheet = [
    warehouseHeader(),
    ["5", "โกดัง 5"],
    ["", "", "50-737", NAME_737, "", "", "", "", "", "1920", "ตัวx1.0000", "0", "ตัว", "11520"],
    ["", "", "50-904", NAME_904_MID, "", "", "", "", "", "2088", "ตัวx1.0000", "0", "ตัว", "62640"],
    ...warehouseTotals("2", "4008", "0"),
  ];
  expect(readWarehouseStockReport(sheet)).toEqual([
    { row: 3, code: "50-737", shelf: "", quantity: 1920 },
    { row: 4, code: "50-904", shelf: "", quantity: 2088 },
  ]);
});

test("warehouse report skips a missing multiplier and still skips a wrong warehouse total", () => {
  const missing = [
    warehouseHeader(),
    ["5", "โกดัง 5"],
    ["", "", "50-904", NAME_904, "", "", "", "", "", "2088", "ตัว", "0", "ตัว", "62640"],
    ...warehouseTotals("1", "2088", "0"),
  ];
  expect(() => readWarehouseStockReport(missing)).toThrow("ข้อมูลรายงานไม่ครบ กรุณาตรวจสอบรายการสินค้า");
  const emptyUnit = [
    warehouseHeader(),
    ["5", "โกดัง 5"],
    ["", "", "50-904", `${NAME_904}",",",",",",2088"`, "", "0", "ตัว", "62640"],
    ...warehouseTotals("1", "2088", "0"),
  ];
  expect(() => readWarehouseStockReport(emptyUnit)).toThrow("ข้อมูลรายงานไม่ครบ กรุณาตรวจสอบรายการสินค้า");
  const wrongTotal = [
    warehouseHeader(),
    ["5", "โกดัง 5"],
    ["", "", "50-904", `${NAME_904}",",",",",",2088"`, "ตัวx1.0000", "0", "ตัว", "62640"],
    ...warehouseTotals("1", "2089", "0"),
  ];
  expect(readWarehouseStockReport(wrongTotal)).toEqual([
    { row: 3, code: "50-904", shelf: "", quantity: 2088 },
  ]);
});

test("reads the exact 50-904 warehouse CSV row with another product after it", async () => {
  const unquoted = ",,50-904," + NAME_904 + ",,,,,,2088,ตัวx1.0000,0,ตัว,62640";
  const unquoted737 = ",,50-737," + NAME_737 + ",,,,,,1920,ตัวx1.0000,0,ตัว,11520";
  const quoted2088c = ",,50-904," + NAME_904 + ',,,,,,"2,088",ตัวx1.0000,0,ตัว,62640';
  await expect(readReferenceFile(new File([warehouseCsv([unquoted, unquoted737])], "reference.csv")))
    .resolves.toEqual(EXPECTED_904_737);
  await expect(readReferenceFile(new File([warehouseCsv([quoted2088c, unquoted737])], "reference.csv")))
    .resolves.toEqual(EXPECTED_904_737);
});

test("recovers 50-904 when a quoted CSV name with an unescaped inch quote swallows later rows", async () => {
  const row904 = [ "", "", "50-904", NAME_904, "", "", "", "", "", "2088", "ตัวx1.0000", "0", "ตัว", "62640" ]
    .map((value, index) => index === 3 ? qBroken(value) : q(value)).join(",");
  const row904c = [ "", "", "50-904", NAME_904, "", "", "", "", "", "2,088", "ตัวx1.0000", "0", "ตัว", "62640" ]
    .map((value, index) => index === 3 ? qBroken(value) : q(value)).join(",");
  const row737 = [ "", "", "50-737", NAME_737, "", "", "", "", "", "1920", "ตัวx1.0000", "0", "ตัว", "11520" ]
    .map(q).join(",");
  const header = [ "คลัง", "", "รหัสสินค้า", "ชื่อสินค้า", "", "", "", "", "", "หน่วยใหญ่", "", "หน่วยย่อย" ].map(q).join(",");
  const warehouse = [ "5", "โกดัง 5" ].map(q).join(",");
  const quotedEmpties = [header, warehouse, row904, row737, "รวมคลัง,,5,2,สินค้า,,,,,4008,,0", "รวมทั้งสิ้น,1,คลัง,2,สินค้า"].join("\n");
  const quotedComma = [header, warehouse, row904c, row737, "รวมคลัง,,5,2,สินค้า,,,,,4008,,0", "รวมทั้งสิ้น,1,คลัง,2,สินค้า"].join("\n");
  await expect(readReferenceFile(new File([quotedEmpties], "reference.csv"))).resolves.toEqual(EXPECTED_904_737);
  await expect(readReferenceFile(new File([quotedComma], "reference.csv"))).resolves.toEqual(EXPECTED_904_737);
});

test("reads an Excel-saved warehouse xlsx with packed, fully packed, and left-shifted 50-904 rows", async () => {
  await expect(readReferenceFile(workbook({ รายงาน: [
    warehouseHeader(),
    ["5", "โกดัง 5"],
    ["", "", "50-904", `${NAME_904}",",",",",",2088"`, "ตัวx1.0000", "0", "ตัว", "62640"],
    ["", "", "50-737", NAME_737, "", "", "", "", "", "1920", "ตัวx1.0000", "0", "ตัว", "11520"],
    ...warehouseTotals("2", "4008", "0"),
  ] }))).resolves.toEqual(EXPECTED_904_737);

  await expect(readReferenceFile(workbook({ รายงาน: [
    warehouseHeader(),
    ["5", "โกดัง 5"],
    ["", "", "50-904", `${NAME_904}",",",",",",2088,ตัวx1.0000,0,ตัว,62640"`],
    ["", "", "50-737", NAME_737, "", "", "", "", "", "1920", "ตัวx1.0000", "0", "ตัว", "11520"],
    ...warehouseTotals("2", "4008", "0"),
  ] }))).resolves.toEqual(EXPECTED_904_737);

  await expect(readReferenceFile(workbook({ รายงาน: [
    warehouseHeader(),
    ["5", "โกดัง 5"],
    ["", "", "50-904", `${NAME_904}",",",",",",2`, '088"', "ตัวx1.0000", "0", "ตัว", "62640"],
    ["", "", "50-737", NAME_737, "", "", "", "", "", "1920", "ตัวx1.0000", "0", "ตัว", "11520"],
    ...warehouseTotals("2", "4008", "0"),
  ] }))).resolves.toEqual(EXPECTED_904_737);
});

test("recovers 50-904 when a quoted CSV has an unescaped mid-name inch quote", async () => {
  const row904 = [ "", "", "50-904", NAME_904_MID, "", "", "", "", "", "2088", "ตัวx1.0000", "0", "ตัว", "62640" ]
    .map((value, index) => index === 3 ? qBroken(value) : q(value)).join(",");
  const row904c = [ "", "", "50-904", NAME_904_MID, "", "", "", "", "", "2,088", "ตัวx1.0000", "0", "ตัว", "62640" ]
    .map((value, index) => index === 3 ? qBroken(value) : q(value)).join(",");
  const row737 = [ "", "", "50-737", NAME_737, "", "", "", "", "", "1920", "ตัวx1.0000", "0", "ตัว", "11520" ]
    .map(q).join(",");
  const header = [ "คลัง", "", "รหัสสินค้า", "ชื่อสินค้า", "", "", "", "", "", "หน่วยใหญ่", "", "หน่วยย่อย" ].map(q).join(",");
  const warehouse = [ "5", "โกดัง 5" ].map(q).join(",");
  const quotedEmpties = [header, warehouse, row904, row737, "รวมคลัง,,5,2,สินค้า,,,,,4008,,0", "รวมทั้งสิ้น,1,คลัง,2,สินค้า"].join("\n");
  const quotedComma = [header, warehouse, row904c, row737, "รวมคลัง,,5,2,สินค้า,,,,,4008,,0", "รวมทั้งสิ้น,1,คลัง,2,สินค้า"].join("\n");
  await expect(readReferenceFile(new File([quotedEmpties], "reference.csv"))).resolves.toEqual(EXPECTED_904_737);
  await expect(readReferenceFile(new File([quotedComma], "reference.csv"))).resolves.toEqual(EXPECTED_904_737);
});

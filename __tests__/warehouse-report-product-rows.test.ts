import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as XLSX from "xlsx";
import { readReferenceFile } from "@/app/(dashboard)/stock-counts/_lib/reference-file";
import { readWarehouseStockReport } from "@/app/(dashboard)/stock-counts/_lib/warehouse-stock-report";
import { sameWarehouseRef } from "@/lib/warehouse-utils";

function tableFromTsv(text: string) {
  return text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(line => line.length > 0).map(line => line.split("\t"));
}

function fixtureTable() {
  return tableFromTsv(readFileSync(resolve(__dirname, "fixtures/warehouse-stock-report-wh5.tsv"), "utf8"));
}

const SPOT_CHECKS: Record<string, number> = {
  "0สบ-120-4": 20240,
  "50-904": 2088,
  "50-706": 2016,
  "อล-1026B": 860,
};

test("pasted warehouse report imports 120 product rows and skips the PL header and totals", () => {
  const rows = readWarehouseStockReport(fixtureTable());
  expect(rows).toHaveLength(120);
  expect(rows?.map(row => row.code)).toEqual(expect.arrayContaining(Object.keys(SPOT_CHECKS)));
  for (const [code, quantity] of Object.entries(SPOT_CHECKS)) {
    expect(rows?.find(row => row.code === code)).toMatchObject({ code, quantity, shelf: "" });
  }
  expect(rows?.[0]).toMatchObject({ row: 9, code: "0สบ-120-4", quantity: 20240 });
  expect(rows?.some(row => row.code === "PL" || row.code === "รวมคลัง" || row.code === "5")).toBe(false);
});

test("readReferenceFile imports the pasted warehouse report from an xlsx file", async () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(fixtureTable()), "รายงาน");
  const file = new File([XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer], "wh5.xlsx");
  const rows = await readReferenceFile(file);
  expect(rows).toHaveLength(120);
  for (const [code, quantity] of Object.entries(SPOT_CHECKS)) {
    expect(rows.find(row => row.code === code)?.quantity).toBe(quantity);
  }
});

test("sameWarehouseRef accepts equivalent warehouse 5 identifiers used in a report", () => {
  expect(sameWarehouseRef("wh-05", "wh-05", "WH5", "โกดัง 5 (พระราม 2)")).toBe(true);
  expect(sameWarehouseRef("wh-05", "wh-5", "5", "โกดัง5")).toBe(true);
  expect(sameWarehouseRef("5", "wh-05", "WH-5", "โกดัง 5")).toBe(true);
  expect(sameWarehouseRef(undefined, "wh-05")).toBe(true);
  expect(sameWarehouseRef("wh-01", "wh-05", "WH5", "โกดัง 5")).toBe(false);
});
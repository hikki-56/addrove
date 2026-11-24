import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as XLSX from "xlsx";
import { readReferenceFile } from "@/app/(dashboard)/stock-counts/_lib/reference-file";
import { readWarehouseStockReport } from "@/app/(dashboard)/stock-counts/_lib/warehouse-stock-report";
import { isForeignWarehouseRow, sameWarehouseRef } from "@/lib/warehouse-utils";

function tableFromTsv(text: string) {
  return text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(line => line.length > 0).map(line => line.split("\t"));
}

const SPOT_CHECKS: Record<string, number> = {
  "0สบ-120-4": 20240,
  "50-904": 2088,
  "50-706": 2016,
  "อล-1026B": 860,
};

const WH5 = ["wh-05", "WH-5", "โกดัง5"] as const;

function assertSpotChecks(rows: { code: string; quantity: number; warehouse?: string }[]) {
  expect(rows).toHaveLength(120);
  for (const [code, quantity] of Object.entries(SPOT_CHECKS)) {
    expect(rows.find(row => row.code === code)).toMatchObject({ code, quantity, shelf: "" });
  }
  expect(rows.some(row => row.code === "PL" || row.code === "รวมคลัง" || row.code === "5")).toBe(false);
  expect(rows.find(row => isForeignWarehouseRow(row.warehouse, ...WH5))).toBeUndefined();
}

test("pasted warehouse report imports 120 product rows and skips the PL header and totals", () => {
  const rows = readWarehouseStockReport(tableFromTsv(
    readFileSync(resolve(__dirname, "fixtures/warehouse-stock-report-wh5.tsv"), "utf8"),
  ));
  assertSpotChecks(rows ?? []);
  expect(rows?.[0]).toMatchObject({ row: 9, code: "0สบ-120-4", quantity: 20240 });
});

test("exact cp874 warehouse CSV imports 120 products through the upload reader", async () => {
  const buf = readFileSync(resolve(__dirname, "fixtures/warehouse-stock-report-wh5.csv"));
  const rows = await readReferenceFile(new File([buf], "warehouse-stock-report-wh5.csv"));
  assertSpotChecks(rows);
  expect(rows[0]).toMatchObject({ row: 9, code: "0สบ-120-4", quantity: 20240 });
  expect(rows.every(row => row.warehouse == null || row.warehouse === "")).toBe(true);
});

test("readReferenceFile imports the pasted warehouse report from an xlsx file", async () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(tableFromTsv(
    readFileSync(resolve(__dirname, "fixtures/warehouse-stock-report-wh5.tsv"), "utf8"),
  )), "รายงาน");
  const rows = await readReferenceFile(new File(
    [XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer],
    "wh5.xlsx",
  ));
  assertSpotChecks(rows);
});

test("sameWarehouseRef accepts equivalent warehouse 5 identifiers and does not block uncertain labels", () => {
  expect(sameWarehouseRef("wh-05", ...WH5)).toBe(true);
  expect(sameWarehouseRef("wh-05", "wh-5", "5", "โกดัง5")).toBe(true);
  expect(sameWarehouseRef("5", "wh-05", "WH-5", "โกดัง 5")).toBe(true);
  expect(sameWarehouseRef("โกดัง 5 (พระราม 2)", "wh-05", "WH-5", "โกดัง5")).toBe(true);
  expect(sameWarehouseRef(undefined, "wh-05")).toBe(true);
  expect(sameWarehouseRef("0สบ-120-4", ...WH5)).toBe(true);
  expect(sameWarehouseRef("PL", ...WH5)).toBe(true);
  expect(sameWarehouseRef("wh-01", ...WH5)).toBe(false);
  expect(isForeignWarehouseRow("wh-01", ...WH5)).toBe(true);
  expect(isForeignWarehouseRow("0สบ-120-4", ...WH5)).toBe(false);
});
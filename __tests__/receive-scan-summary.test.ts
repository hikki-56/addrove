import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildScanStripTotals,
  formatScanStripLabel,
  lineMatchesLastScan,
  scanStripSegments,
} from "@/features/receive/scan-summary";
import ReceiveScanSummaryStrip from "@/features/receive/components/ReceiveScanSummaryStrip";

test("empty strip shows 0 items without boxes, pieces, or the word แพ็ก", () => {
  const totals = buildScanStripTotals([]);
  expect(totals).toEqual({ lineCount: 0, boxCount: 0, pieceCount: null });
  expect(formatScanStripLabel(totals)).toBe("สแกนแล้ว 0 รายการ");
  expect(formatScanStripLabel(totals)).not.toContain("กล่อง");
  expect(formatScanStripLabel(totals)).not.toContain("ชิ้น");
  expect(formatScanStripLabel(totals)).not.toContain("แพ็ก");
});

test("filled strip appends pieces only when every line has a piece count", () => {
  const complete = buildScanStripTotals([
    { product_id: "p-1", boxes: 3, qty: 36 },
    { product_id: "p-2", boxes: 5, qty: 60 },
    { product_id: "p-3", boxes: 3, qty: 36 },
    { product_id: "p-4", boxes: 1, qty: 12 },
  ]);
  expect(complete).toEqual({ lineCount: 4, boxCount: 12, pieceCount: 144 });
  expect(formatScanStripLabel(complete)).toBe("สแกนแล้ว 4 รายการ · 12 กล่อง · 144 ชิ้น");
  expect(formatScanStripLabel(complete)).not.toContain("แพ็ก");

  const missingPieces = buildScanStripTotals([
    { product_id: "p-1", boxes: 2, qty: 24 },
    { product_id: "p-2", boxes: 1, qty: 0 },
  ]);
  expect(missingPieces).toEqual({ lineCount: 2, boxCount: 3, pieceCount: null });
  expect(formatScanStripLabel(missingPieces)).toBe("สแกนแล้ว 2 รายการ · 3 กล่อง");
  expect(formatScanStripLabel(missingPieces)).not.toContain("ชิ้น");
  expect(formatScanStripLabel(missingPieces)).not.toContain("แพ็ก");
});

test("box count matches the receive summary default of 1 when boxes is missing", () => {
  const totals = buildScanStripTotals([{ product_id: "p-1", qty: 12 }]);
  expect(totals.boxCount).toBe(1);
  expect(formatScanStripLabel(totals)).toBe("สแกนแล้ว 1 รายการ · 1 กล่อง · 12 ชิ้น");
});

test("number segments are marked so the strip can use Barlow on digits", () => {
  const segments = scanStripSegments({ lineCount: 4, boxCount: 12, pieceCount: 144 });
  expect(segments.filter((part) => part.isNumber).map((part) => part.text)).toEqual(["4", "12", "144"]);
});

test("lineMatchesLastScan highlights only the product that was just scanned", () => {
  expect(lineMatchesLastScan("p-tea", "p-tea")).toBe(true);
  expect(lineMatchesLastScan("p-loose", "p-tea")).toBe(false);
  expect(lineMatchesLastScan("p-tea", null)).toBe(false);
  expect(lineMatchesLastScan(undefined, "p-tea")).toBe(false);
});

test("strip markup uses กล่อง, never แพ็ก, and stays grey when empty", () => {
  const empty = renderToStaticMarkup(React.createElement(ReceiveScanSummaryStrip, { lines: [] }));
  expect(empty).toContain("สแกนแล้ว ");
  expect(empty).toContain(">0<");
  expect(empty).toContain(" รายการ");
  expect(empty).toContain("bg-m3-grey-200");
  expect(empty).toContain("text-m3-grey-600");
  expect(empty).not.toContain("แพ็ก");
  expect(empty).not.toContain("กล่อง");

  const filled = renderToStaticMarkup(
    React.createElement(ReceiveScanSummaryStrip, {
      lines: [
        { product_id: "p-1", boxes: 3, qty: 36 },
        { product_id: "p-2", boxes: 9, qty: 108 },
      ],
    }),
  );
  expect(filled).toContain("สแกนแล้ว ");
  expect(filled).toContain(">2<");
  expect(filled).toContain(" รายการ · ");
  expect(filled).toContain(">12<");
  expect(filled).toContain(" กล่อง");
  expect(filled).toContain(" ชิ้น");
  expect(filled).toContain("rgba(0,167,111,0.08)");
  expect(filled).toContain("text-m3-primary-dark");
  expect(filled).toContain("font-m3-disp");
  expect(filled).not.toContain("แพ็ก");
});

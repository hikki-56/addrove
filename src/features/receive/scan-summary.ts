export type ReceiveScanLine = {
  product_id?: string;
  boxes?: number | null;
  qty?: number | null;
};

export type ScanStripTotals = {
  lineCount: number;
  boxCount: number;
  /** null when any line is missing a piece quantity */
  pieceCount: number | null;
};

export type ScanStripSegment = {
  text: string;
  isNumber?: boolean;
};

/** ยอดในแถบสรุปใต้กล้อง — จำนวนกล่องใช้สูตรเดียวกับสรุปรอบนี้ */
export function buildScanStripTotals(lines: ReceiveScanLine[] | null | undefined): ScanStripTotals {
  const rows = lines || [];
  const lineCount = rows.length;
  const boxCount = rows.reduce((sum, line) => sum + (Number(line.boxes) || 1), 0);
  const allHavePieces = lineCount > 0 && rows.every((line) => (Number(line.qty) || 0) > 0);
  const pieceCount = allHavePieces
    ? rows.reduce((sum, line) => sum + (Number(line.qty) || 0), 0)
    : null;
  return { lineCount, boxCount, pieceCount };
}

/** ชิ้นต่อท้ายเฉพาะเมื่อรู้จำนวนชิ้นครบทุกรายการ — ใช้คำว่า "กล่อง" เท่านั้น */
export function scanStripSegments(totals: ScanStripTotals): ScanStripSegment[] {
  if (totals.lineCount <= 0) {
    return [
      { text: "สแกนแล้ว " },
      { text: "0", isNumber: true },
      { text: " รายการ" },
    ];
  }
  const parts: ScanStripSegment[] = [
    { text: "สแกนแล้ว " },
    { text: String(totals.lineCount), isNumber: true },
    { text: " รายการ · " },
    { text: String(totals.boxCount), isNumber: true },
    { text: " กล่อง" },
  ];
  if (totals.pieceCount != null) {
    parts.push(
      { text: " · " },
      { text: String(totals.pieceCount), isNumber: true },
      { text: " ชิ้น" },
    );
  }
  return parts;
}

export function formatScanStripLabel(totals: ScanStripTotals): string {
  return scanStripSegments(totals).map((part) => part.text).join("");
}

export function lineMatchesLastScan(
  lineProductId: string | undefined,
  lastScannedId: string | null | undefined,
): boolean {
  if (!lastScannedId || !lineProductId) return false;
  return lineProductId === lastScannedId;
}

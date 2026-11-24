import type { CountReferenceRow } from "@/types/count-round";

function amount(text: string | undefined) {
  const value = text?.trim() ?? "";
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(value))
    return null;
  return Number(value.replaceAll(",", ""));
}

function norm(text: string | undefined) {
  return (text ?? "").replace(/^\uFEFF/, "").replace(/\s+/g, " ").trim();
}

function cellName(text: string | undefined) {
  return norm(text).replace(/\s*[(（].*$/, "");
}

function col(header: string[], name: string) {
  return header.findIndex(v => cellName(v) === name);
}

const NUMBER = /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/;
const UNIT_FACTOR = /[x×]\s*(\d+(?:\.\d+)?)$/i;
const PACK_TAILS = [
  /"(?:,"){5},/g,   // Excel leftover: ",",",",",","
  /"(?:,""){5},/g, // SheetJS leftover: "","","","","",""
  /",{5}/g,          // unquoted empty columns: ",,,,,"
];

function parseCsvFields(text: string, start = 0) {
  const fields: string[] = [];
  let field = "";
  let i = start;
  let quoted = false;
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      if (field === "") { quoted = true; i++; continue; }
      field += c;
      i++;
      continue;
    }
    if (c === ",") { fields.push(field); field = ""; i++; continue; }
    if (c === "\n" || c === "\r") break;
    field += c;
    i++;
  }
  fields.push(field);
  return fields;
}

function stripWrap(value: string) {
  const text = value.trim();
  if (text.startsWith('"') && text.endsWith('"') && text.length >= 2)
    return text.slice(1, -1).replaceAll('""', '"');
  return text.endsWith('"') ? text.slice(0, -1) : text;
}

function splitRemaining(text: string) {
  return parseCsvFields(text).map(stripWrap);
}

function isNumericField(value: string) {
  return NUMBER.test(value.trim()) || /^\d+$/.test(value.trim());
}

function matchPackTail(first: string) {
  let best: { name: string; values: string[]; at: number } | undefined;
  for (const pattern of PACK_TAILS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(first))) {
      const values = splitRemaining(first.slice(match.index + match[0].length));
      if (!values.length || !isNumericField(values[0] ?? "")) continue;
      if (!best || match.index >= best.at)
        best = { name: first.slice(0, match.index + 1), values, at: match.index };
    }
  }
  return best;
}

function mergePackedValues(values: string[], restCells: string[]) {
  const vals = [...values];
  const firstRest = (restCells[0] ?? "").trim();
  if (vals.length === 1 && /^\d+$/.test(vals[0] ?? "") && restCells.length) {
    const fragment = firstRest.match(/^(\d[\d,.]*)"?$/);
    if (fragment && UNIT_FACTOR.test((restCells[1] ?? "").trim())) {
      vals[0] = `${vals[0]},${fragment[1]}`;
      vals.push(...restCells.slice(1).map(stripWrap));
    } else if (UNIT_FACTOR.test(firstRest)) {
      vals.push(...restCells.map(stripWrap));
    }
  } else if (vals.length >= 2 && !(vals[2]?.trim()) && restCells.length) {
    vals.push(...restCells.map(stripWrap));
  }
  return { large: vals[0] ?? "", unit: vals[1] ?? "", small: vals[2] ?? "" };
}

function cleanPackedName(name: string) {
  return name.replace(/^"+/, "").replaceAll('""', '"');
}

function parseCsvRows(text: string) {
  return text.split(/\r?\n/).filter(line => line.length > 0).map(line => parseCsvFields(line));
}

function repairPackedRow(row: string[], iPacked: number, iLarge: number, iUnit: number, iSmall: number) {
  const packed = row[iPacked] ?? "";
  const hasBreak = /\r?\n/.test(packed);
  const large = row[iLarge];
  const unit = iUnit >= 0 ? row[iUnit] : "";
  if (!hasBreak && large?.trim() && unit?.trim()) return { row, extras: [] as string[][] };
  if (!packed.includes('"') && !hasBreak) return { row, extras: [] as string[][] };

  const breakAt = packed.search(/\r?\n/);
  const first = breakAt >= 0 ? packed.slice(0, breakAt) : packed;
  const restText = breakAt >= 0 ? packed.slice(breakAt).replace(/^\r?\n/, "") : "";
  const extras = restText ? parseCsvRows(restText) : [];
  const tail = matchPackTail(first);
  if (!tail) {
    if (!extras.length) return { row, extras };
    const copy = row.slice();
    copy[iPacked] = first;
    return { row: copy, extras };
  }

  const copy = row.slice();
  const merged = mergePackedValues(tail.values, copy.slice(iPacked + 1));
  copy[iPacked] = cleanPackedName(tail.name);
  copy[iLarge] = merged.large;
  if (iUnit >= 0) copy[iUnit] = merged.unit;
  copy[iSmall] = merged.small;
  for (let c = iPacked + 1; c < iLarge; c++) copy[c] = "";
  return { row: copy, extras };
}

function repairPackedRows(table: string[][], iPacked: number, iLarge: number, iUnit: number, iSmall: number) {
  const out: string[][] = [];
  const queue = table.map(r => r.slice());
  while (queue.length) {
    const current = queue.shift()!;
    const repaired = repairPackedRow(current, iPacked, iLarge, iUnit, iSmall);
    out.push(repaired.row);
    if (repaired.extras.length) queue.unshift(...repaired.extras);
  }
  return out;
}

export function readWarehouseStockReport(table: string[][]): CountReferenceRow[] | undefined {
  const header = table.findIndex(r => col(r, "คลัง") >= 0 && col(r, "รหัสสินค้า") >= 0 &&
    col(r, "หน่วยใหญ่") >= 0 && col(r, "หน่วยย่อย") >= 0);
  if (header < 0) return undefined;

  const head = table[header];
  const iWarehouse = col(head, "คลัง");
  const iCode = col(head, "รหัสสินค้า");
  const iName = col(head, "ชื่อสินค้า");
  const iBarcode = ["บาร์โค้ด", "เลขบาร์โค้ด", "barcode"].map(name => col(head, name)).find(index => index >= 0) ?? -1;
  const iLarge = col(head, "หน่วยใหญ่");
  const iSmall = col(head, "หน่วยย่อย");
  const iUnit = iLarge + 1 === iSmall ? -1 : iLarge + 1;
  const iPacked = iName >= 0 ? iName : iCode + 1;
  table = repairPackedRows(table, iPacked, iLarge, iUnit, iSmall);

  const rows: CountReferenceRow[] = [];
  let warehouse = "";
  let skipSection = false;
  for (let i = header + 1; i < table.length; i++) {
    const r = table[i];
    const label = cellName(r[iWarehouse]);
    const code = r[iCode]?.trim();
    if (label && /^0?[1-6]$/.test(label) && !code) {
      const id = `wh-${label.padStart(2, "0")}`;
      if (!warehouse) warehouse = id;
      skipSection = warehouse !== id;
      continue;
    }
    if (skipSection) continue;
    if (!code || label === "รวมทั้งสิ้น" || label === "รวมคลัง" || label.startsWith("รวม") ||
      (label === "คลัง" && cellName(code) === "รหัสสินค้า")) continue;
    const large = r[iLarge], unit = iUnit >= 0 ? r[iUnit] : "", small = r[iSmall];
    const factor = unit?.trim().match(UNIT_FACTOR);
    const hasQty = NUMBER.test((large ?? "").trim()) || NUMBER.test((small ?? "").trim());
    if (!hasQty) continue;
    if (!factor || Number(factor[1]) <= 0) continue;
    const largeQty = amount(large);
    const smallQty = amount(small);
    if (largeQty === null || smallQty === null) continue;
    const total = largeQty * Number(factor[1]) + smallQty;
    const quantity = Number(total.toFixed(3));
    if (Math.abs(quantity - total) > 0.000001 || quantity > 99999999999.999) continue;
    const fileBarcode = (iBarcode >= 0 ? r[iBarcode]?.trim() : "") || "";
    rows.push({ row: i + 1, code, quantity, shelf: "", ...(fileBarcode && fileBarcode !== code ? { barcode: fileBarcode } : {}) });
  }
  if (!rows.length) throw new Error("ข้อมูลรายงานไม่ครบ กรุณาตรวจสอบรายการสินค้า");
  return rows;
}

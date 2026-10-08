import type { ParsedBillItem } from "./bill-import.service";

/**
 * Parser เอกสาร Express แบบ PDF (ใบสั่งขาย/ใบส่งของ เช่น 9090957.pdf)
 *
 * โครงสร้างเอกสาร (สรุปจากไฟล์จริง):
 *   09-ส-06                       ← เลขที่เอกสาร (เล่ม-ที่)
 *   ร้าน สวีทโฮมฮาร์ดแวร์           ← ชื่อลูกค้า
 *   ...ที่อยู่... IV9090957          ← เลขที่ IV (unique, ตรงกับชื่อไฟล์)
 *   โทร 12/09/69 (08:45:26)       ← วันที่ (พ.ศ.)
 *   1  1203 #B-04 สะดืออ้างท/ล ไฮโฟ่  22.00 ชุด 125.00 2,750.00
 *   ↑ลำดับ ↑รหัส(nำหน้า#รหัสย่อ) ↑ชื่อ  ↑จำนวน ↑หน่วย [ราคา [ส่วนลด [ยอด]]]
 *   (แถวไม่มีราคาต่อท้าย = รายการต่อของ SKU เดิม เช่นของแถม — รวมยอดให้ภายหลัง)
 *
 * คีย์จับคู่สินค้า: กลุ่มรหัสนำหน้าชื่อบรรทัด ("1203 #B-04", "0350#KJ35MM S")
 * ตรงกับ "ต้นข้อความคอลัมน์รายละเอียด" ของ PRODUCTS (SKU จริงคือ B04/KJ35M)
 * ดูกลไกนี้ที่ matchProducts ใน bill-import.service.ts
 *
 * หมายเหตุฟอนต์: วรรณยุกต์ไทยบางตัวเข้ารหัสเป็น private-use (U+F700–F7FF)
 * แปลงกลับตาม mapping ที่พิสูจน์จากคำจริง (ร้าน/อ้าง/ก๊อก/ปืน/ซิงค์/ไฮโฟ่)
 */

/**
 * รหัส private-use → ตัวอักษรไทยจริง (ที่เหลือที่ไม่รู้จัก → ตัดทิ้ง)
 * ฟอนต์ Express เก็บวรรณยุกต์แบบ 2 ตำแหน่ง (ปกติ สำหรับพยัญชนะกลาง/สูง
 * และแบบยกสูง สำหรับพยัญชนะต่ำ เช่น ร ฟ) จึงมีรหัสซ้ำเชิงตำแหน่ง:
 *   F70A = ้ ปกติ (อ้าง) · F70B = ้ ยกสูง (ร้าน/ร้อย/เส้น)
 *   F705 = ่ ยกสูง (ไฮโฟ่) · F70C = ๊ (ก๊อก) · F704 = ื (ปืน) · F70E = ์ (ซิงค์/ฮาร์ด)
 */
const PUA_MAP: Record<string, string> = {
  "\uF704": "\u0E37", // ื (ป\uf704น = ปืน)
  "\uF705": "\u0E48", // ่ (ไฮโฟ\uf705 = ไฮโฟ่)
  "\uF70A": "\u0E49", // ้ (อ\uf70aาง = อ้าง)
  "\uF70B": "\u0E49", // ้ แบบยกสูง (ร\uf70bาน = ร้าน, ร\uf70bอย = ร้อย, เส\uf70bน = เส้น)
  "\uF70C": "\u0E4A", // ๊ (ก\uf70cอก = ก๊อก)
  "\uF70E": "\u0E4C", // ์ (ซิงค\uf70e/ฮาร\uf70eด = ซิงค์/ฮาร์ด/สตางค\uf70e)
};

export function fixThaiPua(text: string): string {
  return text.replace(/[\uF700-\uF7FF]/g, (ch) => PUA_MAP[ch] ?? "");
}

const THAI_CHAR = /[\u0E00-\u0E7F]/;
const NUMERIC_TOKEN = /^[\d,]+(?:\.\d+)?$/;

export interface ExpressPdfBill {
  /** เลขที่เอกสารตามเอกสาร (เช่น 09-ส-06) — อาจซ้ำข้ามวัน ใช้เป็นอ้างอิงเท่านั้น */
  doc_no: string;
  /** เลขที่ IV (เช่น IV9090957) — unique, ใช้เป็นเลขบิลหลัก */
  iv_no?: string;
  /** เลขบิลที่ใช้ในระบบ = iv_no ถ้ามี ไม่งั้น doc_no */
  express_bill_no: string;
  customer?: string;
  /** วันที่เอกสารแบบ ISO (แปลงจาก พ.ศ. → ค.ศ. แล้ว) */
  date?: string;
  items: ParsedBillItem[];
}

/** แปลงวันที่ พ.ศ./ค.ศ. แบบ d/m/y(y) → YYYY-MM-DD */
export function parseThaiDate(raw: string): string | undefined {
  const m = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return undefined;
  const dd = String(Number(m[1])).padStart(2, "0");
  const mm = String(Number(m[2])).padStart(2, "0");
  let yyyy = Number(m[3]);
  if (yyyy < 100) yyyy = 2500 + yyyy; // 69 → 2569
  if (yyyy > 2400) yyyy -= 543; // พ.ศ. → ค.ศ.
  if (yyyy < 1900 || yyyy > 2200) return undefined;
  return `${yyyy}-${mm}-${dd}`;
}

/** หน่วยนับไทยสั้นๆ (ชุด/ตัว/เส้น/ม./อัน/…) */
function isThaiUnitToken(token: string): boolean {
  return new RegExp("^[\\u0E00-\\u0E7F]{1,8}\\.?$").test(token);
}

/**
 * แยกบรรทัดรายการสินค้าจากข้อความที่สกัดจาก PDF (pure function — ทดสอบง่าย)
 */
export function parseExpressPdfText(rawText: string): ExpressPdfBill {
  const text = fixThaiPua(rawText);
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  let docNo = "";
  let ivNo: string | undefined;
  let customer: string | undefined;
  let date: string | undefined;
  const items: ParsedBillItem[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // เลขที่ IV (อยู่ปลายบรรทัดที่อยู่) — unique ใช้เป็นเลขบิลหลัก
    if (!ivNo) {
      const iv = line.match(/\b(IV\s?\d{5,})\b/i);
      if (iv) ivNo = iv[1].replace(/\s+/g, "").toUpperCase();
    }

    // เลขที่เอกสาร: บรรทัดแรกที่มีรูปแบบ xx-ส-xx (เล่ม-ประเภท-ลำดับ)
    if (!docNo && /^(\d{1,4}-[\u0E00-\u0E7Fa-zA-Z]{1,4}-\d{1,6})/.test(line)) {
      docNo = RegExp.$1;
    }

    // วันที่: d/m/yy ตัวแรกของเอกสาร (เส้นทางโทร+เวลา)
    if (!date) {
      const d = parseThaiDate(line);
      if (d && /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(line) && i < 10) date = d;
    }

    // ชื่อลูกค้า: บรรทัดถัดจากเลขที่เอกสาร
    if (!customer && docNo && i > 0 && lines[i - 1].startsWith(docNo) && THAI_CHAR.test(line) && !/^\d/.test(line)) {
      customer = line.replace(/\s+/g, " ").trim();
    }

    // ---- บรรทัดรายการสินค้า: "ลำดับ [รหัส…] [ชื่อไทย…] จำนวน หน่วย [ราคา [ส่วนลด [ยอด]]]" ----
    const itemMatch = line.match(/^(\d{1,4})\s+(.+)$/);
    if (!itemMatch) continue;
    const tokens = itemMatch[2]
      .split(/\t+|\s{2,}|\s+/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (tokens.length < 3) continue;

    // ตำแหน่งชื่อไทยเริ่มที่ไหน = จุดจบกลุ่มรหัส
    const firstThaiIdx = tokens.findIndex((t) => THAI_CHAR.test(t));
    if (firstThaiIdx <= 0) continue; // ต้องมีรหัสก่อนหน้าชื่ออย่างน้อย 1 token

    // หา "จำนวน" = token ตัวเลขที่อยู่ก่อนหน้าหน่วยไทยสั้นๆ โดยสแกนจากท้าย
    let qtyIdx = -1;
    for (let j = tokens.length - 1; j > firstThaiIdx; j--) {
      if (isThaiUnitToken(tokens[j]) && j - 1 > firstThaiIdx && NUMERIC_TOKEN.test(tokens[j - 1])) {
        qtyIdx = j - 1;
        break;
      }
      // token ท้ายที่เป็นตัวเลข/ส่วนลด = ราคา/ยอด ข้ามไปเรื่อยๆ
      if (!NUMERIC_TOKEN.test(tokens[j]) && !/%$/.test(tokens[j])) break;
    }
    if (qtyIdx === -1) continue;

    const qty = Math.round(Number(tokens[qtyIdx].replace(/,/g, "")));
    if (!Number.isFinite(qty) || qty <= 0) continue;

    const codePart = tokens.slice(0, firstThaiIdx).join(" ").replace(/\s+/g, " ").trim();
    if (!codePart || codePart.length < 2) continue;

    // ชื่อสินค้าใน Express: ข้อความรายการสินค้าทั้งหมดจนถึงก่อนตัวเลขจำนวน (รวมรหัสและชื่อไทย)
    const fullName = tokens.slice(0, qtyIdx).join(" ").replace(/\s+/g, " ").trim();

    items.push({ sku: codePart, qty, product_name: fullName });
  }

  if (items.length === 0) {
    throw new Error(
      "ไม่พบรายการสินค้าใน PDF นี้ — ตรวจว่าเป็นไฟล์ใบสั่งขาย/ใบส่งของจาก Express ที่มีตารางรายการ (ลำดับ รหัสสินค้า จำนวน หน่วย)"
    );
  }

  return {
    doc_no: docNo || "(ไม่พบเลขที่)",
    iv_no: ivNo,
    express_bill_no: ivNo || docNo || "(ไม่พบเลขที่)",
    customer: customer || undefined,
    date: date || undefined,
    items,
  };
}

/** อ่าน PDF จริงด้วย pdf-parse (pdf.js) แล้วส่งเข้า parser */
export async function parseExpressPdf(buffer: Buffer): Promise<ExpressPdfBill> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return parseExpressPdfText(result.text);
  } finally {
    await parser.destroy().catch(() => {});
  }
}

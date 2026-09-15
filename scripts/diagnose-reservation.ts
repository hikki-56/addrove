import { readSheet, SHEETS } from "../src/lib/google-sheets/client";
import { parseBillNote } from "../src/lib/services/outbound/outbound-documents";
import { isBillReserving } from "../src/lib/services/outbound/outbound-state-machine";

/**
 * วินิจฉัยปัญหา "สต็อกไม่พอสำหรับหยิบบิลนี้" — อ่านข้อมูลจริงจาก Google Sheets
 * แสดง: เอกสารที่กำลังจองสต็อก + ยอด On Hand จริงของสินค้าที่ถูกจอง
 * Run with: npx tsx --env-file=.env.local scripts/diagnose-reservation.ts
 */

interface DocRow {
  document_id: string;
  document_no: string;
  document_type: string;
  status: string;
  note: string;
}

async function main() {
  const [docRows, summaryRows] = await Promise.all([
    readSheet(SHEETS.DOCUMENTS),
    readSheet(SHEETS.STOCK_SUMMARY),
  ]);

  const [, ...docs] = docRows as unknown as DocRow[][];
  const [, ...summaries] = summaryRows as unknown as string[][];

  const outboundDocs = (docs as unknown as string[][])
    .map((row) => ({
      document_id: row[0] ?? "",
      document_no: row[1] ?? "",
      document_type: row[2] ?? "",
      status: row[5] ?? "",
      rawNote: row[6] ?? "",
    }))
    .filter((d) => d.document_type === "OUTBOUND_ORDER" || d.document_type === "WORK_ORDER");

  // ยอด On Hand รวมทุกคลังตาม product_id (columns: product_id, warehouse_id, location_id, quantity, ...)
  const onHand = new Map<string, number>();
  for (const s of summaries) {
    const pid = s[0] ?? "";
    const qty = Number(s[3]) || 0;
    if (!pid || pid === "product_id") continue;
    onHand.set(pid, (onHand.get(pid) || 0) + qty);
  }

  console.log(`อ่านเอกสาร outbound ทั้งหมด: ${outboundDocs.length} รายการ\n`);
  console.log("=== ทุกเอกสาร outbound (สถานะล่าสุด) ===\n");

  for (const d of outboundDocs) {
    if (!d.rawNote || !d.rawNote.startsWith("{")) {
      console.log(`📋 ${d.document_no} [${d.document_type}] docStatus=${d.status} (ไม่มี note)`);
      continue;
    }
    let note;
    try {
      note = JSON.parse(d.rawNote);
    } catch {
      console.log(`📋 ${d.document_no} [${d.document_type}] docStatus=${d.status} (note parse ไม่ได้)`);
      continue;
    }
    console.log(`📋 ${d.document_no} [${d.document_type}] docStatus=${d.status} noteStatus=${note.outbound_status} source=${note.source ?? "-"} ลูกค้า=${note.customer ?? "-"}`);
    for (const it of note.items ?? []) {
      const pid = it.product_id ?? "";
      const oh = onHand.get(pid) ?? 0;
      const remain = (it.qty_required ?? 0) - (it.qty_picked ?? 0);
      const flag = oh < remain ? " ❌ On Hand ไม่พอ" : " ✅";
      console.log(`   • ${it.sku} (${pid}) ต้องการ ${it.qty_required} หยิบแล้ว ${it.qty_picked ?? 0} เหลือ ${remain} | On Hand จริง=${oh} ${flag}`);
    }
    if (Array.isArray(note.q_boxes)) {
      for (const q of note.q_boxes) {
        console.log(`   📦 ${q.q_code} status=${q.status} รายการ=${q.items?.length ?? 0}`);
      }
    }
    if (Array.isArray(note.q_assignments)) {
      for (const q of note.q_assignments) {
        console.log(`   📦 ${q.q_code} status=${q.status} รายการ=${q.items?.length ?? 0}`);
      }
    }
    console.log("");
  }

  console.log("=== เอกสารที่จองสต็อกอยู่ (PICKING / SHORTAGE / PICKED_WAITING_APPROVAL) ===\n");

  const reservedByProduct = new Map<string, { qty: number; docs: string[] }>();
  const productInfo = new Map<string, string>();

  for (const d of outboundDocs) {
    if (!d.rawNote || !d.rawNote.startsWith("{")) continue;
    let note;
    try {
      note = JSON.parse(d.rawNote);
    } catch {
      continue;
    }
    if (note.kind !== "outbound_bill" || !Array.isArray(note.items)) continue;
    if (!isBillReserving(note.outbound_status ?? "IMPORTED")) continue;

    const source = note.source ?? "BILL";
    console.log(`📋 ${d.document_no} [${d.document_type}] สถานะ=${note.outbound_status} source=${source} ลูกค้า=${note.customer ?? "-"}`);
    for (const it of note.items) {
      if (it.status === "PICKED") continue;
      const remain = (it.qty_required ?? 0) - (it.qty_picked ?? 0);
      if (remain <= 0) continue;
      const pid = it.product_id ?? "";
      const key = reservedByProduct.get(pid) ?? { qty: 0, docs: [] };
      key.qty += remain;
      key.docs.push(d.document_no);
      reservedByProduct.set(pid, key);
      productInfo.set(pid, `${it.sku} ${it.product_name ?? ""}`);
      console.log(`   • ${it.sku} ต้องการ ${it.qty_required} หยิบแล้ว ${it.qty_picked ?? 0} → เหลือจอง ${remain}`);
    }
    console.log("");
  }

  if (reservedByProduct.size === 0) {
    console.log("(ไม่มีเอกสารจองสต็อกอยู่เลย)\n");
  }

  console.log("=== สรุป: สินค้าที่ถูกจอง vs On Hand จริง ===\n");
  for (const [pid, r] of reservedByProduct) {
    const oh = onHand.get(pid) ?? 0;
    const avail = oh - r.qty;
    const flag = avail < 0 ? " ❌ ติดลบ!" : avail === 0 ? " ⚠️ เท่ากับ 0" : " ✅";
    console.log(`${productInfo.get(pid)} (${pid})`);
    console.log(`   On Hand=${oh} จอง=${r.qty} → Available=${avail}${flag}`);
    console.log(`   ถูกจองโดย: ${r.docs.join(", ")}\n`);
  }
}

main().catch((e) => {
  console.error("ERROR:", e instanceof Error ? e.message : e);
  process.exit(1);
});

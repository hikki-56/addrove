import { NextRequest, NextResponse } from "next/server";
import { bomRepository } from "@/lib/repositories/sheets/bom.repository";
import { readSheet, getWarehouseSheetName, SHEETS } from "@/lib/google-sheets/client";
import { getAuthSession } from "@/lib/auth-session";
import { unauthorizedResponse } from "@/lib/api-response";

function cleanCode(str?: string): string {
  if (!str) return "";
  return String(str)
    .trim()
    .toLowerCase()
    .replace(/^prod-/, "")
    .replace(/[\s\-_]/g, "");
}

export async function GET(req: NextRequest) {
  const session = await getAuthSession(req);
  if (!session) return unauthorizedResponse();

  try {
    const { searchParams } = new URL(req.url);
    const sku = searchParams.get("sku");

    // 1. Fetch real inventory in Warehouse 2 (โกดัง 2)
    //    แคชสั้น 20 วิ — คนเข้าหน้าต่อเนื่องได้ข้อมูลจากแคช ส่วนการสั่งผลิต (orders API)
    //    อ่านสดและเคลียร์แคชเองหลังตัดสต็อก จึงไม่เห็นยอดเกิน 20 วิหลังธุรกรรม
    const wh2SheetName = getWarehouseSheetName("wh-02");
    const [wh2Rows, stockSummaryRows] = await Promise.all([
      readSheet(wh2SheetName, "A2:I", { maxAgeMs: 20_000 }).catch(() => []),
      readSheet(SHEETS.STOCK_SUMMARY, "A2:E").catch(() => []),
    ]);

    const wh2StockBySku = new Map<string, number>();
    const wh2StockByCleanSku = new Map<string, number>();
    const wh2StockByBarcode = new Map<string, number>();
    const wh2StockByName = new Map<string, number>();

    // Index Warehouse 2 inventory from sheet
    for (const r of wh2Rows) {
      if (!r || !r[0]) continue;
      const rowSku = (r[0] || "").trim();
      const rowBarcode = (r[1] || "").trim();
      const rowName = (r[2] || "").trim();
      const rawQty = parseFloat(String(r[5] || r[4] || "0").replace(/,/g, "").trim());
      const qty = isNaN(rawQty) ? 0 : Math.max(0, rawQty);

      if (rowSku) {
        wh2StockBySku.set(rowSku, (wh2StockBySku.get(rowSku) || 0) + qty);
        wh2StockByCleanSku.set(cleanCode(rowSku), (wh2StockByCleanSku.get(cleanCode(rowSku)) || 0) + qty);
      }
      if (rowBarcode && rowBarcode !== "-") {
        wh2StockByBarcode.set(rowBarcode, (wh2StockByBarcode.get(rowBarcode) || 0) + qty);
        wh2StockByCleanSku.set(cleanCode(rowBarcode), (wh2StockByCleanSku.get(cleanCode(rowBarcode)) || 0) + qty);
      }
      if (rowName) {
        wh2StockByName.set(cleanCode(rowName), (wh2StockByName.get(cleanCode(rowName)) || 0) + qty);
      }
    }

    // Helper to find available stock in Warehouse 2
    const getWh2Stock = (itemSku?: string, itemBarcode?: string, itemName?: string): number => {
      if (itemSku && wh2StockBySku.has(itemSku)) return wh2StockBySku.get(itemSku)!;
      if (itemSku && wh2StockByCleanSku.has(cleanCode(itemSku))) return wh2StockByCleanSku.get(cleanCode(itemSku))!;
      if (itemBarcode && wh2StockByBarcode.has(itemBarcode)) return wh2StockByBarcode.get(itemBarcode)!;
      if (itemBarcode && wh2StockByCleanSku.has(cleanCode(itemBarcode))) return wh2StockByCleanSku.get(cleanCode(itemBarcode))!;
      if (itemName && wh2StockByName.has(cleanCode(itemName))) return wh2StockByName.get(cleanCode(itemName))!;

      // Fallback to StockSummary for wh-02 — จับคู่แบบตรงตัวเท่านั้น
      // (การจับแบบ contains ซึ่งกันและกันเสี่ยงเจอสินค้าผิดตัว เช่น A1 ไปชน A12)
      if (stockSummaryRows && stockSummaryRows.length > 0) {
        const cleanTarget = cleanCode(itemSku || itemBarcode || itemName);
        for (const sr of stockSummaryRows) {
          const sPid = cleanCode(sr[0]);
          const sWh = (sr[1] || "").trim().toLowerCase();
          if ((sWh === "wh-02" || sWh === "wh-2" || sWh.includes("โกดัง2") || sWh.includes("โกดัง 2")) && sPid === cleanTarget && cleanTarget) {
            const sq = parseFloat(String(sr[3] || "0").replace(/,/g, "")) || 0;
            if (sq > 0) return sq;
          }
        }
      }

      return 0;
    };

    const enrichFormula = (f: any) => {
      const enrichedItems = (f.items || []).map((item: any) => {
        const availableInWh2 = getWh2Stock(item.rm_sku, item.rm_barcode, item.rm_name);
        const perUnit = Number(item.rm_qty_required) || 1;
        // นับเศษเสียด้วย: ผลิต 1 ชุดต้องสิ้นเปลืองวัตถุดิบจริง perUnit * wasteFactor
        // ให้ตรงกับการตรวจสอบ/ตัดสต็อกตอนสั่งผลิต (orders API)
        const wasteFactor = 1 + (Number(item.waste_percentage) || 0) / 100;
        const possible = Math.floor(availableInWh2 / (perUnit * wasteFactor));

        return {
          ...item,
          is_primary: Number(item.is_primary) === 1 ? 1 : 0,
          available_wh2_qty: availableInWh2,
          possible_units: Math.max(0, possible),
        };
      });

      // Filter primary items (ตัวหลัก = 1)
      const primaryItems = enrichedItems.filter((item: any) => item.is_primary === 1);

      // คำนวณจากวัตถุดิบทุกรายการในสูตร (หลัก + รอง) เพราะการผลิตจริงหักวัตถุดิบรองด้วย
      // วัตถุดิบรองที่เหลือ 0 หรือน้อยกว่าตัวหลัก จะจำกัดจำนวนที่ผลิตได้จริง
      let minProducible = Infinity;
      for (const it of enrichedItems) {
        if (it.possible_units < minProducible) {
          minProducible = it.possible_units;
        }
      }

      const maxProducible =
        enrichedItems.length > 0 && Number.isFinite(minProducible)
          ? Math.max(0, minProducible)
          : 0;

      // Finished goods current stock in Warehouse 2
      const fgWh2Stock = getWh2Stock(f.fg_sku, f.fg_barcode, f.fg_name);

      // Image mapping
      const image = f.fg_sku === "A002" ? "/products/A002.jpg" : `/products/${f.fg_sku}.jpg`;

      return {
        ...f,
        image,
        maxProducible,
        has_primary_designated: primaryItems.length > 0,
        primary_items: primaryItems.map((p: any) => ({ rm_sku: p.rm_sku, rm_name: p.rm_name })),
        fg_wh2_stock: fgWh2Stock,
        target_warehouse_id: "wh-02",
        target_warehouse_name: "โกดัง 2 (สินค้าสำเร็จรูป)",
        items: enrichedItems,
      };
    };

    if (sku) {
      const formula = await bomRepository.getFormulaBySku(sku);
      if (!formula) {
        return NextResponse.json({ success: false, message: "ไม่พบสูตรการผลิตสำหรับสินค้านี้" }, { status: 404 });
      }
      return NextResponse.json({ success: true, data: enrichFormula(formula) });
    }

    const formulas = await bomRepository.getAllFormulas();
    // หน้า list ส่งเฉพาะหัวสูตร + สรุปจำนวน — ลดขนาด payload จาก Google Sheets ที่โหลดทีเดียวทั้งหมด
    // (ดึงวัตถุดิบรายสูตรทีหลังผ่าน ?sku= ตอนขยายแถว / เพิ่มตะกร้า)
    const headers = formulas.map(enrichFormula).map((f: any) => {
      const { items, ...header } = f;
      return {
        ...header,
        item_count: Array.isArray(items) ? items.length : 0,
        primary_count: Array.isArray(items) ? items.filter((it: any) => it.is_primary === 1).length : 0,
      };
    });
    return NextResponse.json({ success: true, data: headers });
  } catch (error) {
    console.error("[GET /api/production/bom] Error:", error);
    return NextResponse.json(
      { success: false, message: "เกิดข้อผิดพลาดในการดึงข้อมูลสูตรการผลิต" },
      { status: 500 }
    );
  }
}


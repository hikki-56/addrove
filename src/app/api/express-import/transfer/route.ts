import { NextRequest } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { getRepository } from "@/lib/repositories";
import { readSheet, appendRows, SHEETS, getWarehouseSheetName } from "@/lib/google-sheets/client";
import { to8DigitBarcode } from "@/lib/barcode-utils";
import { parseTransferMetadata } from "@/lib/transfer-notification-utils";
import { getWarehouseName, normalizeWarehouseId, detectWarehouseFromLocation } from "@/lib/warehouse-utils";
import { successResponse, unauthorizedResponse, serverErrorResponse } from "@/lib/api-response";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function cleanCode(str?: string): string {
  if (!str) return "";
  return String(str)
    .trim()
    .toLowerCase()
    .replace(/^prod-/, "")
    .replace(/[\s\-_#]/g, "");
}

export async function GET(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    if (!session) return unauthorizedResponse();

    const repo = getRepository();
    const items: Array<{
      id: string;
      movement_id: string;
      document_id: string;
      document_no: string;
      warehouse_name: string;
      warehouse_id: string;
      from_warehouse_name: string;
      from_warehouse_id: string;
      to_warehouse_name: string;
      to_warehouse_id: string;
      created_at: string;
      created_by_name: string;
      sku: string;
      product_name: string;
      quantity: number;
      location: string;
      to_location_id?: string;
      from_location_id?: string;
      barcode: string;
      movement_type: string;
      tag: string;
      status: "PENDING" | "IMPORTED";
    }> = [];

    const seenUniqueKeys = new Set<string>();

    // 1. Preload master product catalog from PRODUCTS sheet and Warehouse tabs
    const productCatalogMap = new Map<string, { sku: string; barcode: string; name: string; location: string; locations_breakdown?: any[] }>();

    try {
      const [prodRows, wh1Rows, wh2Rows, wh3Rows] = await Promise.all([
        readSheet(SHEETS.PRODUCTS).catch(() => []),
        readSheet(getWarehouseSheetName("wh-01"), "A2:I").catch(() => []),
        readSheet(getWarehouseSheetName("wh-02"), "A2:I").catch(() => []),
        readSheet(getWarehouseSheetName("wh-03"), "A2:I").catch(() => []),
      ]);

      const addProductEntry = (rawSku: string, rawBcode: string, rawName: string, rawLoc: string = "") => {
        const sku = (rawSku || "").trim();
        const bcode = (rawBcode || "").trim();
        const name = (rawName || "").trim();
        const loc = (rawLoc || "").trim();
        if (!sku && !bcode && !name) return;

        const entry = {
          sku: sku || bcode,
          barcode: bcode && bcode !== "-" && bcode !== "null" ? bcode : "",
          name: name && name !== sku ? name : "",
          location: loc && loc !== "-" ? loc : "",
        };

        const keys = [cleanCode(sku), cleanCode(bcode), sku.toLowerCase(), bcode.toLowerCase()].filter(Boolean);
        keys.forEach((k) => {
          const existing = productCatalogMap.get(k);
          if (!existing || (!existing.name && entry.name) || (!existing.barcode && entry.barcode)) {
            productCatalogMap.set(k, { ...(existing || {}), ...entry });
          }
        });
      };

      // Ingest warehouse sheets (Col 0=SKU, Col 1=Barcode, Col 2=Name, Col 6=Loc)
      [wh1Rows, wh2Rows, wh3Rows].forEach((rows) => {
        rows.forEach((r) => {
          if (r && r[0]) addProductEntry(r[0], r[1], r[2], r[6]);
        });
      });

      // Ingest PRODUCTS sheet
      prodRows.forEach((r) => {
        if (!r || r.length < 3) return;
        if (r.length >= 7 && !isNaN(Number(r[0]))) {
          addProductEntry(r[2], r[6], r[4]);
        } else {
          addProductEntry(r[0], r[1], r[2]);
        }
      });
    } catch (e) {
      console.warn("[GET /api/express-import/transfer] Preload products warning:", e);
    }

    const enrichProduct = (rawSku: string, rawBarcode: string, rawName: string, rawLocation?: string) => {
      const cleanSku = (rawSku || "").replace(/^prod-/, "").trim();
      const keys = [cleanCode(cleanSku), cleanCode(rawBarcode), cleanSku.toLowerCase()].filter(Boolean);

      let matched: { sku: string; barcode: string; name: string; location: string } | undefined;
      for (const k of keys) {
        if (productCatalogMap.has(k)) {
          matched = productCatalogMap.get(k);
          break;
        }
      }

      const finalSku = cleanSku || matched?.sku || rawBarcode;
      let finalName = (rawName || "").trim();
      if (!finalName || finalName === cleanSku || finalName === `สินค้า ${cleanSku}` || finalName === "สินค้า" || finalName === "รายการย้ายสินค้า") {
        finalName = matched?.name || finalName || cleanSku;
      }

      let finalBarcode = (rawBarcode || "").trim();
      if (!finalBarcode || finalBarcode === "-" || finalBarcode === "null" || finalBarcode === cleanSku || /[ก-๙]/.test(finalBarcode)) {
        if (matched?.barcode && !/[ก-๙]/.test(matched.barcode) && matched.barcode !== "-") {
          finalBarcode = matched.barcode;
        } else {
          finalBarcode = to8DigitBarcode(finalBarcode, finalSku, finalName) || finalSku;
        }
      }

      const finalLocation = (rawLocation && rawLocation !== "-" && rawLocation !== "A1") ? rawLocation : (matched?.location || rawLocation || "-");

      return {
        sku: finalSku,
        name: finalName,
        barcode: finalBarcode,
        location: finalLocation,
      };
    };

    // 2. Preload documents map & movements map
    const allDocsMap = new Map<string, any>();
    let allDocsList: any[] = [];
    const movementsByDocId = new Map<string, { outMovement?: any; inMovement?: any }>();

    try {
      const [allDocs, allMovs] = await Promise.all([
        repo.documents.findAll({ page: 1, limit: 9999 }),
        repo.movements.findAll({ page: 1, limit: 9999 }),
      ]);

      allDocsList = allDocs.data || [];
      allDocsList.forEach((doc) => {
        const docIdKey = (doc.document_id || "").trim().toLowerCase();
        const docNoKey = (doc.document_no || "").trim().toLowerCase();
        if (docIdKey) allDocsMap.set(docIdKey, doc);
        if (docNoKey) allDocsMap.set(docNoKey, doc);
      });

      (allMovs.data || []).forEach((m) => {
        const docIdKey = (m.document_id || "").trim().toLowerCase();
        const docNoKey = (m.document_no || "").trim().toLowerCase();
        const keys = [docIdKey, docNoKey].filter(Boolean);

        keys.forEach((k) => {
          const current = movementsByDocId.get(k) || {};
          if (m.movement_type === "TRANSFER_OUT" || m.qty_change < 0) {
            current.outMovement = m;
          }
          if (m.movement_type === "TRANSFER_IN" || m.qty_change > 0) {
            current.inMovement = m;
          }
          movementsByDocId.set(k, current);
        });
      });
    } catch (e) {
      console.warn("[GET /api/express-import/transfer] Preload docs/movements error:", e);
    }

    const cleanDocNumber = (rawDocNo: string, rawDocId: string, createdAt: string): string => {
      let docNo = String(rawDocNo || "").trim();
      const docId = String(rawDocId || "").trim();

      const docRec = docId ? allDocsMap.get(docId.toLowerCase()) : (docNo ? allDocsMap.get(docNo.toLowerCase()) : undefined);
      if (docRec?.reference_no && !docRec.reference_no.startsWith("doc-") && docRec.reference_no.length <= 25) {
        return docRec.reference_no;
      }
      if (docRec?.document_no && !docRec.document_no.startsWith("doc-") && docRec.document_no.length <= 25) {
        return docRec.document_no;
      }
      if (docNo && !docNo.startsWith("doc-") && docNo.length <= 25) {
        return docNo;
      }

      const datePart = (createdAt || new Date().toISOString()).slice(0, 10).replace(/-/g, "");
      const shortId = (docId || docNo || "0000").replace(/[^a-zA-Z0-9]/g, "").slice(-4).toUpperCase();
      return `TRF-${datePart}-${shortId}`;
    };

    // Helper to extract shelf/location code from text, e.g. "05850 #AD-02 ก็อกบอล" -> "AD-02"
    const extractShelf = (text: string | undefined | null): string => {
      if (!text) return "";
      const str = String(text).trim();
      const hashMatch = str.match(/#\s*([A-Za-z0-9\-_/]+)/);
      if (hashMatch && hashMatch[1]) {
        const loc = hashMatch[1].trim();
        if (loc && loc !== "-" && !/^loc-?(a0?1|b0?1)?$/i.test(loc) && loc !== "A1") return loc;
      }
      const bracketMatch = str.match(/[\(\[\{]([A-Za-z0-9\-_/]+)[\)\]\}]/);
      if (bracketMatch && bracketMatch[1]) {
        const loc = bracketMatch[1].trim();
        if (loc && loc !== "-" && !/^loc-?(a0?1|b0?1)?$/i.test(loc) && loc !== "A1" && loc.length >= 2 && loc.length <= 15) return loc;
      }
      return "";
    };

    // 3. Read directly from Google Sheets Tab: "ย้ายสินค้าเข้าExpress"
    try {
      const sheetRows = await readSheet(SHEETS.EXPRESS_TRANSFER).catch(() => []);
      for (let idx = 0; idx < sheetRows.length; idx++) {
        const row = sheetRows[idx];
        if (!row || row.length === 0) continue;
        const col0 = String(row[0] ?? "").trim();
        const col0Lower = col0.toLowerCase();

        // Skip any header rows (Thai or English column titles, or generated 'คอลัมน์ X')
        const isHeader =
          col0 === "รหัสสินค้า" ||
          col0Lower === "sku" ||
          col0 === "วันที่" ||
          col0Lower === "date" ||
          col0 === "ลำดับ" ||
          col0.startsWith("คอลัมน์") ||
          col0Lower.startsWith("column") ||
          row.some((cell) => {
            const c = String(cell ?? "").trim().toLowerCase();
            return (
              c === "เลขที่เอกสาร" ||
              c === "วันที่เอกสาร" ||
              c === "ชื่อแท็ก" ||
              c === "ชื่อสินค้า" ||
              c === "สถานะการนำเข้า" ||
              c.startsWith("คอลัมน์")
            );
          });

        if (isHeader) {
          continue;
        }

        let sku = "";
        let location = "-";
        let docNo = "";
        let whName = "โกดัง1 -> โกดัง2";
        let date = new Date().toISOString().slice(0, 10);
        let productName = "";
        let status = "รอนำเข้า Express";
        let qty = 1;
        let barcode = "";

        if (col0.includes("/") || (col0.includes("-") && col0.length === 10 && !isNaN(Date.parse(col0)))) {
          // Layout: [Date, DocNo, Barcode, SKU, ProductName, Warehouse, Location, Qty, MovedBy, ApprovedBy, Status]
          date = col0;
          docNo = String(row[1] ?? "").trim();
          barcode = String(row[2] ?? "").trim();
          sku = String(row[3] ?? "").trim();
          productName = String(row[4] ?? "").trim() || sku;
          whName = String(row[5] ?? "").trim() || "โกดัง1 -> โกดัง2";
          location = String(row[6] ?? "").trim() || "-";
          qty = Math.abs(parseFloat(String(row[7] ?? "1").replace(/,/g, "")) || 1);
          status = String(row[10] ?? row[9] ?? "รอนำเข้า Express").trim();
        } else {
          // Standard Sheet Layout: [รหัสสินค้า (SKU), ตำแหน่ง, เลขที่เอกสาร, โกดังต้นทาง-ปลายทาง, วันที่เอกสาร, ชื่อสินค้า, สถานะการนำเข้า, จำนวน, บาร์โค้ด]
          sku = col0;
          location = String(row[1] ?? "-").trim() || "-";
          docNo = String(row[2] ?? "").trim() || `TRF-EXPRESS-${idx + 1}`;
          whName = String(row[3] ?? "โกดัง1 -> โกดัง2").trim() || "โกดัง1 -> โกดัง2";
          date = String(row[4] ?? "").trim() || date;
          productName = String(row[5] ?? "").trim() || sku;
          status = String(row[6] ?? "รอนำเข้า Express").trim();
          const rawQty = parseFloat(String(row[7] ?? "1").replace(/,/g, ""));
          qty = !isNaN(rawQty) && rawQty > 0 ? rawQty : 1;
          const rawBarcode = String(row[8] ?? "").trim();
          barcode = rawBarcode && rawBarcode !== "-" && rawBarcode !== "null" ? rawBarcode : sku;
        }

        // Skip production orders
        if (docNo.toUpperCase().startsWith("PRD-") || docNo.toLowerCase().includes("prd")) {
          continue;
        }

        const enriched = enrichProduct(sku, barcode, productName, location);
        const resolvedDocNo = cleanDocNumber(docNo, docNo, date);
        const docNoKey = resolvedDocNo.toLowerCase();
        const uniqueKey = `sheet_trf_${resolvedDocNo}_${enriched.sku}_${idx}`;

        seenUniqueKeys.add(uniqueKey);

        // Resolve source and destination warehouse
        let fromWarehouseName = "โกดัง1";
        let fromWarehouseId = "wh-01";
        let toWarehouseName = "โกดัง2";
        let toWarehouseId = "wh-02";

        // Check if whName has delimiter (e.g. "โกดัง1 -> โกดัง2", "โกดัง 1 ➔ โกดัง 2", "wh-01 -> wh-02")
        if (whName.includes("->") || whName.includes("➔") || whName.includes("→") || whName.includes("ไป") || whName.includes("/")) {
          const parts = whName.split(/\s*(?:->|➔|→|ไป|\/)\s*/);
          if (parts.length >= 2) {
            fromWarehouseId = normalizeWarehouseId(parts[0]);
            fromWarehouseName = getWarehouseName(fromWarehouseId);
            toWarehouseId = normalizeWarehouseId(parts[1]);
            toWarehouseName = getWarehouseName(toWarehouseId);
          }
        }

        // Look up doc metadata
        const docRec =
          allDocsMap.get(docNo.toLowerCase()) ||
          allDocsMap.get(resolvedDocNo.toLowerCase()) ||
          allDocsMap.get(docNo.replace(/[^a-zA-Z0-9]/g, "").toLowerCase());

        if (docRec) {
          const meta = parseTransferMetadata(docRec.note);
          if (meta.from_warehouse_id || meta.from_warehouse_name) {
            fromWarehouseId = normalizeWarehouseId(meta.from_warehouse_id || meta.from_warehouse_name);
            fromWarehouseName = getWarehouseName(fromWarehouseId);
          }
          if (meta.to_warehouse_id || meta.to_warehouse_name) {
            toWarehouseId = normalizeWarehouseId(meta.to_warehouse_id || meta.to_warehouse_name);
            toWarehouseName = getWarehouseName(toWarehouseId);
          }
        }

        // --- Override: TRF-20260825-000067 ปลายทาง = สำนักงานใหญ่ ---
        if (resolvedDocNo === "TRF-20260825-000067") {
          fromWarehouseId = "wh-01";
          fromWarehouseName = "โกดัง1";
          toWarehouseId = "wh-06";
          toWarehouseName = "สำนักงานใหญ่";
        }

        items.push({
          id: uniqueKey,
          movement_id: `mov-${resolvedDocNo}-${idx}`,
          document_id: resolvedDocNo,
          document_no: resolvedDocNo,
          warehouse_name: fromWarehouseName,
          warehouse_id: fromWarehouseId,
          from_warehouse_name: fromWarehouseName,
          from_warehouse_id: fromWarehouseId,
          to_warehouse_name: toWarehouseName,
          to_warehouse_id: toWarehouseId,
          created_at: date,
          created_by_name: "ผู้ดูแลระบบ",
          sku: enriched.sku,
          product_name: enriched.name,
          quantity: qty,
          location: enriched.location,
          barcode: enriched.barcode,
          movement_type: "TRANSFER",
          tag: "ย้ายสินค้าเข้า Express",
          status: status.includes("แล้ว") || status === "IMPORTED" ? "IMPORTED" : "PENDING",
        });
      }
    } catch (e) {
      console.warn("[GET /api/express-import/transfer] Sheet read error:", e);
    }

    // 4. Process all TRANSFER documents from repository
    const transferDocs = allDocsList.filter((d) => {
      if (d.document_type !== "TRANSFER") return false;
      const isProd =
        d.document_no?.toUpperCase().startsWith("PRD-") ||
        d.reference_no?.toUpperCase().startsWith("PRD-") ||
        d.document_id?.toLowerCase().includes("prd") ||
        d.note?.includes('"type":"PRODUCTION_ORDER"');
      return !isProd;
    });

    for (const doc of transferDocs) {
      const meta = parseTransferMetadata(doc.note);
      const rawDocNo = doc.document_no || meta.doc_no || "";
      const resolvedDocNo = cleanDocNumber(rawDocNo, doc.document_id, doc.created_at);

      const itemsList = Array.isArray(meta.items) && meta.items.length > 0
        ? meta.items
        : Array.isArray(meta.lines) && meta.lines.length > 0
        ? meta.lines
        : [meta];

      itemsList.forEach((subItem: any, subIdx: number) => {
        const rawSku = subItem.sku || subItem.product_id?.replace(/^prod-/, "") || meta.sku || "";
        const rawBarcode = subItem.barcode || meta.barcode || "";
        const rawProductName = subItem.product_name || meta.product_name || rawSku || "สินค้า";
        const toLoc = subItem.to_location_id || meta.to_location_id || meta.to_location || meta.completed_location_id || "";
        const fromLoc = subItem.from_location_id || meta.from_location_id || meta.from_location || (meta.source_allocations?.[0]?.location_id) || "";

        const shelfFallback = extractShelf(rawProductName) || extractShelf(rawSku) || extractShelf(doc.note);
        const effectiveLoc = toLoc || shelfFallback || fromLoc || "-";

        const enriched = enrichProduct(rawSku, rawBarcode, rawProductName, effectiveLoc);
        const uniqueKey = `trf_doc_${doc.document_id}_${enriched.sku}_${subIdx}`;

        if (seenUniqueKeys.has(uniqueKey)) return;
        seenUniqueKeys.add(uniqueKey);

        // Resolve Movements pair (TRANSFER_OUT and TRANSFER_IN) for exact warehouse IDs
        const movPair = movementsByDocId.get(doc.document_id.toLowerCase()) || movementsByDocId.get(resolvedDocNo.toLowerCase());
        const outWh = movPair?.outMovement?.warehouse_id;
        const inWh = movPair?.inMovement?.warehouse_id;

        let fromWarehouseId = meta.from_warehouse_id || outWh || (fromLoc ? detectWarehouseFromLocation(fromLoc) : null) || (doc as any).from_warehouse_id || "wh-01";
        let toWarehouseId = meta.to_warehouse_id || inWh || (toLoc ? detectWarehouseFromLocation(toLoc) : null) || (doc as any).to_warehouse_id || "wh-02";

        fromWarehouseId = normalizeWarehouseId(fromWarehouseId);
        toWarehouseId = normalizeWarehouseId(toWarehouseId);

        // If from and to became identical by mistake, smartly separate
        if (fromWarehouseId === toWarehouseId) {
          if (toLoc && detectWarehouseFromLocation(toLoc)) {
            toWarehouseId = detectWarehouseFromLocation(toLoc)!;
          } else if (fromLoc && detectWarehouseFromLocation(fromLoc)) {
            fromWarehouseId = detectWarehouseFromLocation(fromLoc)!;
          }
          if (fromWarehouseId === toWarehouseId) {
            toWarehouseId = fromWarehouseId === "wh-01" ? "wh-02" : "wh-01";
          }
        }

        // --- Override: TRF-20260825-000067 ปลายทาง = สำนักงานใหญ่ ---
        if (resolvedDocNo === "TRF-20260825-000067") {
          fromWarehouseId = "wh-01";
          toWarehouseId = "wh-06";
        }

        const fromWarehouseName = getWarehouseName(fromWarehouseId);
        const toWarehouseName = getWarehouseName(toWarehouseId);

        const isCompleted =
          doc.status === "COMPLETED" ||
          doc.status === "APPROVED" ||
          meta.status === "COMPLETED" ||
          meta.express_status === "IMPORTED";

        const qty = Math.abs(Number(subItem.qty || subItem.quantity || meta.qty) || 1);

        items.push({
          id: uniqueKey,
          movement_id: `trf-mov-${doc.document_id}-${subIdx}`,
          document_id: doc.document_id,
          document_no: resolvedDocNo,
          warehouse_name: fromWarehouseName,
          warehouse_id: fromWarehouseId,
          from_warehouse_name: fromWarehouseName,
          from_warehouse_id: fromWarehouseId,
          to_warehouse_name: toWarehouseName,
          to_warehouse_id: toWarehouseId,
          created_at: (meta.completed_at || doc.created_at || new Date().toISOString()).slice(0, 10),
          created_by_name: meta.moved_by || meta.assigned_to_name || "ผู้ใช้งาน",
          sku: enriched.sku,
          product_name: enriched.name,
          quantity: qty,
          location: enriched.location,
          to_location_id: toLoc,
          from_location_id: fromLoc,
          barcode: enriched.barcode,
          movement_type: "TRANSFER",
          tag: meta.express_tag || "ย้ายสินค้าเข้า Express",
          status: isCompleted ? "IMPORTED" : "PENDING",
        });
      });
    }

    // Sort by created_at descending
    items.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.document_no.localeCompare(a.document_no));

    return successResponse(items, "โหลดรายการย้ายสินค้าเข้า Express สำเร็จ");
  } catch (error) {
    console.error("[GET /api/express-import/transfer] Error:", error);
    return serverErrorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    if (!session) return unauthorizedResponse();

    const body = await req.json().catch(() => ({}));
    const {
      sku = "",
      location = "-",
      document_no = "TRF",
      from_warehouse_name = "โกดัง1",
      to_warehouse_name = "โกดัง2",
      warehouse_name = "",
      document_date = new Date().toISOString().slice(0, 10),
      product_name = "",
      status = "รอนำเข้า Express",
      quantity = 1,
      barcode = "",
    } = body;

    const routeWh = warehouse_name || `${from_warehouse_name} -> ${to_warehouse_name}`;

    // Append to Google Sheets Tab: "ย้ายสินค้าเข้าExpress"
    const row = [
      sku,
      location,
      document_no,
      routeWh,
      document_date,
      product_name,
      status,
      quantity,
      barcode || sku,
    ];

    await appendRows(SHEETS.EXPRESS_TRANSFER, [row]);

    return successResponse({ success: true }, "บันทึกรายการย้ายสินค้าเข้า Express เรียบร้อย", 201);
  } catch (error) {
    console.error("[POST /api/express-import/transfer] Error:", error);
    return serverErrorResponse(error);
  }
}

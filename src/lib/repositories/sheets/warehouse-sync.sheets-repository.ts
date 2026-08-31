import {
  IWarehouseSyncRepository,
  ProductSyncInfo,
} from "../interfaces/warehouse-sync.repository.interface";
import {
  getWarehouseSheetName,
  appendRows,
  updateRow,
  deleteRows,
  readSheet,
  clearSheetCache,
} from "@/lib/google-sheets/client";

function matchSku(sku1?: string, sku2?: string): boolean {
  if (!sku1 || !sku2) return false;
  const s1 = sku1.trim().toLowerCase().replace(/^prod-/, "").replace(/[\s\-_]/g, "");
  const s2 = sku2.trim().toLowerCase().replace(/^prod-/, "").replace(/[\s\-_]/g, "");
  return s1 === s2;
}

function cleanLocCode(loc?: string): string {
  if (!loc) return "";
  return loc
    .trim()
    .toLowerCase()
    .replace(/^loc-/, "")
    .replace(/^wh-0?[0-9]-?/, "")
    .replace(/^sh-/, "")
    .replace(/^slf-/, "")
    .replace(/[\s\-_]/g, "");
}

function cleanSkuCode(sku?: string): string {
  if (!sku) return "";
  return sku
    .trim()
    .toLowerCase()
    .replace(/^prod-/, "")
    .replace(/[\s\-_]/g, "");
}

export class SheetsWarehouseSyncRepository implements IWarehouseSyncRepository {
  async syncDeduct(
    warehouseId: string,
    productId: string,
    qty: number,
    locationId?: string
  ): Promise<ProductSyncInfo | null> {
    try {
      const sheetName = getWarehouseSheetName(warehouseId);
      clearSheetCache(sheetName);
      const rows = await readSheet(sheetName, "A2:I", { forceFresh: true });
      if (!rows || rows.length === 0) {
        console.warn(`[SheetsWarehouseSync] Sheet ${sheetName} returned empty rows for ${productId}`);
        return null;
      }

      const normTargetLoc = cleanLocCode(locationId);
      const normTargetSku = cleanSkuCode(productId);

      const matchingRowIndices: number[] = [];
      let primaryRow: string[] = [];
      let primaryRowIndex = -1;
      let totalQty = 0;

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (!r || !r[0] || !r[0].trim()) continue;

        const rSku = cleanSkuCode(r[0]);
        const rBarcode = cleanSkuCode(r[1]);

        const isSkuMatch =
          rSku === normTargetSku ||
          rBarcode === normTargetSku ||
          matchSku(r[0], productId) ||
          matchSku(r[1], productId);

        if (isSkuMatch) {
          const rowLoc = cleanLocCode(r[6] || "");
          const isLocMatch =
            !normTargetLoc ||
            !rowLoc ||
            rowLoc === normTargetLoc ||
            rowLoc.includes(normTargetLoc) ||
            normTargetLoc.includes(rowLoc);

          if (isLocMatch) {
            const rawQty = parseFloat((r[5] || r[4] || "0").replace(/,/g, "").trim());
            const parsedQty = isNaN(rawQty) ? 0 : rawQty;

            matchingRowIndices.push(i);
            totalQty += parsedQty;

            if (primaryRowIndex === -1 && parsedQty > 0) {
              primaryRowIndex = i;
              primaryRow = [...r];
            }
          }
        }
      }

      // Fallback: If specific location didn't match, search by SKU regardless of location
      if (matchingRowIndices.length === 0 && normTargetLoc) {
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i];
          if (!r || !r[0] || !r[0].trim()) continue;

          const rSku = cleanSkuCode(r[0]);
          const rBarcode = cleanSkuCode(r[1]);

          const isSkuMatch =
            rSku === normTargetSku ||
            rBarcode === normTargetSku ||
            matchSku(r[0], productId) ||
            matchSku(r[1], productId);

          if (isSkuMatch) {
            const rawQty = parseFloat((r[5] || r[4] || "0").replace(/,/g, "").trim());
            const parsedQty = isNaN(rawQty) ? 0 : rawQty;

            matchingRowIndices.push(i);
            totalQty += parsedQty;

            if (primaryRowIndex === -1 && parsedQty > 0) {
              primaryRowIndex = i;
              primaryRow = [...r];
            }
          }
        }
      }

      if (matchingRowIndices.length === 0) {
        return null;
      }

      if (primaryRowIndex === -1) {
        primaryRowIndex = matchingRowIndices[0];
        primaryRow = [...rows[primaryRowIndex]];
      }

      const productInfo: ProductSyncInfo = {
        sku: primaryRow[0]?.trim() || productId,
        barcode: primaryRow[1]?.trim() || primaryRow[0]?.trim() || productId,
        product_name: primaryRow[2]?.trim() || `สินค้า ${productId}`,
        category: primaryRow[3]?.trim() || "ทั่วไป",
        base_unit: primaryRow[4]?.trim() || "ชิ้น",
        supplier: primaryRow[7]?.trim() || primaryRow[6]?.trim() || "ตัดสต็อก",
      };

      const remainingQty = totalQty - qty;

      if (remainingQty <= 0) {
        // Zero-out or blank the primary row first so client immediately sees 0
        const rowNumber = primaryRowIndex + 2;
        while (primaryRow.length < 9) primaryRow.push("");
        primaryRow[5] = "0";
        primaryRow[8] = new Date().toISOString();
        await updateRow(sheetName, rowNumber, primaryRow).catch(() => {});

        try {
          await deleteRows(
            sheetName,
            matchingRowIndices.map((index) => index + 1)
          );
        } catch (delErr) {
          console.warn(`[SheetsWarehouseSync] deleteRows in ${sheetName} fallback to zero qty:`, delErr);
        }
      } else {
        const rowNumber = primaryRowIndex + 2;
        while (primaryRow.length < 9) primaryRow.push("");
        primaryRow[5] = String(remainingQty);
        primaryRow[8] = new Date().toISOString();

        await updateRow(sheetName, rowNumber, primaryRow).catch(() => {});

        const secondaryIndices = matchingRowIndices.filter((idx) => idx !== primaryRowIndex);
        if (secondaryIndices.length > 0) {
          for (const sIdx of secondaryIndices) {
            const sRow = rows[sIdx] ? [...rows[sIdx]] : [];
            while (sRow.length < 9) sRow.push("");
            sRow[5] = "0";
            await updateRow(sheetName, sIdx + 2, sRow).catch(() => {});
          }
          try {
            await deleteRows(
              sheetName,
              secondaryIndices.map((index) => index + 1)
            );
          } catch {}
        }
      }

      return productInfo;
    } catch (e) {
      console.error("[SheetsWarehouseSync] syncDeduct error:", e);
      return null;
    }
  }

  async syncAdd(
    warehouseId: string,
    product: ProductSyncInfo,
    qty: number,
    locationId?: string
  ): Promise<void> {
    try {
      const sheetName = getWarehouseSheetName(warehouseId);
      clearSheetCache(sheetName);
      const rows = await readSheet(sheetName, "A2:I", { forceFresh: true });

      const targetSku = cleanSkuCode(product.sku);
      const targetBarcode = cleanSkuCode(product.barcode);
      const targetLoc = cleanLocCode(locationId);

      let foundIndex = -1;
      let firstEmptyIndex = -1;
      let existingRow: string[] = [];

      if (rows && rows.length > 0) {
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i];
          if (!r || !r[0] || !r[0].trim()) {
            if (firstEmptyIndex === -1) firstEmptyIndex = i;
            continue;
          }

          const rSku = cleanSkuCode(r[0]);
          const rBarcode = cleanSkuCode(r[1]);

          const isSkuMatch =
            (targetSku && rSku === targetSku) ||
            (targetBarcode && rBarcode === targetBarcode) ||
            matchSku(r[0], product.sku) ||
            matchSku(r[1], product.barcode);

          if (isSkuMatch) {
            const rLoc = cleanLocCode(r[6] || "");
            if (!targetLoc || !rLoc || rLoc === targetLoc) {
              foundIndex = i;
              existingRow = [...r];
              break;
            }
          }
        }
      }

      if (foundIndex !== -1 && existingRow.length > 0) {
        const rowNumber = foundIndex + 2;
        while (existingRow.length < 9) existingRow.push("");

        const currentQty = parseFloat((existingRow[5] || existingRow[4] || "0").replace(/,/g, "").trim()) || 0;
        const newQty = currentQty + qty;

        existingRow[5] = String(newQty);
        if (locationId && locationId.trim()) {
          existingRow[6] = locationId.replace(/^loc-/, "").trim();
        }
        existingRow[8] = new Date().toISOString();

        await updateRow(sheetName, rowNumber, existingRow);
      } else {
        const newRow = [
          product.sku,
          product.barcode && product.barcode !== product.sku ? product.barcode : (product.barcode || ""),
          product.product_name,
          product.category || "ทั่วไป",
          product.base_unit || "ชิ้น",
          String(qty),
          locationId?.replace(/^loc-/, "") || "",
          product.supplier || "เพิ่มสต็อก",
          new Date().toISOString(),
        ];

        if (firstEmptyIndex !== -1) {
          const rowNumber = firstEmptyIndex + 2;
          await updateRow(sheetName, rowNumber, newRow);
        } else {
          await appendRows(sheetName, [newRow]);
        }
      }
    } catch (e) {
      console.error("[SheetsWarehouseSync] syncAdd error:", e);
    }
  }

  async syncMove(
    warehouseId: string,
    productId: string,
    qty: number,
    fromLocationId?: string,
    toLocationId?: string
  ): Promise<void> {
    try {
      const sheetName = getWarehouseSheetName(warehouseId);
      clearSheetCache(sheetName);
      const rows = await readSheet(sheetName, "A2:I", { forceFresh: true });
      if (!rows || rows.length === 0) {
        console.warn(`[SheetsWarehouseSync] Sheet ${sheetName} returned empty rows for ${productId}`);
        return;
      }

      const normTargetSku = cleanSkuCode(productId);
      const normFromLoc = cleanLocCode(fromLocationId);
      const cleanToLoc = (toLocationId || "").replace(/^loc-/, "").trim();

      // Find matching row for the SKU and fromLocation (if specified)
      let matchedIndex = -1;
      let matchedRow: string[] = [];
      let totalSourceQty = 0;

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (!r || !r[0] || !r[0].trim()) continue;

        const rSku = cleanSkuCode(r[0]);
        const rBarcode = cleanSkuCode(r[1]);

        const isSkuMatch =
          rSku === normTargetSku ||
          rBarcode === normTargetSku ||
          matchSku(r[0], productId) ||
          matchSku(r[1], productId);

        if (isSkuMatch) {
          const rLoc = cleanLocCode(r[6] || "");
          const isLocMatch =
            !normFromLoc ||
            !rLoc ||
            rLoc === normFromLoc ||
            rLoc.includes(normFromLoc) ||
            normFromLoc.includes(rLoc);

          if (isLocMatch) {
            const rawQ = parseFloat((r[5] || r[4] || "0").replace(/,/g, "").trim());
            const parsedQ = isNaN(rawQ) ? 0 : rawQ;

            if (matchedIndex === -1) {
              matchedIndex = i;
              matchedRow = [...r];
              totalSourceQty = parsedQ;
            }
          }
        }
      }

      // Fallback: If no location match, match any row with this SKU
      if (matchedIndex === -1) {
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i];
          if (!r || !r[0] || !r[0].trim()) continue;

          const rSku = cleanSkuCode(r[0]);
          const rBarcode = cleanSkuCode(r[1]);

          const isSkuMatch =
            rSku === normTargetSku ||
            rBarcode === normTargetSku ||
            matchSku(r[0], productId) ||
            matchSku(r[1], productId) ||
            r[0].trim().toLowerCase() === productId.trim().toLowerCase() ||
            r[1]?.trim().toLowerCase() === productId.trim().toLowerCase();

          if (isSkuMatch) {
            const rawQ = parseFloat((r[5] || r[4] || "0").replace(/,/g, "").trim());
            const parsedQ = isNaN(rawQ) ? 0 : rawQ;
            matchedIndex = i;
            matchedRow = [...r];
            totalSourceQty = parsedQ;
            break;
          }
        }
      }

      if (matchedIndex === -1) {
        console.warn(`[SheetsWarehouseSync] No matching product found to move: ${productId}`);
        return;
      }

      while (matchedRow.length < 9) matchedRow.push("");
      const now = new Date().toISOString();

      const actualMoveQty = qty > 0 ? qty : totalSourceQty;
      const currentLoc = cleanLocCode(matchedRow[6] || "");

      // Case 1: Assigning new location, or moving all stock -> Simply update the location in place!
      if (!currentLoc || actualMoveQty >= totalSourceQty || totalSourceQty <= 0) {
        matchedRow[6] = cleanToLoc;
        matchedRow[8] = now;
        await updateRow(sheetName, matchedIndex + 2, matchedRow);
        clearSheetCache(sheetName);
        return;
      }

      // Case 2: Moving PARTIAL stock from an existing shelf to a new shelf -> Reduce source row, add/update destination row
      const remainingQty = totalSourceQty - actualMoveQty;
      matchedRow[5] = String(remainingQty);
      matchedRow[8] = now;
      await updateRow(sheetName, matchedIndex + 2, matchedRow);

      const productInfo: ProductSyncInfo = {
        sku: matchedRow[0]?.trim() || productId,
        barcode: matchedRow[1]?.trim() || matchedRow[0]?.trim() || productId,
        product_name: matchedRow[2]?.trim() || `สินค้า ${productId}`,
        category: matchedRow[3]?.trim() || "ทั่วไป",
        base_unit: matchedRow[4]?.trim() || "ชิ้น",
        supplier: matchedRow[7]?.trim() || "ย้ายตำแหน่ง",
      };

      await this.syncAdd(warehouseId, productInfo, actualMoveQty, cleanToLoc);
      clearSheetCache(sheetName);
    } catch (e) {
      console.error("[SheetsWarehouseSync] syncMove error:", e);
    }
  }
}


"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTabAuth } from "@/context/TabAuthContext";
import BarcodeSvg from "@/components/ui/BarcodeSvg";
import ScrollSelect from "@/components/ui/ScrollSelect";
import { getTransferNotifications } from "@/lib/transfer-notification-utils";
import { getWarehouseName, normalizeWarehouseId } from "@/lib/warehouse-utils";
import type { MovementWithDetails, Product } from "@/types/models";
import {
  getAllTaggedExpressItems,
  tagExpressItem,
  untagExpressItem,
  batchTagExpressItems,
  batchUntagExpressItems,
  updateExpressItemStatus,
  batchUpdateExpressItemStatus,
  clearImportedExpressItems,
  type TaggedExpressItem,
  type ExpressSyncStatus,
} from "@/lib/express-tag-utils";

export interface DisplayFields {
  barcode: boolean;
  productName: boolean;
  warehouse: boolean;
  quantity: boolean;
  sku: boolean;
  location: boolean;
  docNo: boolean;
}

const DEFAULT_DISPLAY_FIELDS: DisplayFields = {
  barcode: true,
  productName: true,
  warehouse: true,
  quantity: true,
  sku: false,
  location: false,
  docNo: false,
};

type TagFilterType = "ALL" | "TAGGED_ONLY" | "PENDING" | "IMPORTED" | "UNTAGGED";

export default function ExpressIssuePage() {
  const router = useRouter();
  const { user, status } = useTabAuth();

  useEffect(() => {
    if (status !== "loading" && user && user.role !== "ADMIN") {
      router.replace("/dashboard");
    }
  }, [status, user, router]);

  const [movements, setMovements] = useState<any[]>([]);
  const [catalogProducts, setCatalogProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDocNo, setSelectedDocNo] = useState<string>("ALL");
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedDay, setSelectedDay] = useState<string>("ALL");
  const [selectedMonth, setSelectedMonth] = useState<string>("ALL");
  const [selectedYear, setSelectedYear] = useState<string>("ALL");
  const [tagFilter, setTagFilter] = useState<TagFilterType>("ALL");
  const [copySuccess, setCopySuccess] = useState<string | null>(null);
  const [copiedItemId, setCopiedItemId] = useState<string | null>(null);
  const [copiedItemSku, setCopiedItemSku] = useState<string | null>(null);
  const [displayFields, setDisplayFields] = useState<DisplayFields>(DEFAULT_DISPLAY_FIELDS);

  // Tagging State
  const [taggedItemsMap, setTaggedItemsMap] = useState<Map<string, TaggedExpressItem>>(new Map());
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [customTagInput, setCustomTagInput] = useState<string>("เบิกสินค้าเข้า Express");
  const [showTagModal, setShowTagModal] = useState<boolean>(false);

  // Sync tagged items from localStorage
  const refreshTaggedMap = useCallback(() => {
    const tagged = getAllTaggedExpressItems("ISSUE");
    setTaggedItemsMap((prev) => {
      if (prev.size === tagged.length) {
        let isIdentical = true;
        for (const t of tagged) {
          const p = prev.get(t.id);
          if (!p || p.status !== t.status || p.tag !== t.tag) {
            isIdentical = false;
            break;
          }
        }
        if (isIdentical) return prev;
      }
      const map = new Map<string, TaggedExpressItem>();
      tagged.forEach((t) => map.set(t.id, t));
      return map;
    });
  }, []);

  useEffect(() => {
    refreshTaggedMap();
    window.addEventListener("stockify-express-tags-updated", refreshTaggedMap);
    window.addEventListener("storage", refreshTaggedMap);
    return () => {
      window.removeEventListener("stockify-express-tags-updated", refreshTaggedMap);
      window.removeEventListener("storage", refreshTaggedMap);
    };
  }, [refreshTaggedMap]);

  // Helper to extract 2-digit Express warehouse code (e.g. "01", "02", "03")
  const toExpressWhCode = (whNameOrCode: string): string => {
    if (!whNameOrCode) return "01";
    const match = whNameOrCode.match(/\d+/);
    if (match) return match[0].padStart(2, "0");
    return "01";
  };

  // Helper to get user-friendly Thai warehouse name
  const getWarehouseDisplayName = (raw: string | undefined | null): string => {
    if (!raw) return "-";
    if (raw.includes("โกดัง") || raw.includes("สำนักงานใหญ่")) return raw;
    return getWarehouseName(raw);
  };

  const fetchMovements = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    try {
      const ts = Date.now();
      const [issueRes, prodRes, statusRes] = await Promise.all([
        fetch(`/api/express-import/issue?_t=${ts}`, { cache: "no-store" }),
        fetch(`/api/products?limit=5000&_t=${ts}`, { cache: "no-store" }).catch(() => null),
        fetch(`/api/express-import/status?type=ISSUE&_t=${ts}`, { cache: "no-store" }).catch(() => null),
      ]);

      const issueJson = await issueRes.json().catch(() => null);
      const prodJson = prodRes ? await prodRes.json().catch(() => null) : null;
      const statusJson = statusRes ? await statusRes.json().catch(() => null) : null;

      // Extract products list for catalog matching
      if (prodJson && (Array.isArray(prodJson?.data) || Array.isArray(prodJson?.data?.data))) {
        const products: Product[] = Array.isArray(prodJson.data) ? prodJson.data : prodJson.data.data;
        setCatalogProducts(products);
      }

      if (issueJson && issueJson.success && Array.isArray(issueJson.data)) {
        const incomingMovements: any[] = issueJson.data;
        setMovements((prev) => {
          if (
            prev.length === incomingMovements.length &&
            prev[0]?.id === incomingMovements[0]?.id &&
            prev[prev.length - 1]?.id === incomingMovements[incomingMovements.length - 1]?.id
          ) {
            return prev;
          }
          return incomingMovements;
        });

        // If server returned express statuses, synchronize into tagged map in a SINGLE batch
        if (statusJson?.success && statusJson?.data) {
          const serverStatusMap: Record<string, { status: ExpressSyncStatus; type: string }> = statusJson.data;
          const currentTagged = getAllTaggedExpressItems("ISSUE");
          const localMap = new Map<string, TaggedExpressItem>(currentTagged.map((i) => [i.id, i]));
          const toUpdate: Array<Omit<TaggedExpressItem, "tagged_at" | "status"> & { status?: ExpressSyncStatus }> = [];

          incomingMovements.forEach((item) => {
            const docKey = (item.document_no || "").trim().toLowerCase();
            const docIdKey = (item.document_id || "").trim().toLowerCase();
            const srv = (docKey ? serverStatusMap[docKey] : undefined) || (docIdKey ? serverStatusMap[docIdKey] : undefined);
            const docExpressStatus = srv?.status || (item.status === "IMPORTED" ? "IMPORTED" : undefined);

            if (docExpressStatus) {
              const uniqueId = item.id || `iss_${item.movement_id || item.document_id || item.document_no}_${item.sku}`;
              const existing = localMap.get(uniqueId);
              if (!existing || existing.status !== docExpressStatus) {
                toUpdate.push({
                  id: uniqueId,
                  type: "ISSUE",
                  tag: existing?.tag || "เบิกสินค้าเข้า Express",
                  sku: item.sku,
                  barcode: item.barcode,
                  product_name: item.product_name,
                  warehouse: item.warehouse_name,
                  warehouse_code: toExpressWhCode(item.warehouse_name),
                  quantity: Math.abs(Number(item.quantity) || 1),
                  document_no: item.document_no,
                  document_date: item.created_at,
                  location: item.location || "-",
                  status: docExpressStatus,
                });
              }
            }
          });

          if (toUpdate.length > 0) {
            batchTagExpressItems(toUpdate);
          }
        }
      }
    } catch (e) {
      console.error("Failed to fetch issue movements for Express:", e);
    } finally {
      if (!isSilent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMovements();
    const interval = setInterval(() => {
      fetchMovements(true);
    }, 12000);
    return () => clearInterval(interval);
  }, [fetchMovements]);

  // Helper to extract shelf/location code from text, e.g. "05850 #AD-02 ก็อกบอลก/ล สีชมพู" -> "AD-02"
  const extractShelfFromText = (text: string | undefined | null): string => {
    if (!text) return "";
    const str = String(text).trim();
    // 1. Explicit hash tag like #AD-02, #ADS-05, #HC40, #B-12, #A01
    const hashMatch = str.match(/#\s*([A-Za-z0-9\-_/]+)/);
    if (hashMatch && hashMatch[1]) {
      const loc = hashMatch[1].trim();
      if (loc && loc !== "-" && !/^loc-?(a0?1|b0?1)?$/i.test(loc) && loc !== "A1") {
        return loc;
      }
    }
    // 2. Bracketed shelf code e.g. [AD-02], (AD-02)
    const bracketMatch = str.match(/[\(\[\{]([A-Za-z0-9\-_/]+)[\)\]\}]/);
    if (bracketMatch && bracketMatch[1]) {
      const loc = bracketMatch[1].trim();
      if (loc && loc !== "-" && !/^loc-?(a0?1|b0?1)?$/i.test(loc) && loc !== "A1" && loc.length >= 2 && loc.length <= 15) {
        return loc;
      }
    }
    return "";
  };

  // Flatten & transform movement items
  const allItems = useMemo(() => {
    const list: Array<{
      id: string;
      movement_id: string;
      document_id: string;
      document_no: string;
      warehouse_name: string;
      warehouse_id: string;
      from_warehouse_name?: string;
      to_warehouse_name?: string;
      created_at: string;
      created_by_name: string;
      sku: string;
      product_name: string;
      quantity: number;
      location: string;
      barcode: string;
      movement_type: string;
      status?: string;
      express_status?: ExpressSyncStatus;
    }> = [];

    // Multi-index catalog products for thorough matching
    const prodBySku = new Map<string, Product>();
    const prodByCleanSku = new Map<string, Product>();
    const prodById = new Map<string, Product>();
    const prodByBarcode = new Map<string, Product>();
    const prodByNameClean = new Map<string, Product>();
    const prodByLeadingNumber = new Map<string, Product>();

    catalogProducts.forEach((p) => {
      if (!p) return;
      const pSku = (p.sku || "").trim().toLowerCase();
      const pCleanSku = (p.sku || "").replace(/[\s\-_#]/g, "").toLowerCase();
      const pId = (p.product_id || "").trim().toLowerCase();
      const pCleanId = (p.product_id || "").replace(/^prod-/, "").toLowerCase();
      const pBcode = (p.barcode || "").trim().toLowerCase();
      const pCleanName = (p.product_name || "").replace(/[\s\-_#]/g, "").toLowerCase();

      if (pSku) prodBySku.set(pSku, p);
      if (pCleanSku) prodByCleanSku.set(pCleanSku, p);
      if (pId) prodById.set(pId, p);
      if (pCleanId) prodById.set(pCleanId, p);
      if (pBcode && pBcode !== "-") prodByBarcode.set(pBcode, p);
      if (pCleanName) prodByNameClean.set(pCleanName, p);

      const numMatch = (p.product_name || "").match(/^(\d{3,18})/) || (p.sku || "").match(/^(\d{3,18})/);
      if (numMatch) {
        prodByLeadingNumber.set(numMatch[1], p);
      }
    });

    const findMatchedProduct = (sku: string, barcode: string, prodName: string, id?: string): Product | undefined => {
      const cleanSku = (sku || "").toLowerCase().trim();
      const strippedSku = cleanSku.replace(/[\s\-_#]/g, "");
      const cleanBcode = (barcode || "").toLowerCase().trim();
      const cleanName = (prodName || "").replace(/[\s\-_#]/g, "").toLowerCase();
      const cleanId = (id || "").toLowerCase().trim();

      if (cleanSku && prodBySku.has(cleanSku)) return prodBySku.get(cleanSku);
      if (strippedSku && prodByCleanSku.has(strippedSku)) return prodByCleanSku.get(strippedSku);
      if (cleanBcode && prodByBarcode.has(cleanBcode)) return prodByBarcode.get(cleanBcode);
      if (cleanId && prodById.has(cleanId)) return prodById.get(cleanId);
      if (cleanName && prodByNameClean.has(cleanName)) return prodByNameClean.get(cleanName);

      const numMatch = (prodName || "").match(/^(\d{3,18})/) || (sku || "").match(/^(\d{3,18})/);
      if (numMatch && prodByLeadingNumber.has(numMatch[1])) {
        return prodByLeadingNumber.get(numMatch[1]);
      }
      return undefined;
    };

    movements.forEach((m: any, idx) => {
      if (selectedDocNo !== "ALL" && m.document_no !== selectedDocNo) return;
      if (
        selectedWarehouse !== "ALL" &&
        m.warehouse_name !== selectedWarehouse &&
        m.warehouse_id !== selectedWarehouse &&
        m.from_warehouse_name !== selectedWarehouse &&
        m.to_warehouse_name !== selectedWarehouse
      ) {
        return;
      }

      const rawBarcode = m.barcode || "";
      const sku = m.sku || "";
      const prodName = m.product_name || "";
      const barcode =
        rawBarcode && rawBarcode !== "-" && rawBarcode !== "null" && !rawBarcode.toLowerCase().startsWith("trf")
          ? rawBarcode
          : (sku && sku !== "-" && sku !== "trf-item" && !sku.toLowerCase().startsWith("trf") ? sku : "");

      const finalBarcode = barcode || (prodName.match(/^(\d{3,18})/) ? (prodName.match(/^(\d{3,18})/)?.[1]?.length ?? 0 >= 7 ? prodName.match(/^(\d{3,18})/)![1] : "9000" + prodName.match(/^(\d{3,18})/)![1].padStart(4, "0")) : "");

      // 1. Existing Location on movement record
      let realLocation = (m.location || "").trim();
      if (
        !realLocation ||
        realLocation === "-" ||
        realLocation === "A1" ||
        realLocation === "A01" ||
        /^loc-?(a0?1|b0?1)?$/i.test(realLocation) ||
        realLocation === "ตำแหน่งเริ่มต้น"
      ) {
        realLocation = "";
      }

      // 2. Destination Scanned Location (รหัสตำแหน่งที่สแกนตอนปลายทาง)
      if (!realLocation) {
        const destScannedLoc = (
          (m as any).to_location_id ||
          (m as any).to_location ||
          (m as any).completed_location_id ||
          ""
        ).trim();

        if (destScannedLoc && !/^loc-?(a0?1|b0?1)?$/i.test(destScannedLoc) && destScannedLoc !== "A1" && destScannedLoc !== "A01" && destScannedLoc !== "-" && destScannedLoc !== "ตำแหน่งเริ่มต้น") {
          realLocation = destScannedLoc.replace(/^loc-/, "");
        }
      }

      // 3. Location code on movement record
      if (!realLocation) {
        const rawLoc = (m.location_code || m.location_id || "").trim();
        const isDummy = !rawLoc || /^loc-?(a0?1|b0?1)?$/i.test(rawLoc) || rawLoc === "A1" || rawLoc === "A01" || rawLoc === "-" || rawLoc === "ตำแหน่งเริ่มต้น";
        if (!isDummy) {
          realLocation = rawLoc.replace(/^loc-/, "");
        }
      }

      // 4. Fallback: extract shelf tag #SHELF from product name, SKU, or note
      if (!realLocation) {
        realLocation =
          extractShelfFromText(prodName) ||
          extractShelfFromText(m.product_name) ||
          extractShelfFromText(sku) ||
          extractShelfFromText(m.note);
      }

      // 5. From Matched Product in catalog (Destination warehouse first, then Source)
      const matchedProd = findMatchedProduct(sku, finalBarcode, prodName, m.product_id);
      if (!realLocation && matchedProd) {
        const destWhId = normalizeWarehouseId((m as any).to_warehouse_id || (m as any).to_warehouse_name);
        const srcWhId = normalizeWarehouseId(m.warehouse_id || m.from_warehouse_name || m.warehouse_name);
        
        if (Array.isArray(matchedProd.locations_breakdown)) {
          // Destination warehouse location
          const destLoc = matchedProd.locations_breakdown.find(
            (l: any) =>
              normalizeWarehouseId(l.warehouse_id) === destWhId &&
              l.location &&
              l.location !== "-" &&
              !/^loc-?(a0?1|b0?1)?$/i.test(l.location) &&
              l.location !== "A1"
          );
          if (destLoc?.location) realLocation = destLoc.location.replace(/^loc-/, "");

          // Source warehouse location
          if (!realLocation) {
            const srcLoc = matchedProd.locations_breakdown.find(
              (l: any) =>
                normalizeWarehouseId(l.warehouse_id) === srcWhId &&
                l.location &&
                l.location !== "-" &&
                !/^loc-?(a0?1|b0?1)?$/i.test(l.location) &&
                l.location !== "A1"
            );
            if (srcLoc?.location) realLocation = srcLoc.location.replace(/^loc-/, "");
          }

          // Fallback any warehouse location
          if (!realLocation) {
            const anyLoc = matchedProd.locations_breakdown.find(
              (l: any) =>
                l.location &&
                l.location !== "-" &&
                !/^loc-?(a0?1|b0?1)?$/i.test(l.location) &&
                l.location !== "A1"
            );
            if (anyLoc?.location) realLocation = anyLoc.location.replace(/^loc-/, "");
          }
        }

        // Matched product's main location field
        if (!realLocation && matchedProd.location && matchedProd.location !== "-" && matchedProd.location !== "A1" && matchedProd.location !== "loc-A1") {
          realLocation = matchedProd.location.replace(/^loc-/, "");
        }
      }

      if (!realLocation) {
        realLocation = "-";
      }

      const qty = Math.abs(Number(m.quantity || m.qty_change) || 1);
      const uniqueId = m.id || `iss_${m.movement_id || m.document_id || m.document_no || idx}_${sku}`;

      list.push({
        id: uniqueId,
        movement_id: m.movement_id || uniqueId,
        document_id: m.document_id || m.document_no,
        document_no: m.document_no || "ISS",
        warehouse_name: m.from_warehouse_name || m.warehouse_name || m.warehouse_id || "คลังสินค้า",
        warehouse_id: m.warehouse_id || "",
        from_warehouse_name: m.from_warehouse_name || m.warehouse_name || "คลังสินค้า",
        to_warehouse_name: m.to_warehouse_name || "",
        created_at: m.created_at ? m.created_at.slice(0, 10) : "-",
        created_by_name: m.created_by_name || "ผู้ใช้งาน",
        sku: sku || finalBarcode,
        product_name: prodName || sku || "สินค้า",
        quantity: qty,
        location: realLocation,
        barcode: finalBarcode || rawBarcode || sku,
        movement_type: m.movement_type || "TRANSFER_OUT",
        status: m.status || "PENDING",
        express_status: (m.status as ExpressSyncStatus) || "PENDING",
      });
    });

    return list;
  }, [movements, selectedDocNo, selectedWarehouse, catalogProducts]);

  // Helper to parse date into { year, month, day }
  const parseDateParts = (raw: string | undefined | null) => {
    if (!raw || raw === "-") return null;
    const clean = (raw.includes("T") ? raw.split("T")[0] : raw.split(" ")[0]).trim();
    if (clean.includes("-")) {
      const parts = clean.split("-");
      if (parts.length === 3) {
        if (parts[0].length === 4) {
          return {
            year: parts[0],
            month: parts[1].padStart(2, "0"),
            day: parts[2].padStart(2, "0"),
          };
        } else if (parts[2].length === 4) {
          return {
            year: parts[2],
            month: parts[1].padStart(2, "0"),
            day: parts[0].padStart(2, "0"),
          };
        }
      }
    } else if (clean.includes("/")) {
      const parts = clean.split("/");
      if (parts.length === 3) {
        if (parts[2].length === 4) {
          return {
            year: parts[2],
            month: parts[1].padStart(2, "0"),
            day: parts[0].padStart(2, "0"),
          };
        } else if (parts[0].length === 4) {
          return {
            year: parts[0],
            month: parts[1].padStart(2, "0"),
            day: parts[2].padStart(2, "0"),
          };
        }
      }
    }
    return null;
  };

  // Available distinct years from dataset
  const availableYears = useMemo(() => {
    const set = new Set<string>();
    const currentYear = String(new Date().getFullYear());
    set.add(currentYear);
    set.add(String(new Date().getFullYear() - 1));
    allItems.forEach((item) => {
      const parts = parseDateParts(item.created_at);
      if (parts && /^\d{4}$/.test(parts.year)) {
        set.add(parts.year);
      }
    });
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [allItems]);

  const setDateToToday = () => {
    const now = new Date();
    setSelectedYear(String(now.getFullYear()));
    setSelectedMonth(String(now.getMonth() + 1).padStart(2, "0"));
    setSelectedDay(String(now.getDate()).padStart(2, "0"));
  };

  const availableWarehouses = useMemo(() => {
    const set = new Set<string>();
    movements.forEach((m) => {
      const wh = m.warehouse_name || m.warehouse_id;
      if (wh) set.add(wh);
    });
    return Array.from(set);
  }, [movements]);

  const resetDateFilter = () => {
    setSelectedYear("ALL");
    setSelectedMonth("ALL");
    setSelectedDay("ALL");
  };

  const warehouseOptions = useMemo(() => [
    { value: "ALL", label: `ทุกคลังสินค้า (${availableWarehouses.length})` },
    ...availableWarehouses.map((wh) => ({
      value: wh,
      label: `โกดัง: ${getWarehouseDisplayName(wh)}`,
    })),
  ], [availableWarehouses]);

  const dayOptions = useMemo(() => [
    { value: "ALL", label: "ทุกวัน" },
    ...Array.from({ length: 31 }, (_, i) => {
      const d = String(i + 1).padStart(2, "0");
      return { value: d, label: `วันที่ ${parseInt(d, 10)}` };
    }),
  ], []);
  const monthOptions = useMemo(() => [
    { value: "ALL", label: "ทุกเดือน" },
    { value: "01", label: "ม.ค. (01)" },
    { value: "02", label: "ก.พ. (02)" },
    { value: "03", label: "มี.ค. (03)" },
    { value: "04", label: "เม.ย. (04)" },
    { value: "05", label: "พ.ค. (05)" },
    { value: "06", label: "มิ.ย. (06)" },
    { value: "07", label: "ก.ค. (07)" },
    { value: "08", label: "ส.ค. (08)" },
    { value: "09", label: "ก.ย. (09)" },
    { value: "10", label: "ต.ค. (10)" },
    { value: "11", label: "พ.ย. (11)" },
    { value: "12", label: "ธ.ค. (12)" },
  ], []);

  const yearOptions = useMemo(() => [
    { value: "ALL", label: "ทุกปี" },
    ...availableYears.map((yr) => ({ value: yr, label: `ปี ${yr}` })),
  ], [availableYears]);

  // Filter items by search query, Tag filter, & Day/Month/Year date filter
  const filteredItems = useMemo(() => {
    return allItems.filter((item) => {
      // Tag filter check
      const tagged = taggedItemsMap.get(item.id);
      const effectiveStatus: ExpressSyncStatus = tagged?.status || (item.status as ExpressSyncStatus) || "PENDING";
      const isTagged = true; // Approved items default to tagged for Express Issue

      if (tagFilter === "TAGGED_ONLY" && !isTagged) return false;
      if (tagFilter === "PENDING" && effectiveStatus !== "PENDING") return false;
      if (tagFilter === "IMPORTED" && effectiveStatus !== "IMPORTED") return false;
      if (tagFilter === "UNTAGGED" && (tagged || isTagged)) return false;

      // Day / Month / Year date filter check
      if (selectedYear !== "ALL" || selectedMonth !== "ALL" || selectedDay !== "ALL") {
        const parts = parseDateParts(item.created_at);
        if (parts) {
          if (selectedYear !== "ALL" && parts.year !== selectedYear) return false;
          if (selectedMonth !== "ALL" && parts.month !== selectedMonth) return false;
          if (selectedDay !== "ALL" && parts.day !== selectedDay) return false;
        } else {
          return false;
        }
      }

      // Search query check
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      const currentTag = tagged?.tag || "เบิกสินค้าเข้า Express";
      return (
        item.sku.toLowerCase().includes(q) ||
        item.product_name.toLowerCase().includes(q) ||
        item.barcode.toLowerCase().includes(q) ||
        item.document_no.toLowerCase().includes(q) ||
        item.warehouse_name.toLowerCase().includes(q) ||
        (item.from_warehouse_name && item.from_warehouse_name.toLowerCase().includes(q)) ||
        (item.to_warehouse_name && item.to_warehouse_name.toLowerCase().includes(q)) ||
        item.location.toLowerCase().includes(q) ||
        currentTag.toLowerCase().includes(q)
      );
    });
  }, [allItems, searchQuery, tagFilter, taggedItemsMap, selectedDay, selectedMonth, selectedYear]);

  const availableDocNos = useMemo(() => {
    const set = new Set<string>();
    movements.forEach((m) => {
      if (m.document_no) set.add(m.document_no);
    });
    return Array.from(set);
  }, [movements]);

  // Tagging Stats
  const tagStats = useMemo(() => {
    let taggedCount = 0;
    let pendingCount = 0;
    let importedCount = 0;

    const baseItems = allItems.filter((item) => {
      if (selectedYear !== "ALL" || selectedMonth !== "ALL" || selectedDay !== "ALL") {
        const parts = parseDateParts(item.created_at);
        if (parts) {
          if (selectedYear !== "ALL" && parts.year !== selectedYear) return false;
          if (selectedMonth !== "ALL" && parts.month !== selectedMonth) return false;
          if (selectedDay !== "ALL" && parts.day !== selectedDay) return false;
        } else {
          return false;
        }
      }
      return true;
    });

    baseItems.forEach((item) => {
      const t = taggedItemsMap.get(item.id);
      const effectiveStatus: ExpressSyncStatus = t?.status || (item.status as ExpressSyncStatus) || "PENDING";
      taggedCount++;
      if (effectiveStatus === "PENDING") pendingCount++;
      if (effectiveStatus === "IMPORTED") importedCount++;
    });

    return { total: baseItems.length, taggedCount, pendingCount, importedCount };
  }, [allItems, taggedItemsMap, selectedDay, selectedMonth, selectedYear]);

  // Toggle Single Tag
  const handleToggleTag = (item: (typeof allItems)[0]) => {
    const existing = taggedItemsMap.get(item.id);
    if (existing) {
      untagExpressItem(item.id);
    } else {
      tagExpressItem({
        id: item.id,
        type: "ISSUE",
        tag: customTagInput || "รอนำเข้า Express",
        sku: item.sku,
        barcode: item.barcode,
        product_name: item.product_name,
        quantity: item.quantity,
        location: item.location,
        warehouse: item.warehouse_name,
        warehouse_code: toExpressWhCode(item.warehouse_name),
        document_no: item.document_no,
        document_date: item.created_at,
      });
    }
  };

  // Helper to sync status to Google Sheets and DB in background
  const syncStatusToSheet = async (items: Array<{ document_no: string; sku?: string; status: ExpressSyncStatus; type: "ISSUE" }>) => {
    try {
      await fetch("/api/express-import/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
    } catch (e) {
      console.warn("[ExpressIssuePage] Background status sync to sheet failed:", e);
    }
  };

  // Update Status
  const handleSetStatus = (item: (typeof allItems)[0], newStatus: ExpressSyncStatus) => {
    const existing = taggedItemsMap.get(item.id);
    if (existing) {
      updateExpressItemStatus(item.id, newStatus);
    } else {
      tagExpressItem({
        id: item.id,
        type: "ISSUE",
        tag: customTagInput || "เบิกสินค้ารอนำเข้า Express",
        sku: item.sku,
        barcode: item.barcode,
        product_name: item.product_name,
        quantity: item.quantity,
        location: item.location,
        warehouse: item.warehouse_name,
        warehouse_code: toExpressWhCode(item.warehouse_name),
        document_no: item.document_no,
        document_date: item.created_at,
        status: newStatus,
      });
    }
    refreshTaggedMap();
    syncStatusToSheet([{ document_no: item.document_no, sku: item.sku, status: newStatus, type: "ISSUE" }]);
  };

  const handleToggleStatus = (id: string) => {
    const existing = taggedItemsMap.get(id);
    if (!existing) return;
    const nextStatus: ExpressSyncStatus = existing.status === "PENDING" ? "IMPORTED" : "PENDING";
    updateExpressItemStatus(id, nextStatus);
    refreshTaggedMap();
    if (existing.document_no) {
      syncStatusToSheet([{ document_no: existing.document_no, sku: existing.sku, status: nextStatus, type: "ISSUE" }]);
    }
  };

  // Multi-Select
  const handleSelectAll = () => {
    if (selectedItemIds.size === filteredItems.length) {
      setSelectedItemIds(new Set());
    } else {
      setSelectedItemIds(new Set(filteredItems.map((i) => i.id)));
    }
  };

  const handleSelectItem = (id: string) => {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Batch Actions
  const handleBatchTag = (tagLabel: string) => {
    const selectedItems = allItems.filter((i) => selectedItemIds.has(i.id));
    if (selectedItems.length === 0) return;

    batchTagExpressItems(
      selectedItems.map((item) => ({
        id: item.id,
        type: "ISSUE",
        tag: tagLabel || "รอนำเข้า Express",
        sku: item.sku,
        barcode: item.barcode,
        product_name: item.product_name,
        quantity: item.quantity,
        location: item.location,
        warehouse: item.warehouse_name,
        warehouse_code: toExpressWhCode(item.warehouse_name),
        document_no: item.document_no,
        document_date: item.created_at,
      }))
    );
    setShowTagModal(false);
  };

  const handleBatchUntag = () => {
    if (selectedItemIds.size === 0) return;
    batchUntagExpressItems(Array.from(selectedItemIds));
    setSelectedItemIds(new Set());
  };

  const handleBatchMarkStatus = (status: ExpressSyncStatus) => {
    if (selectedItemIds.size === 0) return;
    const ids = Array.from(selectedItemIds);
    batchUpdateExpressItemStatus(ids, status);
    refreshTaggedMap();
    const itemsToSync = allItems
      .filter((i) => selectedItemIds.has(i.id))
      .map((i) => ({ document_no: i.document_no, sku: i.sku, status, type: "ISSUE" as const }));
    syncStatusToSheet(itemsToSync);
  };

  // Generate Tab-delimited row for an item
  const getItemExpressRowString = useCallback(
    (item: (typeof allItems)[0]) => {
      const parts: string[] = [];
      if (displayFields.barcode) parts.push(item.barcode);
      if (displayFields.productName) parts.push(item.product_name.replace(/\t/g, " "));
      if (displayFields.warehouse) parts.push(toExpressWhCode(item.warehouse_name));
      if (displayFields.quantity) parts.push(String(item.quantity));
      if (displayFields.sku) parts.push(item.sku);
      if (displayFields.location) parts.push(item.location);
      if (displayFields.docNo) parts.push(item.document_no);

      if (parts.length === 0) {
        return `${item.barcode}\t${item.product_name.replace(/\t/g, " ")}\t${toExpressWhCode(item.warehouse_name)}\t${item.quantity}`;
      }
      return parts.join("\t");
    },
    [displayFields]
  );

  // Copy Single Row with TAB separators
  const handleCopyRow = (item: (typeof allItems)[0]) => {
    const rowStr = getItemExpressRowString(item);
    navigator.clipboard.writeText(rowStr);
    setCopiedItemId(item.id);
    setTimeout(() => setCopiedItemId(null), 2000);
  };

  // Copy Single Barcode Only
  const handleCopySingleBarcode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedItemSku(code);
    setTimeout(() => setCopiedItemSku(null), 2000);
  };

  // Copy All Filtered Rows
  const handleCopyExpressData = () => {
    if (filteredItems.length === 0) return;
    const lines = filteredItems.map((item) => getItemExpressRowString(item));
    const content = lines.join("\n");
    navigator.clipboard.writeText(content);
    setCopySuccess("คัดลอกข้อมูลทั้งหมดเรียบร้อยแล้ว!");
    setTimeout(() => setCopySuccess(null), 3000);
  };

  // Copy Only Selected Rows
  const handleCopySelectedRows = () => {
    const selectedItems = filteredItems.filter((i) => selectedItemIds.has(i.id));
    if (selectedItems.length === 0) return;
    const lines = selectedItems.map((item) => getItemExpressRowString(item));
    const content = lines.join("\n");
    navigator.clipboard.writeText(content);
    setCopySuccess(`คัดลอกเฉพาะ ${selectedItems.length} รายการที่เลือกเรียบร้อยแล้ว!`);
    setTimeout(() => setCopySuccess(null), 3000);
  };

  const handleDownloadExpressTxt = () => {
    if (filteredItems.length === 0) return;
    const headers: string[] = [];
    if (displayFields.barcode) headers.push("บาร์โค้ด");
    if (displayFields.productName) headers.push("ชื่อสินค้า");
    if (displayFields.warehouse) headers.push("โกดัง");
    if (displayFields.quantity) headers.push("จำนวน");
    if (displayFields.sku) headers.push("รหัสสินค้า");
    if (displayFields.location) headers.push("ตำแหน่ง");
    if (displayFields.docNo) headers.push("เลขที่เอกสาร");

    const headerLine = (headers.length > 0 ? headers.join("\t") : "บาร์โค้ด\tชื่อสินค้า\tโกดัง\tจำนวน") + "\n";
    const body = filteredItems.map((item) => getItemExpressRowString(item)).join("\n");

    const blob = new Blob([headerLine + body], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `express_issue_${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handlePrintBarcodes = () => {
    window.print();
  };

  const toggleField = (field: keyof DisplayFields) => {
    setDisplayFields((prev) => ({ ...prev, [field]: !prev[field] }));
  };

  return (
    <div className="w-full max-w-full space-y-5 pb-12">
      {/* Top Header Banner (Clean Light Style) */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm print:hidden">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600 font-bold flex-shrink-0">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </div>
          <div>
            <h1 className="text-base sm:text-lg font-black text-slate-900">
              นำเข้า Express — เบิกสินค้า
            </h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleCopyExpressData}
            className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs flex items-center gap-2 shadow-xs transition-all cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
            </svg>
            <span>{copySuccess || "คัดลอกข้อมูลทั้งหมด"}</span>
          </button>

          <button
            type="button"
            onClick={handleDownloadExpressTxt}
            className="px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
            title="ดาวน์โหลดไฟล์ .txt สำหรับ Express"
          >
            <svg className="w-4 h-4 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            <span>ดาวน์โหลด .txt</span>
          </button>

          <button
            type="button"
            onClick={handlePrintBarcodes}
            className="px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
          >
            <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            <span>พิมพ์ใบสแกน</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(() => {});
              } else {
                document.exitFullscreen().catch(() => {});
              }
            }}
            className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
            title="ขยายเต็มหน้าจอ (Fullscreen)"
          >
            <svg className="w-4 h-4 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m4 0v4m0 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
            <span>เต็มจอ</span>
          </button>
        </div>
      </div>

      {/* Express Tagging & Batch Stats Bar (Clean Light Theme Cards) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 print:hidden">
        {/* All Items Card */}
        <div
          onClick={() => setTagFilter("ALL")}
          className={`p-4 rounded-2xl border transition-all cursor-pointer ${
            tagFilter === "ALL"
              ? "bg-slate-100 border-slate-400 shadow-sm"
              : "bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50/70 shadow-2xs"
          }`}
        >
          <div className="text-xs font-bold text-slate-600">รายการเบิกทั้งหมด</div>
          <div className="text-2xl font-black text-slate-900 mt-1 font-mono">{tagStats.total}</div>
        </div>

        {/* Pending Card */}
        <div
          onClick={() => setTagFilter("PENDING")}
          className={`p-4 rounded-2xl border transition-all cursor-pointer ${
            tagFilter === "PENDING"
              ? "bg-amber-100/70 border-amber-500 shadow-sm"
              : "bg-white border-slate-200 hover:border-amber-300 hover:bg-amber-50/40 shadow-2xs"
          }`}
        >
          <div className="text-xs font-bold text-amber-800">⏳ รอนำเข้า Express</div>
          <div className="text-2xl font-black text-amber-900 mt-1 font-mono">{tagStats.pendingCount}</div>
        </div>

        {/* Imported Card */}
        <div
          onClick={() => setTagFilter("IMPORTED")}
          className={`p-4 rounded-2xl border transition-all cursor-pointer ${
            tagFilter === "IMPORTED"
              ? "bg-emerald-100/70 border-emerald-500 shadow-sm"
              : "bg-white border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/40 shadow-2xs"
          }`}
        >
          <div className="text-xs font-bold text-emerald-800">✅ นำเข้าแล้ว</div>
          <div className="text-2xl font-black text-emerald-900 mt-1 font-mono">{tagStats.importedCount}</div>
        </div>
      </div>

      {/* Filter Controls & Search (Clean Light Box) */}
      <div className="p-4 bg-white border border-slate-200 rounded-2xl space-y-3.5 shadow-2xs print:hidden">
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
          {/* Search Box */}
          <div className="sm:col-span-5 relative">
            <svg className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ค้นหาบาร์โค้ด, SKU, สินค้า, แท็ก, โกดัง, เลขเอกสาร..."
              className="w-full pl-10 pr-8 py-2.5 min-h-[42px] bg-slate-50 border border-slate-300 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-rose-600 focus:bg-white transition-all font-medium"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-800"
              >
                ✕
              </button>
            )}
          </div>

          {/* Warehouse Selector */}
          <div className="sm:col-span-3">
            <ScrollSelect
              value={selectedWarehouse}
              onChange={setSelectedWarehouse}
              options={warehouseOptions}
              maxVisibleItems={4}
              title="เลือกคลังสินค้า"
              activeColor="rose"
            />
          </div>

          {/* Day / Month / Year Dropdowns */}
          <div className="sm:col-span-4 flex items-center gap-1.5">
            {/* วัน (Day) */}
            <ScrollSelect
              value={selectedDay}
              onChange={setSelectedDay}
              options={dayOptions}
              maxVisibleItems={4}
              title="เลือกวัน"
              activeColor="rose"
            />

            {/* เดือน (Month) */}
            <ScrollSelect
              value={selectedMonth}
              onChange={setSelectedMonth}
              options={monthOptions}
              maxVisibleItems={4}
              title="เลือกเดือน"
              activeColor="rose"
            />

            {/* ปี (Year) */}
            <ScrollSelect
              value={selectedYear}
              onChange={setSelectedYear}
              options={yearOptions}
              maxVisibleItems={4}
              title="เลือกปี"
              activeColor="rose"
            />

            {(selectedDay !== "ALL" || selectedMonth !== "ALL" || selectedYear !== "ALL") && (
              <button
                type="button"
                onClick={resetDateFilter}
                className="px-2.5 py-2 min-h-[42px] text-sm text-rose-600 hover:bg-rose-50 rounded-xl font-bold cursor-pointer flex-shrink-0 border border-rose-200"
                title="ล้างตัวกรองวันที่"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Items Content (Clean Light Card Design) */}
      <div className="space-y-4">
        {/* Printable Header */}
        <div className="hidden print:block text-center mb-6 pb-3 border-b-2 border-black">
          <h1 className="text-xl font-bold text-black">ใบสแกนบาร์โค้ดเบิกสินค้า — Express ERP</h1>
          <p className="text-xs text-gray-600 mt-1">
            วันที่พิมพ์: {new Date().toLocaleDateString("th-TH")} | รวม {filteredItems.length} รายการ
          </p>
        </div>

        {loading ? (
          <div className="rounded-2xl p-16 text-center border border-slate-200 bg-white shadow-sm">
            <div className="w-8 h-8 border-3 border-rose-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-slate-600 text-sm font-medium">กำลังโหลดข้อมูลรายการเบิกสินค้า...</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="rounded-2xl p-16 text-center border border-slate-200 bg-white shadow-sm">
            <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3 text-slate-400">
              <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
            </div>
            <h3 className="text-base font-bold text-slate-800 mb-1">ไม่พบรายการเบิกสินค้าที่ตรงกับเงื่อนไข</h3>
            <p className="text-slate-500 text-xs sm:text-sm">ลองเปลี่ยนเงื่อนไขการค้นหาหรือตัวกรองแท็ก</p>
          </div>
        ) : (
          /* Table View */
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden print:border-black">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/95 border-b border-slate-200 text-slate-700 text-sm font-bold tracking-normal print:bg-white">
                    <th className="py-3.5 px-3 text-center w-14 text-sm font-bold text-slate-700">ลำดับ</th>
                    <th className="py-3.5 px-3 whitespace-nowrap text-sm font-bold text-slate-700">เลขที่เอกสาร</th>
                    <th className="py-3.5 px-3 text-center whitespace-nowrap text-sm font-bold text-slate-700">บาร์โค้ด</th>
                    <th className="py-3.5 px-3 whitespace-nowrap text-sm font-bold text-slate-700">รหัสสินค้า</th>
                    <th className="py-3.5 px-3 min-w-[220px] text-sm font-bold text-slate-700">ชื่อสินค้า</th>
                    <th className="py-3.5 px-3 whitespace-nowrap text-center text-sm font-bold text-slate-700">คลังสินค้า</th>
                    <th className="py-3.5 px-3 whitespace-nowrap text-center text-sm font-bold text-slate-700">ตำแหน่ง</th>
                    <th className="py-3.5 px-3 text-right whitespace-nowrap text-sm font-bold text-slate-700">จำนวน</th>
                    <th className="py-3.5 px-3 text-center whitespace-nowrap print:hidden text-sm font-bold text-slate-700">สถานะ Express</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {filteredItems.map((item, idx) => {
                    const barcodeValue = item.barcode || item.sku;
                    const isRowCopied = copiedItemId === item.id;
                    const isBarcodeCopied = copiedItemSku === barcodeValue;
                    const isSelected = selectedItemIds.has(item.id);
                    const tagged = taggedItemsMap.get(item.id);
                    const effectiveStatus: ExpressSyncStatus = tagged?.status || item.express_status || (item.status as ExpressSyncStatus) || "PENDING";
                    const isImported = effectiveStatus === "IMPORTED";

                    return (
                      <tr
                        key={`${item.id}-${idx}`}
                        className={`transition-colors border-b ${
                          isImported
                            ? "!bg-emerald-100 hover:!bg-emerald-200/80 border-emerald-300"
                            : isSelected
                            ? "bg-rose-50/50 hover:bg-rose-100/50 border-slate-100"
                            : "hover:bg-slate-50/90 border-slate-100"
                        }`}
                      >
                        {/* 1. ลำดับ */}
                        <td className={`py-3 px-3 text-center font-bold font-mono text-sm text-slate-500 ${isImported ? "!bg-emerald-100" : ""}`}>
                          {idx + 1}
                        </td>

                        {/* 2. เลขที่เอกสาร */}
                        <td className={`py-3 px-3 whitespace-nowrap ${isImported ? "!bg-emerald-100" : ""}`}>
                          <div className="font-mono font-bold text-slate-900 text-sm">
                            {item.document_no}
                          </div>
                          {item.created_at && (
                            <div className="text-xs text-slate-400 font-mono mt-0.5">
                              {item.created_at}
                            </div>
                          )}
                        </td>

                        {/* 3. บาร์โค้ด (รูปบาร์โค้ด) */}
                        <td className={`py-2.5 px-3 whitespace-nowrap text-center ${isImported ? "!bg-emerald-100" : ""}`}>
                          <div className="flex flex-col items-center justify-center gap-1">
                            <BarcodeSvg
                              value={barcodeValue}
                              height={40}
                              width={1.4}
                              fontSize={12}
                              showText={true}
                            />
                            <button
                              type="button"
                              onClick={() => handleCopySingleBarcode(barcodeValue)}
                              className="text-xs font-mono text-slate-500 hover:text-rose-600 px-2 py-0.5 rounded hover:bg-slate-100 transition-colors cursor-pointer inline-flex items-center gap-1 print:hidden"
                              title="คัดลอกเฉพาะเลขบาร์โค้ด"
                            >
                              {isBarcodeCopied ? (
                                <span className="text-emerald-600 font-bold">✓ คัดลอกแล้ว</span>
                              ) : (
                                <>
                                  <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                  </svg>
                                  <span>คัดลอกเลข</span>
                                </>
                              )}
                            </button>
                          </div>
                        </td>

                        {/* 4. รหัสสินค้า */}
                        <td className={`py-3 px-3 whitespace-nowrap font-mono font-bold text-slate-900 text-sm ${isImported ? "!bg-emerald-100" : ""}`}>
                          {item.sku || "-"}
                        </td>

                        {/* 5. ชื่อสินค้า */}
                        <td className={`py-3 px-3 min-w-[220px] ${isImported ? "!bg-emerald-100" : ""}`}>
                          <div className="text-slate-900 font-semibold text-sm leading-snug" title={item.product_name}>
                            {item.product_name}
                          </div>
                        </td>

                        {/* 6. คลังสินค้า */}
                        <td className={`py-3 px-3 whitespace-nowrap text-center text-sm ${isImported ? "!bg-emerald-100" : ""}`}>
                          {item.to_warehouse_name ? (
                            <div className="inline-flex items-center gap-1.5 text-slate-800 font-medium">
                              <span>{getWarehouseDisplayName(item.from_warehouse_name || item.warehouse_name)}</span>
                              <span className="text-slate-400 font-bold">➔</span>
                              <span className="font-bold text-slate-900">{getWarehouseDisplayName(item.to_warehouse_name)}</span>
                            </div>
                          ) : (
                            <span className="text-slate-800 font-semibold">
                              {getWarehouseDisplayName(item.warehouse_name)}
                            </span>
                          )}
                        </td>

                        {/* 7. ตำแหน่ง */}
                        <td className={`py-3 px-3 whitespace-nowrap text-center text-sm ${isImported ? "!bg-emerald-100" : ""}`}>
                          <span className="font-mono font-bold text-slate-800 text-sm">
                            {item.location && item.location !== "-" ? item.location : "-"}
                          </span>
                        </td>

                        {/* 8. จำนวน */}
                        <td className={`py-3 px-3 text-right whitespace-nowrap ${isImported ? "!bg-emerald-100" : ""}`}>
                          <span className="font-mono font-bold text-slate-900 text-base">
                            {item.quantity.toLocaleString()} <span className="font-normal text-slate-500 text-xs">ชิ้น</span>
                          </span>
                        </td>

                        {/* 8. สถานะ Express */}
                        <td className={`py-3 px-3 text-center whitespace-nowrap print:hidden ${isImported ? "!bg-emerald-100" : ""}`}>
                          <select
                            value={effectiveStatus}
                            onChange={(e) => handleSetStatus(item, e.target.value as ExpressSyncStatus)}
                            className={`px-3.5 py-1.5 rounded-xl text-xs sm:text-sm font-bold border transition-all cursor-pointer outline-none ${
                              isImported
                                ? "bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100"
                                : "bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100"
                            }`}
                          >
                            <option value="PENDING">⏳ รอนำเข้า</option>
                            <option value="IMPORTED">✅ นำเข้าแล้ว</option>
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Batch Tag Input Modal (Clean Light Design) */}
      {showTagModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-5 space-y-4 shadow-2xl animate-in fade-in zoom-in-95">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <span>🏷️ กำหนดชื่อแท็กสำหรับ Express</span>
              <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-indigo-100 text-indigo-700">
                {selectedItemIds.size} รายการ
              </span>
            </h3>
            <p className="text-xs text-slate-500">
              ระบุชื่อแท็กหรือกลุ่มข้อมูลสำหรับจัดเก็บรายการเบิกสินค้านี้ เช่น &quot;เบิกส่งลูกค้า A&quot;, &quot;ล็อตบ่าย&quot;
            </p>

            <input
              type="text"
              value={customTagInput}
              onChange={(e) => setCustomTagInput(e.target.value)}
              placeholder="ระบุชื่อแท็ก..."
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-rose-600 focus:bg-white"
            />

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowTagModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={() => handleBatchTag(customTagInput)}
                className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-sm cursor-pointer"
              >
                บันทึกแท็ก
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

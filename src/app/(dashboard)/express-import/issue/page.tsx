"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { usePollingWhenVisible } from "@/hooks/use-visibility-polling";
import { isSameJson } from "@/lib/json-equal";
import { useRouter } from "next/navigation";
import { useTabAuth } from "@/context/TabAuthContext";
import BarcodeSvg from "@/components/ui/BarcodeSvg";
import { getWarehouseName, normalizeWarehouseId } from "@/lib/warehouse-utils";
import type { Product } from "@/types/models";
import ExpressImportWorkspaceHeader, {
  type ExpressDatePreset,
  type ExpressStatusFilter,
} from "../_components/ExpressImportWorkspaceHeader";
import ExpressToast, { type ExpressToastState } from "../_components/ExpressToast";
import {
  getAllTaggedExpressItems,
  tagExpressItem,
  batchTagExpressItems,
  updateExpressItemStatus,
  type TaggedExpressItem,
  type ExpressSyncStatus,
} from "@/lib/express-tag-utils";
import {
  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type RowData,
  type SortingState,
} from "@tanstack/react-table";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

// เพิ่ม meta ของคอลัมน์สำหรับคลาส Tailwind ของ <th>/<td> (แนวทางตามเอกสาร TanStack Table)
declare module "@tanstack/react-table" {
  interface ColumnMeta<TData extends RowData, TValue> {
    th?: string;
    td?: string;
  }
}

type TagFilterType = ExpressStatusFilter;

type DatePreset = ExpressDatePreset;

const toIsoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// จำนวนแถวต่อหน้าของตาราง — ข้อมูลเต็มยังอยู่ใน filteredItems แบ่งแสดงฝั่งหน้าเว็บเท่านั้น
const PAGE_SIZE = 10;

// ลูกศรบอกสถานะการเรียงบนหัวคอลัมน์
function SortIcon({ dir }: { dir: false | "asc" | "desc" }) {
  const base = "w-3.5 h-3.5 shrink-0";
  if (dir === "asc") {
    return (
      <svg className={base} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 19V5M5 12l7-7 7 7" />
      </svg>
    );
  }
  if (dir === "desc") {
    return (
      <svg className={base} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 5v14M19 12l-7 7-7-7" />
      </svg>
    );
  }
  return (
    <svg className={`${base} opacity-40`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 9l4-4 4 4M8 15l4 4 4-4" />
    </svg>
  );
}

// รูปแบบชั้นวางที่ยอมรับ — ตรวจจากข้อมูลจริงในชีตโกดัง (233/239 ค่า):
// หลัก: เลขโกดัง+โซน+เลขแถว-ชั้น เช่น 1K11-2A, 3K41-1B, 6K53 | รอง (มีขีด): B-12, AD-02
// กันหยิบรหัสสินค้า/รหัสรุ่น/แบรนด์ (เช่น "JHC", "433AC", "AD02", "0C1000-1") มาโชว์ในคอลัมน์ตำแหน่ง
const looksLikeShelfCode = (loc: string): boolean =>
  loc.length >= 3 &&
  loc.length <= 8 &&
  (/^\d[A-Za-z]\d{2}(-\d[A-Za-z])?$/.test(loc) || /^[A-Za-z]{1,4}-\d{1,3}[A-Za-z]?$/.test(loc));

// Helper to extract shelf/location code from text, e.g. "05850 #AD-02 ก็อกบอลก/ล สีชมพู" -> "AD-02"
const extractShelfFromText = (text: string | undefined | null): string => {
  if (!text) return "";
  const str = String(text).trim();
  // 1. Explicit hash tag like #AD-02, #ADS-05, #HC40, #B-12, #A01
  const hashMatch = str.match(/#\s*([A-Za-z0-9\-_/]+)/);
  if (hashMatch && hashMatch[1]) {
    const loc = hashMatch[1].trim();
    if (looksLikeShelfCode(loc) && !/^loc-?(a0?1|b0?1)?$/i.test(loc) && loc !== "A1") {
      return loc;
    }
  }
  // 2. Bracketed shelf code e.g. [AD-02], (AD-02) — ต้องผ่านรูปแบบชั้นวางเท่านั้น
  //    วงเล็บในชื่อสินค้ามักเป็นรหัสรุ่น (เช่น "สายยาง (6K13-1A)") ไม่ใช่ตำแหน่งวาง
  const bracketMatch = str.match(/[\(\[\{]([A-Za-z0-9\-_/]+)[\)\]\}]/);
  if (bracketMatch && bracketMatch[1]) {
    const loc = bracketMatch[1].trim();
    if (looksLikeShelfCode(loc) && !/^loc-?(a0?1|b0?1)?$/i.test(loc) && loc !== "A1") {
      return loc;
    }
  }
  return "";
};

// Helper to extract 2-digit Express warehouse code (e.g. "01", "02", "03")
const toExpressWhCode = (whNameOrCode: string): string => {
  if (!whNameOrCode) return "01";
  // normalize ก่อนเสมอ — เดิม regex จับเลขจากข้อความดิบ ทำให้ชื่อที่ไม่มีเลข (เช่น สำนักงานใหญ่) ได้โค้ด "01" ผิด
  const normalized = normalizeWarehouseId(whNameOrCode);
  const match = normalized.match(/\d+/);
  return match ? match[0].padStart(2, "0") : "01";
};

// Helper to get user-friendly Thai warehouse name
const getWarehouseDisplayName = (raw: string | undefined | null): string => {
  if (!raw) return "-";
  const str = String(raw).trim();
  if (!str || str === "-" || str === "null" || str === "undefined") return "-";
  // ชื่อที่ไม่ตรงรูปแบบโกดังมาตรฐานจะถูก normalize เป็น wh-01 เสมอ —
  // ถ้าข้อความเดิมไม่ได้หมายถึงโกดัง 1 ให้แสดงข้อความเดิม อย่าหลอกว่าเป็น "โกดัง1"
  if (normalizeWarehouseId(str) === "wh-01" && !/โกดัง|สำนักงาน|wh[-_\s]*0?1|^1$/.test(str.toLowerCase())) {
    return str;
  }
  return getWarehouseName(str);
};

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
  // true = รอบดึงข้อมูลล่าสุดล้มเหลว (เครือข่าย/เซิร์ฟเวอร์) — โชว์แบนเนอร์พร้อมปุ่มลองใหม่ ไม่ปล่อยให้กลายเป็น empty state หลอก
  const [fetchError, setFetchError] = useState(false);
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  // ค่าเริ่มต้นโชว์เฉพาารายการของวันนี้ — ข้อมูลเก่าต้องกด "ทั้งหมด" เอง
  const [datePreset, setDatePreset] = useState<DatePreset>("TODAY");
  const [tagFilter, setTagFilter] = useState<TagFilterType>("ALL");
  const [copiedItemSku, setCopiedItemSku] = useState<string | null>(null);
  const [toast, setToast] = useState<ExpressToastState | null>(null);
  // แบ่งหน้าตาราง — ค่าเริ่มต้นหน้าละ 10 แถว (เปลี่ยนได้ที่แถบล่างตาราง)
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  // เรียงข้อมูล — คลิกหัวคอลัมน์
  const [sorting, setSorting] = useState<SortingState>([]);

  // เปลี่ยนตัวกรอง/คำค้นหาเมื่อไหร่ กลับไปหน้า 1 เสมอ
  useEffect(() => {
    setPage(1);
  }, [searchQuery, selectedWarehouse, datePreset, tagFilter]);

  // Tagging State
  const [taggedItemsMap, setTaggedItemsMap] = useState<Map<string, TaggedExpressItem>>(new Map());

  // นับรอบของ fetch — response ของรอบเก่าต้องไม่ย่อยสถานะใหม่ (กัน race กับการกดระหว่าง poll)
  const fetchGenRef = useRef(0);
  // เอกสารที่เพิ่งกดเปลี่ยนสถานะและ POST ยังไม่ตอบกลับ (docNo lowercase → timestamp)
  // รอบ sync ระหว่างนี้ห้ามเอาค่าจาก server (ซึ่งยังเป็นค่าเก่า) มาทับค่าที่ผู้ใช้เพิ่งกด
  const pendingSyncRef = useRef<Map<string, number>>(new Map());
  const PENDING_SYNC_TTL_MS = 30000;

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

  const fetchMovements = useCallback(async (isSilent = false) => {
    const gen = ++fetchGenRef.current;
    if (!isSilent) setLoading(true);
    try {
      const [issueRes, prodRes, statusRes] = await Promise.all([
        fetch(`/api/express-import/issue`, { cache: "no-store" }),
        fetch(`/api/products?limit=5000`, { cache: "no-store" }).catch(() => null),
        fetch(`/api/express-import/status?type=ISSUE`, { cache: "no-store" }).catch(() => null),
      ]);

      const issueJson = await issueRes.json().catch(() => null);
      const prodJson = prodRes ? await prodRes.json().catch(() => null) : null;
      const statusJson = statusRes ? await statusRes.json().catch(() => null) : null;

      // response ของรอบเก่า (ยิงก่อนหน้านี้) มาถึงทีหลัง — ทิ้ง อย่าให้ทับ state และ sync สถานะ
      if (gen !== fetchGenRef.current) return;

      // ดึงรายการหลักไม่สำเร็จ (เครือข่าย/เซิร์ฟเวอร์) — โชว์แบนเนอร์ให้ผู้ใช้รู้จริง ไม่ปล่อยให้กลายเป็น empty state หลอก
      setFetchError(issueJson?.success !== true);

      // Extract products list for catalog matching
      if (prodJson && (Array.isArray(prodJson?.data) || Array.isArray(prodJson?.data?.data))) {
        const products: Product[] = Array.isArray(prodJson.data) ? prodJson.data : prodJson.data.data;
        // คง state เดิมเมื่อข้อมูล catalog ไม่เปลี่ยน เพื่อไม่ให้ polling ทั้งหน้า re-render ทุก 12 วิ
        setCatalogProducts((prev) => (isSameJson(prev, products) ? prev : products));
      }

      if (issueJson && issueJson.success && Array.isArray(issueJson.data)) {
        const incomingMovements: any[] = issueJson.data.filter((m: any) => {
          const docNo = String(m.document_no || "").trim();
          const sku = String(m.sku || "").trim();
          const date = String(m.created_at || "").trim();
          const name = String(m.product_name || "").trim();
          return !(
            docNo === "เลขที่เอกสาร" ||
            date === "วันที่เอกสาร" ||
            sku.startsWith("คอลัมน์") ||
            sku === "รหัสสินค้า" ||
            name === "ชื่อแท็ก"
          );
        });
        // เทียบทั้งชุด — เดิมเทียแค่จำนวน + id แรก/id สุดท้าย ทำให้ from/to ที่แก้แล้วไม่เคยขึ้นจอ
        setMovements((prev) => (isSameJson(prev, incomingMovements) ? prev : incomingMovements));

        // If server returned express statuses, synchronize into tagged map in a SINGLE batch
        if (statusJson?.success && statusJson?.data) {
          const serverStatusMap: Record<string, { status: ExpressSyncStatus; type: string }> = statusJson.data;
          const currentTagged = getAllTaggedExpressItems("ISSUE");
          const localMap = new Map<string, TaggedExpressItem>(currentTagged.map((i) => [i.id, i]));
          const toUpdate: Array<Omit<TaggedExpressItem, "tagged_at" | "status"> & { status?: ExpressSyncStatus }> = [];
          const nowMs = Date.now();

          incomingMovements.forEach((item) => {
            const docNoLower = (item.document_no || "").trim().toLowerCase();
            // รายการที่เพิ่งกดและ POST ยังไม่ตอบกลับ — ค่า server ตอนนี้ยังเก่า ห้ามเอามาทับ
            const pendingAt = pendingSyncRef.current.get(docNoLower);
            if (pendingAt !== undefined && nowMs - pendingAt < PENDING_SYNC_TTL_MS) return;

            const docKey = (item.document_no || "").trim().toLowerCase();
            const docIdKey = (item.document_id || "").trim().toLowerCase();
            const srv = (docKey ? serverStatusMap[docKey] : undefined) || (docIdKey ? serverStatusMap[docIdKey] : undefined);
            const docExpressStatus: ExpressSyncStatus = srv?.status || (item.status as ExpressSyncStatus) || "PENDING";

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
            });

          if (toUpdate.length > 0) {
            batchTagExpressItems(toUpdate);
          }
        }
      }
    } catch (e) {
      console.error("Failed to fetch issue movements for Express:", e);
      setFetchError(true);
    } finally {
      if (!isSilent && gen === fetchGenRef.current) setLoading(false);
    }
  }, []);

  // hook ส่ง initial=true เฉพาะครั้งแรก — ครั้งแรกโชว์ loading, รอบ polling ต้อง refresh เงียบ ๆ
  // wrapper ต้อง memoize เพราะ hook ใช้ callback เป็น dependency ของ effect
  // (callback ใหม่ทุก render = effect รีสตาร์ทและยิง "ครั้งแรก" ซ้ำ ๆ จนหน้ากระพริบ)
  const pollingFetch = useCallback((initial?: boolean) => {
    void fetchMovements(!initial);
  }, [fetchMovements]);
  usePollingWhenVisible(pollingFetch, 12000);

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
      const docNo = String(m.document_no || "").trim();
      const rawSkuVal = String(m.sku || "").trim();
      const date = String(m.created_at || "").trim();
      const name = String(m.product_name || "").trim();
      if (
        docNo === "เลขที่เอกสาร" ||
        date === "วันที่เอกสาร" ||
        rawSkuVal.startsWith("คอลัมน์") ||
        rawSkuVal === "รหัสสินค้า" ||
        name === "ชื่อแท็ก"
      ) {
        return;
      }

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

      // 2. Source Scanned Location (ตำแหน่งต้นทางที่สแกนตอนเบิก) — หน้านี้เป็นรายการ "เบิกสินค้า"
      //    ตำแหน่งจริงคือชั้นต้นทางที่หยิบของ เดิมดึง to_location_id มาก่อน ทำให้โชว์ชั้นวางปลายทางแทน
      if (!realLocation) {
        const srcScannedLoc = ((m as any).from_location_id || "").trim();

        if (srcScannedLoc && !/^loc-?(a0?1|b0?1)?$/i.test(srcScannedLoc) && srcScannedLoc !== "A1" && srcScannedLoc !== "A01" && srcScannedLoc !== "-" && srcScannedLoc !== "ตำแหน่งเริ่มต้น") {
          realLocation = srcScannedLoc.replace(/^loc-/, "");
        }
      }

      // 3. Destination Scanned Location (รหัสตำแหน่งที่สแกนตอนปลายทาง) — fallback รอง
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

      // 4. Location code on movement record
      if (!realLocation) {
        const rawLoc = (m.location_code || m.location_id || "").trim();
        const isDummy = !rawLoc || /^loc-?(a0?1|b0?1)?$/i.test(rawLoc) || rawLoc === "A1" || rawLoc === "A01" || rawLoc === "-" || rawLoc === "ตำแหน่งเริ่มต้น";
        if (!isDummy) {
          realLocation = rawLoc.replace(/^loc-/, "");
        }
      }

      // 5. Fallback: extract shelf tag #SHELF from product name, SKU, or note
      if (!realLocation) {
        realLocation =
          extractShelfFromText(prodName) ||
          extractShelfFromText(m.product_name) ||
          extractShelfFromText(sku) ||
          extractShelfFromText(m.note);
      }

      // 6. From Matched Product in catalog (Source warehouse first, then Destination)
      const matchedProd = findMatchedProduct(sku, finalBarcode, prodName, m.product_id);
      if (!realLocation && matchedProd) {
        const srcWhId = normalizeWarehouseId(m.warehouse_id || m.from_warehouse_name || m.warehouse_name);
        const destWhId = normalizeWarehouseId((m as any).to_warehouse_id || (m as any).to_warehouse_name);

        if (Array.isArray(matchedProd.locations_breakdown)) {
          const isUsableLocEntry = (l: any) =>
            l.location &&
            l.location !== "-" &&
            !/^loc-?(a0?1|b0?1)?$/i.test(l.location) &&
            l.location !== "A1";

          // Source warehouse location — ชั้นวางต้นทางคือตำแหน่งจริงของรายการเบิก
          const srcLoc = matchedProd.locations_breakdown.find(
            (l: any) => normalizeWarehouseId(l.warehouse_id) === srcWhId && isUsableLocEntry(l)
          );
          if (srcLoc?.location) realLocation = srcLoc.location.replace(/^loc-/, "");

          // Destination warehouse location
          if (!realLocation) {
            const destLoc = matchedProd.locations_breakdown.find(
              (l: any) => normalizeWarehouseId(l.warehouse_id) === destWhId && isUsableLocEntry(l)
            );
            if (destLoc?.location) realLocation = destLoc.location.replace(/^loc-/, "");
          }

          // Fallback any warehouse location
          if (!realLocation) {
            const anyLoc = matchedProd.locations_breakdown.find(isUsableLocEntry);
            if (anyLoc?.location) realLocation = anyLoc.location.replace(/^loc-/, "");
          }
        }

        // Matched product's main location field
        if (!realLocation && matchedProd.location && matchedProd.location !== "-" && matchedProd.location !== "A1" && matchedProd.location !== "loc-A1") {
          realLocation = matchedProd.location.replace(/^loc-/, "");
        }
      }

      // ค่าที่ได้ต้องหน้าตาเป็นชั้นวางเท่านั้น — ค่าที่ไม่ผ่าน (เช่นรหัสรุ่นหลุดมาจากชื่อ/ชีต) แสดง "-" ดีกว่าโชว์ผิด
      if (realLocation && !looksLikeShelfCode(realLocation)) {
        realLocation = "-";
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
        product_name:
          matchedProd?.product_name && matchedProd.product_name !== sku
            ? matchedProd.product_name
            : prodName && prodName !== sku
            ? prodName
            : matchedProd?.product_name || prodName || sku || "สินค้า",
        quantity: qty,
        location: realLocation,
        barcode:
          matchedProd?.barcode && matchedProd.barcode !== "-" && !/[ก-๙]/.test(matchedProd.barcode)
            ? matchedProd.barcode
            : finalBarcode || rawBarcode || sku,
        movement_type: m.movement_type || "TRANSFER_OUT",
        status: m.status || "PENDING",
        express_status: (m.status as ExpressSyncStatus) || "PENDING",
      });
    });

    return list;
  }, [movements, selectedWarehouse, catalogProducts]);

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

  // กรองตามช่วงเวลาลัด — คำนวณจาก preset ที่เลือก เทียบเป็นสตริง ISO (YYYY-MM-DD)
  const presetRange = useMemo(() => {
    const now = new Date();
    const today = toIsoDate(now);
    switch (datePreset) {
      case "TODAY":
        return { from: today, to: today };
      case "YESTERDAY": {
        const y = new Date(now);
        y.setDate(y.getDate() - 1);
        const iso = toIsoDate(y);
        return { from: iso, to: iso };
      }
      case "LAST_7_DAYS": {
        const s = new Date(now);
        s.setDate(s.getDate() - 6);
        return { from: toIsoDate(s), to: today };
      }
      case "THIS_MONTH": {
        const s = new Date(now.getFullYear(), now.getMonth(), 1);
        return { from: toIsoDate(s), to: today };
      }
      default:
        return { from: "", to: "" };
    }
  }, [datePreset]);

  const isInDateRange = useCallback(
    (rawDate: string): boolean => {
      if (!presetRange.from && !presetRange.to) return true;
      const parts = parseDateParts(rawDate);
      if (!parts) return false;
      const iso = `${parts.year}-${parts.month}-${parts.day}`;
      if (presetRange.from && iso < presetRange.from) return false;
      if (presetRange.to && iso > presetRange.to) return false;
      return true;
    },
    [presetRange]
  );

  const availableWarehouses = useMemo(() => {
    const set = new Set<string>();
    movements.forEach((m) => {
      const wh = m.warehouse_name || m.warehouse_id;
      if (wh) set.add(wh);
    });
    return Array.from(set);
  }, [movements]);

  const warehouseOptions = useMemo(() => [
    { value: "ALL", label: `ทุกคลังสินค้า (${availableWarehouses.length})` },
    ...availableWarehouses.map((wh) => ({
      value: wh,
      label: `โกดัง: ${getWarehouseDisplayName(wh)}`,
    })),
  ], [availableWarehouses]);

  // Filter items by search query, tag filter & date range
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

      // Date range check
      if (!isInDateRange(item.created_at)) return false;

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
  }, [allItems, searchQuery, tagFilter, taggedItemsMap, isInDateRange]);

  // แบ่งหน้า — currentPage กันค่าเกินกรณี polling ทำให้จำนวนแถวหดระหว่างอยู่หน้าท้าย
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  // เลขหน้าแสดงสูงสุด 5 ปุ่ม ครอบหน้าปัจจุบันไว้กลางเสมอ
  const pageWindow = useMemo(() => {
    const start = Math.max(1, Math.min(currentPage - 2, totalPages - 4));
    const end = Math.min(totalPages, start + 4);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }, [currentPage, totalPages]);

  // คลาสปุ่มเลขหน้า — หน้าปัจจุบันพื้นเขียวตัวขาว
  const pageBtnClass = (active: boolean): string =>
    `min-h-[44px] min-w-[44px] px-3.5 rounded-xl text-base font-bold border transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#053425] focus-visible:ring-offset-2 ${
      active
        ? "bg-[#06402B] border-[#06402B] text-white shadow-sm shadow-[#06402B]/25"
        : "border-[#E8ECEA] bg-white text-slate-700 hover:border-[#5B8A74] hover:text-[#053425]"
    }`;

  // Tagging Stats
  const tagStats = useMemo(() => {
    let taggedCount = 0;
    let pendingCount = 0;
    let importedCount = 0;

    const baseItems = allItems.filter((item) => isInDateRange(item.created_at));

    baseItems.forEach((item) => {
      const t = taggedItemsMap.get(item.id);
      const effectiveStatus: ExpressSyncStatus = t?.status || (item.status as ExpressSyncStatus) || "PENDING";
      taggedCount++;
      if (effectiveStatus === "PENDING") pendingCount++;
      if (effectiveStatus === "IMPORTED") importedCount++;
    });

    return { total: baseItems.length, taggedCount, pendingCount, importedCount };
  }, [allItems, taggedItemsMap, isInDateRange]);

  // Helper to sync status to Google Sheets and DB in background
  // ตลอดช่วงที่ POST ยังไม่ตอบกลับ จะ mark เอกสารไว้ใน pendingSyncRef เพื่อกัน
  // รอบ polling เอาสถานะเก่าจาก server มาทับค่าที่ผู้ใช้เพิ่งกด (สาเหตุที่สถานะเด้งกลับเป็น "รอนำเข้า")
  const syncStatusToSheet = useCallback(async (items: Array<{ document_no: string; sku?: string; status: ExpressSyncStatus; type: "ISSUE" }>) => {
    const docKeys = items
      .map((i) => (i.document_no || "").trim().toLowerCase())
      .filter(Boolean);
    docKeys.forEach((k) => pendingSyncRef.current.set(k, Date.now()));
    try {
      const res = await fetch("/api/express-import/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) {
        throw new Error(`status sync HTTP ${res.status}`);
      }
      // POST ตอบกลับแล้ว = server รับสถานะแล้ว (memory + doc note) — ปล่อยให้ polling sync ตามปกติ
      docKeys.forEach((k) => pendingSyncRef.current.delete(k));

      const firstItem = items[0];
      const statusLabel = firstItem?.status === "IMPORTED" ? "นำเข้าแล้ว" : "รอนำเข้า";
      const docDesc = items.length === 1 && firstItem?.document_no
        ? `เลขที่ ${firstItem.document_no}`
        : `${items.length} รายการ`;
      setToast({
        message: `บันทึกสถานะ "${statusLabel}" (${docDesc}) เข้า Google Sheets เรียบร้อย`,
        tone: "success",
      });
    } catch (e) {
      // คง pendingSync ไว้ — รอบหน้าจะไม่ทับค่าที่ผู้ใช้กด และรายการหมดอายุเองใน 30 วิ
      console.warn("[ExpressIssuePage] Background status sync to sheet failed:", e);
      setToast({
        message: "ไม่สามารถบันทึกสถานะเข้า Google Sheets ได้ ระบบจะลองใหม่อัตโนมัติ",
        tone: "error",
      });
    }
  }, []);

  // Update Status
  const handleSetStatus = useCallback(
    (item: (typeof allItems)[0], newStatus: ExpressSyncStatus) => {
      const existing = taggedItemsMap.get(item.id);
      if (existing) {
        updateExpressItemStatus(item.id, newStatus);
      } else {
        tagExpressItem({
          id: item.id,
          type: "ISSUE",
          tag: "เบิกสินค้าเข้า Express",
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
    },
    [taggedItemsMap, refreshTaggedMap, syncStatusToSheet]
  );

  // Copy Single Barcode Only
  const handleCopySingleBarcode = useCallback((code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedItemSku(code);
    setTimeout(() => setCopiedItemSku(null), 2000);
  }, []);

  // ล้างตัวกรองทุกตัวในคลิกเดียว (ใช้ใน empty state)
  const handleClearAllFilters = () => {
    setSearchQuery("");
    setDatePreset("ALL");
    setSelectedWarehouse("ALL");
    setTagFilter("ALL");
  };

  // ── TanStack Table v8 (headless) — logic แบ่งหน้า/จัดการแถว, หน้าตาเป็น Tailwind เดิมทั้งหมด ──
  type IssueItem = (typeof allItems)[number];

  const columns = useMemo<ColumnDef<IssueItem, any>[]>(
    () => [
      {
        id: "no",
        header: "ลำดับ",
        enableSorting: false,
        meta: { th: "text-center w-16 text-base sm:text-[17px] font-bold text-slate-900", td: "text-center" },
        // ลำดับที่มองเห็น = ตำแหน่งในลิสต์ที่เรียงแล้ว (นับต่อเนื่องข้ามหน้า)
        cell: ({ row, table }) => {
          const { pageIndex, pageSize } = table.getState().pagination;
          const visibleIndex = table.getPaginationRowModel().rows.findIndex((r) => r.id === row.id);
          return <span className="disp text-base sm:text-[17px] font-bold num text-slate-700">{pageIndex * pageSize + visibleIndex + 1}</span>;
        },
      },
      {
        accessorKey: "document_no",
        header: "เลขที่เอกสาร",
        meta: { th: "text-left text-base sm:text-[17px] font-bold text-slate-900", td: "whitespace-nowrap" },
        cell: ({ row }) => {
          const item = row.original;
          return (
            <>
              <div className="font-mono font-bold text-slate-900 text-[17px] sm:text-lg">{item.document_no}</div>
              {item.created_at && <div className="text-base font-medium text-slate-600 font-mono mt-1">{item.created_at}</div>}
            </>
          );
        },
      },
      {
        id: "barcode",
        header: "บาร์โค้ด",
        meta: { th: "text-center text-base sm:text-[17px] font-bold text-slate-900", td: "text-center" },
        cell: ({ row }) => {
          const item = row.original;
          const barcodeValue = item.barcode || item.sku;
          const isBarcodeCopied = copiedItemSku === barcodeValue;
          return (
            <div className="flex flex-col items-center justify-center gap-1.5 py-1">
              <div className="bg-white px-3 py-2 rounded-xl border border-[#D5DDD9] shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
                <BarcodeSvg value={barcodeValue} height={48} width={1.5} fontSize={14} showText={true} />
              </div>
              <button
                type="button"
                onClick={() => handleCopySingleBarcode(barcodeValue)}
                aria-label={`คัดลอกเลขบาร์โค้ด ${barcodeValue}`}
                className="text-base font-bold text-[#344054] hover:text-[#053425] px-3 py-1.5 min-h-[36px] rounded-lg hover:bg-black/[.05] transition-colors cursor-pointer inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#053425] focus-visible:ring-offset-2 print:hidden"
                title="คัดลอกเฉพาะเลขบาร์โค้ด"
              >
                {isBarcodeCopied ? (
                  <span className="text-[#053425] font-bold inline-flex items-center gap-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.5l5 5L19.5 7" />
                    </svg>
                    คัดลอกแล้ว
                  </span>
                ) : (
                  <>
                    <svg className="w-4 h-4 text-[#475467]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    <span>คัดลอกเลข</span>
                  </>
                )}
              </button>
            </div>
          );
        },
      },
      {
        accessorKey: "sku",
        header: "รหัสสินค้า",
        meta: { th: "text-left text-base sm:text-[17px] font-bold text-slate-900", td: "font-mono font-bold text-slate-900 text-base sm:text-lg" },
        cell: ({ getValue }) => getValue<string>() || "-",
      },
      {
        accessorKey: "product_name",
        header: "ชื่อสินค้า",
        meta: { th: "min-w-[260px] text-left text-base sm:text-[17px] font-bold text-slate-900", td: "min-w-[260px] whitespace-nowrap" },
        cell: ({ row }) => (
          <div className="text-slate-900 font-bold text-[18px] sm:text-[19px] leading-snug" title={row.original.product_name}>
            {row.original.product_name}
          </div>
        ),
      },
      {
        id: "warehouse",
        header: "คลังสินค้า",
        meta: { th: "text-center text-base sm:text-[17px] font-bold text-slate-900", td: "text-center whitespace-nowrap" },
        // แสดงต้นทาง ➔ ปลายทางเสมอ — ถ้าไม่มีปลายทางจริงใช้ "Express" เพราะทุกรายการบนหน้านี้จะนำเข้า Express
        cell: ({ row }) => {
          const item = row.original;
          return (
            <div className="inline-flex items-center gap-2 text-slate-800 text-base sm:text-[17px] font-medium">
              <span>{getWarehouseDisplayName(item.from_warehouse_name || item.warehouse_name)}</span>
              <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
              </svg>
              <span className="font-bold text-slate-900">
                {item.to_warehouse_name ? getWarehouseDisplayName(item.to_warehouse_name) : "Express"}
              </span>
            </div>
          );
        },
      },
      {
        accessorKey: "location",
        header: "ตำแหน่ง",
        meta: { th: "text-center text-base sm:text-[17px] font-bold text-slate-900", td: "text-center" },
        cell: ({ getValue }) => {
          const val = getValue<string>();
          const hasVal = val && val !== "-";
          return (
            <span className={`font-mono font-bold text-base sm:text-[17px] ${hasVal ? "text-slate-900 bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200/70" : "text-slate-400"}`}>
              {hasVal ? val : "-"}
            </span>
          );
        },
      },
      {
        accessorKey: "quantity",
        header: "จำนวน",
        meta: { th: "text-right text-base sm:text-[17px] font-bold text-slate-900", td: "text-right whitespace-nowrap" },
        cell: ({ getValue }) => (
          <>
            <span className="disp font-black num text-slate-900 text-[24px] sm:text-[26px]">{Number(getValue()).toLocaleString()}</span>
            <span className="font-bold text-slate-600 text-base sm:text-[17px] ml-1.5">ชิ้น</span>
          </>
        ),
      },
      {
        id: "status",
        header: "สถานะ Express",
        meta: { th: "text-center text-base sm:text-[17px] font-bold text-slate-900 print:hidden", td: "text-center print:hidden" },
        cell: ({ row }) => {
          const item = row.original;
          const tagged = taggedItemsMap.get(item.id);
          const effectiveStatus: ExpressSyncStatus = tagged?.status || item.express_status || (item.status as ExpressSyncStatus) || "PENDING";
          const isImported = effectiveStatus === "IMPORTED";
          return (
            <select
              value={effectiveStatus}
              onChange={(e) => handleSetStatus(item, e.target.value as ExpressSyncStatus)}
              aria-label={`สถานะ Express ของเอกสาร ${item.document_no} สินค้า ${item.product_name}`}
              className={`px-4 min-h-[46px] rounded-full text-base sm:text-[17px] font-bold border transition-all cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[#053425] focus-visible:ring-offset-2 ${
                isImported
                  ? "bg-[#DFEDE6] text-[#052B1F] border-[#8FB3A3] hover:bg-[#C9DFD4]/60"
                  : "bg-amber-100 text-amber-900 border-amber-300 hover:bg-amber-200/60"
              }`}
            >
              <option value="PENDING">รอนำเข้า</option>
              <option value="IMPORTED">นำเข้าแล้ว</option>
            </select>
          );
        },
      },
    ],
    [taggedItemsMap, copiedItemSku, handleSetStatus, handleCopySingleBarcode]
  );

  const table = useReactTable({
    data: filteredItems,
    columns,
    state: {
      pagination: { pageIndex: currentPage - 1, pageSize },
      sorting,
    },
    onPaginationChange: (updater) => {
      const next = typeof updater === "function" ? updater({ pageIndex: currentPage - 1, pageSize }) : updater;
      setPage(next.pageIndex + 1);
      setPageSize(next.pageSize);
    },
    onSortingChange: (updater) => {
      setSorting(updater);
      setPage(1); // เรียงใหม่เมื่อไหร่กลับไปหน้า 1
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    // คุมการกลับหน้า 1 เองผ่าน useEffect ตัวกรอง (กัน polling เปลี่ยนข้อมูลแล้วหน้ากระโดด)
    autoResetPageIndex: false,
  });

  return (
    <div className="w-full max-w-full space-y-4 sm:space-y-5 pb-12">
      <ExpressToast toast={toast} onClose={() => setToast(null)} />
      <ExpressImportWorkspaceHeader
        mode="issue"
        loading={loading}
        totalCount={tagStats.total}
        pendingCount={tagStats.pendingCount}
        importedCount={tagStats.importedCount}
        visibleCount={filteredItems.length}
        statusFilter={tagFilter}
        onStatusFilterChange={setTagFilter}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        selectedWarehouse={selectedWarehouse}
        onWarehouseChange={setSelectedWarehouse}
        warehouseOptions={warehouseOptions}
        datePreset={datePreset}
        onDatePresetChange={setDatePreset}
        hasActiveFilters={Boolean(searchQuery.trim()) || selectedWarehouse !== "ALL" || datePreset !== "TODAY" || tagFilter !== "ALL"}
        onClearFilters={handleClearAllFilters}
      />

      {/* เนื้อหาหลัก */}
      <div className="space-y-4">
        {/* หัวกระดาษเมื่อพิมพ์ */}
        <div className="hidden print:block text-center mb-6 pb-3 border-b-2 border-black">
          <h1 className="text-xl font-bold text-black">ใบสแกนบาร์โค้ดเบิกสินค้า — Express ERP</h1>
          <p className="text-sm text-slate-600 mt-1">
            วันที่พิมพ์: {new Date().toLocaleDateString("th-TH")} | รวม {filteredItems.length} รายการ
          </p>
        </div>

        {/* แบนเนอร์ข้อผิดพลาด — รอบดึงข้อมูลล่าสุดล้มเหลว (ซ่อนระหว่างโหลดซ้ำ และหายเองเมื่อรอบถัดไปสำเร็จ) */}
        {fetchError && !loading && (
          <div
            role="alert"
            className="bg-white rounded-[20px] border border-[#F3C4BA] px-4 py-3.5 flex flex-wrap items-center justify-between gap-3 print:hidden"
          >
            <div className="flex items-center gap-2.5 text-[#9B1C1C]">
              <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4M12 17h.01" />
              </svg>
              <p className="text-sm font-bold">โหลดข้อมูลไม่สำเร็จ — ตรวจการเชื่อมต่อแล้วลองใหม่</p>
            </div>
            <button
              type="button"
              onClick={() => pollingFetch(true)}
              className="min-h-[44px] px-4 rounded-xl border border-[#E8B7AC] bg-white text-[#9B1C1C] text-sm font-bold hover:bg-[#FDF3F1] transition-colors cursor-pointer inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#053425] focus-visible:ring-offset-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v5h5" />
              </svg>
              ลองใหม่
            </button>
          </div>
        )}

        {loading ? (
          <div
            className="bg-white rounded-[20px] border border-[#E8ECEA] shadow-[0_1px_2px_rgba(16,24,40,0.05)] overflow-hidden"
            aria-busy="true"
            aria-label="กำลังโหลดรายการเบิกสินค้า"
          >
            <div className="bg-slate-50 border-b border-[#E8ECEA] px-4 py-3.5 flex items-center gap-4">
              <div className="skeleton h-4 w-8 shrink-0" />
              <div className="skeleton h-4 w-28 hidden sm:block" />
              <div className="skeleton h-4 w-20 mx-auto hidden md:block" />
              <div className="skeleton h-4 w-24 hidden lg:block" />
              <div className="skeleton h-4 w-20 ml-auto" />
            </div>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="px-4 py-[21px] border-b border-[#EEF1EF] last:border-b-0 flex items-center gap-4">
                <div className="skeleton h-4 w-8 shrink-0" />
                <div className="skeleton h-4 w-36 hidden sm:block" />
                <div className="skeleton h-10 w-24 shrink-0" />
                <div className="skeleton h-4 flex-1 min-w-[80px] max-w-[240px]" />
                <div className="skeleton h-7 w-28 ml-auto shrink-0 hidden sm:block" />
              </div>
            ))}
          </div>
        ) : filteredItems.length === 0 ? (
          allItems.length === 0 ? (
            /* ไม่มีข้อมูลจากระบบเลย — แยกกรณีคลังที่กรองไว้ (มีทางออก) กับไม่มีข้อมูลจริง */
            <div className="bg-white rounded-[20px] border border-[#E8ECEA] p-10 sm:p-16 text-center">
              <div className="w-14 h-14 rounded-full bg-black/[.04] flex items-center justify-center mx-auto mb-3 text-slate-400">
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M3.5 7.5L12 3l8.5 4.5v9L12 21l-8.5-4.5v-9Z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M3.5 7.5L12 12l8.5-4.5M12 12v9" />
                </svg>
              </div>
              <h3 className="text-base font-bold text-slate-800">ยังไม่มีรายการเบิก</h3>
              {selectedWarehouse !== "ALL" ? (
                <>
                  <p className="text-sm text-slate-500 mt-1">ไม่พบรายการในคลังที่เลือก — ลองดูทุกคลังสินค้า</p>
                  <button
                    type="button"
                    onClick={handleClearAllFilters}
                    className="min-h-[44px] px-5 mt-4 rounded-xl border border-[#D5DDD9] bg-white text-[15px] font-bold text-slate-700 hover:bg-black/[.03] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#053425] focus-visible:ring-offset-2"
                  >
                    ล้างตัวกรอง
                  </button>
                </>
              ) : (
                <p className="text-sm text-slate-500 mt-1">รายการจะแสดงที่นี่เมื่อมีการบันทึกเบิกสินค้าในระบบ</p>
              )}
            </div>
          ) : tagFilter === "PENDING" && !searchQuery.trim() ? (
            /* กรอง "รอนำเข้า" แล้วว่าง = นำเข้าครบแล้ว */
            <div className="bg-white rounded-[20px] border border-[#E8ECEA] p-10 sm:p-16 text-center">
              <div className="w-14 h-14 rounded-full bg-[#EAF2EE] border border-[#C9DFD4] flex items-center justify-center mx-auto mb-3 text-[#053425]">
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.5 12.5l5 5L19.5 7" />
                </svg>
              </div>
              <h3 className="text-base font-bold text-slate-800">นำเข้าครบแล้ว</h3>
              <p className="text-sm text-slate-500 mt-1 mb-4">ทุกรายการในช่วงเวลานี้นำเข้า Express เรียบร้อย</p>
              <button
                type="button"
                onClick={() => setTagFilter("ALL")}
                className="min-h-[44px] px-5 rounded-xl border border-[#D5DDD9] bg-white text-[15px] font-bold text-slate-700 hover:bg-black/[.03] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#053425] focus-visible:ring-offset-2"
              >
                ดูทั้งหมด
              </button>
            </div>
          ) : (
            /* ค้นหา/กรองแล้วไม่เจอ */
            <div className="bg-white rounded-[20px] border border-[#E8ECEA] p-10 sm:p-16 text-center">
              <div className="w-14 h-14 rounded-full bg-black/[.04] flex items-center justify-center mx-auto mb-3 text-slate-400">
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <h3 className="text-base font-bold text-slate-800 mb-4">
                {searchQuery.trim() ? `ไม่พบ "${searchQuery.trim()}"` : "ไม่พบรายการที่ตรงกับตัวกรอง"}
              </h3>
              <button
                type="button"
                onClick={handleClearAllFilters}
                className="min-h-[44px] px-5 rounded-xl border border-[#D5DDD9] bg-white text-[15px] font-bold text-slate-700 hover:bg-black/[.03] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#053425] focus-visible:ring-offset-2"
              >
                ล้างตัวกรอง
              </button>
            </div>
          )
        ) : (
          /* ตารางรายการเบิก */
          <div className="bg-white rounded-[20px] border border-[#E8ECEA] shadow-[0_1px_2px_rgba(16,24,40,0.05)] overflow-hidden print:rounded-none print:shadow-none print:border-black">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  {table.getHeaderGroups().map((headerGroup) => (
                    <TableRow
                      key={headerGroup.id}
                      className="bg-slate-50 hover:bg-slate-50 border-b border-[#E8ECEA] print:bg-white"
                    >
                      {headerGroup.headers.map((header) => (
                        <TableHead
                          key={header.id}
                          className={(header.column.columnDef.meta as { th?: string } | undefined)?.th ?? ""}
                        >
                          {header.isPlaceholder ? null : header.column.getCanSort() ? (
                            <button
                              type="button"
                              onClick={header.column.getToggleSortingHandler()}
                              className="inline-flex items-center gap-1 transition-colors hover:text-slate-900 cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#053425]"
                              title="คลิกเพื่อเรียงข้อมูล"
                            >
                              {flexRender(header.column.columnDef.header, header.getContext())}
                              <SortIcon dir={header.column.getIsSorted()} />
                            </button>
                          ) : (
                            flexRender(header.column.columnDef.header, header.getContext())
                          )}
                        </TableHead>
                      ))}
                    </TableRow>
                  ))}
                </TableHeader>
                <TableBody className="text-base">
                  {table.getRowModel().rows.map((row) => {
                    const item = row.original;
                    const tagged = taggedItemsMap.get(item.id);
                    const effectiveStatus: ExpressSyncStatus = tagged?.status || item.express_status || (item.status as ExpressSyncStatus) || "PENDING";
                    const isImported = effectiveStatus === "IMPORTED";

                    return (
                      <TableRow
                        key={row.id}
                        className={isImported ? "bg-[#EAF2EE] border-[#C9DFD4] hover:bg-[#DFEDE6]/70" : undefined}
                      >
                        {row.getVisibleCells().map((cell) => (
                          <TableCell
                            key={cell.id}
                            className={(cell.column.columnDef.meta as { td?: string } | undefined)?.td ?? ""}
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </TableCell>
                        ))}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* แบ่งหน้า — แสดงเมื่อมีมากกว่า 1 หน้า */}
            {totalPages > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-[#EEF1EF] print:hidden">
                <p className="text-base font-semibold text-slate-700">
                  แสดง {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filteredItems.length)} จาก{" "}
                  {filteredItems.length.toLocaleString()} รายการ
                </p>
                <nav className="flex flex-wrap items-center gap-1.5" aria-label="แบ่งหน้ารายการ">
                  <label className="flex items-center gap-2 text-base font-semibold text-slate-700 mr-2">
                    แถว/หน้า
                    <select
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setPage(1);
                      }}
                      className="min-h-[44px] px-3 rounded-xl text-base font-bold border border-[#E8ECEA] bg-white text-slate-800 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[#053425]"
                    >
                      {[10, 20, 50, 100].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => setPage(currentPage - 1)}
                    disabled={currentPage === 1}
                    className="min-h-[44px] px-4 rounded-xl text-base font-bold border transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed border-[#E8ECEA] bg-white text-slate-700 hover:border-[#5B8A74] hover:text-[#053425] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#053425] focus-visible:ring-offset-2"
                  >
                    ‹ ก่อนหน้า
                  </button>
                  {pageWindow[0] > 1 && (
                    <>
                      <button type="button" onClick={() => setPage(1)} className={pageBtnClass(false)}>1</button>
                      {pageWindow[0] > 2 && <span className="px-1 text-slate-400" aria-hidden="true">…</span>}
                    </>
                  )}
                  {pageWindow.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPage(p)}
                      aria-current={p === currentPage ? "page" : undefined}
                      className={pageBtnClass(p === currentPage)}
                    >
                      {p}
                    </button>
                  ))}
                  {pageWindow[pageWindow.length - 1] < totalPages && (
                    <>
                      {pageWindow[pageWindow.length - 1] < totalPages - 1 && (
                        <span className="px-1 text-slate-400" aria-hidden="true">…</span>
                      )}
                      <button type="button" onClick={() => setPage(totalPages)} className={pageBtnClass(false)}>
                        {totalPages}
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => setPage(currentPage + 1)}
                    disabled={currentPage === totalPages}
                    className="min-h-[44px] px-4 rounded-xl text-base font-bold border transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed border-[#E8ECEA] bg-white text-slate-700 hover:border-[#5B8A74] hover:text-[#053425] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#053425] focus-visible:ring-offset-2"
                  >
                    ถัดไป ›
                  </button>
                </nav>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

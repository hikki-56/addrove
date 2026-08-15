"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { Warehouse, Location, Product } from "@/types/models";
import { v4 as uuidv4 } from "uuid";
import { useTabAuth } from "@/context/TabAuthContext";
import {
  saveTransferNotification,
  getPendingTransferNotifications,
  markTransferNotificationAcknowledged,
  markTransferCancelled,
  markTransferCompleted,
  fetchAndSyncTransferNotifications,
  clearAllTransferNotifications,
  updateTransferTaskProgress,
  type TransferNotification,
} from "@/lib/transfer-notification-utils";
import { areBarcodesMatching } from "@/lib/barcode-utils";
import { normalizeWarehouseId, getDefaultLocationsForWarehouse } from "@/lib/warehouse-utils";

export const TransferFormSchema = z.object({
  product_id: z.string(),
  qty: z.number(),
  from_warehouse_id: z.string().min(1, "กรุณาเลือกโกดังต้นทาง"),
  to_warehouse_id: z.string().min(1, "กรุณาเลือกโกดังปลายทาง"),
  moved_by: z.string(),
  document_date: z.string(),
  reference_no: z.string().max(100),
  note: z.string().max(500),
  idempotency_key: z.string(),
});

export type TransferFormInput = z.infer<typeof TransferFormSchema>;

export interface SelectedTransferItem {
  product_id: string;
  product_name: string;
  sku: string;
  barcode?: string;
  stock_qty?: number;
  qty: number;
}

export function findMatchingProduct(t: Partial<TransferNotification> | null | undefined, products: Product[]): Product | undefined {
  if (!t || !products || products.length === 0) return undefined;

  const targetPid = (t.product_id || "").trim().toLowerCase();
  const targetSku = (t.sku || "").trim().toLowerCase().replace(/^prod-/, "");
  const targetBarcode = (t.barcode || "").trim().toLowerCase();
  const targetName = (t.product_name || "").trim().toLowerCase();
  const targetNote = (t.note || "").trim().toLowerCase();

  // 1. Direct ID / SKU / Barcode match (STRICT)
  const direct = products.find((prod) => {
    const pPid = (prod.product_id || "").trim().toLowerCase();
    const pSku = (prod.sku || "").trim().toLowerCase().replace(/^prod-/, "");
    const pBcode = (prod.barcode || "").trim().toLowerCase();

    if (targetPid && (pPid === targetPid || pSku === targetPid.replace(/^prod-/, ""))) return true;
    if (targetSku && targetSku !== "trf" && !targetSku.startsWith("trf-") && (pSku === targetSku || pPid === `prod-${targetSku}`)) return true;
    if (targetBarcode && targetBarcode !== "trf" && pBcode && pBcode === targetBarcode) return true;
    return false;
  });
  if (direct) return direct;

  // 2. Strict Clean-String Match
  const cleanName = targetName.replace(/[\s\-_#]/g, "");
  const cleanNote = targetNote.replace(/[\s\-_#]/g, "");

  return products.find((prod) => {
    const pName = (prod.product_name || "").replace(/[\s\-_#]/g, "").toLowerCase();
    const pSku = (prod.sku || "").replace(/[\s\-_#]/g, "").toLowerCase();

    if (pName && cleanName && cleanName !== "รายการย้ายสินค้า" && pName === cleanName) return true;
    if (pName && cleanNote && cleanNote === pName) return true;
    if (pSku && pSku.length >= 2 && (cleanName === pSku || cleanNote === pSku)) return true;
    return false;
  });
}

export const defaultStaff = [
  { id: "usr-staff-01", full_name: "สมชาย ใจดี", role: "WAREHOUSE_STAFF" },
  { id: "usr-staff-02", full_name: "สมศักดิ์ ขยันยิ่ง", role: "WAREHOUSE_STAFF" },
  { id: "usr-staff-03", full_name: "วิภาดา แสงทอง", role: "WAREHOUSE_STAFF" },
  { id: "usr-staff-04", full_name: "ณรงค์เดช ชัยชนะ", role: "WAREHOUSE_STAFF" },
  { id: "usr-staff-05", full_name: "กนกวรรณ รัตนรัตน์", role: "WAREHOUSE_STAFF" },
  { id: "usr-staff-06", full_name: "ธนพล วงษ์สว่าง", role: "WAREHOUSE_STAFF" },
];

export interface UseTransferMovementOptions {
  activeWhId: string;
  warehouses: Warehouse[];
  products: Product[];
  refreshData: () => void;
}

export function useTransferMovement({
  activeWhId,
  warehouses,
  products,
  refreshData,
}: UseTransferMovementOptions) {
  const { user: tabUser } = useTabAuth();
  const [activeMode, setActiveMode] = useState<"ADMIN_CREATE" | "STAFF_EXECUTE">("ADMIN_CREATE");
  const [submitted, setSubmitted] = useState(false);
  const [assignedStaff, setAssignedStaff] = useState("");
  const [error, setError] = useState("");
  const [pendingTasks, setPendingTasks] = useState<TransferNotification[]>([]);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [isCleaningUp, setIsCleaningUp] = useState(false);
  const [selectedTask, setSelectedTask] = useState<TransferNotification | null>(null);
  const [staffStep, setStaffStep] = useState<number>(1);
  const [staffScanProductInput, setStaffScanProductInput] = useState("");
  const [staffScanSourceLocationInput, setStaffScanSourceLocationInput] = useState("");
  const [staffScanDestLocationInput, setStaffScanDestLocationInput] = useState("");
  const [sourceLocations, setSourceLocations] = useState<Location[]>([]);
  const [destLocations, setDestLocations] = useState<Location[]>([]);
  const [scannedFromLocation, setScannedFromLocation] = useState("");
  const [scannedToLocation, setScannedToLocation] = useState("");
  const [sourceAllocations, setSourceAllocations] = useState<Array<{ location_id: string; location_name?: string; max_qty?: number; qty: number }>>([]);
  const [staffError, setStaffError] = useState("");
  const [staffSuccess, setStaffSuccess] = useState("");
  const [isStaffCameraOpen, setIsStaffCameraOpen] = useState(false);
  const [staffCameraTarget, setStaffCameraTarget] = useState<"PRODUCT" | "SOURCE_LOCATION" | "DEST_LOCATION">("PRODUCT");

  const staffProductInputRef = useRef<HTMLInputElement | null>(null);
  const staffSourceLocationInputRef = useRef<HTMLInputElement | null>(null);
  const staffDestLocationInputRef = useRef<HTMLInputElement | null>(null);
  const isStepTransitioningRef = useRef<boolean>(false);

  const form = useForm<TransferFormInput>({
    resolver: zodResolver(TransferFormSchema),
    defaultValues: {
      from_warehouse_id: activeWhId,
      to_warehouse_id: activeWhId === "wh-1" || activeWhId === "wh-01" ? "wh-2" : "wh-1",
      product_id: "",
      qty: 1,
      moved_by: "",
      document_date: new Date().toISOString().slice(0, 10),
      reference_no: "",
      note: "",
      idempotency_key: uuidv4(),
    },
  });

  const { register, handleSubmit, watch, setValue, reset, formState: { errors, isSubmitting } } = form;

  const watchProduct = watch("product_id");
  const watchFromWh = watch("from_warehouse_id");
  const watchToWh = watch("to_warehouse_id");
  const watchQty = watch("qty");
  const watchMovedBy = watch("moved_by");

  const [staffList, setStaffList] = useState<Array<{ id: string; full_name: string; role: string }>>(defaultStaff);

  // Fetch real users list from /api/users
  useEffect(() => {
    let isMounted = true;
    fetch("/api/users")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!isMounted || !json || !json.data || !Array.isArray(json.data)) return;
        const fetched: Array<{ id: string; full_name: string; role: string }> = json.data
          .filter((u: any) => u && u.active !== false)
          .map((u: any) => ({
            id: String(u.user_id || u.id || "").trim(),
            full_name: String(u.full_name || u.name || "").trim(),
            role: String(u.role || "WAREHOUSE_STAFF").trim(),
          }))
          .filter((u: any) => u.id && u.full_name);

        if (fetched.length > 0) {
          setStaffList(fetched);
        }
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, []);

  // Initialize from_warehouse_id and to_warehouse_id on initial mount or when active warehouse prop changes
  const isInitializedRef = useRef(false);
  const prevActiveWhPropRef = useRef(activeWhId);

  useEffect(() => {
    if (activeWhId && (!isInitializedRef.current || prevActiveWhPropRef.current !== activeWhId)) {
      isInitializedRef.current = true;
      prevActiveWhPropRef.current = activeWhId;
      setValue("from_warehouse_id", activeWhId);
      const otherWh = warehouses.find((w) => w.warehouse_id !== activeWhId)?.warehouse_id || (activeWhId === "wh-1" || activeWhId === "wh-01" ? "wh-2" : "wh-1");
      setValue("to_warehouse_id", otherWh);
    }
  }, [activeWhId, setValue, warehouses]);

  // When source warehouse changes, ensure destination warehouse is not the same
  useEffect(() => {
    if (watchFromWh && watchToWh === watchFromWh) {
      const otherWh = warehouses.find((w) => w.warehouse_id !== watchFromWh)?.warehouse_id || (watchFromWh === "wh-1" || watchFromWh === "wh-01" ? "wh-2" : "wh-1");
      setValue("to_warehouse_id", otherWh);
    }
  }, [watchFromWh, watchToWh, warehouses, setValue]);

  const [fromWhProducts, setFromWhProducts] = useState<Product[]>([]);

  // Fetch products belonging strictly to the selected source warehouse (watchFromWh)
  useEffect(() => {
    let isMounted = true;
    const targetWh = watchFromWh || activeWhId;
    if (!targetWh) return;

    fetch(`/api/products?warehouse_id=${encodeURIComponent(targetWh)}`)
      .then((res) => (res.ok ? res.json() : { data: [] }))
      .then((json) => {
        if (!isMounted) return;
        const list: Product[] = Array.isArray(json.data) ? json.data : json.data?.items || [];
        
        // Aggregate quantities across different locations for the same SKU
        const map = new Map<string, Product>();
        for (const p of list) {
          const normSku = (p.sku || "").trim().toLowerCase().replace(/^prod-/, "");
          const normId = (p.product_id || "").trim().toLowerCase().replace(/^prod-/, "");
          const key = normSku || normId;
          if (!key) continue;

          const qty = p.quantity ?? p.total_quantity ?? 0;
          const existing = map.get(key);

          if (!existing) {
            map.set(key, { ...p, quantity: qty, total_quantity: qty });
          } else {
            const existingQty = existing.quantity ?? existing.total_quantity ?? 0;
            const newQty = existingQty + qty;
            let combinedLoc = existing.location || "";
            if (p.location && p.location !== existing.location) {
              if (!combinedLoc) {
                combinedLoc = p.location;
              } else if (!combinedLoc.split(", ").includes(p.location)) {
                combinedLoc = `${combinedLoc}, ${p.location}`;
              }
            }
            map.set(key, { ...existing, quantity: newQty, total_quantity: newQty, location: combinedLoc });
          }
        }

        setFromWhProducts(Array.from(map.values()));
      })
      .catch((err) => console.error("Error fetching source warehouse products:", err));

    return () => {
      isMounted = false;
    };
  }, [watchFromWh, activeWhId]);

  const [selectedItems, setSelectedItems] = useState<SelectedTransferItem[]>([]);

  const addTransferItem = useCallback((prod: Product) => {
    const stockQty = prod.quantity ?? prod.total_quantity ?? 0;
    setSelectedItems((prev) => {
      const idx = prev.findIndex((i) => i.product_id === prod.product_id);
      if (idx >= 0) {
        const copy = [...prev];
        const maxQty = copy[idx].stock_qty ?? stockQty;
        const nextQty = Math.min(copy[idx].qty + 1, maxQty);
        copy[idx] = { ...copy[idx], qty: Math.max(1, nextQty) };
        return copy;
      }
      return [
        ...prev,
        {
          product_id: prod.product_id,
          product_name: prod.product_name,
          sku: prod.sku,
          barcode: prod.barcode,
          qty: stockQty > 0 ? 1 : 1,
          stock_qty: stockQty,
        },
      ];
    });
  }, []);

  const updateItemQty = useCallback((index: number, newQty: number) => {
    setSelectedItems((prev) => {
      const copy = [...prev];
      if (copy[index]) {
        const stockQty = copy[index].stock_qty;
        let qty = Math.max(1, newQty);
        if (stockQty !== undefined && stockQty !== null) {
          qty = Math.min(qty, Math.max(1, stockQty));
        }
        copy[index] = { ...copy[index], qty };
      }
      return copy;
    });
  }, []);

  const removeItem = useCallback((index: number) => {
    setSelectedItems((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const clearItems = useCallback(() => {
    setSelectedItems([]);
  }, []);

  // When source warehouse changes, reset selectedItems
  const prevFromWhRef = useRef(watchFromWh);
  useEffect(() => {
    if (prevFromWhRef.current && prevFromWhRef.current !== watchFromWh) {
      setValue("product_id", "");
      setSelectedItems([]);
    }
    prevFromWhRef.current = watchFromWh;
  }, [watchFromWh, setValue]);

  // Derived selected product from source warehouse items
  const activeProductList = fromWhProducts.length > 0 ? fromWhProducts : (products || []);
  const cleanSearchVal = (watchProduct || "").trim().toLowerCase();
  const selectedProduct = cleanSearchVal
    ? activeProductList.find(
        (p) =>
          p.product_id.toLowerCase() === cleanSearchVal ||
          p.sku.toLowerCase() === cleanSearchVal ||
          (p.barcode && p.barcode.trim().toLowerCase() === cleanSearchVal) ||
          p.product_id.toLowerCase() === `prod-${cleanSearchVal}`
      ) ||
      activeProductList.find(
        (p) =>
          (p.barcode && p.barcode.trim().toLowerCase().includes(cleanSearchVal)) ||
          (p.sku && p.sku.trim().toLowerCase().includes(cleanSearchVal)) ||
          (p.product_name && p.product_name.trim().toLowerCase().includes(cleanSearchVal))
      ) ||
      null
    : null;

  // Notification sync
  useEffect(() => {
    const updateTasks = () => {
      const staffFilter = tabUser?.role !== "ADMIN" ? tabUser?.name : undefined;
      setPendingTasks(getPendingTransferNotifications(staffFilter));
    };
    updateTasks();

    const fetchServerTransfers = () => {
      fetchAndSyncTransferNotifications().then(updateTasks);
    };

    fetchServerTransfers();
    const interval = setInterval(fetchServerTransfers, 2000);

    window.addEventListener("stockify-transfer-created", updateTasks);
    window.addEventListener("stockify-transfer-updated", updateTasks);
    window.addEventListener("storage", updateTasks);
    return () => {
      clearInterval(interval);
      window.removeEventListener("stockify-transfer-created", updateTasks);
      window.removeEventListener("stockify-transfer-updated", updateTasks);
      window.removeEventListener("storage", updateTasks);
    };
  }, [tabUser]);

  useEffect(() => {
    setSourceAllocations([]);
  }, [selectedTask]);

  useEffect(() => {
    if (tabUser?.role === "WAREHOUSE_STAFF") {
      setActiveMode("STAFF_EXECUTE");
    }
  }, [tabUser]);

  const handleCleanupHistory = async () => {
    if (!confirm("คุณต้องการเคลียร์รายการที่ทำเสร็จแล้วออกจากหน้าจอใช่หรือไม่?")) return;
    setIsCleaningUp(true);
    try {
      clearAllTransferNotifications();
      localStorage.removeItem("stockify_completed_transfers");
      setPendingTasks((prev) => prev.filter((t) => t.status === "PENDING"));
      window.dispatchEvent(new Event("stockify-transfer-updated"));
    } catch (e) {
      console.error("[CleanupHistory] Client cleanup error:", e);
    } finally {
      setIsCleaningUp(false);
    }
  };

  const handleCancelTransfer = async (e: React.MouseEvent, t: TransferNotification) => {
    e.stopPropagation();
    if (!confirm(`ยืนยันยกเลิกใบย้ายสินค้า ${t.doc_no}?`)) return;
    setCancellingId(t.id);
    try {
      const res = await fetch(`/api/movements/transfer/${t.id}/cancel`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: "ยกเลิกโดย Admin" }),
      });
      const json = await res.json();
      if (json.success) {
        markTransferCancelled(t.id);
        setPendingTasks((prev) => prev.filter((task) => task.id !== t.id));
        window.dispatchEvent(new Event("stockify-transfer-updated"));
      } else {
        alert(json.message || "ยกเลิกไม่สำเร็จ");
      }
    } catch {
      alert("เกิดข้อผิดพลาดในการเชื่อมต่อ");
    } finally {
      setCancellingId(null);
    }
  };

  const handleVerifyProductBarcode = (scannedCode: string) => {
    if (!selectedTask || isStepTransitioningRef.current) return;
    setStaffError("");
    setStaffSuccess("");

    const norm = (val?: string) => (val || "").trim().toLowerCase().replace(/[\s\-_#]/g, "");

    const scannedNorm = norm(scannedCode);
    if (!scannedNorm) {
      setStaffError("❌ กรุณาสแกนหรือระบุบาร์โค้ดสินค้า");
      return;
    }

    const matchedProduct = findMatchingProduct(selectedTask, products);

    // Candidates extracted strictly in order: 1. Barcode, 2. SKU, 3. Product ID
    const targetBarcode = selectedTask.barcode || matchedProduct?.barcode || "";
    const targetSku = selectedTask.sku || matchedProduct?.sku || "";
    const targetPid = selectedTask.product_id || matchedProduct?.product_id || "";

    const normBarcode = norm(targetBarcode);
    const normSku = norm(targetSku);
    const normPid = norm(targetPid).replace(/^prod/, "");

    // Exclude TRF document numbers or placeholders
    if (selectedTask.doc_no && norm(selectedTask.doc_no) === scannedNorm) {
      setStaffError(
        `❌ รหัสที่สแกนเป็นเลขที่ใบงาน (${scannedCode}) ไม่ใช่บาร์โค้ดสินค้า! กรุณาสแกนป้ายบาร์โค้ดบนตัวสินค้า`
      );
      return;
    }

    const isBarcodeMatch = Boolean(normBarcode && scannedNorm === normBarcode);
    const isSkuMatch = Boolean(normSku && scannedNorm === normSku);
    const isPidMatch = Boolean(normPid && (scannedNorm === normPid || scannedNorm === `prod${normPid}`));

    const isMatch = isBarcodeMatch || isSkuMatch || isPidMatch;

    // Check if task is missing barcode & product info completely
    if (!targetBarcode && !targetSku && !targetPid) {
      setStaffError("❌ ใบงานนี้ไม่มีข้อมูลบาร์โค้ดสินค้า กรุณาให้ผู้ดูแลสร้างใบงานใหม่หรือแก้ไขข้อมูลสินค้า");
      return;
    }

    if (isMatch) {
      setStaffSuccess(`✅ บาร์โค้ดสินค้าถูกต้องเรียบร้อย! ขั้นตอนถัดไป: สแกน/เลือกตำแหน่งต้นทางใน ${selectedTask.from_warehouse_name}`);
      setStaffScanProductInput("");
      setStaffScanSourceLocationInput("");

      isStepTransitioningRef.current = true;
      setTimeout(() => {
        isStepTransitioningRef.current = false;
      }, 500);

      const srcWhId = normalizeWarehouseId(selectedTask.from_warehouse_id || "");
      fetch(`/api/locations?warehouse_id=${srcWhId}`)
        .then((r) => r.json())
        .then((d) => {
          if (d.success && Array.isArray(d.data) && d.data.length > 0) {
            setSourceLocations(d.data.filter((l: Location) => l && l.active !== false));
          } else {
            setSourceLocations(getDefaultLocationsForWarehouse(srcWhId));
          }
        })
        .catch(() => {
          setSourceLocations(getDefaultLocationsForWarehouse(srcWhId));
        });

      setStaffStep(2);
      updateTransferTaskProgress(selectedTask.id, 2, "กำลังหยิบสินค้าต้นทาง");
    } else {
      const displayExpected = [targetBarcode, targetSku]
        .filter(Boolean)
        .filter((v, i, a) => a.indexOf(v) === i)
        .join(" / ");

      setStaffError(
        `❌ บาร์โค้ดไม่ตรงกับสินค้าที่ต้องย้าย! (ที่สแกน: "${scannedCode}" / ต้องการ: "${displayExpected || selectedTask.product_name}")`
      );
    }
  };

  const handleVerifySourceLocationBarcode = async (scannedCode: string, requestedQty?: number) => {
    if (!selectedTask || isStepTransitioningRef.current) return;
    setStaffError("");
    setStaffSuccess("");

    const norm = (val?: string) => (val || "").trim().toLowerCase().replace(/[\s\-_#]/g, "");

    const code = scannedCode.trim().toLowerCase();
    if (!code) {
      setStaffError(
        `❌ กรุณาสแกนหรือระบุรหัสตำแหน่งต้นทางใน "${selectedTask.from_warehouse_name}"`
      );
      return;
    }

    const srcWhId = normalizeWarehouseId(selectedTask.from_warehouse_id || "");
    let validLocs = (sourceLocations || []).filter(
      (l) => l && l.warehouse_id && normalizeWarehouseId(l.warehouse_id) === srcWhId
    );
    if (validLocs.length === 0) {
      validLocs = getDefaultLocationsForWarehouse(srcWhId);
    }

    const cleanCode = code.replace(/^loc-/, "").replace(/^wh-0?[0-9]-?/, "");

    const matchedLoc = validLocs.find((loc) => {
      const locId = (loc.location_id || "").trim().toLowerCase();
      const locCode = (loc.location_code || "").trim().toLowerCase();
      const locName = (loc.location_name || "").trim().toLowerCase();
      const shelfCode = ((loc as unknown as { shelf_code?: string }).shelf_code || "").trim().toLowerCase();
      const cleanLocCode = locCode.replace(/^loc-/, "").replace(/^wh-0?[0-9]-?/, "");

      return (
        code === locId ||
        code === locCode ||
        code === locName ||
        code === shelfCode ||
        (cleanLocCode && cleanCode === cleanLocCode)
      );
    });

    const targetLocId = matchedLoc
      ? (matchedLoc.shelf_code && (matchedLoc.shelf_code.trim().toLowerCase() === code || matchedLoc.shelf_code.trim().toLowerCase().replace(/^loc-/, "").replace(/^wh-0?[0-9]-?/, "") === cleanCode)
          ? matchedLoc.shelf_code.toUpperCase()
          : (matchedLoc.location_code && (matchedLoc.location_code.trim().toLowerCase() === code || matchedLoc.location_code.trim().toLowerCase().replace(/^loc-/, "").replace(/^wh-0?[0-9]-?/, "") === cleanCode)
              ? matchedLoc.location_code.toUpperCase()
              : scannedCode.trim().toUpperCase()))
      : scannedCode.trim().toUpperCase();
    const targetLocName = matchedLoc ? (matchedLoc.location_name || matchedLoc.location_code || targetLocId) : targetLocId;

    // Check picked total so far (excluding if re-picking same location)
    const existingPicks = sourceAllocations.filter((a) => a.location_id !== targetLocId);
    const currentPickedTotal = existingPicks.reduce((sum, a) => sum + a.qty, 0);
    const remainingNeeded = Math.max(0, selectedTask.qty - currentPickedTotal);

    if (remainingNeeded <= 0) {
      setStaffError(`❌ สแกนหยิบสินค้าครบจำนวนตามใบงานแล้ว (${selectedTask.qty.toLocaleString()} ชิ้น)`);
      return;
    }

    let availableLocStock = remainingNeeded;

    try {
      const prodRes = await fetch(`/api/products?warehouse_id=${srcWhId}`).catch(() => null);
      if (prodRes && prodRes.ok) {
        const prodData = await prodRes.json();
        const items = Array.isArray(prodData.data) ? prodData.data : prodData.data?.items || [];
        const normTargetSku = norm(selectedTask.sku || selectedTask.product_id);
        const matchedProductRows = items.filter((p: any) => {
          const pSku = norm(p.sku || p.product_id);
          return pSku === normTargetSku;
        });

        const targetNormLoc = norm(targetLocId);
        const locItem = matchedProductRows.find((p: any) => {
          const pLoc = norm(p.location || p.location_id || "");
          return pLoc === targetNormLoc || pLoc.includes(targetNormLoc) || targetNormLoc.includes(pLoc);
        });

        if (locItem && typeof locItem.quantity === "number") {
          availableLocStock = locItem.quantity;
        } else if (matchedProductRows.length === 1 && typeof matchedProductRows[0].quantity === "number") {
          availableLocStock = matchedProductRows[0].quantity;
        }
      }
    } catch {}

    if (availableLocStock <= 0) {
      setStaffError(`❌ ตำแหน่ง "${targetLocId}" ไม่มีสินค้าคงเหลือในคลัง`);
      return;
    }

    // Determine how much to take from this location
    let takeQty = Math.min(availableLocStock, remainingNeeded);
    if (requestedQty && requestedQty > 0) {
      takeQty = Math.min(requestedQty, availableLocStock, remainingNeeded);
    }

    if (takeQty <= 0) {
      setStaffError(`❌ ไม่สามารถหยิบสินค้าจากตำแหน่ง "${targetLocId}" ได้`);
      return;
    }

    const newAllocations = [
      ...existingPicks,
      { location_id: targetLocId, location_name: targetLocName, max_qty: availableLocStock, qty: takeQty },
    ];
    setSourceAllocations(newAllocations);
    setScannedFromLocation(targetLocId);

    const newPickedTotal = currentPickedTotal + takeQty;
    const newRemaining = Math.max(0, selectedTask.qty - newPickedTotal);

    setStaffScanSourceLocationInput("");

    if (newRemaining > 0) {
      setStaffSuccess(
        `✅ ตรวจพบตำแหน่ง "${targetLocId}" มีสินค้า ${availableLocStock.toLocaleString()} ชิ้น (เลือกหยิบ ${takeQty.toLocaleString()} ชิ้น) ยังขาดอีก ${newRemaining.toLocaleString()} ชิ้น กรุณาสแกนตำแหน่งถัดไป`
      );
    } else {
      setStaffSuccess(
        `✅ เลือกหยิบสินค้าครบตามจำนวน (${selectedTask.qty.toLocaleString()} ชิ้น) เรียบร้อย! สามารถปรับจำนวนในแต่ละตำแหน่ง หรือกดยืนยันเพื่อไปขั้นตอนถัดไป`
      );
    }
  };

  const handleUpdateSourceAllocationQty = (index: number, newQty: number) => {
    setStaffError("");
    setSourceAllocations((prev) => {
      const updated = [...prev];
      if (index >= 0 && index < updated.length) {
        const item = updated[index];
        const maxVal = item.max_qty || item.qty;
        const validQty = Math.max(1, Math.min(newQty, maxVal));
        updated[index] = { ...item, qty: validQty };
      }
      return updated;
    });
  };

  const handleProceedToDestStep = () => {
    if (!selectedTask) return;
    const totalPicked = sourceAllocations.reduce((sum, a) => sum + (a.qty || 0), 0);
    if (totalPicked < selectedTask.qty) {
      setStaffError(
        `❌ สินค้าที่เลือกยังไม่ครบตามใบงาน (เลือกแล้ว: ${totalPicked.toLocaleString()} / ต้องการ: ${selectedTask.qty.toLocaleString()} ชิ้น) กรุณาสแกนตำแหน่งเพิ่ม`
      );
      return;
    }
    if (totalPicked > selectedTask.qty) {
      setStaffError(
        `❌ จำนวนสินค้าที่ระบุ (${totalPicked.toLocaleString()} ชิ้น) เกินกว่าที่ต้องการย้าย (${selectedTask.qty.toLocaleString()} ชิ้น) กรุณาปรับลดจำนวนในช่องตัวเลข`
      );
      return;
    }

    setStaffError("");
    setStaffSuccess(
      `✅ ตำแหน่งต้นทางถูกต้องครบถ้วน! ขั้นตอนถัดไป: สแกน/เลือกตำแหน่งปลายทางใน ${selectedTask.to_warehouse_name}`
    );

    isStepTransitioningRef.current = true;
    setTimeout(() => {
      isStepTransitioningRef.current = false;
    }, 500);

    const destWhId = normalizeWarehouseId(selectedTask.to_warehouse_id || "");
    fetch(`/api/locations?warehouse_id=${destWhId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.success && Array.isArray(d.data) && d.data.length > 0) {
          setDestLocations(d.data.filter((l: Location) => l && l.active !== false));
        } else {
          setDestLocations(getDefaultLocationsForWarehouse(destWhId));
        }
      })
      .catch(() => {
        setDestLocations(getDefaultLocationsForWarehouse(destWhId));
      });

    setStaffStep(3);
    if (selectedTask?.id) {
      updateTransferTaskProgress(selectedTask.id, 3, "กำลังนำเข้าตำแหน่งปลายทาง");
    }
  };

  const handleRemoveSourceAllocation = (index: number) => {
    setSourceAllocations((prev) => prev.filter((_, i) => i !== index));
    setStaffSuccess("ลบรายการเลือกตำแหน่งเรียบร้อย");
  };

  const handleClearSourceAllocations = () => {
    setSourceAllocations([]);
    setStaffSuccess("ยกเลิกรายการตำแหน่งต้นทางทั้งหมดเรียบร้อย");
  };

  const handleVerifyDestinationLocationBarcode = async (scannedCode: string) => {
    if (!selectedTask || isStepTransitioningRef.current) return;
    setStaffError("");
    setStaffSuccess("");

    const code = scannedCode.trim().toLowerCase();
    if (!code) {
      setStaffError(
        `❌ กรุณาสแกนหรือระบุรหัสตำแหน่งปลายทางใน "${selectedTask.to_warehouse_name}"`
      );
      return;
    }

    const destWhId = normalizeWarehouseId(selectedTask.to_warehouse_id || "");
    let validLocs = (destLocations || []).filter(
      (l) => l && l.warehouse_id && normalizeWarehouseId(l.warehouse_id) === destWhId
    );
    if (validLocs.length === 0) {
      validLocs = getDefaultLocationsForWarehouse(destWhId);
    }

    const cleanCode = code.replace(/^loc-/, "").replace(/^wh-0?[0-9]-?/, "");

    const matchedLoc = validLocs.find((loc) => {
      const locId = (loc.location_id || "").trim().toLowerCase();
      const locCode = (loc.location_code || "").trim().toLowerCase();
      const locName = (loc.location_name || "").trim().toLowerCase();
      const shelfCode = ((loc as unknown as { shelf_code?: string }).shelf_code || "").trim().toLowerCase();
      const cleanLocCode = locCode.replace(/^loc-/, "").replace(/^wh-0?[0-9]-?/, "");

      return (
        code === locId ||
        code === locCode ||
        code === locName ||
        code === shelfCode ||
        (cleanLocCode && cleanCode === cleanLocCode)
      );
    });

    const targetToLocId = matchedLoc
      ? (matchedLoc.shelf_code && (matchedLoc.shelf_code.trim().toLowerCase() === code || matchedLoc.shelf_code.trim().toLowerCase().replace(/^loc-/, "").replace(/^wh-0?[0-9]-?/, "") === cleanCode)
          ? matchedLoc.shelf_code.toUpperCase()
          : (matchedLoc.location_code && (matchedLoc.location_code.trim().toLowerCase() === code || matchedLoc.location_code.trim().toLowerCase().replace(/^loc-/, "").replace(/^wh-0?[0-9]-?/, "") === cleanCode)
              ? matchedLoc.location_code.toUpperCase()
              : scannedCode.trim().toUpperCase()))
      : scannedCode.trim().toUpperCase();
    setScannedToLocation(targetToLocId);

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const storedToken =
        typeof window !== "undefined"
          ? sessionStorage.getItem("stockify_tab_token") ||
            localStorage.getItem("stockify_tab_token") ||
            (function () {
              try {
                return JSON.parse(sessionStorage.getItem("stockify_tab_session") || "{}")?.token;
              } catch {
                return null;
              }
            })()
          : null;

      if (storedToken) {
        headers["x-tab-token"] = storedToken;
        headers["Authorization"] = `Bearer ${storedToken}`;
      }

      const res = await fetch(`/api/movements/transfer/${selectedTask.id}/complete`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          from_location_id: sourceAllocations[0]?.location_id || scannedFromLocation,
          to_location_id: targetToLocId,
          source_allocations: sourceAllocations.length > 0 ? sourceAllocations.map(a => ({ location_id: a.location_id, qty: a.qty })) : undefined,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || json.message || "ดำเนินการปิดงานย้ายสินค้าไม่สำเร็จ");
      }

      // Mark completed ONLY after server API returns success: true
      setStaffError("");
      markTransferCompleted(selectedTask.id);
      setPendingTasks((prev) => prev.filter((t) => t.id !== selectedTask.id));
      setStaffStep(4);
      if (selectedTask?.id) {
        updateTransferTaskProgress(selectedTask.id, 4, "ย้ายสินค้าสำเร็จ");
      }
    } catch (err: any) {
      setStaffError(`❌ เกิดข้อผิดพลาด: ${err.message || "ไม่สามารถย้ายสินค้าได้"}`);
    }
  };

  const onSubmit = async (data: TransferFormInput) => {
    setError("");

    if (data.from_warehouse_id === data.to_warehouse_id) {
      setError("โกดังต้นทางและโกดังปลายทางต้องไม่ซ้ำกัน");
      return;
    }

    let itemsToProcess = [...selectedItems];
    if (itemsToProcess.length === 0 && data.product_id) {
      const prod = activeProductList.find((p) => p.product_id === data.product_id);
      if (prod) {
        itemsToProcess.push({
          product_id: prod.product_id,
          product_name: prod.product_name,
          sku: prod.sku,
          barcode: prod.barcode,
          stock_qty: prod.quantity ?? prod.total_quantity ?? 0,
          qty: Number(data.qty) || 1,
        });
      }
    }

    if (itemsToProcess.length === 0) {
      setError("กรุณาค้นหาและเลือกสินค้าที่ต้องการโอนอย่างน้อย 1 รายการ");
      return;
    }

    for (const item of itemsToProcess) {
      const stockQty = item.stock_qty;
      if (stockQty !== undefined && stockQty !== null && item.qty > stockQty) {
        setError(`จำนวนที่จะโอนสำหรับ "${item.product_name}" (${item.qty} ชิ้น) เกินกว่าจำนวนที่มีในโกดังต้นทาง (คงเหลือ ${stockQty.toLocaleString()} ชิ้น)`);
        return;
      }
    }

    try {
      const fromWhName = warehouses.find((w) => w.warehouse_id === data.from_warehouse_id)?.warehouse_name || data.from_warehouse_id;
      const toWhName = warehouses.find((w) => w.warehouse_id === data.to_warehouse_id)?.warehouse_name || data.to_warehouse_id;

      const createdDocs: any[] = [];
      const errors: string[] = [];

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const storedToken =
        typeof window !== "undefined"
          ? sessionStorage.getItem("stockify_tab_token") ||
            localStorage.getItem("stockify_tab_token") ||
            (function () {
              try {
                return JSON.parse(sessionStorage.getItem("stockify_tab_session") || "{}")?.token;
              } catch {
                return null;
              }
            })()
          : null;

      if (storedToken) {
        headers["x-tab-token"] = storedToken;
        headers["Authorization"] = `Bearer ${storedToken}`;
      }

      const baseIdemKey = data.idempotency_key && data.idempotency_key.trim() ? data.idempotency_key.trim() : uuidv4();
      const rawMovedBy = data.moved_by && data.moved_by.trim() ? data.moved_by.trim() : "พนักงาน";
      const matchedStaff =
        staffList.find((s) => s.id === rawMovedBy || s.full_name === rawMovedBy) ||
        defaultStaff.find((s) => s.id === rawMovedBy || s.full_name === rawMovedBy);
      const assignedUserId = matchedStaff ? matchedStaff.id : (rawMovedBy.startsWith("usr-") || rawMovedBy.startsWith("user-") ? rawMovedBy : "");
      const assignedName = matchedStaff ? matchedStaff.full_name : (rawMovedBy || "พนักงาน");
      const docDateVal = data.document_date && data.document_date.trim() ? data.document_date.trim() : new Date().toISOString().slice(0, 10);

      for (let i = 0; i < itemsToProcess.length; i++) {
        const item = itemsToProcess[i];
        const res = await fetch("/api/movements/transfer", {
          method: "POST",
          headers,
          body: JSON.stringify({
            ...data,
            product_id: item.product_id,
            qty: item.qty,
            moved_by: assignedName,
            assigned_to_user_id: assignedUserId,
            assigned_to_name: assignedName,
            document_date: docDateVal,
            idempotency_key: `${baseIdemKey}-${i}`,
          }),
        });

        const json = await res.json();

        if (!res.ok || !json.success || !json.data) {
          const errMsg = json.error || json.message || "สร้างใบย้ายสินค้าไม่สำเร็จ";
          errors.push(`"${item.product_name}": ${errMsg}`);
          continue;
        }

        const realDoc = json.data;
        createdDocs.push(realDoc);

        // Save notification strictly using server document_id and document_no
        const notif: TransferNotification = {
          id: realDoc.document_id,
          doc_no: realDoc.document_no || `TRF-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`,
          product_id: item.product_id,
          sku: item.sku || item.product_id,
          product_name: item.product_name || `สินค้า ${item.product_id}`,
          barcode: item.barcode || "",
          qty: item.qty,
          from_warehouse_id: data.from_warehouse_id,
          from_warehouse_name: fromWhName,
          to_warehouse_id: data.to_warehouse_id,
          to_warehouse_name: toWhName,
          created_by: tabUser?.name || "Admin",
          created_at: realDoc.created_at || new Date().toISOString(),
          status: "PENDING",
          moved_by: assignedName,
          assigned_to_user_id: assignedUserId,
          assigned_to_name: assignedName,
        };

        saveTransferNotification(notif);
      }

      if (errors.length > 0) {
        if (createdDocs.length === 0) {
          setError(`❌ ไม่สามารถสร้างใบสั่งย้ายสินค้าได้:\n${errors.join("\n")}`);
          return;
        }
        setError(`⚠️ สร้างสำเร็จ ${createdDocs.length} รายการ แต่พบข้อผิดพลาดในบางรายการ:\n${errors.join("\n")}`);
      }

      refreshData();
      setSelectedItems([]);
      setSubmitted(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "ไม่สามารถเชื่อมต่อระบบได้ กรุณาลองใหม่อีกครั้ง";
      setError(msg);
    }
  };

  const resetForm = () => {
    refreshData();
    setSubmitted(false);
    reset({
      from_warehouse_id: activeWhId,
      to_warehouse_id: activeWhId === "wh-1" || activeWhId === "wh-01" ? "wh-2" : "wh-1",
      product_id: "",
      qty: 1,
      moved_by: "",
      document_date: new Date().toISOString().slice(0, 10),
      reference_no: "",
      note: "",
      idempotency_key: uuidv4(),
    });
  };

  return {
    activeMode,
    setActiveMode,
    tabUser,
    form,
    register,
    handleSubmit,
    watch,
    setValue,
    errors,
    isSubmitting,
    submitted,
    error,
    setError,
    pendingTasks,
    cancellingId,
    isCleaningUp,
    selectedTask,
    setSelectedTask,
    staffStep,
    setStaffStep,
    staffScanProductInput,
    setStaffScanProductInput,
    staffScanSourceLocationInput,
    setStaffScanSourceLocationInput,
    staffScanDestLocationInput,
    setStaffScanDestLocationInput,
    sourceLocations,
    destLocations,
    staffError,
    staffSuccess,
    isStaffCameraOpen,
    setIsStaffCameraOpen,
    staffCameraTarget,
    setStaffCameraTarget,
    staffProductInputRef,
    staffSourceLocationInputRef,
    staffDestLocationInputRef,
    staffList,
    fromWhProducts,
    selectedItems,
    addTransferItem,
    updateItemQty,
    removeItem,
    clearItems,
    watchProduct,
    watchFromWh,
    watchToWh,
    watchQty,
    watchMovedBy,
    selectedProduct,
    handleCleanupHistory,
    handleCancelTransfer,
    sourceAllocations,
    handleUpdateSourceAllocationQty,
    handleProceedToDestStep,
    handleRemoveSourceAllocation,
    handleClearSourceAllocations,
    handleVerifyProductBarcode,
    handleVerifySourceLocationBarcode,
    handleVerifyDestinationLocationBarcode,
    onSubmit,
    resetForm,
  };
}

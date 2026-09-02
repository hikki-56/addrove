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
  getTransferNotifications,
  markTransferNotificationAcknowledged,
  markTransferCancelled,
  markTransferWaitingApproval,
  markTransferCompleted,
  fetchAndSyncTransferNotifications,
  clearAllTransferNotifications,
  updateTransferTaskProgress,
  type TransferNotification,
} from "@/lib/transfer-notification-utils";
import { areBarcodesMatching } from "@/lib/barcode-utils";
import { normalizeWarehouseId, getDefaultLocationsForWarehouse } from "@/lib/warehouse-utils";
import { tagExpressItem } from "@/lib/express-tag-utils";

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
  location?: string;
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

export function areTasksEqual(a: TransferNotification[], b: TransferNotification[]): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const t1 = a[i];
    const t2 = b[i];
    if (
      t1.id !== t2.id ||
      t1.status !== t2.status ||
      t1.current_step !== t2.current_step ||
      t1.current_step_text !== t2.current_step_text ||
      t1.qty !== t2.qty ||
      t1.product_id !== t2.product_id ||
      t1.sku !== t2.sku ||
      t1.barcode !== t2.barcode ||
      t1.from_warehouse_id !== t2.from_warehouse_id ||
      t1.to_warehouse_id !== t2.to_warehouse_id ||
      t1.from_location_id !== t2.from_location_id ||
      t1.to_location_id !== t2.to_location_id
    ) {
      return false;
    }
  }
  return true;
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
  const [activeMode, setActiveMode] = useState<"ADMIN_CREATE" | "STAFF_EXECUTE" | "WAITING_APPROVAL">(
    () => (tabUser?.role === "APPROVER" ? "WAITING_APPROVAL" : "ADMIN_CREATE")
  );

  useEffect(() => {
    if (tabUser?.role === "APPROVER") {
      setActiveMode("WAITING_APPROVAL");
    }
  }, [tabUser?.role]);
  const [submitted, setSubmitted] = useState(false);
  const [assignedStaff, setAssignedStaff] = useState("");
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [pendingTasks, setPendingTasks] = useState<TransferNotification[]>([]);
  const [waitingApprovalTasks, setWaitingApprovalTasks] = useState<TransferNotification[]>([]);
  const [approvingId, setApprovingId] = useState<string | null>(null);
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
  const [isSubmittingTransfer, setIsSubmittingTransfer] = useState(false);
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
      .catch(() => { });

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
    setSuccessMessage("");
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
          location: prod.location || "",
        },
      ];
    });
  }, []);

  const updateItemQty = useCallback((index: number, newQty: number) => {
    setSelectedItems((prev) => {
      const copy = [...prev];
      if (copy[index]) {
        const stockQty = copy[index].stock_qty;
        let qty = Math.max(0, newQty);
        if (stockQty !== undefined && stockQty !== null && stockQty > 0) {
          qty = Math.min(qty, stockQty);
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
      const all = getTransferNotifications();
      const isAdmin = tabUser?.role === "ADMIN" || tabUser?.role === "APPROVER";
      const isStaff = !isAdmin;

      // If staff, strictly filter by the active warehouse they scanned into
      const pending = isStaff
        ? getPendingTransferNotifications(tabUser?.name, activeWhId)
        : getPendingTransferNotifications(undefined, undefined);

      const waiting = all.filter((t) => t && t.status === "WAITING_APPROVAL");

      setPendingTasks((prev) => (areTasksEqual(prev, pending) ? prev : pending));
      setWaitingApprovalTasks((prev) => (areTasksEqual(prev, waiting) ? prev : waiting));
    };
    updateTasks();

    const fetchServerTransfers = () => {
      fetchAndSyncTransferNotifications().then(updateTasks);
    };

    fetchServerTransfers();
    const interval = setInterval(fetchServerTransfers, 3000);

    window.addEventListener("stockify-transfer-created", updateTasks);
    window.addEventListener("stockify-transfer-updated", updateTasks);
    window.addEventListener("stockify-warehouse-changed", updateTasks);
    window.addEventListener("storage", updateTasks);
    return () => {
      clearInterval(interval);
      window.removeEventListener("stockify-transfer-created", updateTasks);
      window.removeEventListener("stockify-transfer-updated", updateTasks);
      window.removeEventListener("stockify-warehouse-changed", updateTasks);
      window.removeEventListener("storage", updateTasks);
    };
  }, [tabUser, activeWhId]);

  useEffect(() => {
    setSourceAllocations([]);
    setScannedToLocation("");
    if (selectedTask?.to_warehouse_id) {
      const destWhId = normalizeWarehouseId(selectedTask.to_warehouse_id);
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
    }
  }, [selectedTask]);

  const handleCleanupHistory = async () => {
    if (!confirm("คุณต้องการเคลียร์รายการที่ทำเสร็จแล้วออกจากหน้าจอใช่หรือไม่?")) return;
    setIsCleaningUp(true);
    try {
      clearAllTransferNotifications();
      localStorage.removeItem("stockify_completed_transfers");
      setPendingTasks((prev) => prev.filter((t) => t.status === "PENDING"));
      setWaitingApprovalTasks((prev) => prev.filter((t) => t.status === "WAITING_APPROVAL"));
      window.dispatchEvent(new Event("stockify-transfer-updated"));
    } catch (e) {
      console.error("[CleanupHistory] Client cleanup error:", e);
    } finally {
      setIsCleaningUp(false);
    }
  };

  const handleCancelTransfer = async (
    eOrTask: React.MouseEvent | TransferNotification,
    taskParam?: TransferNotification
  ) => {
    if ("stopPropagation" in eOrTask && typeof eOrTask.stopPropagation === "function") {
      eOrTask.stopPropagation();
    }
    const t = taskParam || (eOrTask as TransferNotification);
    if (!t || !t.id) return;
    if (!confirm(`ยืนยันยกเลิกใบเบิกสินค้า ${t.doc_no}?`)) return;

    // --- OPTIMISTIC UI: Instant response in 0.05s ---
    markTransferCancelled(t.id);
    setPendingTasks((prev) => prev.filter((task) => task.id !== t.id));
    setWaitingApprovalTasks((prev) => prev.filter((task) => task.id !== t.id));
    window.dispatchEvent(new Event("stockify-transfer-updated"));

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

      const res = await fetch(`/api/movements/transfer/${t.id}/cancel`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ note: "ยกเลิกโดย Admin" }),
      });
      const json = await res.json();
      if (!json.success) {
        // Rollback
        setPendingTasks((prev) => [t, ...prev.filter((item) => item.id !== t.id)]);
        window.dispatchEvent(new Event("stockify-transfer-updated"));
        alert(`❌ ยกเลิกไม่สำเร็จ: ${json.message || "เกิดข้อผิดพลาด"}`);
      }
    } catch {
      setPendingTasks((prev) => [t, ...prev.filter((item) => item.id !== t.id)]);
      window.dispatchEvent(new Event("stockify-transfer-updated"));
      alert("❌ เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์");
    }
  };

  const handleApproveTransfer = async (t: TransferNotification) => {
    if (!confirm(`ยืนยันอนุมัติการเบิกสินค้า ${t.doc_no} และบันทึกยอดเข้าสต็อกจริงใช่หรือไม่?`)) return;

    // --- OPTIMISTIC UI: Instant response in 0.05s ---
    markTransferCompleted(t.id);
    setWaitingApprovalTasks((prev) => prev.filter((item) => item.id !== t.id));
    setPendingTasks((prev) => prev.filter((item) => item.id !== t.id));

    try {
      tagExpressItem({
        id: `iss_trf-mov-${t.id}_${t.sku}_0`,
        type: "ISSUE",
        tag: "เบิกสินค้าเข้า Express",
        status: "PENDING",
        sku: t.sku,
        barcode: t.barcode || t.sku || "",
        product_name: t.product_name || t.sku || "สินค้า",
        quantity: t.qty,
        location: t.from_location_id || "-",
        warehouse: t.from_warehouse_name || "โกดัง",
        warehouse_code: t.from_warehouse_id || "01",
        document_no: t.doc_no || "TRF",
        document_date: new Date().toISOString().slice(0, 10),
      });

      tagExpressItem({
        id: `trf_doc_${t.id}_${t.sku}_0`,
        type: "TRANSFER",
        tag: "ย้ายสินค้าเข้า Express",
        status: "PENDING",
        sku: t.sku,
        barcode: t.barcode || t.sku || "",
        product_name: t.product_name || t.sku || "สินค้า",
        quantity: t.qty,
        location: t.to_location_id || t.from_location_id || "-",
        warehouse: t.from_warehouse_name || "โกดัง",
        warehouse_code: t.from_warehouse_id || "01",
        document_no: t.doc_no || "TRF",
        document_date: new Date().toISOString().slice(0, 10),
      });
    } catch { }

    window.dispatchEvent(new Event("stockify-transfer-updated"));
    window.dispatchEvent(new Event("stockify-express-tags-updated"));

    // Background server sync
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

      const res = await fetch(`/api/movements/transfer/${t.id}/approve`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          from_location_id: t.from_location_id,
          to_location_id: t.to_location_id,
          source_allocations: t.source_allocations,
        }),
      });
      const json = await res.json();
      if (!json.success) {
        // Rollback optimistic state if server failed
        console.error("[Optimistic Transfer Approval] Server error:", json.message);
        setWaitingApprovalTasks((prev) => [t, ...prev.filter((item) => item.id !== t.id)]);
        window.dispatchEvent(new Event("stockify-transfer-updated"));
        alert(`❌ อนุมัติไม่สำเร็จ: ${json.message || "เกิดข้อผิดพลาดจากเซิร์ฟเวอร์"}`);
      } else {
        refreshData();
      }
    } catch (err: any) {
      console.error("[Optimistic Transfer Approval] Network error:", err);
      setWaitingApprovalTasks((prev) => [t, ...prev.filter((item) => item.id !== t.id)]);
      window.dispatchEvent(new Event("stockify-transfer-updated"));
      alert("❌ เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์");
    }
  };

  const handleRejectTransfer = async (e: React.MouseEvent, t: TransferNotification) => {
    e.stopPropagation();
    if (!confirm(`ยืนยันปฏิเสธใบย้ายสินค้า ${t.doc_no}?`)) return;

    // --- OPTIMISTIC UI ---
    markTransferCancelled(t.id);
    setWaitingApprovalTasks((prev) => prev.filter((task) => task.id !== t.id));
    window.dispatchEvent(new Event("stockify-transfer-updated"));

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const storedToken =
        typeof window !== "undefined"
          ? sessionStorage.getItem("stockify_tab_token") ||
          localStorage.getItem("stockify_tab_token")
          : null;

      if (storedToken) {
        headers["x-tab-token"] = storedToken;
        headers["Authorization"] = `Bearer ${storedToken}`;
      }

      const res = await fetch(`/api/movements/transfer/${t.id}/reject`, {
        method: "POST",
        headers,
        body: JSON.stringify({ note: "ปฏิเสธโดย Admin" }),
      });
      const json = await res.json();
      if (!json.success) {
        setWaitingApprovalTasks((prev) => [t, ...prev.filter((item) => item.id !== t.id)]);
        window.dispatchEvent(new Event("stockify-transfer-updated"));
        alert(`❌ ปฏิเสธไม่สำเร็จ: ${json.message || "เกิดข้อผิดพลาด"}`);
      }
    } catch {
      setWaitingApprovalTasks((prev) => [t, ...prev.filter((item) => item.id !== t.id)]);
      window.dispatchEvent(new Event("stockify-transfer-updated"));
      alert("❌ เกิดข้อผิดพลาดในการเชื่อมต่อ");
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

    const is4Digit = /^\d{4}$/.test(scannedNorm);
    const digitsBarcode = targetBarcode.replace(/\D/g, "");
    const digitsSku = targetSku.replace(/\D/g, "");

    const isBarcode4Match = Boolean(
      is4Digit && (
        (normBarcode && (normBarcode.endsWith(scannedNorm) || digitsBarcode.endsWith(scannedNorm))) ||
        (!normBarcode && normSku && (normSku.endsWith(scannedNorm) || digitsSku.endsWith(scannedNorm)))
      )
    );

    const isBarcodeMatch = Boolean(normBarcode && scannedNorm === normBarcode);
    const isSkuMatch = Boolean(normSku && scannedNorm === normSku);
    const isPidMatch = Boolean(normPid && (scannedNorm === normPid || scannedNorm === `prod${normPid}`));

    const isMatch = isBarcodeMatch || isSkuMatch || isPidMatch || isBarcode4Match;

    // Check if task is missing barcode & product info completely
    if (!targetBarcode && !targetSku && !targetPid) {
      setStaffError("❌ ใบงานนี้ไม่มีข้อมูลบาร์โค้ดสินค้า กรุณาให้ผู้ดูแลสร้างใบงานใหม่หรือแก้ไขข้อมูลสินค้า");
      return;
    }

    if (isMatch) {
      // ขั้นตอนที่ 2 (สแกนต้นทาง) ถูกคอมเมนต์ไว้ชั่วคราว -> ข้ามไปขั้นตอนปลายทางทันที
      setStaffSuccess(`✅ บาร์โค้ดสินค้าถูกต้องเรียบร้อย! ขั้นตอนถัดไป: สแกน/เลือกตำแหน่งปลายทางใน ${selectedTask.to_warehouse_name}`);
      setStaffScanProductInput("");
      setStaffScanDestLocationInput("");

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
      updateTransferTaskProgress(selectedTask.id, 3, "กำลังนำเข้าตำแหน่งปลายทาง");
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

    const cleanCode = code.replace(/^loc-/, "").replace(/^wh-0?[0-9]-?/, "").replace(/[\s\-_#]/g, "");

    const matchedLoc = validLocs.find((loc) => {
      const locId = (loc.location_id || "").trim().toLowerCase();
      const locCode = (loc.location_code || "").trim().toLowerCase();
      const locName = (loc.location_name || "").trim().toLowerCase();
      const shelfCode = ((loc as unknown as { shelf_code?: string }).shelf_code || "").trim().toLowerCase();

      const cleanLocId = locId.replace(/^loc-/, "").replace(/^wh-0?[0-9]-?/, "").replace(/[\s\-_#]/g, "");
      const cleanLocCode = locCode.replace(/^loc-/, "").replace(/^wh-0?[0-9]-?/, "").replace(/[\s\-_#]/g, "");
      const cleanShelfCode = shelfCode.replace(/^loc-/, "").replace(/^wh-0?[0-9]-?/, "").replace(/[\s\-_#]/g, "");
      const cleanLocName = locName.replace(/[\s\-_#]/g, "");

      return (
        code === locId ||
        code === locCode ||
        code === locName ||
        code === shelfCode ||
        (cleanLocCode && cleanCode === cleanLocCode) ||
        (cleanShelfCode && cleanCode === cleanShelfCode) ||
        (cleanLocId && cleanCode === cleanLocId) ||
        (cleanLocName && cleanCode === cleanLocName)
      );
    });

    if (!matchedLoc) {
      const sampleNames = validLocs
        .map((l) => l.location_code || l.location_name)
        .filter(Boolean)
        .slice(0, 4)
        .join(", ");

      setStaffError(
        `❌ ไม่พบตำแหน่ง/ชั้นวาง "${scannedCode}" ใน "${selectedTask.from_warehouse_name}" กรุณาสแกนชั้นวางที่มีอยู่จริงในโกดังนี้${sampleNames ? ` (เช่น ${sampleNames})` : ""}`
      );
      return;
    }

    const targetLocId = (
      matchedLoc.location_code ||
      matchedLoc.location_name ||
      matchedLoc.location_id
    ).toUpperCase();
    const targetLocName = matchedLoc.location_name || matchedLoc.location_code || targetLocId;

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
    } catch { }

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

    // If local state hasn't loaded yet, fetch from API
    if (validLocs.length === 0) {
      try {
        const res = await fetch(`/api/locations?warehouse_id=${destWhId}`);
        const data = await res.json();
        if (data.success && Array.isArray(data.data) && data.data.length > 0) {
          validLocs = data.data.filter((l: Location) => l && l.active !== false);
          setDestLocations(validLocs);
        }
      } catch { }
    }

    if (validLocs.length === 0) {
      validLocs = getDefaultLocationsForWarehouse(destWhId);
    }

    const cleanCode = code.replace(/^loc-/, "").replace(/^wh-0?[0-9]-?/, "").replace(/[\s\-_#]/g, "");

    const matchedLoc = validLocs.find((loc) => {
      const locId = (loc.location_id || "").trim().toLowerCase();
      const locCode = (loc.location_code || "").trim().toLowerCase();
      const locName = (loc.location_name || "").trim().toLowerCase();
      const shelfCode = ((loc as unknown as { shelf_code?: string }).shelf_code || "").trim().toLowerCase();

      const cleanLocId = locId.replace(/^loc-/, "").replace(/^wh-0?[0-9]-?/, "").replace(/[\s\-_#]/g, "");
      const cleanLocCode = locCode.replace(/^loc-/, "").replace(/^wh-0?[0-9]-?/, "").replace(/[\s\-_#]/g, "");
      const cleanShelfCode = shelfCode.replace(/^loc-/, "").replace(/^wh-0?[0-9]-?/, "").replace(/[\s\-_#]/g, "");
      const cleanLocName = locName.replace(/[\s\-_#]/g, "");

      return (
        code === locId ||
        code === locCode ||
        code === locName ||
        code === shelfCode ||
        (cleanLocCode && cleanCode === cleanLocCode) ||
        (cleanShelfCode && cleanCode === cleanShelfCode) ||
        (cleanLocId && cleanCode === cleanLocId) ||
        (cleanLocName && cleanCode === cleanLocName)
      );
    });

    if (!matchedLoc) {
      const sampleNames = validLocs
        .map((l) => l.location_code || l.location_name)
        .filter(Boolean)
        .slice(0, 4)
        .join(", ");

      setScannedToLocation("");
      setStaffError(
        `❌ ไม่พบตำแหน่ง/ชั้นวาง "${scannedCode}" ใน "${selectedTask.to_warehouse_name}" กรุณาสแกนชั้นวางที่มีอยู่จริงในโกดังนี้${sampleNames ? ` (เช่น ${sampleNames})` : ""}`
      );
      return;
    }

    const targetToLocId = (
      matchedLoc.location_code ||
      matchedLoc.location_name ||
      matchedLoc.location_id
    ).toUpperCase();

    setScannedToLocation(targetToLocId);
    setStaffScanDestLocationInput(targetToLocId);
    setStaffError("");
    setStaffSuccess(
      `✅ สแกนชั้นวางปลายทาง "${targetToLocId}" ใน "${selectedTask.to_warehouse_name}" ถูกต้อง กรุณากดยืนยันการเบิก`
    );
  };

  const handleSubmitTransfer = async () => {
    if (!selectedTask || isSubmittingTransfer) return;
    const targetToLocId = (scannedToLocation || staffScanDestLocationInput).trim().toUpperCase();
    if (!targetToLocId) {
      setStaffError(
        `❌ กรุณาสแกนหรือระบุตำแหน่งปลายทางใน "${selectedTask.to_warehouse_name}" ก่อนกดยืนยัน`
      );
      return;
    }

    // Re-verify that target location actually exists in dest warehouse
    const destWhId = normalizeWarehouseId(selectedTask.to_warehouse_id || "");
    const validLocs = (destLocations || []).filter(
      (l) => l && l.warehouse_id && normalizeWarehouseId(l.warehouse_id) === destWhId
    );
    if (validLocs.length > 0) {
      const c = targetToLocId.toLowerCase().replace(/[\s\-_#]/g, "");
      const isRealLoc = validLocs.some((loc) => {
        const locId = (loc.location_id || "").toLowerCase().replace(/[\s\-_#]/g, "");
        const locCode = (loc.location_code || "").toLowerCase().replace(/[\s\-_#]/g, "");
        const locName = (loc.location_name || "").toLowerCase().replace(/[\s\-_#]/g, "");
        return c === locId || c === locCode || c === locName;
      });

      if (!isRealLoc) {
        setStaffError(
          `❌ ตำแหน่ง "${targetToLocId}" ไม่ใช่ตำแหน่งจริงใน "${selectedTask.to_warehouse_name}" กรุณาสแกนตำแหน่งที่มีอยู่จริง`
        );
        return;
      }
    }

    setIsSubmittingTransfer(true);
    setStaffError("");
    setStaffSuccess("");

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

      const res = await fetch(`/api/movements/transfer/${selectedTask.id}/submit`, {
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
        throw new Error(json.error || json.message || "ส่งข้อมูลการย้ายสินค้าไม่สำเร็จ");
      }

      setStaffError("");
      const moverStaffName = tabUser?.name || "พนักงาน";
      const moverStaffId = tabUser?.id || "";
      markTransferWaitingApproval(selectedTask.id, {
        from_location_id: sourceAllocations[0]?.location_id || scannedFromLocation,
        to_location_id: targetToLocId,
        source_allocations: sourceAllocations.length > 0 ? sourceAllocations.map(a => ({ location_id: a.location_id, qty: a.qty })) : undefined,
        moved_by: moverStaffName,
        assigned_to_name: moverStaffName,
        assigned_to_user_id: moverStaffId,
      });
      setPendingTasks((prev) => prev.filter((t) => t.id !== selectedTask.id));
      setStaffStep(4);
      if (selectedTask?.id) {
        updateTransferTaskProgress(selectedTask.id, 4, "ย้ายสินค้าแล้ว (รอ Admin อนุมัติ)");
      }
    } catch (err: any) {
      setStaffError(`❌ เกิดข้อผิดพลาด: ${err.message || "ไม่สามารถย้ายสินค้าได้"}`);
    } finally {
      setIsSubmittingTransfer(false);
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
      const createdNotifs: TransferNotification[] = [];
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

      // Always generate a fresh unique idempotency base key on every submission attempt to prevent key conflict
      const baseIdemKey = uuidv4();
      const creatorId = tabUser?.id || "admin";
      const creatorName = tabUser?.name || "ผู้สร้างรายการ";
      const docDateVal = data.document_date && data.document_date.trim() ? data.document_date.trim() : new Date().toISOString().slice(0, 10);

      // Process all items in parallel concurrently for maximum speed
      const createResults = await Promise.all(
        itemsToProcess.map(async (item, i) => {
          try {
            const itemKey = `trf-${baseIdemKey}-${i}-${Date.now()}`;
            const res = await fetch("/api/movements/transfer", {
              method: "POST",
              headers,
              body: JSON.stringify({
                ...data,
                product_id: item.product_id,
                sku: item.sku,
                barcode: item.barcode,
                product_name: item.product_name,
                from_location_id: item.location || "",
                qty: Math.max(1, item.qty || 1),
                moved_by: "",
                assigned_to_user_id: "",
                assigned_to_name: "",
                created_by: creatorId,
                created_by_name: creatorName,
                document_date: docDateVal,
                idempotency_key: itemKey,
              }),
            });

            const json = await res.json();
            if (!res.ok || !json.success || !json.data) {
              const errMsg = json.error || json.message || "สร้างใบย้ายสินค้าไม่สำเร็จ";
              return { error: `"${item.product_name}": ${errMsg}`, doc: null, notif: null };
            }

            const realDoc = json.data;
            const notif: TransferNotification = {
              id: realDoc.document_id,
              doc_no: realDoc.document_no || `TRF-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`,
              product_id: item.product_id,
              sku: item.sku || item.product_id,
              product_name: item.product_name || `สินค้า ${item.product_id}`,
              barcode: item.barcode || "",
              from_location_id: item.location || "",
              location_code: item.location || "",
              qty: item.qty,
              from_warehouse_id: data.from_warehouse_id,
              from_warehouse_name: fromWhName,
              to_warehouse_id: data.to_warehouse_id,
              to_warehouse_name: toWhName,
              created_by: tabUser?.id || "admin",
              created_by_name: tabUser?.name || (tabUser?.role === "ADMIN" ? "ผู้ดูแลระบบ (Admin)" : "Admin"),
              created_at: realDoc.created_at || new Date().toISOString(),
              status: "PENDING",
              moved_by: "",
              assigned_to_user_id: "",
              assigned_to_name: "",
            };

            saveTransferNotification(notif);
            return { error: null, doc: realDoc, notif };
          } catch {
            return { error: `"${item.product_name}": เกิดข้อผิดพลาดในการเชื่อมต่อ`, doc: null, notif: null };
          }
        })
      );

      for (const res of createResults) {
        if (res.error) {
          errors.push(res.error);
        }
        if (res.doc) {
          createdDocs.push(res.doc);
        }
        if (res.notif) {
          createdNotifs.push(res.notif);
        }
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
      setValue("product_id", "");
      setValue("qty", 1);
      setError("");
      setSuccessMessage(`✅ สร้างรายการเบิกสินค้าสำเร็จ ${createdDocs.length} รายการ (บันทึกใน "รายการที่ต้องไปเบิก" เรียบร้อยแล้ว)`);
      setSelectedTask(null);
      setStaffStep(1);
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
    waitingApprovalTasks,
    approvingId,
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
    handleApproveTransfer,
    handleRejectTransfer,
    sourceAllocations,
    handleUpdateSourceAllocationQty,
    handleProceedToDestStep,
    handleRemoveSourceAllocation,
    handleClearSourceAllocations,
    handleVerifyProductBarcode,
    handleVerifySourceLocationBarcode,
    handleVerifyDestinationLocationBarcode,
    handleSubmitTransfer,
    scannedToLocation,
    setScannedToLocation,
    isSubmittingTransfer,
    successMessage,
    setSuccessMessage,
    onSubmit,
    resetForm,
  };
}

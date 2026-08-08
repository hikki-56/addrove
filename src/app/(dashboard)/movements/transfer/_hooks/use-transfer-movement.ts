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
  type TransferNotification,
} from "@/lib/transfer-notification-utils";
import { areBarcodesMatching } from "@/lib/barcode-utils";
import { normalizeWarehouseId, getDefaultLocationsForWarehouse } from "@/lib/warehouse-utils";

export const TransferFormSchema = z.object({
  product_id: z.string().min(1, "กรุณาสแกนหรือเลือกสินค้า"),
  qty: z.number().positive("จำนวนต้องมากกว่า 0"),
  from_warehouse_id: z.string().min(1, "กรุณาเลือกโกดังต้นทาง"),
  to_warehouse_id: z.string().min(1, "กรุณาเลือกโกดังปลายทาง"),
  moved_by: z.string().min(1, "กรุณาระบุชื่อคนไปย้ายสินค้า"),
  document_date: z.string().min(1, "กรุณาเลือกวันที่"),
  reference_no: z.string().max(100),
  note: z.string().max(500),
  idempotency_key: z.string().min(1),
});

export type TransferFormInput = z.infer<typeof TransferFormSchema>;

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
  const [staffStep, setStaffStep] = useState<1 | 2 | 3 | 4>(1);
  const [staffScanProductInput, setStaffScanProductInput] = useState("");
  const [staffScanWhInput, setStaffScanWhInput] = useState("");
  const [staffScanLocationInput, setStaffScanLocationInput] = useState("");
  const [destLocations, setDestLocations] = useState<Location[]>([]);
  const [staffError, setStaffError] = useState("");
  const [staffSuccess, setStaffSuccess] = useState("");
  const [isStaffCameraOpen, setIsStaffCameraOpen] = useState(false);
  const [staffCameraTarget, setStaffCameraTarget] = useState<"PRODUCT" | "WAREHOUSE" | "LOCATION">("PRODUCT");

  const staffProductInputRef = useRef<HTMLInputElement | null>(null);
  const staffWhInputRef = useRef<HTMLInputElement | null>(null);
  const staffLocationInputRef = useRef<HTMLInputElement | null>(null);
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

  // Keep from_warehouse_id synced with active warehouse
  useEffect(() => {
    if (activeWhId) {
      setValue("from_warehouse_id", activeWhId);
      if (watchToWh === activeWhId) {
        setValue("to_warehouse_id", activeWhId === "wh-1" || activeWhId === "wh-01" ? "wh-2" : "wh-1");
      }
    }
  }, [activeWhId, setValue, watchToWh]);

  // Derived selected product
  const cleanSearchVal = (watchProduct || "").trim().toLowerCase();
  const selectedProduct = cleanSearchVal
    ? (products || []).find(
        (p) =>
          p.product_id.toLowerCase() === cleanSearchVal ||
          p.sku.toLowerCase() === cleanSearchVal ||
          (p.barcode && p.barcode.trim().toLowerCase() === cleanSearchVal) ||
          p.product_id.toLowerCase() === `prod-${cleanSearchVal}`
      ) ||
      (products || []).find(
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
    const interval = setInterval(fetchServerTransfers, 20000);

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
    if (tabUser?.role === "WAREHOUSE_STAFF") {
      setActiveMode("STAFF_EXECUTE");
    }
  }, [tabUser]);

  const handleCleanupHistory = async () => {
    if (!confirm("ยืนยันลบประวัติใบย้ายสินค้าที่เสร็จแล้วออกจากชีตทั้งหมด?")) return;
    setIsCleaningUp(true);
    try {
      const res = await fetch("/api/movements/transfer/cleanup", { method: "DELETE" });
      const json = await res.json();
      if (json.success) {
        clearAllTransferNotifications();
        localStorage.removeItem("stockify_completed_transfers");
        setPendingTasks([]);
        window.dispatchEvent(new Event("stockify-transfer-updated"));
        alert(json.message || "ลบประวัติสำเร็จ");
      } else {
        alert(json.message || "เกิดข้อผิดพลาด");
      }
    } catch {
      alert("เกิดข้อผิดพลาดในการเชื่อมต่อ");
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

    const matchedProduct = findMatchingProduct(selectedTask, products);

    const isMatch = areBarcodesMatching(scannedCode, [
      selectedTask.barcode,
      matchedProduct?.barcode,
      selectedTask.sku,
      matchedProduct?.sku,
      selectedTask.product_id,
      matchedProduct?.product_id,
      selectedTask.product_name,
      matchedProduct?.product_name,
    ]);

    if (isMatch) {
      setStaffSuccess("✅ บาร์โค้ดสินค้าถูกต้องเรียบร้อย! ขั้นตอนถัดไป: สแกนบาร์โค้ดโกดังปลายทาง");
      setStaffScanProductInput("");
      setStaffScanWhInput("");

      isStepTransitioningRef.current = true;
      setTimeout(() => {
        isStepTransitioningRef.current = false;
      }, 500);

      setStaffStep(2);
    } else {
      const displayExpected = [
        selectedTask.barcode,
        matchedProduct?.barcode,
        selectedTask.sku || matchedProduct?.sku,
      ]
        .filter(Boolean)
        .filter((v, i, a) => a.indexOf(v) === i)
        .join(" / ");

      setStaffError(
        `❌ บาร์โค้ดไม่ตรงกับสินค้าที่ต้องย้าย! (ที่สแกน: "${scannedCode}" / ต้องการ: "${displayExpected || selectedTask.product_name}")`
      );
    }
  };

  const handleVerifyWarehouseBarcode = (scannedCode: string) => {
    if (!selectedTask || isStepTransitioningRef.current) return;
    setStaffError("");
    setStaffSuccess("");

    const code = scannedCode.trim().toLowerCase();
    const targetWhId = normalizeWarehouseId(selectedTask.to_warehouse_id || "");
    const targetWhName = (selectedTask.to_warehouse_name || "").trim().toLowerCase();
    const scannedWhId = normalizeWarehouseId(code);

    const isMatch =
      scannedWhId === targetWhId ||
      code === targetWhName ||
      code.includes(targetWhId) ||
      code.includes(targetWhName) ||
      code === `wh-${targetWhId.replace("wh-", "")}` ||
      code === `โกดัง${targetWhId.replace("wh-", "").replace("0", "")}`;

    if (isMatch) {
      setStaffSuccess(`✅ โกดังปลายทางถูกต้อง! ขั้นตอนถัดไป: สแกนบาร์โค้ด / QR Code ตำแหน่ง (ชั้นวาง) ใน ${selectedTask.to_warehouse_name}`);
      setStaffScanWhInput("");
      setStaffScanLocationInput("");

      isStepTransitioningRef.current = true;
      setTimeout(() => {
        isStepTransitioningRef.current = false;
      }, 500);

      setStaffStep(3);

      fetch(`/api/locations?warehouse_id=${targetWhId}`)
        .then((r) => r.json())
        .then((d) => {
          if (d.success && Array.isArray(d.data) && d.data.length > 0) {
            setDestLocations(d.data.filter((l: Location) => l && l.active !== false));
          } else {
            setDestLocations(getDefaultLocationsForWarehouse(targetWhId));
          }
        })
        .catch(() => {
          setDestLocations(getDefaultLocationsForWarehouse(targetWhId));
        });
    } else {
      setStaffError(
        `❌ บาร์โค้ดโกดังไม่ตรง! กรุณาสแกนโกดังปลายทาง "${selectedTask.to_warehouse_name}" (สแกนได้: "${scannedCode}")`
      );
    }
  };

  const handleVerifyLocationBarcode = (scannedCode: string) => {
    if (!selectedTask || isStepTransitioningRef.current) return;
    setStaffError("");
    setStaffSuccess("");

    const code = scannedCode.trim().toLowerCase();
    if (!code) {
      setStaffError(
        `❌ กรุณาสแกนหรือระบุรหัสตำแหน่ง/ชั้นวางใน "${selectedTask.to_warehouse_name}" ก่อนทำรายการเสร็จสิ้น`
      );
      return;
    }

    const targetWhId = normalizeWarehouseId(selectedTask.to_warehouse_id || "");

    let validLocs = (destLocations || []).filter(
      (l) => l && l.warehouse_id && normalizeWarehouseId(l.warehouse_id) === targetWhId
    );
    if (validLocs.length === 0) {
      validLocs = getDefaultLocationsForWarehouse(targetWhId);
    }

    const matchedLoc = validLocs.find((loc) => {
      const locId = (loc.location_id || "").trim().toLowerCase();
      const locCode = (loc.location_code || "").trim().toLowerCase();
      const locName = (loc.location_name || "").trim().toLowerCase();
      const shelfCode = ((loc as unknown as { shelf_code?: string }).shelf_code || "").trim().toLowerCase();
      const shelfName = ((loc as unknown as { shelf_name?: string }).shelf_name || "").trim().toLowerCase();

      const cleanCode = code.replace(/^loc-/, "").replace(/^wh-0?[0-9]-?/, "");
      const cleanLocCode = locCode.replace(/^loc-/, "").replace(/^wh-0?[0-9]-?/, "");
      const cleanShelfCode = shelfCode.replace(/^loc-/, "").replace(/^wh-0?[0-9]-?/, "");

      return (
        code === locId ||
        code === locCode ||
        code === locName ||
        code === shelfCode ||
        code === shelfName ||
        (cleanLocCode && cleanCode === cleanLocCode) ||
        (cleanShelfCode && cleanCode === cleanShelfCode) ||
        (locCode && locCode.length >= 2 && code.includes(locCode)) ||
        (shelfCode && shelfCode.length >= 2 && code.includes(shelfCode))
      );
    });

    if (!matchedLoc) {
      setStaffError(
        `❌ รหัสตำแหน่ง "${scannedCode}" ไม่ถูกต้อง! ไม่ใช่ตำแหน่งใน ${selectedTask.to_warehouse_name} (กรุณาสแกนป้ายตำแหน่งประจำ ${selectedTask.to_warehouse_name})`
      );
      return;
    }

    if (selectedTask.id) {
      markTransferCompleted(selectedTask.id, selectedTask.doc_no, selectedTask.product_id);
    } else if (selectedTask.doc_no) {
      markTransferCompleted(selectedTask.doc_no, selectedTask.doc_no, selectedTask.product_id);
    }

    fetch(`/api/movements/transfer/${selectedTask.id}/complete`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        completed_location_id: matchedLoc.location_code || matchedLoc.location_id,
        completed_location_name: matchedLoc.location_name || (matchedLoc as unknown as { shelf_name?: string }).shelf_name || matchedLoc.location_code,
        completed_by: tabUser?.name || "พนักงาน",
      }),
    }).catch((err) => {
      console.warn("[Background Transfer Complete Sync Failed]:", err);
    });

    setPendingTasks((prev) => prev.filter((t) => t.id !== selectedTask.id));
    setStaffStep(4);
  };

  const onSubmit = async (data: TransferFormInput) => {
    setError("");

    if (data.from_warehouse_id === data.to_warehouse_id) {
      setError("โกดังต้นทางและโกดังปลายทางต้องไม่ซ้ำกัน");
      return;
    }

    try {
      const res = await fetch("/api/movements/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          qty: Number(data.qty) || 1,
        }),
      });

      const json = await res.json();
      if (json.success) {
        const notif: TransferNotification = {
          id: `trf-${Date.now()}`,
          doc_no: json.data?.document_no || `TRF-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`,
          product_id: data.product_id,
          sku: selectedProduct?.sku || data.product_id,
          product_name: selectedProduct?.product_name || `สินค้า ${data.product_id}`,
          barcode: selectedProduct?.barcode || "",
          qty: Number(data.qty) || 1,
          from_warehouse_id: data.from_warehouse_id,
          from_warehouse_name: warehouses.find((w) => w.warehouse_id === data.from_warehouse_id)?.warehouse_name || data.from_warehouse_id,
          to_warehouse_id: data.to_warehouse_id,
          to_warehouse_name: warehouses.find((w) => w.warehouse_id === data.to_warehouse_id)?.warehouse_name || data.to_warehouse_id,
          created_by: tabUser?.name || "Admin",
          created_at: new Date().toISOString(),
          status: "PENDING",
          moved_by: data.moved_by,
        };

        saveTransferNotification(notif);
        refreshData();
        setSubmitted(true);
      } else {
        setError(json.message || "เกิดข้อผิดพลาดในการโอนสินค้า");
      }
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
    staffScanWhInput,
    setStaffScanWhInput,
    staffScanLocationInput,
    setStaffScanLocationInput,
    destLocations,
    staffError,
    staffSuccess,
    isStaffCameraOpen,
    setIsStaffCameraOpen,
    staffCameraTarget,
    setStaffCameraTarget,
    staffProductInputRef,
    staffWhInputRef,
    staffLocationInputRef,
    watchProduct,
    watchFromWh,
    watchToWh,
    watchQty,
    watchMovedBy,
    selectedProduct,
    handleCleanupHistory,
    handleCancelTransfer,
    handleVerifyProductBarcode,
    handleVerifyWarehouseBarcode,
    handleVerifyLocationBarcode,
    onSubmit,
    resetForm,
  };
}

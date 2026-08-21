"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { MoveDocumentSchema, type MoveDocumentInput } from "@/types/api";
import type { Location, Product } from "@/types/models";
import { v4 as uuidv4 } from "uuid";
import { normalizeWarehouseId, detectWarehouseCode, getWarehouseName } from "@/lib/warehouse-utils";
import type { ScanFeedback } from "@/components/scanner/ScanFeedbackBanner";

export const MOVE_DRAFT_KEY = "stockify_move_draft_v1";

export function cleanLocStr(str?: string): string {
  if (!str) return "";
  return str
    .trim()
    .toLowerCase()
    .replace(/^loc-/, "")
    .replace(/^wh-?0?[0-9]-?/, "")
    .replace(/^sh-/, "")
    .replace(/^slf-/, "")
    .replace(/^l(?=\d)/, "")
    .replace(/[\s\-_]/g, "");
}

export interface UseMoveMovementOptions {
  activeWhId: string;
  setActiveWhId?: (whId: string) => void;
  activeWhName: string;
  locations: Location[];
  products: Product[];
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>;
  refreshWarehouseData: (whId: string) => void;
}

export function useMoveMovement({
  activeWhId,
  setActiveWhId,
  activeWhName,
  locations,
  products,
  setProducts,
  refreshWarehouseData,
}: UseMoveMovementOptions) {
  const [step, setStep] = useState<1 | 2>(1);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [sourceBalance, setSourceBalance] = useState<number | null>(null);
  const [barcodeInput, setBarcodeInput] = useState("");
  const [scanFeedback, setScanFeedback] = useState<ScanFeedback | null>(null);
  const [isCameraOpen, setIsCameraOpen] = useState(false);

  const form = useForm<MoveDocumentInput>({
    resolver: zodResolver(MoveDocumentSchema) as any,
    defaultValues: {
      warehouse_id: activeWhId,
      product_id: "",
      from_location_id: "",
      to_location_id: "",
      qty: "" as any,
      reference_no: "",
      note: "",
      document_date: new Date().toISOString().slice(0, 10),
      idempotency_key: uuidv4(),
    },
  });

  const { register, handleSubmit, watch, setValue, reset, formState: { errors, isSubmitting } } = form;

  const watchFromLocation = watch("from_location_id");
  const watchProduct = watch("product_id");
  const watchQty = watch("qty");
  const watchToLocation = watch("to_location_id");

  // Keep warehouse_id in form in sync with active warehouse
  useEffect(() => {
    if (activeWhId) {
      setValue("warehouse_id", activeWhId, { shouldValidate: true });
    }
  }, [activeWhId, setValue]);

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



  let pBarcode = (selectedProduct?.barcode && selectedProduct.barcode.trim() !== "-") ? selectedProduct.barcode.trim() : "";
  let pSku = selectedProduct?.sku || "";
  let pName = selectedProduct?.product_name || "";

  if (!pBarcode && watchProduct) {
    const combined = `${pSku} ${pName} ${watchProduct}`;
    const m = combined.match(/\b\d{6,14}\b/) || combined.match(/\d{6,14}/);
    if (m) {
      pBarcode = m[0];
    }
  }

  if (pBarcode) {
    const cleanBarcodeRegex = new RegExp(`[\\s\\-_#]*${pBarcode}[\\s\\-_#]*`, "gi");
    pSku = pSku.replace(cleanBarcodeRegex, "").trim();
    pName = pName.replace(cleanBarcodeRegex, "").trim();
  }

  const displaySku = pSku || (watchProduct !== pBarcode ? watchProduct : "");
  const rawName = (selectedProduct?.product_name || pName || "").trim();
  const cleanRawName = pBarcode && rawName ? rawName.replace(new RegExp(`[\\s\\-_#]*${pBarcode}[\\s\\-_#]*`, "gi"), "").trim() : rawName;
  const hasDistinctName = Boolean(cleanRawName && cleanRawName.toLowerCase() !== displaySku.toLowerCase() && cleanRawName.toLowerCase() !== watchProduct.toLowerCase());
  const displayName = hasDistinctName ? cleanRawName : "";
  const displayBarcode = pBarcode || "-";

  const selectedFromLoc = locations.find(
    (l) => l.location_code === watchFromLocation || l.location_id === watchFromLocation
  );
  const selectedToLoc = locations.find(
    (l) => l.location_code === watchToLocation || l.location_id === watchToLocation
  );

  useEffect(() => {
    if (selectedProduct) {
      if (selectedProduct.location && selectedProduct.location !== "-" && selectedProduct.location.trim()) {
        setValue("from_location_id", selectedProduct.location.trim(), { shouldValidate: true });
      }
      const pQty = Number(selectedProduct.quantity ?? selectedProduct.minimum_stock ?? 0);
      if (pQty > 0) {
        setValue("qty", pQty, { shouldValidate: true });
      }
    }
  }, [selectedProduct, setValue]);

  const lastStepTransitionRef = useRef<number>(0);

  const handleScanBarcode = useCallback(async (code: string) => {
    const trimmed = code.trim().toLowerCase();
    if (!trimmed) return;

    const now = Date.now();
    if (now - lastStepTransitionRef.current < 500) {
      return;
    }

    // 0. Detect Warehouse Barcode / QR Code
    const detectedWh = detectWarehouseCode(code);
    if (detectedWh) {
      if (setActiveWhId) {
        setActiveWhId(detectedWh);
      }
      setScanFeedback({
        type: "success",
        message: `✓ สลับโกดัง: ${getWarehouseName(detectedWh)}`,
      });
      setBarcodeInput("");
      return;
    }

    const scannedClean = cleanLocStr(trimmed);

    // Step 1: Scan Product Barcode
    if (step === 1) {
      let matched = (products || []).find(
        (p) =>
          (p.barcode && p.barcode.trim().toLowerCase() === trimmed) ||
          (p.sku && p.sku.trim().toLowerCase() === trimmed) ||
          (p.product_id && p.product_id.trim().toLowerCase() === trimmed) ||
          (p.product_id && p.product_id.trim().toLowerCase() === `prod-${trimmed}`)
      );

      if (!matched) {
        matched = (products || []).find(
          (p) =>
            (p.barcode && p.barcode.trim().toLowerCase().includes(trimmed)) ||
            (p.sku && p.sku.trim().toLowerCase().includes(trimmed)) ||
            (p.product_name && p.product_name.trim().toLowerCase().includes(trimmed))
        );
      }

      if (!matched) {
        try {
          const res = await fetch(`/api/products?search=${encodeURIComponent(code.trim())}&warehouse_id=${encodeURIComponent(activeWhId)}`);
          const json = await res.json();
          if (json.success) {
            const list: Product[] = Array.isArray(json.data) ? json.data : json.data?.items || [];
            if (list.length > 0) {
              matched = list[0];
            }
          }
        } catch (e) {
          console.error("Fetch product error:", e);
        }
      }

      if (matched) {
        const pid = matched.sku || matched.product_id;
        setValue("product_id", pid, { shouldValidate: true, shouldDirty: true, shouldTouch: true });
        if (matched.location && matched.location.trim() && matched.location.trim() !== "-") {
          setValue("from_location_id", matched.location.trim(), { shouldValidate: true });
        }
        if (matched.quantity && matched.quantity > 0) {
          setValue("qty", matched.quantity, { shouldValidate: true });
        }
        const locText = matched.location && matched.location !== "-" ? ` (ตำแหน่งเดิม: ${matched.location})` : "";
        setScanFeedback({
          type: "success",
          message: `✓ สแกนสำเร็จ: ${matched.sku || matched.product_name}${locText}`,
        });
        setBarcodeInput("");
        setTimeout(() => setScanFeedback(null), 3000);
        return;
      } else {
        setValue("product_id", "", { shouldValidate: true, shouldDirty: true, shouldTouch: true });
        setScanFeedback({
          type: "error",
          message: `✕ ไม่พบสินค้า "${code.trim()}" ใน ${activeWhName}`,
          scannedCode: code.trim(),
        });
        setBarcodeInput("");
        return;
      }
    }

    // Step 2: Scan Destination Location
    if (step === 2) {
      const matchedLoc = locations.find((l) => {
        const lId = l.location_id.trim().toLowerCase();
        const lCode = l.location_code.trim().toLowerCase();
        const lName = (l.location_name || "").trim().toLowerCase();
        const shelfCode = ((l as unknown as { shelf_code?: string }).shelf_code || "").trim().toLowerCase();
        const shelfName = ((l as unknown as { shelf_name?: string }).shelf_name || "").trim().toLowerCase();

        if (trimmed === lId || trimmed === lCode || trimmed === lName || (shelfCode && trimmed === shelfCode) || (shelfName && trimmed === shelfName)) {
          return true;
        }

        const cCode = cleanLocStr(lCode);
        const cId = cleanLocStr(lId);
        const cShelfCode = cleanLocStr(shelfCode);

        return Boolean(
          (cCode && scannedClean === cCode) ||
          (cId && scannedClean === cId) ||
          (cShelfCode && scannedClean === cShelfCode)
        );
      });

      const targetCode = matchedLoc
        ? (matchedLoc.shelf_code && (matchedLoc.shelf_code.trim().toLowerCase() === trimmed || cleanLocStr(matchedLoc.shelf_code) === scannedClean)
            ? matchedLoc.shelf_code.toUpperCase()
            : (matchedLoc.location_code && (matchedLoc.location_code.trim().toLowerCase() === trimmed || cleanLocStr(matchedLoc.location_code) === scannedClean)
                ? matchedLoc.location_code.toUpperCase()
                : code.trim().toUpperCase()))
        : code.trim().toUpperCase();
      setValue("to_location_id", targetCode, { shouldValidate: true });
      setScanFeedback({
        type: "success",
        message: `✓ ปลายทาง: ${targetCode}`,
      });
      setBarcodeInput("");
      setTimeout(() => setScanFeedback(null), 4000);
      return;
    }
  }, [step, locations, products, activeWhId, activeWhName, setValue, setProducts, setActiveWhId]);

  // Global scanner event listener
  const handleScanRef = useRef(handleScanBarcode);
  useEffect(() => {
    handleScanRef.current = handleScanBarcode;
  }, [handleScanBarcode]);

  useEffect(() => {
    let buffer = "";
    let lastScanTime = 0;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }

      const now = Date.now();
      if (now - lastScanTime > 200) {
        buffer = "";
      }
      lastScanTime = now;

      if (e.key === "Enter") {
        if (buffer.length >= 2) {
          e.preventDefault();
          handleScanRef.current(buffer);
        }
        buffer = "";
        return;
      }

      if (e.key.length === 1) {
        buffer += e.key;
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => {
      window.removeEventListener("keydown", handleGlobalKeyDown);
    };
  }, []);

  const maxAvailableQty = selectedProduct
    ? Number(selectedProduct.quantity ?? selectedProduct.minimum_stock ?? 0)
    : null;

  const handleNextStep1 = () => {
    setError("");
    if (!watchProduct) {
      setError("กรุณายิงสแกนสินค้าก่อน");
      return;
    }

    const isWhProduct = (products || []).some(
      (p) =>
        p.product_id.toLowerCase() === watchProduct.toLowerCase() ||
        p.sku.toLowerCase() === watchProduct.toLowerCase() ||
        (p.barcode && p.barcode.trim().toLowerCase() === watchProduct.toLowerCase()) ||
        p.product_id.toLowerCase() === `prod-${watchProduct.toLowerCase()}`
    ) || selectedProduct !== null;

    if (!isWhProduct) {
      setError(`ไม่พบสินค้า "${watchProduct}" ใน ${activeWhName}`);
      return;
    }

    const currentQty = Number(watchQty);
    if (!currentQty || currentQty <= 0) {
      setError("กรุณาระบุจำนวนมากกว่า 0");
      return;
    }

    if (maxAvailableQty !== null && maxAvailableQty > 0 && currentQty > maxAvailableQty) {
      setError(`จำนวนที่ระบุ (${currentQty}) เกินจำนวนคงเหลือในโกดัง (มีอยู่ ${maxAvailableQty} ชิ้น)`);
      return;
    }

    setStep(2);
  };

  const handleNextStep2 = () => {
    // 2-step flow step 2 is final submit
  };

  const onSubmit = async (data: MoveDocumentInput) => {
    setError("");
    const rawFrom = (selectedFromLoc?.location_code || watchFromLocation || data.from_location_id || "").trim();
    const rawTo = (selectedToLoc?.location_code || watchToLocation || data.to_location_id || "").trim();

    if (!rawTo) {
      setError("กรุณาเลือกหรือสแกนตำแหน่งปลายทางก่อนกดบันทึก");
      return;
    }

    const currentQty = Number(data.qty) || 1;
    if (maxAvailableQty !== null && maxAvailableQty > 0 && currentQty > maxAvailableQty) {
      setError(`จำนวนที่ระบุ (${currentQty}) เกินจำนวนคงเหลือในโกดัง (มีอยู่ ${maxAvailableQty} ชิ้น)`);
      return;
    }

    try {
      const res = await fetch("/api/movements/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          product_id: selectedProduct?.sku || selectedProduct?.product_id || data.product_id,
          from_location_id: rawFrom,
          to_location_id: rawTo,
          qty: currentQty,
        }),
      });
      const json = await res.json();
      if (json.success) {
        if (typeof window !== "undefined") {
          localStorage.removeItem(MOVE_DRAFT_KEY);
          window.dispatchEvent(new Event("stockify-product-updated"));
          window.dispatchEvent(new Event("stockify-stock-updated"));
        }
        refreshWarehouseData(activeWhId);
        setSubmitted(true);
      } else {
        setError(json.message || "เกิดข้อผิดพลาดในการจัดตำแหน่งสินค้า");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "ไม่สามารถเชื่อมต่อระบบได้ กรุณาลองใหม่อีกครั้ง";
      setError(msg);
    }
  };

  const resetForm = () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem(MOVE_DRAFT_KEY);
    }
    refreshWarehouseData(activeWhId);
    setSubmitted(false);
    setStep(1);
    reset({
      warehouse_id: activeWhId,
      product_id: "",
      from_location_id: "",
      to_location_id: "",
      qty: "" as any,
      document_date: new Date().toISOString().slice(0, 10),
      idempotency_key: uuidv4(),
    });
    setSourceBalance(null);
  };

  return {
    step,
    setStep,
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
    sourceBalance,
    maxAvailableQty,
    barcodeInput,
    setBarcodeInput,
    scanFeedback,
    setScanFeedback,
    isCameraOpen,
    setIsCameraOpen,
    watchFromLocation,
    watchProduct,
    watchQty,
    watchToLocation,
    selectedProduct,
    selectedFromLoc,
    selectedToLoc,
    displayName,
    displaySku,
    displayBarcode,
    handleScanBarcode,
    handleNextStep1,
    handleNextStep2,
    onSubmit,
    resetForm,
  };
}

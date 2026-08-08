"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { MoveDocumentSchema, type MoveDocumentInput } from "@/types/api";
import type { Location, Product } from "@/types/models";
import { v4 as uuidv4 } from "uuid";
import { normalizeWarehouseId } from "@/lib/warehouse-utils";
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
  activeWhName: string;
  locations: Location[];
  products: Product[];
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>;
  refreshWarehouseData: (whId: string) => void;
}

export function useMoveMovement({
  activeWhId,
  activeWhName,
  locations,
  products,
  setProducts,
  refreshWarehouseData,
}: UseMoveMovementOptions) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
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
      qty: 1,
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

  const lastStepTransitionRef = useRef<number>(0);

  const handleScanBarcode = useCallback(async (code: string) => {
    const trimmed = code.trim().toLowerCase();
    if (!trimmed) return;

    const now = Date.now();
    if (now - lastStepTransitionRef.current < 500) {
      return;
    }

    const scannedClean = cleanLocStr(trimmed);

    // Step 1: Scan Source Location
    if (step === 1) {
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

      if (matchedLoc) {
        const targetCode = matchedLoc.location_code || matchedLoc.location_id;
        setValue("from_location_id", targetCode, { shouldValidate: true });
        setScanFeedback({
          type: "success",
          message: `✓ สแกนเลือกตำแหน่งต้นทางสำเร็จ: ${matchedLoc.location_code} (${(matchedLoc as unknown as { shelf_name?: string }).shelf_name || matchedLoc.location_name || "ชั้นวาง"})`,
        });
        setBarcodeInput("");
        setTimeout(() => setScanFeedback(null), 3000);
        lastStepTransitionRef.current = Date.now();
        setStep(2);
        return;
      } else {
        setScanFeedback({
          type: "error",
          message: `✕ ไม่พบรหัสตำแหน่ง "${code}" ในโกดังนี้ (กรุณาสแกนหรือเลือกป้ายตำแหน่งที่มี)`,
        });
        setBarcodeInput("");
        return;
      }
    }

    // Step 2: Scan Product Barcode
    if (step === 2) {
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
              setProducts((prev) => {
                const exists = (prev || []).some((p) => p.product_id === matched!.product_id);
                return exists ? prev : [matched!, ...(prev || [])];
              });
            }
          }
        } catch (e) {
          console.error("Fetch product error:", e);
        }
      }

      if (matched) {
        const pid = matched.product_id || matched.sku;
        setValue("product_id", pid, { shouldValidate: true, shouldDirty: true, shouldTouch: true });
        setScanFeedback({
          type: "success",
          message: `✓ สแกนเลือกสินค้าสำเร็จ: [${matched.sku}] ${matched.product_name} (กรุณาระบุจำนวน แล้วกดถัดไป)`,
        });
        setBarcodeInput("");
        setTimeout(() => setScanFeedback(null), 4000);
        return;
      } else {
        setScanFeedback({
          type: "error",
          message: `✕ บาร์โค้ดสินค้า "${code}" ไม่มีอยู่ใน ${activeWhName} (ไม่อนุญาตให้ย้ายสินค้าที่ไม่มีอยู่ในโกดังนี้)`,
          scannedCode: code.trim(),
        });
        setBarcodeInput("");
        return;
      }
    }

    // Step 3: Scan Destination Location
    if (step === 3) {
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

      if (matchedLoc) {
        const targetCode = matchedLoc.location_code || matchedLoc.location_id;
        if (targetCode === watchFromLocation || matchedLoc.location_id === watchFromLocation) {
          setScanFeedback({
            type: "error",
            message: `✕ ตำแหน่งปลายทางต้องไม่ซ้ำกับตำแหน่งต้นทาง (${matchedLoc.location_code})`,
          });
          return;
        }
        setValue("to_location_id", targetCode, { shouldValidate: true });
        setScanFeedback({
          type: "success",
          message: `✓ สแกนเลือกตำแหน่งปลายทางสำเร็จ: ${matchedLoc.location_code} (${(matchedLoc as unknown as { shelf_name?: string }).shelf_name || matchedLoc.location_name || "ชั้นวาง"})`,
        });
        setBarcodeInput("");
        setTimeout(() => setScanFeedback(null), 4000);
        return;
      } else {
        setScanFeedback({
          type: "error",
          message: `✕ ไม่พบรหัสตำแหน่ง "${code}" ในโกดังนี้ (กรุณาสแกนหรือเลือกป้ายตำแหน่งปลายทางที่มี)`,
        });
        setBarcodeInput("");
        return;
      }
    }
  }, [step, locations, products, activeWhId, activeWhName, setValue, setProducts, watchFromLocation]);

  // Global scanner event listener
  const handleScanRef = useRef(handleScanBarcode);
  useEffect(() => {
    handleScanRef.current = handleScanBarcode;
  }, [handleScanBarcode]);

  useEffect(() => {
    let buffer = "";
    let timeoutId: NodeJS.Timeout;
    let lastScanTime = 0;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target &&
        (target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }

      if (e.key === "Enter" || e.key === "NumpadEnter") {
        const currentTime = Date.now();
        if (currentTime - lastScanTime < 400) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }

        if (buffer.trim().length >= 2) {
          e.preventDefault();
          e.stopPropagation();
          lastScanTime = currentTime;
          const text = buffer.trim();
          buffer = "";
          handleScanRef.current(text);
        }
        return;
      }

      if (e.key.length === 1) {
        buffer += e.key;
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          buffer = "";
        }, 150);
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => {
      window.removeEventListener("keydown", handleGlobalKeyDown);
      clearTimeout(timeoutId);
    };
  }, []);

  const handleNextStep1 = () => {
    setError("");
    if (!watchFromLocation) {
      setError("กรุณาสแกนหรือเลือกตำแหน่งต้นทางก่อนทำรายการถัดไป");
      return;
    }
    setStep(2);
  };

  const handleNextStep2 = () => {
    setError("");
    if (!watchProduct) {
      setError(`กรุณายิงสแกนบาร์โค้ดสินค้าที่มีใน ${activeWhName} ก่อนทำรายการถัดไป`);
      return;
    }
    const isWhProduct = (products || []).some(
      (p) =>
        p.product_id.toLowerCase() === watchProduct.toLowerCase() ||
        p.sku.toLowerCase() === watchProduct.toLowerCase() ||
        (p.barcode && p.barcode.trim().toLowerCase() === watchProduct.toLowerCase()) ||
        p.product_id.toLowerCase() === `prod-${watchProduct.toLowerCase()}`
    );
    if (!isWhProduct && selectedProduct === null) {
      setError(`ไม่พบสินค้า "${watchProduct}" ใน ${activeWhName} (กรุณาสแกนหรือเลือกสินค้าที่มีอยู่ในโกดังนี้เท่านั้น)`);
      return;
    }
    const currentQty = Number(watchQty);
    if (!currentQty || currentQty <= 0) {
      setError("กรุณาระบุจำนวนสินค้าให้ถูกต้อง (มากกว่า 0)");
      return;
    }
    setStep(3);
  };

  const onSubmit = async (data: MoveDocumentInput) => {
    setError("");
    const rawFrom = (selectedFromLoc?.location_code || watchFromLocation || data.from_location_id || "").trim();
    const rawTo = (selectedToLoc?.location_code || watchToLocation || data.to_location_id || "").trim();

    if (!rawFrom) {
      setError("กรุณาเลือกหรือสแกนตำแหน่งต้นทาง");
      return;
    }
    if (!rawTo) {
      setError("กรุณาเลือกหรือสแกนตำแหน่งปลายทางก่อนกดบันทึก");
      return;
    }

    const normFrom = rawFrom.replace(/^loc-/, "").replace(/^wh-0?[0-9]-?/, "").toLowerCase();
    const normTo = rawTo.replace(/^loc-/, "").replace(/^wh-0?[0-9]-?/, "").toLowerCase();

    if (normFrom === normTo) {
      setError("ตำแหน่งปลายทางต้องไม่เหมือนตำแหน่งต้นทาง");
      return;
    }

    try {
      const res = await fetch("/api/movements/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          from_location_id: rawFrom,
          to_location_id: rawTo,
          qty: Number(data.qty) || 1,
        }),
      });
      const json = await res.json();
      if (json.success) {
        if (typeof window !== "undefined") {
          localStorage.removeItem(MOVE_DRAFT_KEY);
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
      qty: 1,
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

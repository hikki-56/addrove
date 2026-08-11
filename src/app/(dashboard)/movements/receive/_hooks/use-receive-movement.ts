"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ReceiveDocumentSchema, type ReceiveDocumentInput } from "@/types/api";
import type { Location, Product } from "@/types/models";
import { v4 as uuidv4 } from "uuid";
import type { ScanFeedback } from "@/components/scanner/ScanFeedbackBanner";

import { detectWarehouseCode, getWarehouseName } from "@/lib/warehouse-utils";

export const RECEIVE_DRAFT_KEY = "stockify_receive_draft_v1";

export interface UseReceiveMovementOptions {
  activeWhId: string;
  setActiveWhId?: (whId: string) => void;
  locations: Location[];
  products: Product[];
  setLocations?: React.Dispatch<React.SetStateAction<Location[]>>;
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>;
  refreshWarehouseData: () => void;
}

export function useReceiveMovement({
  activeWhId,
  setActiveWhId,
  locations,
  products,
  setLocations,
  setProducts,
  refreshWarehouseData,
}: UseReceiveMovementOptions) {
  const [step, setStep] = useState<1 | 2>(1);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [barcodeInput, setBarcodeInput] = useState("");
  const [scanFeedback, setScanFeedback] = useState<ScanFeedback | null>(null);
  const [lastScannedId, setLastScannedId] = useState<string | null>(null);
  const [cameraScanLineIndex, setCameraScanLineIndex] = useState<number | null>(null);
  const [locationInputs, setLocationInputs] = useState<Record<number, string>>({});
  const [confirmedLines, setConfirmedLines] = useState<Record<number, boolean>>({});
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);

  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const isProcessingRef = useRef(false);

  const form = useForm<ReceiveDocumentInput>({
    resolver: zodResolver(ReceiveDocumentSchema) as any,
    defaultValues: {
      warehouse_id: activeWhId,
      document_date: new Date().toISOString().slice(0, 10),
      idempotency_key: uuidv4(),
      lines: [] as unknown as ReceiveDocumentInput["lines"],
    },
  });

  const { register, control, handleSubmit, watch, setValue, reset, formState: { errors, isSubmitting } } = form;
  const { fields, append, insert, remove } = useFieldArray({ control, name: "lines" });
  const watchLines = watch("lines");

  // Keep warehouse_id in form in sync with active warehouse
  useEffect(() => {
    if (activeWhId) {
      setValue("warehouse_id", activeWhId, { shouldValidate: true });
    }
  }, [activeWhId, setValue]);

  // Restore draft from localStorage on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = localStorage.getItem(RECEIVE_DRAFT_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.lines && Array.isArray(parsed.lines) && parsed.lines.length > 0) {
          setValue("lines", parsed.lines, { shouldValidate: true });
          if (parsed.step) setStep(parsed.step);
          if (parsed.document_date) setValue("document_date", parsed.document_date);
        }
      }
    } catch (e) {
      console.warn("[Receive Page] Failed to restore draft:", e);
    }
  }, [setValue]);

  // Save draft to localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (submitted) {
      localStorage.removeItem(RECEIVE_DRAFT_KEY);
      return;
    }
    if (!watchLines || watchLines.length === 0) {
      localStorage.removeItem(RECEIVE_DRAFT_KEY);
      return;
    }
    try {
      const draft = {
        warehouse_id: activeWhId,
        document_date: watch("document_date"),
        lines: watchLines,
        step,
      };
      localStorage.setItem(RECEIVE_DRAFT_KEY, JSON.stringify(draft));
    } catch (e) {
      console.warn("[Receive Page] Failed to save draft:", e);
    }
  }, [watchLines, activeWhId, step, watch, submitted]);

  const toggleConfirmLine = (i: number) => {
    const isCurrentlyConfirmed = !!confirmedLines[i];
    if (!isCurrentlyConfirmed) {
      const val = locationInputs[i] || watchLines?.[i]?.location_id || "";
      if (val.trim()) {
        handleScanLocationForLine(i, val);
      }
      setConfirmedLines((prev) => ({ ...prev, [i]: true }));
    } else {
      setConfirmedLines((prev) => ({ ...prev, [i]: false }));
    }
  };

  const handleAddLocationForProduct = (index: number) => {
    const currentLine = watchLines[index];
    if (!currentLine) return;
    insert(index + 1, {
      product_id: currentLine.product_id,
      location_id: "",
      extra_locations: [],
      boxes: 1,
      qty: 1,
      barcode: currentLine.barcode || "",
    });
  };

  const handleScanLocationForLine = async (lineIdx: number, rawCode: string) => {
    const rawTrimmed = (rawCode || "").trim();
    if (!rawTrimmed) return;
    const trimmed = rawTrimmed.toLowerCase();

    let matchedLoc = locations.find((l) => {
      const shelfCode = ((l as unknown as { shelf_code?: string }).shelf_code || "").trim().toLowerCase();
      const locCode = (l.location_code || "").trim().toLowerCase();
      const locId = (l.location_id || "").trim().toLowerCase();
      const locName = (l.location_name || "").trim().toLowerCase();
      return (
        locCode === trimmed ||
        locId === trimmed ||
        (shelfCode && shelfCode === trimmed) ||
        locName === trimmed
      );
    });

    if (!matchedLoc) {
      try {
        const res = await fetch(`/api/locations?warehouse_id=${encodeURIComponent(activeWhId || "")}`);
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          const freshLocations: Location[] = json.data;
          if (setLocations) setLocations(freshLocations);
          matchedLoc = freshLocations.find((l) => {
            const shelfCode = ((l as unknown as { shelf_code?: string }).shelf_code || "").trim().toLowerCase();
            const locCode = (l.location_code || "").trim().toLowerCase();
            const locId = (l.location_id || "").trim().toLowerCase();
            const locName = (l.location_name || "").trim().toLowerCase();
            return (
              locCode === trimmed ||
              locId === trimmed ||
              (shelfCode && shelfCode === trimmed) ||
              locName === trimmed
            );
          });
        }
      } catch (e) {
        console.error("Location search error:", e);
      }
    }

    const finalLocCode = matchedLoc ? matchedLoc.location_code : rawTrimmed.toUpperCase();
    const finalLocId = matchedLoc ? matchedLoc.location_id : rawTrimmed.toUpperCase();

    if (!matchedLoc) {
      const newLocObj: Location = {
        location_id: finalLocId,
        warehouse_id: activeWhId || "wh-1",
        location_code: finalLocCode,
        location_name: `ตำแหน่ง ${finalLocCode}`,
        active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      if (setLocations) setLocations((prev) => [newLocObj, ...prev]);
    }

    setValue(`lines.${lineIdx}.location_id`, finalLocId, { shouldValidate: true, shouldDirty: true });
    setLocationInputs((prev) => ({ ...prev, [lineIdx]: finalLocCode }));
  };

  const handleScanBarcode = useCallback(async (code: string) => {
    const trimmed = code.trim().toLowerCase();
    if (!trimmed) return;

    if (isProcessingRef.current) return;
    isProcessingRef.current = true;

    setBarcodeInput("");
    if (barcodeInputRef.current) barcodeInputRef.current.value = "";
    setScanFeedback(null);

    // 0. Check if scanned code is a Warehouse Barcode (e.g. WH-01..WH-05, WH1..WH5, โกดัง1..5)
    const detectedWh = detectWarehouseCode(code);
    if (detectedWh) {
      if (setActiveWhId) {
        setActiveWhId(detectedWh);
      }
      setScanFeedback({
        type: "success",
        title: "สลับโกดังสินค้าสำเร็จ",
        message: `สแกนบาร์โค้ดสลับคลังเป็น: ${getWarehouseName(detectedWh)} (${detectedWh.toUpperCase()})`,
      });
      isProcessingRef.current = false;
      return;
    }

    // 0.5 Check if scanned code is a Location Barcode
    let matchedLoc = locations.find((l) => {
      const shelfCode = ((l as unknown as { shelf_code?: string }).shelf_code || "").trim().toLowerCase();
      const locCode = (l.location_code || "").trim().toLowerCase();
      const locId = (l.location_id || "").trim().toLowerCase();
      const locName = (l.location_name || "").trim().toLowerCase();
      return (
        (locCode && locCode === trimmed) ||
        (locId && locId === trimmed) ||
        (shelfCode && shelfCode === trimmed) ||
        (locName && locName === trimmed)
      );
    });

    const isExplicitLocationPattern =
      Boolean(matchedLoc) ||
      /^(loc|wh[0-9]|shelf|rack|a|b|c|d|e|f|k\d)[-_]?[a-z0-9]+/i.test(trimmed) ||
      /^[a-z0-9]{3,15}$/i.test(trimmed);

    // Step 1: Product scanning match check
    let matched = (products || []).find(
      (p) =>
        (p.barcode && p.barcode.trim().toLowerCase() === trimmed) ||
        (p.sku && p.sku.trim().toLowerCase() === trimmed) ||
        (p.product_id && p.product_id.trim().toLowerCase() === trimmed) ||
        (p.product_id && p.product_id.trim().toLowerCase() === `prod-${trimmed}`)
    );

    // If it's a location code or no product matched and looks like location code
    if ((isExplicitLocationPattern && !matched) || (matchedLoc && !matched)) {
      const currentLines = watchLines || [];
      if (currentLines.length > 0) {
        const rawTrimmed = code.trim();
        const finalLocCode = matchedLoc ? matchedLoc.location_code : rawTrimmed.toUpperCase();
        const finalLocId = matchedLoc ? matchedLoc.location_id : rawTrimmed.toUpperCase();

        if (!matchedLoc) {
          const newLocObj: Location = {
            location_id: finalLocId,
            warehouse_id: activeWhId || "wh-01",
            location_code: finalLocCode,
            location_name: `ตำแหน่ง ${finalLocCode}`,
            active: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          if (setLocations) setLocations((prev) => [newLocObj, ...prev]);
        }

        const firstUnconfirmed = currentLines.findIndex(
          (_, idx) => !confirmedLines[idx] && (idx === 0 || confirmedLines[idx - 1])
        );
        const targetIdx = firstUnconfirmed !== -1 ? firstUnconfirmed : 0;
        const targetLine = currentLines[targetIdx];

        const currentExtras: string[] = Array.isArray((targetLine as any).extra_locations)
          ? [...(targetLine as any).extra_locations]
          : [];

        const emptyExtraIdx = currentExtras.findIndex((loc) => !loc || !loc.trim());

        if (emptyExtraIdx !== -1) {
          // Empty extra slot explicitly exists (created by + เพิ่มตำแหน่งสแกน) -> Fill extra slot!
          currentExtras[emptyExtraIdx] = finalLocCode;
          setValue(`lines.${targetIdx}.extra_locations` as any, currentExtras, { shouldValidate: true, shouldDirty: true });
        } else {
          // No empty extra slot -> Re-scanning / replacing the primary location (Location 1)!
          setValue(`lines.${targetIdx}.location_id`, finalLocId, { shouldValidate: true, shouldDirty: true });
          setLocationInputs((prev) => ({ ...prev, [targetIdx]: finalLocCode }));
        }

        // Location scan only updates location fields for the current targetIdx card.
        // Item card confirmation is ONLY toggled when user explicitly clicks the "ยืนยัน" button.

        const lineProduct = products?.find((p) => p.product_id === currentLines[targetIdx].product_id || p.sku === currentLines[targetIdx].product_id);
        const prodName = lineProduct ? lineProduct.product_name : currentLines[targetIdx].product_id;

        setScanFeedback({
          type: "success",
          title: "ระบุตำแหน่งจัดเก็บสำเร็จ",
          message: `📍 บันทึกตำแหน่ง [${finalLocCode}] ให้กับสินค้า ${prodName} แล้ว`,
        });
        setBarcodeInput("");
        isProcessingRef.current = false;
        return;
      }
    }

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
        const res = await fetch(`/api/products?search=${encodeURIComponent(code.trim())}&master_only=true`);
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
      const currentLines = watchLines || [];
      const barcodeDisplay = matched.barcode && matched.barcode.trim() !== "-" ? matched.barcode.trim() : "";
      const barcodePrefix = barcodeDisplay ? `บาร์โค้ด: ${barcodeDisplay} | ` : "";

      const existingIdx = currentLines.findIndex((l) => l.product_id === pid);
      if (existingIdx !== -1) {
        const currentBoxes = Number(currentLines[existingIdx].boxes) || 1;
        const currentQty = Number(currentLines[existingIdx].qty) || 1;
        setValue(`lines.${existingIdx}.boxes`, currentBoxes + 1, { shouldValidate: true, shouldDirty: true });
        setValue(`lines.${existingIdx}.qty`, currentQty + 1, { shouldValidate: true, shouldDirty: true });
        setScanFeedback({
          type: "success",
          title: "นำเข้าสินค้าสำเร็จ",
          message: `${barcodePrefix}[${matched.sku}] ${matched.product_name} (เพิ่มเป็น ${currentBoxes + 1} กล่อง)`,
        });
      } else {
        // Block scanning next product if any existing line item is NOT yet confirmed!
        const unconfirmedIdx = currentLines.findIndex((_, idx) => !confirmedLines[idx]);
        if (unconfirmedIdx !== -1) {
          setError(`🔒 กรุณากดยืนยันรายการสินค้าที่ #${unconfirmedIdx + 1} ก่อนยิงสแกนสินค้าถัดไป`);
          setScanFeedback({
            type: "error",
            title: "ต้องยืนยันรายการเดิมก่อน",
            message: `🔒 กรุณากดยืนยันรายการสินค้าที่ #${unconfirmedIdx + 1} ให้เสร็จสิ้นก่อนยิงสแกนสินค้าถัดไป`,
          });
          setBarcodeInput("");
          isProcessingRef.current = false;
          return;
        }

        append({
          product_id: pid,
          location_id: "",
          extra_locations: [],
          boxes: 1,
          qty: 1,
          barcode: matched.barcode || matched.sku || "",
        });
        setError("");
        setScanFeedback({
          type: "success",
          title: "นำเข้าสินค้าสำเร็จ",
          message: `${barcodePrefix}[${matched.sku}] ${matched.product_name}`,
        });
      }

      setLastScannedId(pid);
      setBarcodeInput("");
      setTimeout(() => {
        setScanFeedback(null);
        setLastScannedId(null);
      }, 4000);
    } else {
      setScanFeedback({
        type: "error",
        title: "ไม่มีข้อมูล",
        message: `บาร์โค้ด "${code}" ไม่พบในระบบ`,
      });
      setBarcodeInput("");
      setTimeout(() => {
        setScanFeedback(null);
      }, 4000);
    }

    isProcessingRef.current = false;
  }, [step, locations, products, activeWhId, watchLines, setValue, append, setLocations, setProducts]);

  // Global barcode scanner listener
  const handleScanRef = useRef(handleScanBarcode);
  useEffect(() => {
    handleScanRef.current = handleScanBarcode;
  }, [handleScanBarcode]);

  useEffect(() => {
    let buffer = "";
    let timeoutId: NodeJS.Timeout;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target === barcodeInputRef.current) return;
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable)) return;

      if (e.key === "Enter") {
        if (buffer.trim().length >= 2) {
          e.preventDefault();
          e.stopPropagation();
          handleScanRef.current(buffer.trim());
          buffer = "";
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

  const onSubmit = async (data: ReceiveDocumentInput) => {
    setError("");

    if (!data.lines || data.lines.length === 0) {
      setError("กรุณาสแกนหรือเลือกสินค้าอย่างน้อย 1 รายการก่อนทำการบันทึก");
      return;
    }

    const defaultLoc = locations[0]?.location_id || `loc-${activeWhId || "wh-1"}-A1`;

    const cleanedLines = data.lines.map((l, idx) => {
      const manualLoc = locationInputs[idx];
      const locToUse = manualLoc?.trim() ? manualLoc.trim() : (l.location_id?.trim() ? l.location_id.trim() : defaultLoc);
      return {
        product_id: l.product_id,
        location_id: locToUse,
        boxes: Number(l.boxes) || 1,
        qty: Number(l.qty) || 1,
      };
    });

    try {
      const res = await fetch("/api/movements/receive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          lines: cleanedLines,
        }),
      });
      const json = await res.json();
      if (json.success) {
        if (typeof window !== "undefined") {
          localStorage.removeItem(RECEIVE_DRAFT_KEY);
        }
        refreshWarehouseData();
        setSubmitted(true);
        setConfirmModalOpen(false);
      } else {
        setError(json.message || "เกิดข้อผิดพลาดในการบันทึกเอกสารรับสินค้า");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "ไม่สามารถเชื่อมต่อระบบได้ กรุณาลองใหม่อีกครั้ง";
      setError(msg);
    }
  };

  const resetForm = () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem(RECEIVE_DRAFT_KEY);
    }
    refreshWarehouseData();
    setSubmitted(false);
    setStep(1);
    reset({
      warehouse_id: activeWhId,
      document_date: new Date().toISOString().slice(0, 10),
      idempotency_key: uuidv4(),
      lines: [] as unknown as ReceiveDocumentInput["lines"],
    });
    setConfirmedLines({});
    setLocationInputs({});
  };

  const handleProductSelect = (product: Product) => {
    const pid = product.product_id || product.sku;
    const currentLines = watchLines || [];
    const barcodeDisplay = product.barcode && product.barcode.trim() !== "-" ? product.barcode.trim() : "";
    const barcodePrefix = barcodeDisplay ? `บาร์โค้ด: ${barcodeDisplay} | ` : "";

    const existingIdx = currentLines.findIndex((l) => l.product_id === pid);
    if (existingIdx !== -1) {
      const currentBoxes = Number(currentLines[existingIdx].boxes) || 1;
      const currentQty = Number(currentLines[existingIdx].qty) || 1;
      setValue(`lines.${existingIdx}.boxes`, currentBoxes + 1, { shouldValidate: true, shouldDirty: true });
      setValue(`lines.${existingIdx}.qty`, currentQty + 1, { shouldValidate: true, shouldDirty: true });
      setScanFeedback({
        type: "success",
        title: "นำเข้าสินค้าสำเร็จ",
        message: `${barcodePrefix}[${product.sku}] ${product.product_name} (เพิ่มเป็น ${currentBoxes + 1} กล่อง)`,
      });
      } else {
        // Block adding next product if any existing line item is NOT yet confirmed!
        const unconfirmedIdx = currentLines.findIndex((_, idx) => !confirmedLines[idx]);
        if (unconfirmedIdx !== -1) {
          setError(`🔒 กรุณากดยืนยันรายการสินค้าที่ #${unconfirmedIdx + 1} ก่อนเพิ่มสินค้าถัดไป`);
          setScanFeedback({
            type: "error",
            title: "ต้องยืนยันรายการเดิมก่อน",
            message: `🔒 กรุณากดยืนยันรายการสินค้าที่ #${unconfirmedIdx + 1} ให้เสร็จสิ้นก่อนเพิ่มสินค้าถัดไป`,
          });
          setSearchOpen(false);
          return;
        }

        append({
          product_id: pid,
          location_id: "",
          extra_locations: [],
          boxes: 1,
          qty: 1,
          barcode: product.barcode || product.sku || "",
        });
        setError("");
        setScanFeedback({
          type: "success",
          title: "นำเข้าสินค้าสำเร็จ",
          message: `${barcodePrefix}[${product.sku}] ${product.product_name}`,
        });
      }

    setLastScannedId(pid);
    setSearchOpen(false);
    setSearchQuery("");
    setTimeout(() => {
      setScanFeedback(null);
      setLastScannedId(null);
    }, 4000);
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
    fields,
    append,
    remove,
    watchLines,
    submitted,
    error,
    setError,
    barcodeInput,
    setBarcodeInput,
    barcodeInputRef,
    scanFeedback,
    setScanFeedback,
    lastScannedId,
    cameraScanLineIndex,
    setCameraScanLineIndex,
    locationInputs,
    setLocationInputs,
    confirmedLines,
    toggleConfirmLine,
    handleAddLocationForProduct,
    handleScanLocationForLine,
    handleScanBarcode,
    searchOpen,
    setSearchOpen,
    searchQuery,
    setSearchQuery,
    confirmModalOpen,
    setConfirmModalOpen,
    isCameraOpen,
    setIsCameraOpen,
    onSubmit,
    resetForm,
    handleProductSelect,
  };
}

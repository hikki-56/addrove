"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ReceiveDocumentSchema, type ReceiveDocumentInput } from "@/types/api";
import type { Location, Product } from "@/types/models";
import { v4 as uuidv4 } from "uuid";
import type { ScanFeedback } from "@/components/scanner/ScanFeedbackBanner";

import { detectWarehouseCode, getWarehouseName } from "@/lib/warehouse-utils";
import { useTabAuth } from "@/context/TabAuthContext";

export const RECEIVE_DRAFT_KEY = "stockify_receive_draft_v1";

// Re-key index-based state (locationInputs/confirmedLines) after line order changes.
// map() returns the new index for an old index, or null when the entry is dropped.
function remapIndexState<T>(prev: Record<number, T>, map: (i: number) => number | null): Record<number, T> {
  const next: Record<number, T> = {};
  for (const [k, v] of Object.entries(prev)) {
    const target = map(Number(k));
    if (target === null) continue;
    next[target] = v;
  }
  return next;
}

function shortName(name: string, max = 32): string {
  return name.length > max ? `${name.slice(0, max).trimEnd()}…` : name;
}

function normalizeWhId(v: string): string {
  return (v || "").trim().toLowerCase().replace(/^wh-0*(\d+)$/, "wh-$1");
}

// รับสินค้า: ต้องตรงกันทุกหลัก (บาร์โค้ด/SKU/product id) — ห้ามจับคู่บางส่วน
function matchesProductExact(p: Product, code: string): boolean {
  const c = code.trim().toLowerCase();
  return (
    (!!p.barcode && p.barcode.trim().toLowerCase() === c) ||
    (!!p.sku && p.sku.trim().toLowerCase() === c) ||
    (!!p.product_id && p.product_id.trim().toLowerCase() === c) ||
    (!!p.product_id && p.product_id.trim().toLowerCase() === `prod-${c}`)
  );
}

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
  const { user } = useTabAuth();
  const [step, setStep] = useState<1 | 2>(1);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [barcodeInput, setBarcodeInput] = useState("");
  const [scanFeedback, setScanFeedback] = useState<ScanFeedback | null>(null);
  const [lastScannedId, setLastScannedId] = useState<string | null>(null);
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
  const { fields, insert, remove, move } = useFieldArray({ control, name: "lines" });
  const watchLines = watch("lines");

  // Remove a line AND remap index-keyed state (locationInputs/confirmedLines) so values
  // of the removed line can never leak onto a different line after indices shift
  const removeLine = useCallback((index: number) => {
    remove(index);
    const shift = (i: number): number | null => (i === index ? null : i > index ? i - 1 : i);
    setLocationInputs((prev) => remapIndexState(prev, shift));
    setConfirmedLines((prev) => remapIndexState(prev, shift));
  }, [remove]);

  // Latest scan wins: move the just-scanned line to the top of the list, carrying its
  // index-keyed state along so location/confirmed status stay attached to the same line
  const moveLineToTop = useCallback((fromIdx: number) => {
    if (fromIdx <= 0) return;
    move(fromIdx, 0);
    const toTop = (i: number): number | null => (i === fromIdx ? 0 : i < fromIdx ? i + 1 : i);
    setLocationInputs((prev) => remapIndexState(prev, toTop));
    setConfirmedLines((prev) => remapIndexState(prev, toTop));
  }, [move]);

  // Keep warehouse_id in form in sync with active warehouse
  useEffect(() => {
    if (activeWhId) {
      setValue("warehouse_id", activeWhId, { shouldValidate: true });
    }
  }, [activeWhId, setValue]);

  // Restore draft from localStorage on mount — only if the draft belongs to the same warehouse
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = localStorage.getItem(RECEIVE_DRAFT_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.warehouse_id && activeWhId && normalizeWhId(parsed.warehouse_id) !== normalizeWhId(activeWhId)) {
          // Draft was made for another warehouse — discard it instead of mixing lines across warehouses
          localStorage.removeItem(RECEIVE_DRAFT_KEY);
          return;
        }
        if (parsed.lines && Array.isArray(parsed.lines) && parsed.lines.length > 0) {
          setValue("lines", parsed.lines, { shouldValidate: true });
          if (parsed.step) setStep(parsed.step);
          if (parsed.document_date) setValue("document_date", parsed.document_date);
        }
      }
    } catch (e) {
      console.warn("[Receive Page] Failed to restore draft:", e);
    }
  }, [setValue, activeWhId]);

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

  // Restoring a draft only brings back the line rows. Products scanned in the previous
  // session may not be in the warehouse product list after a refresh (refreshData
  // replaces the list with warehouse-scoped products, e.g. zero-stock items are absent),
  // so the card would fall back to "สินค้าใหม่" — re-fetch those from the product master.
  const attemptedResolveRef = useRef<Set<string>>(new Set());
  const lastProductsRef = useRef(products);
  useEffect(() => {
    if (lastProductsRef.current !== products) {
      lastProductsRef.current = products;
      // The list was replaced/reloaded (or we merged a product) — allow retrying lines
      // that previously failed to resolve
      attemptedResolveRef.current = new Set();
    }
    const lines = watchLines || [];
    if (lines.length === 0) return;

    const unresolved = lines.filter((l) => {
      const pid = (l.product_id || "").trim().toLowerCase();
      if (!pid || attemptedResolveRef.current.has(pid)) return false;
      return !(products || []).some((p) =>
        p.product_id.toLowerCase() === pid ||
        p.sku.toLowerCase() === pid ||
        (p.barcode && p.barcode.trim().toLowerCase() === pid) ||
        p.product_id.toLowerCase() === `prod-${pid}`
      );
    });
    if (unresolved.length === 0) return;

    let cancelled = false;
    (async () => {
      for (const line of unresolved) {
        const code = (line.product_id || "").trim();
        attemptedResolveRef.current.add(code.toLowerCase());
        try {
          const res = await fetch(`/api/products?search=${encodeURIComponent(code)}&master_only=true`);
          const json = await res.json();
          if (cancelled) return;
          if (!json.success) continue;
          const list: Product[] = Array.isArray(json.data) ? json.data : json.data?.items || [];
          const exact = list.find((p) => matchesProductExact(p, code));
          if (exact) {
            setProducts((prev) => {
              const exists = (prev || []).some((p) => p.product_id === exact.product_id);
              return exists ? prev : [exact, ...(prev || [])];
            });
          }
        } catch (e) {
          console.error("[Receive Page] Draft product resolve error:", e);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [watchLines, products, setProducts]);

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
      extra_qtys: [],
      location_allocations: [],
      boxes: 1,
      qty: 0,
      barcode: currentLine.barcode || "",
    });
  };

  const handleScanLocationForLine = async (lineIdx: number, rawCode: string) => {
    const rawTrimmed = (rawCode || "").trim();
    if (!rawTrimmed) return;
    const trimmed = rawTrimmed.toLowerCase();
    const finalLocCode = rawTrimmed.toUpperCase();

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

    if (!matchedLoc) {
      // Unknown shelf: reject instead of silently creating a phantom location
      setScanFeedback({
        type: "error",
        title: "ไม่พบตำแหน่งนี้ในโกดัง",
        message: `"${rawTrimmed.toUpperCase()}" ไม่อยู่ในรายการตำแหน่ง — กรุณาเช็ค QR ชั้นวางหรือเพิ่มตำแหน่งในระบบก่อน`,
      });
      setTimeout(() => setScanFeedback(null), 4000);
      return;
    }

    const finalLocId = matchedLoc.shelf_code && matchedLoc.shelf_code.trim().toLowerCase() === trimmed
      ? matchedLoc.shelf_code.toUpperCase()
      : (matchedLoc.location_code && matchedLoc.location_code.trim().toLowerCase() === trimmed
          ? matchedLoc.location_code.toUpperCase()
          : finalLocCode);

    setValue(`lines.${lineIdx}.location_id`, finalLocId, { shouldValidate: true, shouldDirty: true });
    setLocationInputs((prev) => ({ ...prev, [lineIdx]: finalLocId }));
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
        title: "สลับโกดังแล้ว",
        message: getWarehouseName(detectedWh),
      });
      isProcessingRef.current = false;
      return;
    }

    // Step 1: Product match — exact code only, no partial matching
    let matched = (products || []).find((p) => matchesProductExact(p, trimmed));

    if (!matched) {
      try {
        const res = await fetch(`/api/products?search=${encodeURIComponent(code.trim())}&master_only=true`);
        const json = await res.json();
        if (json.success) {
          const list: Product[] = Array.isArray(json.data) ? json.data : json.data?.items || [];
          const exact = list.find((p) => matchesProductExact(p, trimmed));
          if (exact) {
            matched = exact;
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

    // IF PRODUCT MATCHED -> ADD (duplicate scan adds one box only — จำนวนชิ้น is counted manually)
    if (matched) {
      const pid = matched.product_id || matched.sku;
      const currentLines = watchLines || [];

      const existingIdx = currentLines.findIndex((l) => l.product_id === pid);
      if (existingIdx !== -1) {
        const currentBoxes = Number(currentLines[existingIdx].boxes) || 1;
        setValue(`lines.${existingIdx}.boxes`, currentBoxes + 1, { shouldValidate: true, shouldDirty: true });
        moveLineToTop(existingIdx);
        setScanFeedback({
          type: "success",
          title: `เพิ่ม 1 กล่อง — รวม ${currentBoxes + 1} กล่อง`,
          message: `[${matched.sku}] ${shortName(matched.product_name)}`,
        });
      } else {
        insert(0, {
          product_id: pid,
          location_id: "",
          extra_locations: [],
          extra_qtys: [],
          location_allocations: [],
          boxes: 1,
          qty: 0,
          barcode: matched.barcode || matched.sku || "",
        });
        setError("");
        setScanFeedback({
          type: "success",
          title: "นำเข้าสำเร็จ",
          message: `[${matched.sku}] ${shortName(matched.product_name)}`,
        });
      }

      setLastScannedId(pid);
      setBarcodeInput("");
      setTimeout(() => {
        setScanFeedback(null);
        setLastScannedId(null);
      }, 4000);
      isProcessingRef.current = false;
      return;
    }

    // Step 2: Location Scanning Check (ONLY executed if NO Product matched!)
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

    // Only structural location-code prefixes count as a location barcode — generic
    // patterns like "a12"/"12ab" also match product SKUs and must NOT be treated as shelves
    const looksLikeLocationCode = /^(loc|shelf|rack|bin|slf)[-_]/i.test(trimmed);

    if (matchedLoc || looksLikeLocationCode) {
      const currentLines = watchLines || [];
      if (currentLines.length > 0) {
        const rawTrimmed = code.trim();
        const finalLocCode = rawTrimmed.toUpperCase();

        // Master may be stale (location recently added) — refetch once before rejecting
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
                return (
                  (locCode && locCode === trimmed) ||
                  (locId && locId === trimmed) ||
                  (shelfCode && shelfCode === trimmed)
                );
              });
            }
          } catch (e) {
            console.error("Location search error:", e);
          }
        }

        if (!matchedLoc) {
          // Unknown shelf: reject instead of silently creating a phantom location
          setScanFeedback({
            type: "error",
            title: "ไม่พบตำแหน่งนี้ในโกดัง",
            message: `"${finalLocCode}" ไม่อยู่ในรายการตำแหน่ง — กรุณาเช็ค QR ชั้นวางหรือเพิ่มตำแหน่งในระบบก่อน`,
          });
          setBarcodeInput("");
          setTimeout(() => setScanFeedback(null), 4000);
          isProcessingRef.current = false;
          return;
        }

        const finalLocId = matchedLoc.shelf_code && matchedLoc.shelf_code.trim().toLowerCase() === trimmed
          ? matchedLoc.shelf_code.toUpperCase()
          : (matchedLoc.location_code && matchedLoc.location_code.trim().toLowerCase() === trimmed
              ? matchedLoc.location_code.toUpperCase()
              : finalLocCode);

        const firstEmptyLocIdx = currentLines.findIndex(
          (l) => !l.location_id || !l.location_id.trim()
        );
        const firstUnconfirmed = currentLines.findIndex(
          (_, idx) => !confirmedLines[idx] && (idx === 0 || confirmedLines[idx - 1])
        );
        const targetIdx = firstEmptyLocIdx !== -1 ? firstEmptyLocIdx : (firstUnconfirmed !== -1 ? firstUnconfirmed : 0);
        const targetLine = currentLines[targetIdx];

        const currentExtras: string[] = Array.isArray((targetLine as any).extra_locations)
          ? [...(targetLine as any).extra_locations]
          : [];
        const currentQtys: number[] = Array.isArray((targetLine as any).extra_qtys)
          ? [...(targetLine as any).extra_qtys]
          : [];
        const primaryLoc = (targetLine.location_id || "").trim();

        if (!primaryLoc) {
          setValue(`lines.${targetIdx}.location_id`, finalLocId, { shouldValidate: true, shouldDirty: true });
          setLocationInputs((prev) => ({ ...prev, [targetIdx]: finalLocId }));
        } else {
          const emptyExtraIdx = currentExtras.findIndex((loc) => !loc || !loc.trim());
          if (emptyExtraIdx !== -1) {
            currentExtras[emptyExtraIdx] = finalLocId;
            setValue(`lines.${targetIdx}.extra_locations` as any, currentExtras, { shouldValidate: true, shouldDirty: true });
          } else if (primaryLoc.toUpperCase() !== finalLocId.toUpperCase() && !currentExtras.some((e) => e.toUpperCase() === finalLocId.toUpperCase())) {
            const updatedExtras = [...currentExtras, finalLocId];
            const updatedQtys = [...currentQtys, 1];
            setValue(`lines.${targetIdx}.extra_locations` as any, updatedExtras, { shouldValidate: true, shouldDirty: true });
            setValue(`lines.${targetIdx}.extra_qtys` as any, updatedQtys, { shouldValidate: true, shouldDirty: true });
            const pQty = typeof (targetLine as any).primary_qty === "number" ? (targetLine as any).primary_qty : (Number(targetLine.qty) || 0);
            setValue(`lines.${targetIdx}.primary_qty` as any, pQty, { shouldValidate: true, shouldDirty: true });
            const sumExtras = updatedQtys.reduce((acc, curr) => acc + (Number(curr) || 1), 0);
            setValue(`lines.${targetIdx}.qty`, pQty + sumExtras, { shouldValidate: true, shouldDirty: true });
          } else {
            setValue(`lines.${targetIdx}.location_id`, finalLocId, { shouldValidate: true, shouldDirty: true });
            setLocationInputs((prev) => ({ ...prev, [targetIdx]: finalLocId }));
          }
        }

        const lineProduct = products?.find((p) => p.product_id === currentLines[targetIdx].product_id || p.sku === currentLines[targetIdx].product_id);
        const prodName = lineProduct ? lineProduct.product_name : currentLines[targetIdx].product_id;

        setScanFeedback({
          type: "success",
          title: "บันทึกตำแหน่งแล้ว",
          message: `[${finalLocId}] ${shortName(prodName)}`,
        });
        setBarcodeInput("");
        isProcessingRef.current = false;
        return;
      }
    }

    // Step 3: Neither Product nor Location
    setScanFeedback({
      type: "error",
      title: "ไม่พบในระบบ",
      message: `"${code}" ไม่ตรงกับสินค้า/ตำแหน่ง — ต้องตรงทุกหลัก`,
    });
    setBarcodeInput("");
    setTimeout(() => {
      setScanFeedback(null);
    }, 4000);

    isProcessingRef.current = false;
  }, [step, locations, products, activeWhId, watchLines, confirmedLines, setValue, insert, moveLineToTop, setLocations, setProducts]);

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

    const missingLocIdx: number[] = [];

    const cleanedLines = data.lines.map((l, idx) => {
      // The line's own location is authoritative — index-keyed manual input is only a fallback,
      // and a missing location must block submission instead of guessing a default shelf
      const locToUse = l.location_id?.trim()
        ? l.location_id.trim()
        : (locationInputs[idx]?.trim() ? locationInputs[idx].trim() : "");
      if (!locToUse) missingLocIdx.push(idx + 1);
      const extraLocs = Array.isArray(l.extra_locations) ? l.extra_locations.filter((x: string) => Boolean(x && x.trim())) : [];
      const extraQtys = Array.isArray((l as any).extra_qtys) ? (l as any).extra_qtys : [];
      const primaryQty = typeof (l as any).primary_qty === "number"
        ? (l as any).primary_qty
        : extraLocs.length > 0
        ? Math.max(0, (Number(l.qty) || 0) - extraQtys.reduce((sum: number, q: number) => sum + (Number(q) || 1), 0))
        : Number(l.qty) || 0;

      const allocations = [
        { location_id: locToUse, qty: primaryQty },
        ...extraLocs.map((loc: string, i: number) => ({ location_id: loc, qty: Number(extraQtys[i]) || 1 })),
      ];

      return {
        product_id: l.product_id,
        location_id: locToUse,
        primary_qty: primaryQty,
        extra_locations: extraLocs,
        extra_qtys: extraQtys,
        location_allocations: allocations,
        boxes: Number(l.boxes) || 1,
        qty: Number(l.qty) || 0,
        barcode: l.barcode || "",
      };
    });

    if (missingLocIdx.length > 0) {
      setError(`กรุณาสแกน/เลือกตำแหน่งวางสินค้าให้ครบทุกรายการ (ขาด: รายการที่ ${missingLocIdx.join(", ")})`);
      setConfirmModalOpen(false);
      return;
    }

    try {
      const res = await fetch("/api/movements/receive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          lines: cleanedLines,
          created_by_name: user?.name || undefined,
          user_name: user?.name || undefined,
        }),
      });
      const json = await res.json();
      if (json.success) {
        if (typeof window !== "undefined") {
          localStorage.removeItem(RECEIVE_DRAFT_KEY);
        }
        refreshWarehouseData();
        setSuccessMessage(typeof json.message === "string" && json.message ? json.message : "ส่งรายการรับสินค้าไปรออนุมัติแล้ว");
        setSubmitted(true);
        setConfirmModalOpen(false);
      } else {
        setError(json.message || "เกิดข้อผิดพลาดในการบันทึกเอกสารรับสินค้า");
      }
    } catch (err: unknown) {
      // Network failures must show friendly Thai text, never the raw browser message
      const isNetworkError = err instanceof TypeError || (err instanceof Error && /failed to fetch|networkerror|load failed/i.test(err.message));
      setError(
        isNetworkError
          ? "เน็ตขัดข้อง กรุณาตรวจสอบอินเทอร์เน็ตแล้วกดยืนยันอีกครั้ง — รายการเดิมยังอยู่ครบ"
          : "ไม่สามารถเชื่อมต่อระบบได้ กรุณาลองใหม่อีกครั้ง"
      );
    }
  };

  const resetForm = () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem(RECEIVE_DRAFT_KEY);
    }
    refreshWarehouseData();
    setSubmitted(false);
    setStep(1);
    setSuccessMessage("");
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

    const existingIdx = currentLines.findIndex((l) => l.product_id === pid);
    if (existingIdx !== -1) {
      const currentBoxes = Number(currentLines[existingIdx].boxes) || 1;
      setValue(`lines.${existingIdx}.boxes`, currentBoxes + 1, { shouldValidate: true, shouldDirty: true });
      moveLineToTop(existingIdx);
      setScanFeedback({
        type: "success",
        title: `เพิ่ม 1 กล่อง — รวม ${currentBoxes + 1} กล่อง`,
        message: `[${product.sku}] ${shortName(product.product_name)}`,
      });
      } else {
        insert(0, {
        product_id: pid,
        location_id: "",
        extra_locations: [],
        extra_qtys: [],
        location_allocations: [],
        boxes: 1,
        qty: 0,
        barcode: product.barcode || product.sku || "",
      });
        setError("");
        setScanFeedback({
          type: "success",
          title: "นำเข้าสำเร็จ",
          message: `[${product.sku}] ${shortName(product.product_name)}`,
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
    insert,
    remove: removeLine,
    watchLines,
    submitted,
    error,
    setError,
    successMessage,
    barcodeInput,
    setBarcodeInput,
    barcodeInputRef,
    scanFeedback,
    setScanFeedback,
    lastScannedId,
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

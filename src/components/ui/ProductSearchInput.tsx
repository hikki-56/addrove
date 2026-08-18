"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import type { Product } from "@/types/models";

interface ProductSearchInputProps {
  value?: string;
  onChange?: (productId: string, product?: Product) => void;
  onSelectProduct?: (product: Product) => void;
  selectedProductIds?: string[];
  products: Product[];
  onQuickAdd?: () => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  size?: "default" | "lg";
}

export default function ProductSearchInput({
  value = "",
  onChange,
  onSelectProduct,
  selectedProductIds = [],
  products = [],
  onQuickAdd,
  placeholder = "พิมพ์รหัส SKU, ชื่อสินค้า หรือ บาร์โค้ด...",
  className = "",
  inputClassName = "",
  size = "default",
}: ProductSearchInputProps) {
  const [internalQuery, setInternalQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Aggregate products by SKU / product_id (summing quantities for items in different locations)
  const aggregatedProducts = useMemo(() => {
    if (!products || products.length === 0) return [];
    const map = new Map<string, Product>();

    for (const p of products) {
      const normSku = (p.sku || "").trim().toLowerCase().replace(/^prod-/, "");
      const normId = (p.product_id || "").trim().toLowerCase().replace(/^prod-/, "");
      const key = normSku || normId;
      if (!key) continue;

      const qty = p.quantity ?? p.total_quantity ?? 0;
      const existing = map.get(key);

      if (!existing) {
        map.set(key, {
          ...p,
          quantity: qty,
          total_quantity: qty,
        });
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

        map.set(key, {
          ...existing,
          quantity: newQty,
          total_quantity: newQty,
          location: combinedLoc,
        });
      }
    }

    return Array.from(map.values());
  }, [products]);

  // Sync display text with selected product value
  const selectedProduct = useMemo(() => {
    if (!value) return undefined;
    const cleanVal = value.trim().toLowerCase();
    return aggregatedProducts.find(
      (p) =>
        p.product_id.toLowerCase() === cleanVal ||
        p.sku.toLowerCase() === cleanVal ||
        (p.barcode && p.barcode.trim().toLowerCase() === cleanVal) ||
        p.product_id.toLowerCase() === `prod-${cleanVal}`
    );
  }, [value, aggregatedProducts]);

  const defaultDisplayText = useMemo(() => {
    if (selectedProduct) {
      const sup = selectedProduct.supplier ? `[${selectedProduct.supplier}] ` : "";
      return `${sup}${selectedProduct.sku} - ${selectedProduct.product_name}`;
    }
    return value || "";
  }, [selectedProduct, value]);

  const query = internalQuery !== null ? internalQuery : (onSelectProduct ? "" : defaultDisplayText);
  const setQuery = (newVal: string) => setInternalQuery(newVal);

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredProducts = useMemo(() => {
    if (!aggregatedProducts || aggregatedProducts.length === 0) return [];
    const trimmedQuery = query.trim().toLowerCase();

    if (!trimmedQuery || (!onSelectProduct && selectedProduct && `${selectedProduct.product_name} (${selectedProduct.sku})`.toLowerCase() === trimmedQuery)) {
      return aggregatedProducts;
    }

    return aggregatedProducts.filter((p) => {
      const sku = (p.sku || "").toLowerCase();
      const name = (p.product_name || "").toLowerCase();
      const barcode = (p.barcode || "").toLowerCase();
      const supplier = (p.supplier || "").toLowerCase();
      const category = (p.category || "").toLowerCase();

      return (
        sku.includes(trimmedQuery) ||
        name.includes(trimmedQuery) ||
        barcode.includes(trimmedQuery) ||
        supplier.includes(trimmedQuery) ||
        category.includes(trimmedQuery)
      );
    });
  }, [aggregatedProducts, query, selectedProduct, onSelectProduct]);

  // Slice to 50 for max performance & zero UI lag
  const displayedProducts = useMemo(() => filteredProducts.slice(0, 50), [filteredProducts]);

  const isLg = size === "lg";

  return (
    <div ref={containerRef} className={`relative w-full min-w-0 max-w-full ${className}`}>
      <div className="relative">
        <input
          type="text"
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            if (!e.target.value && onChange) {
              onChange("", undefined);
            }
          }}
          placeholder={placeholder}
          className={
            inputClassName ||
            `w-full ${
              isLg
                ? "px-5 py-4 rounded-2xl text-base sm:text-lg font-bold border-2 pr-12"
                : "px-3.5 py-2.5 rounded-xl text-sm font-semibold border pr-8"
            } bg-white border-slate-300 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/20 transition-all shadow-sm`
          }
        />

        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              if (onChange) onChange("", undefined);
              setOpen(true);
            }}
            className={`absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-900 p-1 cursor-pointer`}
          >
            <svg className={isLg ? "w-5 h-5" : "w-4 h-4"} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        ) : (
          <svg
            className={`${isLg ? "w-5 h-5 right-4" : "w-4 h-4 right-3"} text-slate-400 absolute top-1/2 -translate-y-1/2 pointer-events-none`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        )}
      </div>

      {/* Auto-complete Dropdown Popup */}
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1.5 z-[100] w-full max-w-full bg-white border border-slate-300 rounded-xl shadow-2xl overflow-hidden py-1 max-h-72 overflow-y-auto scale-in duration-100 text-slate-900">
          {onQuickAdd && (
            <div
              onClick={onQuickAdd}
              className="px-3.5 py-2 text-xs font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 cursor-pointer border-b border-slate-200 flex items-center gap-1.5 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span>+ เพิ่มสินค้าใหม่เข้าฐานข้อมูล</span>
            </div>
          )}

          <div className="px-3.5 py-1.5 text-[11px] font-medium text-slate-600 bg-slate-100 border-b border-slate-200 flex justify-between items-center">
            <span>รายการสินค้า (จาก Google Sheet)</span>
            <span className="text-indigo-600 font-mono font-bold">
              {filteredProducts.length > 50
                ? `แสดง 50 จาก ${filteredProducts.length.toLocaleString()} รายการ`
                : `${filteredProducts.length.toLocaleString()} รายการ`}
            </span>
          </div>

          {filteredProducts.length === 0 ? (
            <div className="px-3.5 py-4 text-xs text-slate-500 text-center font-medium">
              {products.length === 0 ? "ไม่มีสินค้าในโกดังนี้" : "ไม่พบสินค้าที่ตรงกับคำค้นหา"}
            </div>
          ) : (
            displayedProducts.map((p, idx) => {
              const isSelected = selectedProductIds.some(
                (id) =>
                  id.toLowerCase() === p.product_id.toLowerCase() ||
                  id.toLowerCase() === p.sku.toLowerCase()
              );

              return (
                <div
                  key={`${p.product_id}-${p.sku}-${idx}`}
                  onClick={() => {
                    if (onSelectProduct) {
                      onSelectProduct(p);
                      setQuery("");
                      setOpen(false);
                    } else if (onChange) {
                      onChange(p.product_id, p);
                      const sup = p.supplier ? `[${p.supplier}] ` : "";
                      const bar = p.barcode && p.barcode !== p.sku ? ` (${p.barcode})` : "";
                      setQuery(`${sup}${p.sku}${bar} - ${p.product_name}`);
                      setOpen(false);
                    }
                  }}
                  className={`px-3.5 py-2.5 text-sm cursor-pointer transition-colors border-b border-slate-100 last:border-0 ${
                    isSelected
                      ? "bg-emerald-50/80 text-emerald-900 font-semibold border-l-4 border-emerald-500"
                      : p.product_id === value || p.sku === value
                      ? "bg-indigo-50 text-indigo-900 font-semibold border-l-4 border-indigo-600"
                      : "text-slate-900 hover:bg-slate-100"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3 py-1.5">
                    <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                      {/* บรรทัดที่ 1: เลขบาร์โค้ดขนาดใหญ่ */}
                      <div className="text-slate-950 font-mono font-black text-base sm:text-lg tracking-wide truncate">
                        {p.barcode || p.sku}
                      </div>

                      {/* บรรทัดที่ 2: [ผู้จำหน่าย] | [SKU] */}
                      <div className="flex items-center gap-x-2 text-xs sm:text-sm text-slate-500 font-medium truncate">
                        {p.supplier ? (
                          <>
                            <span className="text-slate-800 font-bold">{p.supplier}</span>
                            <span className="text-slate-300">|</span>
                          </>
                        ) : null}
                        <span className="font-mono text-slate-700">{p.sku}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {/* Far Right: Stock Balance Text (Black & Frameless) */}
                      <div className="text-right shrink-0">
                        <span className="text-xs text-black font-bold">
                          คงเหลือ <strong className="text-black font-mono font-extrabold text-xs sm:text-sm">{(p.quantity ?? p.total_quantity ?? 0).toLocaleString()}</strong> ชิ้น
                        </span>
                      </div>

                      {isSelected && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 shrink-0">
                          ✓ เลือกแล้ว
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

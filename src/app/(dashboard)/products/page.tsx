"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import type { Product, Warehouse } from "@/types/models";
import { STOCK_STATUS_META, getStockStatus, type StockStatus } from "@/lib/stock-status";
import { useRouter } from "next/navigation";
import CustomSelect from "@/components/ui/CustomSelect";

const STATUS_OPTIONS: StockStatus[] = ["NORMAL", "LOW", "OUT", "NEGATIVE"];

const statusMeta = (s?: string) =>
  STOCK_STATUS_META[(s as StockStatus) || "NORMAL"] ?? STOCK_STATUS_META.NORMAL;

const resolveStatus = (p: Product): StockStatus =>
  p.stock_status ?? getStockStatus(Number(p.total_quantity ?? p.quantity ?? 0), Number(p.minimum_stock ?? 0));

const WAREHOUSE_ICON = (
  <svg className="w-3.5 h-3.5 text-[#0F5C3F] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
  </svg>
);

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [warehouses, setWarehouses] = useState<Warehouse[] | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  // ตัวเลขสรุปรวม (ไม่เปลี่ยนตามตัวกรอง) — null = ยังไม่ได้โหลด
  const [grandProductCount, setGrandProductCount] = useState<number | null>(null);
  const [totalLocationsCount, setTotalLocationsCount] = useState<number | null>(null);
  const [totalStockSum, setTotalStockSum] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [expandedSku, setExpandedSku] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterWarehouse, setFilterWarehouse] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterStatus, setFilterStatus] = useState<StockStatus | "">("");

  // Server-side Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number | "ALL">(10);

  const router = useRouter();

  // Debounce คำค้นหา — ส่งคำขอเมื่อหยุดพิมพ์แล้ว ไม่ใช่ทุก keystroke
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setCurrentPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  // Fetch initial metadata (warehouses, locations, categories & total stock)
  useEffect(() => {
    Promise.all([
      fetch("/api/warehouses").then((r) => r.json()).catch(() => ({ success: false })),
      fetch("/api/locations").then((r) => r.json()).catch(() => ({ success: false })),
      fetch("/api/products?limit=1000").then((r) => r.json()).catch(() => ({ success: false })),
    ]).then(([whRes, locRes, prodRes]) => {
      if (whRes.success && Array.isArray(whRes.data)) {
        setWarehouses(whRes.data);
      }
      if (locRes.success && Array.isArray(locRes.data)) {
        setTotalLocationsCount(locRes.data.length);
      }
      if (prodRes.success) {
        const items: Product[] = Array.isArray(prodRes.data)
          ? prodRes.data
          : prodRes.data?.items || [];
        const cats = Array.from(new Set(items.map((p) => p.category).filter(Boolean)));
        setCategories(cats as string[]);
        setGrandProductCount(items.length);
        const sum = items.reduce(
          (acc, p) => acc + (Number(p.total_quantity ?? p.quantity ?? 0) || 0),
          0
        );
        setTotalStockSum(sum);
      }
    });
  }, []);

  // Server-side fetch products based on page, limit, search, category, and status
  const loadProducts = useCallback(() => {
    setLoading(true);
    setLoadError(false);
    const params = new URLSearchParams();
    params.set("page", String(currentPage));
    params.set("limit", String(pageSize));
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (filterCategory) params.set("category", filterCategory);
    if (filterStatus) params.set("status", filterStatus);
    if (filterWarehouse) params.set("warehouse_id", filterWarehouse);

    params.set("_t", String(Date.now()));

    fetch(`/api/products?${params.toString()}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!d.success) throw new Error("products fetch failed");
        if (d.data && typeof d.data === "object" && "items" in d.data) {
          setProducts(d.data.items);
          setTotalItems(d.data.total);
          setTotalPages(d.data.totalPages);
        } else if (Array.isArray(d.data)) {
          setProducts(d.data);
          setTotalItems(d.data.length);
          setTotalPages(1);
        }
        setExpandedSku(null);
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [currentPage, pageSize, debouncedSearch, filterCategory, filterStatus, filterWarehouse]);

  useEffect(() => {
    loadProducts();
    const handleUpdate = () => loadProducts();
    window.addEventListener("stockify-product-updated", handleUpdate);
    window.addEventListener("stockify-stock-updated", handleUpdate);
    return () => {
      window.removeEventListener("stockify-product-updated", handleUpdate);
      window.removeEventListener("stockify-stock-updated", handleUpdate);
    };
  }, [loadProducts]);

  const handleCategoryChange = (val: string) => {
    setFilterCategory(val);
    setCurrentPage(1);
  };

  const handleStatusChange = (val: StockStatus | "") => {
    setFilterStatus(val);
    setCurrentPage(1);
  };

  const handlePageSizeChange = (val: number | "ALL") => {
    setPageSize(val);
    setCurrentPage(1);
  };

  const hasActiveFilters = Boolean(debouncedSearch || filterWarehouse || filterCategory || filterStatus);

  const resetFilters = () => {
    setSearch("");
    setFilterWarehouse("");
    setFilterCategory("");
    setFilterStatus("");
    setCurrentPage(1);
  };

  const effectiveLimit = pageSize === "ALL" ? totalItems || 1 : Number(pageSize);
  const startIndex = (currentPage - 1) * effectiveLimit;
  const endIndex = pageSize === "ALL" ? totalItems : Math.min(startIndex + effectiveLimit, totalItems);

  const warehouseTotalsFor = (p: Product) => {
    const whTotals = new Map<string, { name: string; qty: number }>();
    (p.locations_breakdown ?? []).forEach((e) => {
      const key = e.warehouse_id || e.warehouse_name;
      const cur = whTotals.get(key) || { name: e.warehouse_name, qty: 0 };
      cur.qty += Number(e.quantity) || 0;
      whTotals.set(key, cur);
    });
    return Array.from(whTotals.values());
  };

  const displayProducts = useMemo(() => {
    const seen = new Set<string>();
    return products.filter((p) => {
      const key = (p.sku || "").trim().toLowerCase().replace(/^prod-/, "");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [products]);

  const grandValue = (v: number | null, unit: string) =>
    v === null ? (
      <span className="text-slate-400">—</span>
    ) : (
      <>
        {v.toLocaleString()}{" "}
        <span className="text-xs font-normal">{unit}</span>
      </>
    );

  const showEmptyState = !loading && !loadError && displayProducts.length === 0;

  return (
    <div className="w-full space-y-6 print:hidden">
      {/* Top Header Row */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pt-1">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
            สินค้าทั้งหมด
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-slate-500 font-medium">
            รายการสินค้าและยอดคงเหลือรวมทุกคลัง — กดที่ชื่อสินค้าเพื่อดูแยกตามโกดัง
          </p>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-3">
          {/* Action: เพิ่มสินค้าใหม่ */}
          <button
            type="button"
            onClick={() => router.push("/products/new")}
            className="px-4 py-2.5 rounded-2xl bg-[#06402B] hover:bg-[#053425] text-white text-xs sm:text-sm font-extrabold flex items-center justify-center gap-2 shadow-md shadow-[#06402B]/20 transition-all cursor-pointer active:scale-98"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.25} d="M12 4v16m8-8H4" />
            </svg>
            <span>เพิ่มสินค้าใหม่</span>
          </button>

        </div>
      </div>

      {/* Filter and Search Bar Row */}
      <div className="flex flex-col sm:flex-row flex-wrap lg:flex-nowrap gap-2.5 md:gap-3 items-stretch sm:items-center w-full">
        {/* Search Input Box */}
        <div className="relative flex-1 min-w-[200px] bg-slate-50 rounded-xl border border-[#E8ECEA] focus-within:bg-white focus-within:border-[#0F5C3F] focus-within:ring-2 focus-within:ring-[#0F5C3F]/20 overflow-hidden transition-all">
          <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            id="product-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหารหัสสินค้า บาร์โค้ด หรือชื่อสินค้า"
            aria-label="ค้นหารหัสสินค้า บาร์โค้ด หรือชื่อสินค้า"
            className="w-full h-10 pl-10 pr-3.5 bg-transparent text-slate-900 font-medium placeholder-slate-500 text-xs sm:text-sm outline-none"
          />
        </div>

        {/* Warehouse Dropdown Filter */}
        <div className="w-full sm:w-36 shrink-0">
          <CustomSelect
            value={filterWarehouse}
            onChange={(val) => {
              setFilterWarehouse(val);
              setCurrentPage(1);
            }}
            options={(warehouses ?? []).map((w) => ({ value: w.warehouse_id, label: w.warehouse_name }))}
            placeholder="ทุกโกดัง"
            visibleOptions={4}
          />
        </div>

        {/* Status Dropdown Filter */}
        <div className="w-full sm:w-40 shrink-0">
          <CustomSelect
            value={filterStatus}
            onChange={(val) => handleStatusChange(val as StockStatus | "")}
            options={STATUS_OPTIONS.map((st) => ({ value: st, label: statusMeta(st).label }))}
            placeholder="ทุกสถานะ"
            visibleOptions={4}
          />
        </div>

        {/* Category Dropdown Filter */}
        <div className="w-full sm:w-56 shrink-0">
          <CustomSelect
            value={filterCategory}
            onChange={handleCategoryChange}
            options={categories.map((c) => ({ value: c, label: c }))}
            placeholder="ทุกหมวดหมู่"
            visibleOptions={4}
          />
        </div>

        {/* Reset filters (appears only when a filter is active) */}
        {hasActiveFilters && (
          <button
            type="button"
            onClick={resetFilters}
            className="px-4 h-10 bg-slate-50 hover:bg-slate-100/80 hover:border-[#D5DDD9] rounded-xl border border-[#E8ECEA] text-slate-600 text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-all cursor-pointer shrink-0 active:scale-95"
          >
            <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M6 18L18 6M6 6l12 12" />
            </svg>
            <span>ล้างตัวกรอง</span>
          </button>
        )}
      </div>

      {/* 4 Summary Stat Cards Grid — ตัวเลขรวมทั้งระบบ ไม่เปลี่ยนตามตัวกรอง */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Card 1: สินค้าทั้งหมด */}
        <div className="bg-white rounded-2xl p-4 border border-[#E8ECEA]/80 shadow-2xs">
          <div className="min-w-0">
            <div className="text-xs text-slate-500 font-semibold truncate">สินค้าทั้งหมด</div>
            <div className="text-lg sm:text-xl font-black text-slate-900 leading-tight num">
              {grandValue(grandProductCount, "รายการ")}
            </div>
          </div>
        </div>

        {/* Card 2: โกดังทั้งหมด */}
        <div className="bg-white rounded-2xl p-4 border border-[#E8ECEA]/80 shadow-2xs">
          <div className="min-w-0">
            <div className="text-xs text-slate-500 font-semibold truncate">โกดังทั้งหมด</div>
            <div className="text-lg sm:text-xl font-black text-slate-900 leading-tight num">
              {grandValue(warehouses === null ? null : warehouses.length, "โกดัง")}
            </div>
          </div>
        </div>

        {/* Card 3: ตำแหน่งทั้งหมด */}
        <div className="bg-white rounded-2xl p-4 border border-[#E8ECEA]/80 shadow-2xs">
          <div className="min-w-0">
            <div className="text-xs text-slate-500 font-semibold truncate">ตำแหน่งทั้งหมด</div>
            <div className="text-lg sm:text-xl font-black text-slate-900 leading-tight num">
              {grandValue(totalLocationsCount, "ตำแหน่ง")}
            </div>
          </div>
        </div>

        {/* Card 4: สินค้าคงเหลือรวม */}
        <div className="bg-white rounded-2xl p-4 border border-[#E8ECEA]/80 shadow-2xs">
          <div className="min-w-0">
            <div className="text-xs text-slate-500 font-semibold truncate">สินค้าคงเหลือรวม</div>
            <div className="text-lg sm:text-xl font-black text-[#06402B] leading-tight num">
              {totalStockSum === null ? (
                <span className="text-slate-400">—</span>
              ) : (
                <>
                  {totalStockSum.toLocaleString()}{" "}
                  <span className="text-xs font-bold text-[#06402B]">ชิ้น</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* เนื้อหาหลัก: โหลด / ผิดพลาด / ว่าง / ตาราง */}
      {loadError ? (
        <div className="bg-white rounded-2xl sm:rounded-3xl border border-rose-200/80 shadow-sm px-6 py-12 sm:py-14 text-center">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-rose-50 border border-rose-200/70 flex items-center justify-center">
            <svg className="w-6 h-6 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          </div>
          <p className="mt-4 text-sm font-extrabold text-slate-900">โหลดข้อมูลสินค้าไม่สำเร็จ</p>
          <p className="mt-1 text-xs text-slate-500 font-medium">
            เชื่อมต่อฐานข้อมูลไม่ได้ในขณะนี้ — ตรวจสายเน็ตแล้วลองอีกครั้ง
          </p>
          <button
            type="button"
            onClick={loadProducts}
            className="mt-5 px-4 py-2.5 rounded-xl bg-[#06402B] hover:bg-[#053425] text-white text-xs sm:text-sm font-extrabold shadow-md shadow-[#06402B]/20 transition-all cursor-pointer active:scale-98"
          >
            ลองโหลดอีกครั้ง
          </button>
        </div>
      ) : showEmptyState ? (
        <div className="bg-white rounded-2xl sm:rounded-3xl border border-[#E8ECEA]/90 shadow-sm px-6 py-12 sm:py-14 text-center">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-[#EAF2EE] border border-[#C9DFD4]/60 flex items-center justify-center">
            <svg className="w-6 h-6 text-[#0F5C3F]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M21 8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16Z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="m3.3 7 8.7 5 8.7-5" />
            </svg>
          </div>
          <p className="mt-4 text-sm font-extrabold text-slate-900">
            {hasActiveFilters ? "ไม่พบสินค้าที่ตรงเงื่อนไข" : "ยังไม่มีรายการสินค้า"}
          </p>
          <p className="mt-1 text-xs text-slate-500 font-medium">
            {hasActiveFilters
              ? "ลองปรับคำค้นหาหรือตัวกรอง แล้วค้นหาใหม่อีกครั้ง"
              : "เพิ่มสินค้าแรกเพื่อเริ่มบันทึกยอดคงเหลือและตำแหน่งจัดเก็บ"}
          </p>
          <div className="mt-5">
            {hasActiveFilters ? (
              <button
                type="button"
                onClick={resetFilters}
                className="px-4 py-2.5 rounded-xl bg-slate-50 hover:bg-slate-100/80 border border-[#E8ECEA] hover:border-[#D5DDD9] text-slate-700 text-xs sm:text-sm font-bold transition-all cursor-pointer active:scale-95"
              >
                ล้างตัวกรองทั้งหมด
              </button>
            ) : (
              <button
                type="button"
                onClick={() => router.push("/products/new")}
                className="px-4 py-2.5 rounded-xl bg-[#06402B] hover:bg-[#053425] text-white text-xs sm:text-sm font-extrabold shadow-md shadow-[#06402B]/20 transition-all cursor-pointer active:scale-98"
              >
                เพิ่มสินค้าใหม่
              </button>
            )}
          </div>
        </div>
      ) : loading ? (
        <>
          {/* Desktop skeleton */}
          <div className="hidden sm:block bg-white rounded-3xl border border-[#E8ECEA]/90 shadow-sm overflow-hidden" role="status" aria-live="polite">
            <span className="sr-only">กำลังโหลดข้อมูลสินค้า</span>
            <div className="overflow-hidden">
              <table className="w-full text-left text-xs sm:text-sm">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 font-semibold">
                    {["บาร์โค้ด", "SKU", "ชื่อสินค้า", "หมวดหมู่", "หน่วย", "ขั้นต่ำ", "คงเหลือ", "สถานะ"].map((h) => (
                      <th key={h} className="py-3.5 px-4 font-semibold whitespace-nowrap border-b border-[#EEF1EF]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EEF1EF]">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <tr key={`sk-${i}`}>
                      {["w-24", "w-20", "w-44", "w-20", "w-12", "w-14", "w-14", "w-20"].map((w, j) => (
                        <td key={j} className="py-4 px-4">
                          <div className={`h-3 rounded-full bg-slate-100 animate-pulse ${w}`} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile skeleton */}
          <div className="sm:hidden space-y-3" role="status" aria-live="polite">
            <span className="sr-only">กำลังโหลดข้อมูลสินค้า</span>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={`msk-${i}`} className="bg-white rounded-2xl border border-[#E8ECEA]/90 shadow-2xs p-4 space-y-3">
                <div className="h-4 w-2/3 rounded-full bg-slate-100 animate-pulse" />
                <div className="h-3 w-1/3 rounded-full bg-slate-100 animate-pulse" />
                <div className="h-3 w-1/2 rounded-full bg-slate-100 animate-pulse" />
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          {/* Desktop: Main Table of Products */}
          <div className="hidden sm:block bg-white rounded-3xl border border-[#E8ECEA]/90 shadow-sm overflow-hidden">
            <div className="overflow-auto max-h-[60vh]">
              <table className="w-full text-left text-xs sm:text-sm">
                <thead>
                  <tr className="text-slate-500 font-semibold">
                    <th className="py-3.5 px-4 font-semibold whitespace-nowrap sticky top-0 z-10 bg-slate-50 border-b border-[#EEF1EF]">บาร์โค้ด</th>
                    <th className="py-3.5 px-4 font-semibold whitespace-nowrap sticky top-0 z-10 bg-slate-50 border-b border-[#EEF1EF]">SKU</th>
                    <th className="py-3.5 px-4 font-semibold whitespace-nowrap sticky top-0 z-10 bg-slate-50 border-b border-[#EEF1EF]">ชื่อสินค้า</th>
                    <th className="py-3.5 px-4 font-semibold whitespace-nowrap sticky top-0 z-10 bg-slate-50 border-b border-[#EEF1EF]">หมวดหมู่</th>
                    <th className="py-3.5 px-4 font-semibold whitespace-nowrap sticky top-0 z-10 bg-slate-50 border-b border-[#EEF1EF]">หน่วย</th>
                    <th className="py-3.5 px-4 font-semibold text-right whitespace-nowrap sticky top-0 z-10 bg-slate-50 border-b border-[#EEF1EF]">ขั้นต่ำ</th>
                    <th className="py-3.5 px-4 font-semibold text-right whitespace-nowrap sticky top-0 z-10 bg-slate-50 border-b border-[#EEF1EF]">คงเหลือ</th>
                    <th className="py-3.5 px-4 font-semibold whitespace-nowrap sticky top-0 z-10 bg-slate-50 border-b border-[#EEF1EF]">สถานะ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EEF1EF]">
                  {displayProducts.map((p: Product, idx: number) => {
                    const totalStock = Number(p.total_quantity ?? p.quantity ?? 0);
                    const status = resolveStatus(p);
                    const meta = statusMeta(status);
                    const rowKey =
                      (p.sku || "").trim().toLowerCase().replace(/^prod-/, "") || String(idx);
                    const isExpanded = expandedSku === rowKey;
                    const whList = warehouseTotalsFor(p);

                    return (
                      <React.Fragment key={`prod-row-${p.product_id || p.sku || idx}-${idx}`}>
                        <tr
                          onClick={() => setExpandedSku(isExpanded ? null : rowKey)}
                          className={`hover:bg-slate-50/80 transition-colors cursor-pointer ${
                            isExpanded ? "bg-[#EAF2EE]/40" : ""
                          }`}
                        >
                          {/* Barcode */}
                          <td className="py-3.5 px-4 font-mono num text-slate-600 text-xs whitespace-nowrap">
                            {p.barcode && p.barcode.trim() !== "-" ? p.barcode : "—"}
                          </td>

                          {/* SKU */}
                          <td className="py-3.5 px-4">
                            <span className="font-mono num font-bold text-[#053425] text-xs sm:text-sm whitespace-nowrap">
                              {p.sku}
                            </span>
                          </td>

                          {/* Product Name — ปุ่มขยายดูสต็อกแยกโกดัง (คีย์บอร์ดกดได้) */}
                          <td className="py-2 px-4 text-xs sm:text-sm max-w-[280px]">
                            <button
                              type="button"
                              onClick={() => setExpandedSku(isExpanded ? null : rowKey)}
                              aria-expanded={isExpanded}
                              className="w-full flex items-center gap-1 text-left font-bold text-slate-800 py-1 pr-1 rounded-lg -mx-1 px-1 cursor-pointer"
                            >
                              <span className="truncate" title={p.product_name}>
                                {p.product_name}
                              </span>
                              <svg
                                className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${
                                  isExpanded ? "rotate-180 text-[#0F5C3F]" : "text-slate-500"
                                }`}
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            </button>
                          </td>

                          {/* Category */}
                          <td className="py-3.5 px-4 text-slate-500 text-xs whitespace-nowrap">
                            {p.category || "—"}
                          </td>

                          {/* Unit */}
                          <td className="py-3.5 px-4 text-slate-500 text-xs font-medium whitespace-nowrap">
                            {p.base_unit || "ชิ้น"}
                          </td>

                          {/* Minimum Stock */}
                          <td className="py-3.5 px-4 font-mono num text-slate-600 text-xs text-right whitespace-nowrap">
                            {(Number(p.minimum_stock) || 0).toLocaleString()}
                          </td>

                          {/* Stock Quantity */}
                          <td className="py-3.5 px-4 font-mono num font-bold text-right text-xs sm:text-sm whitespace-nowrap">
                            <span className={totalStock < 0 ? "text-rose-600" : totalStock === 0 ? "text-slate-500" : "text-[#053425]"}>
                              {totalStock.toLocaleString()}
                            </span>
                          </td>

                          {/* Status Badge */}
                          <td className="py-3.5 px-4">
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border whitespace-nowrap ${meta.badge}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                              {meta.label}
                            </span>
                          </td>

                        </tr>

                        {/* แถวขยาย: สินค้านี้อยู่โกดังไหนกี่ชิ้น */}
                        {isExpanded && (
                          <tr className="bg-[#EAF2EE]/30">
                            <td colSpan={8} className="px-4 py-3">
                              <div className="rounded-xl border border-[#C9DFD4]/60 bg-white p-3.5 flex flex-wrap items-center gap-2">
                                <span className="text-xs font-extrabold text-slate-700 mr-1">อยู่ในโกดัง:</span>
                                {whList.length === 0 ? (
                                  <span className="text-xs text-slate-500 font-medium">
                                    ยังไม่มีข้อมูลโกดังของสินค้านี้
                                  </span>
                                ) : (
                                  whList.map((w) => (
                                    <span
                                      key={w.name}
                                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 border border-[#E8ECEA] text-xs"
                                    >
                                      {WAREHOUSE_ICON}
                                      <span className="font-bold text-slate-700">{w.name}</span>
                                      <span className="font-mono num font-extrabold text-[#053425]">
                                        {w.qty.toLocaleString()}
                                      </span>
                                      <span className="text-slate-500 font-medium">{p.base_unit || "ชิ้น"}</span>
                                    </span>
                                  ))
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination Footer */}
            <div className="p-4 border-t border-[#EEF1EF] flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500 bg-white">
              {/* Range text */}
              <div className="text-slate-500 font-medium num">
                แสดง {totalItems > 0 ? startIndex + 1 : 0}-{endIndex} จาก {totalItems.toLocaleString()} รายการ
              </div>

              {/* Numeric Page Buttons */}
              <nav className="flex items-center gap-1.5 select-none" aria-label="เปลี่ยนหน้า">
                <button
                  type="button"
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                  className="w-8 h-8 rounded-lg bg-slate-50 hover:bg-slate-100 border border-[#E8ECEA] text-slate-600 flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed transition-all font-bold cursor-pointer"
                  aria-label="หน้าก่อนหน้า"
                >
                  ‹
                </button>

                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter((p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
                  .map((p, i, arr) => {
                    const prev = arr[i - 1];
                    const showDots = prev && p - prev > 1;
                    return (
                      <React.Fragment key={`page-${p}`}>
                        {showDots && <span className="px-1 text-slate-400">...</span>}
                        <button
                          type="button"
                          onClick={() => setCurrentPage(p)}
                          aria-current={currentPage === p ? "page" : undefined}
                          className={`w-8 h-8 rounded-lg font-bold text-xs flex items-center justify-center transition-all cursor-pointer num ${
                            currentPage === p
                              ? "bg-[#06402B] text-white shadow-sm shadow-[#06402B]/30"
                              : "bg-white hover:bg-slate-50 border border-[#E8ECEA] text-slate-700"
                          }`}
                        >
                          {p}
                        </button>
                      </React.Fragment>
                    );
                  })}

                <button
                  type="button"
                  disabled={currentPage === totalPages || totalPages === 0}
                  onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
                  className="w-8 h-8 rounded-lg bg-slate-50 hover:bg-slate-100 border border-[#E8ECEA] text-slate-600 flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed transition-all font-bold cursor-pointer"
                  aria-label="หน้าถัดไป"
                >
                  ›
                </button>
              </nav>

              {/* Page Size Selector */}
              <div className="flex items-center gap-2">
                <select
                  value={pageSize}
                  onChange={(e) => handlePageSizeChange(e.target.value === "ALL" ? "ALL" : Number(e.target.value))}
                  aria-label="จำนวนรายการต่อหน้า"
                  className="px-3 py-1.5 rounded-xl bg-white border border-[#E8ECEA] text-slate-700 text-xs font-bold focus:outline-none focus:border-[#0F5C3F] focus:ring-2 focus:ring-[#0F5C3F]/20 cursor-pointer shadow-2xs"
                >
                  {[10, 20, 30, 50, 100, "ALL"].map((size) => (
                    <option key={`ps-${size}`} value={size}>
                      {size === "ALL" ? "ทั้งหมด / หน้า" : `${size} / หน้า`}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Mobile: รายการสินค้าแบบการ์ด */}
          <div className="sm:hidden space-y-3">
            {displayProducts.map((p: Product, idx: number) => {
              const totalStock = Number(p.total_quantity ?? p.quantity ?? 0);
              const status = resolveStatus(p);
              const meta = statusMeta(status);
              const rowKey =
                (p.sku || "").trim().toLowerCase().replace(/^prod-/, "") || String(idx);
              const isExpanded = expandedSku === rowKey;
              const whList = warehouseTotalsFor(p);

              return (
                <div
                  key={`prod-card-${p.product_id || idx}`}
                  className="bg-white rounded-2xl border border-[#E8ECEA]/90 shadow-2xs overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => setExpandedSku(isExpanded ? null : rowKey)}
                    aria-expanded={isExpanded}
                    className={`w-full text-left p-4 cursor-pointer transition-colors ${
                      isExpanded ? "bg-[#EAF2EE]/40" : "hover:bg-slate-50/60"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-extrabold text-slate-900 leading-snug">{p.product_name}</p>
                        <p className="mt-0.5 flex items-center gap-2 text-xs min-w-0">
                          <span className="font-mono num font-bold text-[#053425] shrink-0">{p.sku}</span>
                          {p.barcode && p.barcode.trim() !== "-" && (
                            <span className="font-mono num text-slate-500 truncate">{p.barcode}</span>
                          )}
                        </p>
                      </div>
                      <svg
                        className={`w-4 h-4 shrink-0 mt-1 transition-transform duration-200 ${
                          isExpanded ? "rotate-180 text-[#0F5C3F]" : "text-slate-500"
                        }`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-3 text-xs">
                      <span className="flex items-baseline gap-1.5 shrink-0">
                        <span className="text-[11px] font-bold text-slate-500">ขั้นต่ำ</span>
                        <span className="font-mono num font-bold text-slate-700">
                          {(Number(p.minimum_stock) || 0).toLocaleString()}
                        </span>
                      </span>
                      <span className="flex items-baseline gap-1.5 shrink-0">
                        <span className="text-[11px] font-bold text-slate-500">คงเหลือ</span>
                        <span
                          className={`font-mono num font-extrabold ${
                            totalStock < 0 ? "text-rose-600" : totalStock === 0 ? "text-slate-500" : "text-[#053425]"
                          }`}
                        >
                          {totalStock.toLocaleString()}
                        </span>
                      </span>
                      <span className="flex items-baseline gap-1.5 min-w-0">
                        <span className="text-[11px] font-bold text-slate-500 shrink-0">หน่วย</span>
                        <span className="font-bold text-slate-700 truncate">{p.base_unit || "ชิ้น"}</span>
                      </span>
                    </div>

                    <div className="mt-2.5 flex items-center justify-between gap-2">
                      <span className="text-[11px] text-slate-500 font-medium truncate">
                        {p.category || "ไม่ระบุหมวดหมู่"}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border whitespace-nowrap ${meta.badge}`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                        {meta.label}
                      </span>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-4">
                      <div className="rounded-xl border border-[#C9DFD4]/60 bg-white p-3 flex flex-wrap items-center gap-2">
                        <span className="text-xs font-extrabold text-slate-700 mr-1">อยู่ในโกดัง:</span>
                        {whList.length === 0 ? (
                          <span className="text-xs text-slate-500 font-medium">
                            ยังไม่มีข้อมูลโกดังของสินค้านี้
                          </span>
                        ) : (
                          whList.map((w) => (
                            <span
                              key={w.name}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 border border-[#E8ECEA] text-xs"
                            >
                              {WAREHOUSE_ICON}
                              <span className="font-bold text-slate-700">{w.name}</span>
                              <span className="font-mono num font-extrabold text-[#053425]">
                                {w.qty.toLocaleString()}
                              </span>
                              <span className="text-slate-500 font-medium">{p.base_unit || "ชิ้น"}</span>
                            </span>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Mobile: pagination แบบกระชับ */}
      {!loading && !loadError && totalItems > 0 && (
        <div className="sm:hidden bg-white rounded-2xl border border-[#E8ECEA]/90 shadow-2xs p-3 flex items-center justify-between gap-2 text-xs text-slate-500">
          <span className="font-medium num">
            แสดง {totalItems > 0 ? startIndex + 1 : 0}-{endIndex} จาก {totalItems.toLocaleString()}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((pg) => Math.max(pg - 1, 1))}
              className="w-8 h-8 rounded-lg bg-slate-50 hover:bg-slate-100 border border-[#E8ECEA] text-slate-600 flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed transition-all font-bold cursor-pointer"
              aria-label="หน้าก่อนหน้า"
            >
              ‹
            </button>
            <span className="font-bold text-slate-700 px-1 num">
              {currentPage} / {totalPages}
            </span>
            <button
              type="button"
              disabled={currentPage === totalPages || totalPages === 0}
              onClick={() => setCurrentPage((pg) => Math.min(pg + 1, totalPages))}
              className="w-8 h-8 rounded-lg bg-slate-50 hover:bg-slate-100 border border-[#E8ECEA] text-slate-600 flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed transition-all font-bold cursor-pointer"
              aria-label="หน้าถัดไป"
            >
              ›
            </button>
          </div>
        </div>
      )}

    </div>
  );
}

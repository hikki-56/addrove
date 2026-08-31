"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useEscapeKey } from "@/hooks/use-escape-key";
import type { Product, Warehouse } from "@/types/models";
import { useRouter } from "next/navigation";

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [totalLocationsCount, setTotalLocationsCount] = useState(0);
  const [totalStockSum, setTotalStockSum] = useState(0);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState("");
  const [filterWarehouse, setFilterWarehouse] = useState("");
  const [filterCategory, setFilterCategory] = useState("");

  // Server-side Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number | "ALL">(10);

  // Accordion & Edit Modal State
  const [expandedSku, setExpandedSku] = useState<string | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState("");

  useEscapeKey(!!editingProduct, () => setEditingProduct(null));

  const router = useRouter();

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
        const sum = items.reduce(
          (acc, p) => acc + (Number(p.total_quantity ?? p.quantity ?? p.minimum_stock ?? 0) || 0),
          0
        );
        setTotalStockSum(sum);
      }
    });
  }, []);

  // Server-side fetch products based on page, limit, search, and category
  const loadProducts = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set("page", String(currentPage));
    params.set("limit", String(pageSize));
    if (search) params.set("search", search);
    if (filterCategory) params.set("category", filterCategory);
    if (filterWarehouse) params.set("warehouse_id", filterWarehouse);

    params.set("_t", String(Date.now()));

    fetch(`/api/products?${params.toString()}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          if (d.data && typeof d.data === "object" && "items" in d.data) {
            setProducts(d.data.items);
            setTotalItems(d.data.total);
            setTotalPages(d.data.totalPages);
          } else if (Array.isArray(d.data)) {
            setProducts(d.data);
            setTotalItems(d.data.length);
            setTotalPages(1);
          }
        }
      })
      .finally(() => setLoading(false));
  }, [currentPage, pageSize, search, filterCategory, filterWarehouse]);

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

  // Reset page to 1 when filters change
  const handleSearchChange = (val: string) => {
    setSearch(val);
    setCurrentPage(1);
  };

  const handleCategoryChange = (val: string) => {
    setFilterCategory(val);
    setCurrentPage(1);
  };

  const handlePageSizeChange = (val: number | "ALL") => {
    setPageSize(val);
    setCurrentPage(1);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct) return;
    setSaving(true);
    setEditError("");

    try {
      const res = await fetch(`/api/products/${editingProduct.product_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku: editingProduct.sku,
          barcode: editingProduct.barcode,
          product_name: editingProduct.product_name,
          category: editingProduct.category,
          base_unit: editingProduct.base_unit,
          minimum_stock: Number(editingProduct.minimum_stock),
          description: editingProduct.description,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setEditingProduct(null);
        loadProducts();
      } else {
        setEditError(json.message);
      }
    } catch (err: any) {
      setEditError(err.message || "เกิดข้อผิดพลาดในการบันทึก");
    } finally {
      setSaving(false);
    }
  };

  const effectiveLimit = pageSize === "ALL" ? totalItems || 1 : Number(pageSize);
  const startIndex = (currentPage - 1) * effectiveLimit;
  const endIndex = pageSize === "ALL" ? totalItems : Math.min(startIndex + effectiveLimit, totalItems);

  const defaultWarehouses = [
    { id: "wh-1", name: "โกดัง 1" },
    { id: "wh-2", name: "โกดัง 2" },
    { id: "wh-3", name: "โกดัง 3" },
    { id: "wh-4", name: "โกดัง 4" },
    { id: "wh-5", name: "โกดัง 5" },
    { id: "wh-6", name: "สำนักงานใหญ่" },
  ];

  const getWarehouseName = (whId?: string) => {
    if (!whId) return "โกดัง 1";
    const found = warehouses.find((w) => w.warehouse_id === whId);
    return found?.warehouse_name || whId.replace(/^wh-/, "โกดัง ");
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

  return (
    <div className="w-full space-y-6">
      {/* Top Header & Breadcrumbs Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
            สินค้าทั้งหมด
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 font-medium mt-0.5">
            ดูตำแหน่งและจำนวนสินค้าคงเหลือในทุกโกดัง
          </p>
        </div>

        {/* Breadcrumbs */}
        <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
          <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
          <span>คลังสินค้า</span>
          <span className="text-slate-300">/</span>
          <span className="text-slate-800 font-bold">สินค้าทั้งหมด</span>
        </div>
      </div>

      {/* Filter and Search Bar Row (Fluid Responsive) */}
      <div className="flex flex-col sm:flex-row flex-wrap lg:flex-nowrap gap-2.5 md:gap-3 items-stretch sm:items-center w-full">
        {/* Search Input Box */}
        <div className="relative flex-1 min-w-[240px] bg-white rounded-2xl sm:rounded-l-2xl sm:rounded-r-none border border-slate-200/90 shadow-2xs focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/20 overflow-hidden transition-all">
          <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            id="product-search"
            type="text"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="ค้นหา รหัสสินค้า, Barcode, ชื่อสินค้า..."
            className="w-full pl-11 pr-4 py-3 bg-transparent text-slate-900 font-medium placeholder-slate-400 text-xs sm:text-sm outline-none"
          />
        </div>

        {/* Warehouse Dropdown Filter (Flat Rectangular) */}
        <div className="relative bg-white rounded-2xl sm:rounded-none border border-slate-200/90 shadow-2xs hover:border-slate-300 transition-all shrink-0">
          <div className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
          <select
            value={filterWarehouse}
            onChange={(e) => {
              setFilterWarehouse(e.target.value);
              setCurrentPage(1);
            }}
            className="w-full sm:w-auto pl-10 pr-9 py-3 bg-transparent text-slate-700 text-xs sm:text-sm font-semibold outline-none cursor-pointer appearance-none"
          >
            <option value="">ทุกโกดัง</option>
            {(warehouses.length > 0
              ? warehouses.map((w) => ({ id: w.warehouse_id, name: w.warehouse_name }))
              : defaultWarehouses
            ).map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <div className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>

        {/* Category Dropdown Filter (Flat Rectangular) */}
        <div className="relative bg-white rounded-2xl sm:rounded-none border border-slate-200/90 shadow-2xs hover:border-slate-300 transition-all shrink-0">
          <div className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
          </div>
          <select
            value={filterCategory}
            onChange={(e) => handleCategoryChange(e.target.value)}
            className="w-full sm:w-auto pl-10 pr-9 py-3 bg-transparent text-slate-700 text-xs sm:text-sm font-semibold outline-none cursor-pointer appearance-none"
          >
            <option value="">ทุกหมวดหมู่</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <div className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>

        {/* Additional Filters / Reset Button */}
        <button
          type="button"
          onClick={() => {
            setSearch("");
            setFilterWarehouse("");
            setFilterCategory("");
            setCurrentPage(1);
          }}
          className="px-4 py-3 bg-white hover:bg-slate-50 rounded-2xl sm:rounded-l-none sm:rounded-r-2xl border border-slate-200/90 text-slate-700 text-xs sm:text-sm font-bold flex items-center justify-center gap-2 shadow-2xs transition-all cursor-pointer shrink-0 active:scale-98"
        >
          <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
          <span>ตัวกรองเพิ่มเติม</span>
        </button>
      </div>

      {/* 4 Summary Stat Cards Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Card 1: สินค้าทั้งหมด */}
        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-2xs flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center justify-center shrink-0 shadow-2xs">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          </div>
          <div className="min-w-0">
            <div className="text-xs text-slate-500 font-semibold truncate">สินค้าทั้งหมด</div>
            <div className="text-lg sm:text-xl font-black text-slate-900 leading-tight">
              {totalItems > 0 ? totalItems.toLocaleString() : (displayProducts.length || 0).toLocaleString()}{" "}
              <span className="text-xs text-slate-500 font-normal">รายการ</span>
            </div>
          </div>
        </div>

        {/* Card 2: โกดังทั้งหมด */}
        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-2xs flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 border border-indigo-100 flex items-center justify-center shrink-0 shadow-2xs">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
          <div className="min-w-0">
            <div className="text-xs text-slate-500 font-semibold truncate">โกดังทั้งหมด</div>
            <div className="text-lg sm:text-xl font-black text-slate-900 leading-tight">
              {warehouses.length || defaultWarehouses.length}{" "}
              <span className="text-xs text-slate-500 font-normal">โกดัง</span>
            </div>
          </div>
        </div>

        {/* Card 3: ตำแหน่งทั้งหมด */}
        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-2xs flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-purple-50 text-purple-600 border border-purple-100 flex items-center justify-center shrink-0 shadow-2xs">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <div className="min-w-0">
            <div className="text-xs text-slate-500 font-semibold truncate">ตำแหน่งทั้งหมด</div>
            <div className="text-lg sm:text-xl font-black text-slate-900 leading-tight">
              {totalLocationsCount > 0 ? totalLocationsCount.toLocaleString() : "128"}{" "}
              <span className="text-xs text-slate-500 font-normal">ตำแหน่ง</span>
            </div>
          </div>
        </div>

        {/* Card 4: สินค้าคงเหลือรวม */}
        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-2xs flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-teal-50 text-teal-600 border border-teal-100 flex items-center justify-center shrink-0 shadow-2xs">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
          <div className="min-w-0">
            <div className="text-xs text-slate-500 font-semibold truncate">สินค้าคงเหลือรวม</div>
            <div className="text-lg sm:text-xl font-black text-emerald-600 leading-tight">
              {totalStockSum > 0 ? totalStockSum.toLocaleString() : "84,001"}{" "}
              <span className="text-xs font-bold text-emerald-600">ชิ้น</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Table of Products */}
      {loading ? (
        <div className="bg-white rounded-3xl p-12 text-center border border-slate-200 shadow-sm space-y-3">
          <div className="w-8 h-8 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs text-slate-500 font-semibold">กำลังโหลดข้อมูลสินค้า...</p>
        </div>
      ) : (
        <div className="bg-white rounded-3xl border border-slate-200/90 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead>
                <tr className="bg-slate-50/70 border-b border-slate-100 text-slate-500 font-semibold">
                  <th className="py-3.5 px-4 font-semibold">รหัสสินค้า</th>
                  <th className="py-3.5 px-4 font-semibold">บาร์โค้ด</th>
                  <th className="py-3.5 px-4 font-semibold">ชื่อสินค้า</th>
                  <th className="py-3.5 px-4 font-semibold">หมวดหมู่</th>
                  <th className="py-3.5 px-4 font-semibold">ตำแหน่ง</th>
                  <th className="py-3.5 px-4 font-semibold text-right">สินค้าคงเหลือ</th>
                  <th className="py-3.5 px-4 font-semibold">หน่วย</th>
                  <th className="py-3.5 px-4 font-semibold text-center">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {displayProducts.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-12 text-slate-400 font-medium">
                      ไม่พบข้อมูลสินค้าที่ตรงกับเงื่อนไข
                    </td>
                  </tr>
                ) : (
                  displayProducts.map((p: Product, idx: number) => {
                    const totalStock = p.total_quantity ?? p.quantity ?? p.minimum_stock ?? 0;
                    const isExpanded = expandedSku === p.sku;

                    const primaryLoc = p.locations_breakdown?.[0];
                    const whName = primaryLoc?.warehouse_name || getWarehouseName((p as any).warehouse_id);
                    const locCode = primaryLoc?.location && primaryLoc.location !== "-"
                      ? primaryLoc.location
                      : (p.location && p.location !== "-"
                      ? p.location
                      : "");

                    return (
                      <React.Fragment key={`prod-row-${p.product_id || p.sku || idx}-${idx}`}>
                        <tr
                          onClick={() => setExpandedSku(isExpanded ? null : p.sku)}
                          className={`hover:bg-slate-50/80 transition-colors cursor-pointer group ${
                            isExpanded ? "bg-emerald-50/40" : ""
                          }`}
                        >
                          {/* SKU with Chevron */}
                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-2">
                              <svg
                                className={`w-3.5 h-3.5 text-slate-400 group-hover:text-emerald-600 transition-transform duration-200 shrink-0 ${
                                  isExpanded ? "rotate-90 text-emerald-600" : ""
                                }`}
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                              </svg>
                              <span className="font-mono font-bold text-emerald-700 text-xs sm:text-sm">
                                {p.sku}
                              </span>
                            </div>
                          </td>

                          {/* Barcode */}
                          <td className="py-3.5 px-4 font-mono text-slate-600 text-xs">
                            {p.barcode && p.barcode.trim() !== "-" ? p.barcode : "-"}
                          </td>

                          {/* Product Name */}
                          <td className="py-3.5 px-4 font-bold text-slate-800 text-xs sm:text-sm max-w-[240px]">
                            <span className="truncate block" title={p.product_name}>
                              {p.product_name}
                            </span>
                          </td>

                          {/* Category */}
                          <td className="py-3.5 px-4 text-slate-500 text-xs">
                            {p.category || "-"}
                          </td>

                          {/* Location with Warehouse & Slot Badges */}
                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-100/80 shrink-0">
                                {whName}
                              </span>
                              {locCode ? (
                                <span className="px-2 py-0.5 rounded-md text-[11px] font-mono font-bold bg-blue-50 text-blue-700 border border-blue-100/80 shrink-0">
                                  {locCode}
                                </span>
                              ) : (
                                <span className="text-[11px] text-slate-400 font-mono">-</span>
                              )}
                              {p.locations_breakdown && p.locations_breakdown.length > 1 && (
                                <span className="text-[10px] text-slate-400 font-bold">
                                  +{p.locations_breakdown.length - 1}
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Stock Quantity */}
                          <td className="py-3.5 px-4 font-mono font-bold text-right text-emerald-700 text-xs sm:text-sm">
                            {totalStock.toLocaleString()}
                          </td>

                          {/* Unit */}
                          <td className="py-3.5 px-4 text-slate-500 text-xs font-medium">
                            {p.base_unit || "ชิ้น"}
                          </td>

                          {/* Action Button: ดูรายละเอียด */}
                          <td className="py-3.5 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedSku(isExpanded ? null : p.sku);
                              }}
                              className="px-3 py-1.5 rounded-full text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200/90 inline-flex items-center gap-1.5 transition-all shadow-2xs cursor-pointer active:scale-95 shrink-0"
                            >
                              <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                              </svg>
                              <span>ดูรายละเอียด</span>
                            </button>
                          </td>
                        </tr>

                        {/* Accordion Row */}
                        {isExpanded && (
                          <tr className="bg-emerald-50/20 border-b border-slate-100">
                            <td colSpan={8} className="p-4 sm:p-5">
                              <div className="rounded-2xl p-4 sm:p-5 bg-white border border-emerald-200/60 space-y-4 shadow-sm">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                                  <div className="flex items-center gap-2">
                                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                                    <h4 className="text-xs sm:text-sm font-extrabold text-slate-800">
                                      รายละเอียดสถานที่จัดเก็บในแต่ละโกดัง ({p.sku})
                                    </h4>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => setEditingProduct({ ...p })}
                                      className="px-3 py-1 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200/90 transition-all flex items-center gap-1 cursor-pointer"
                                    >
                                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                      </svg>
                                      แก้ไขข้อมูล
                                    </button>
                                    <span className="px-3 py-1 rounded-full text-xs font-mono font-extrabold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                      รวม {totalStock.toLocaleString()} {p.base_unit || "ชิ้น"}
                                    </span>
                                  </div>
                                </div>

                                <div className="overflow-x-auto">
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="text-slate-500 bg-slate-50/80 border-b border-slate-100 text-left">
                                        <th className="py-2.5 px-3.5 font-semibold">โกดัง</th>
                                        <th className="py-2.5 px-3.5 font-semibold">ตำแหน่ง</th>
                                        <th className="py-2.5 px-3.5 font-semibold text-right">จำนวนคงเหลือ</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                      {(p.locations_breakdown && p.locations_breakdown.length > 0
                                        ? p.locations_breakdown
                                        : [
                                            {
                                              warehouse_id: (p as any).warehouse_id || "wh-1",
                                              warehouse_name: whName,
                                              location: locCode || "-",
                                              quantity: totalStock,
                                            },
                                          ]
                                      ).map((locItem, lIdx) => (
                                        <tr key={`loc-sub-${lIdx}`} className="hover:bg-slate-50 transition-colors">
                                          <td className="py-2.5 px-3.5 font-bold text-slate-800">
                                            {locItem.warehouse_name}
                                          </td>
                                          <td className="py-2.5 px-3.5 font-mono font-bold text-blue-700">
                                            {locItem.location && locItem.location !== "-" ? locItem.location : "-"}
                                          </td>
                                          <td className="py-2.5 px-3.5 font-mono text-right font-extrabold text-emerald-700">
                                            {locItem.quantity.toLocaleString()} {p.base_unit || "ชิ้น"}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          <div className="p-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500 bg-white">
            {/* Range text */}
            <div className="text-slate-500 font-medium">
              แสดง {totalItems > 0 ? startIndex + 1 : 0}-{endIndex} จาก {totalItems.toLocaleString()} รายการ
            </div>

            {/* Numeric Page Buttons */}
            <div className="flex items-center gap-1.5 select-none">
              <button
                type="button"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                className="w-8 h-8 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-600 flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed transition-all font-bold cursor-pointer"
                title="หน้าก่อนหน้า"
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
                        className={`w-8 h-8 rounded-lg font-bold text-xs flex items-center justify-center transition-all cursor-pointer ${
                          currentPage === p
                            ? "bg-emerald-600 text-white shadow-sm shadow-emerald-600/30"
                            : "bg-white hover:bg-slate-50 border border-slate-200 text-slate-700"
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
                className="w-8 h-8 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-600 flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed transition-all font-bold cursor-pointer"
                title="หน้าถัดไป"
              >
                ›
              </button>
            </div>

            {/* Page Size Selector */}
            <div className="flex items-center gap-2">
              <select
                value={pageSize}
                onChange={(e) => handlePageSizeChange(e.target.value === "ALL" ? "ALL" : Number(e.target.value))}
                className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-slate-700 text-xs font-bold focus:outline-none cursor-pointer shadow-2xs"
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
      )}

      {/* Edit Product Modal */}
      {editingProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl p-6 sm:p-8 w-full max-w-xl border border-slate-200 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3.5">
              <h2 className="text-base sm:text-lg font-black text-slate-900 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                แก้ไขข้อมูลสินค้า ({editingProduct.sku})
              </h2>
              <button
                type="button"
                onClick={() => setEditingProduct(null)}
                className="text-slate-400 hover:text-slate-700 p-1.5 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {editError && (
              <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
                {editError}
              </div>
            )}

            <form onSubmit={handleSaveEdit} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label htmlFor="edit-prod-sku" className="block font-bold text-slate-700 mb-1.5">รหัสสินค้า (SKU) *</label>
                  <input
                    id="edit-prod-sku"
                    type="text"
                    required
                    value={editingProduct.sku}
                    onChange={(e) => setEditingProduct({ ...editingProduct, sku: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 text-xs sm:text-sm font-mono font-bold"
                  />
                </div>
                <div>
                  <label htmlFor="edit-prod-barcode" className="block font-bold text-slate-700 mb-1.5">Barcode</label>
                  <input
                    id="edit-prod-barcode"
                    type="text"
                    value={editingProduct.barcode || ""}
                    onChange={(e) => setEditingProduct({ ...editingProduct, barcode: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 text-xs sm:text-sm font-mono"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="edit-prod-name" className="block font-bold text-slate-700 mb-1.5">ชื่อสินค้า *</label>
                <input
                  id="edit-prod-name"
                  type="text"
                  required
                  value={editingProduct.product_name}
                  onChange={(e) => setEditingProduct({ ...editingProduct, product_name: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 text-xs sm:text-sm font-medium"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                <div>
                  <label htmlFor="edit-prod-cat" className="block font-bold text-slate-700 mb-1.5">หมวดหมู่ *</label>
                  <input
                    id="edit-prod-cat"
                    type="text"
                    required
                    value={editingProduct.category}
                    onChange={(e) => setEditingProduct({ ...editingProduct, category: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 text-xs sm:text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="edit-prod-unit" className="block font-bold text-slate-700 mb-1.5">หน่วยนับ *</label>
                  <input
                    id="edit-prod-unit"
                    type="text"
                    required
                    value={editingProduct.base_unit}
                    onChange={(e) => setEditingProduct({ ...editingProduct, base_unit: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 text-xs sm:text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="edit-prod-min-stock" className="block font-bold text-slate-700 mb-1.5">จำนวนขั้นต่ำ *</label>
                  <input
                    id="edit-prod-min-stock"
                    type="number"
                    min="0"
                    required
                    value={editingProduct.minimum_stock}
                    onChange={(e) => setEditingProduct({ ...editingProduct, minimum_stock: Number(e.target.value) })}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 text-xs sm:text-sm font-mono font-bold"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="edit-prod-loc" className="block font-bold text-slate-700 mb-1.5">ตำแหน่ง</label>
                <input
                  id="edit-prod-loc"
                  type="text"
                  value={editingProduct.description ? editingProduct.description.replace(/^ตำแหน่ง:\s*/, "") : ""}
                  onChange={(e) => setEditingProduct({ ...editingProduct, description: e.target.value })}
                  placeholder="กรอกตำแหน่ง (เช่น 14A1)"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 text-xs sm:text-sm font-mono"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingProduct(null)}
                  className="flex-1 py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs sm:text-sm transition-all cursor-pointer border border-slate-200"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-extrabold text-xs sm:text-sm shadow-md shadow-emerald-600/20 transition-all cursor-pointer"
                >
                  {saving ? "กำลังบันทึก..." : "บันทึกการแก้ไข"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";
import React, { useEffect, useState, useCallback, useMemo } from "react";
import type { Product, Warehouse } from "@/types/models";
import { useRouter } from "next/navigation";

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
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

  const router = useRouter();

  // Fetch initial metadata (warehouses & categories)
  useEffect(() => {
    Promise.all([
      fetch("/api/warehouses").then(r => r.json()),
      fetch("/api/products").then(r => r.json())
    ]).then(([whRes, prodRes]) => {
      if (whRes.success) setWarehouses(whRes.data);
      if (prodRes.success && Array.isArray(prodRes.data)) {
        const cats = Array.from(new Set(prodRes.data.map((p: Product) => p.category).filter(Boolean)));
        setCategories(cats as string[]);
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

    fetch(`/api/products?${params.toString()}`)
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
  }, [loadProducts]);

  // Reset page to 1 when filters or pageSize change
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
  ];

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
    <div className="max-w-7xl mx-auto space-y-6">


      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            id="product-search"
            type="text"
            value={search}
            onChange={e => handleSearchChange(e.target.value)}
            placeholder="ค้นหา รหัสสินค้า, Barcode, ชื่อสินค้า..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.09] text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500/50 text-sm transition-all"
          />
        </div>

        {/* Warehouse Filter */}
        <select
          value={filterWarehouse}
          onChange={e => { setFilterWarehouse(e.target.value); setCurrentPage(1); }}
          className="px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.09] text-slate-300 focus:outline-none focus:border-indigo-500/50 text-sm font-medium cursor-pointer transition-all"
        >
          <option value="" className="bg-[#111118] text-white">ทุกโกดัง</option>
          {(warehouses.length > 0
            ? warehouses.map(w => ({ id: w.warehouse_id, name: w.warehouse_name }))
            : defaultWarehouses
          ).map(w => (
            <option key={w.id} value={w.id} className="bg-[#111118] text-white">{w.name}</option>
          ))}
        </select>

        {/* Category Filter */}
        <select
          value={filterCategory}
          onChange={e => handleCategoryChange(e.target.value)}
          className="px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.09] text-slate-300 focus:outline-none focus:border-indigo-500/50 text-sm font-medium cursor-pointer transition-all"
        >
          <option value="" className="bg-[#111118] text-white">ทุกหมวดหมู่</option>
          {categories.map(c => <option key={c} value={c} className="bg-[#111118] text-white">{c}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-500 text-sm">กำลังโหลดข้อมูล...</div>
      ) : (
        <div className="glass-card rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/[0.08]">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">รหัสสินค้า</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">บาร์โค้ด</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">ชื่อสินค้า</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">หมวดหมู่</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">ผู้จำหน่าย</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">สินค้าคงเหลือรวม</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">หน่วย</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {displayProducts.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-10 text-slate-500 text-sm">ไม่พบสินค้า</td></tr>
                ) : displayProducts.map((p: Product, idx: number) => {
                  const supplierDisplay =
                    p.supplier ||
                    (p.description && p.description.includes("ผู้จำหน่าย:")
                      ? p.description.replace(/^ผู้จำหน่าย:\s*/, "")
                      : "");

                  const totalStock = (p.total_quantity ?? p.quantity ?? p.minimum_stock ?? 0);
                  const isExpanded = expandedSku === p.sku;

                  return (
                    <React.Fragment key={`${p.product_id || 'prod'}-${p.sku || idx}-${idx}`}>
                      <tr
                        onClick={() => setExpandedSku(isExpanded ? null : p.sku)}
                        className={`cursor-pointer transition-all group ${
                          isExpanded ? "bg-emerald-500/10" : "hover:bg-emerald-500/10 text-emerald-400"
                        }`}
                      >
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-2">
                            <svg
                              className={`w-3.5 h-3.5 text-indigo-400 transition-transform duration-200 ${
                                isExpanded ? "rotate-90 text-indigo-300" : ""
                              }`}
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                            </svg>
                            <p className="font-mono text-xs font-bold text-indigo-400 group-hover:underline">{p.sku}</p>
                          </div>
                        </td>
                        <td className="px-5 py-3.5">
                          <p className="font-mono text-xs text-slate-300">{p.barcode || "-"}</p>
                        </td>
                        <td className="px-5 py-3.5 text-sm text-slate-200 max-w-[220px]">
                          <p className="truncate font-medium group-hover:text-emerald-300 transition-colors">{p.product_name}</p>
                        </td>
                        <td className="px-5 py-3.5 text-xs text-slate-400">{p.category}</td>
                        <td className="px-5 py-3.5 text-xs text-indigo-300 font-semibold font-mono">
                          {supplierDisplay || "-"}
                        </td>
                        <td className="px-5 py-3.5 text-xs text-emerald-400 font-bold font-mono text-right">
                          {totalStock.toLocaleString()}
                        </td>
                        <td className="px-5 py-3.5 text-xs text-slate-500">{p.base_unit}</td>
                        <td className="px-5 py-3.5 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingProduct({ ...p });
                              }}
                              className="px-2.5 py-1 rounded-lg text-xs font-medium bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 hover:bg-indigo-500/20 transition-all flex items-center gap-1 cursor-pointer"
                              title="แก้ไขทั้งหมด"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                              แก้ไข
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Dropdown / Accordion Details Row */}
                      {isExpanded && (
                        <tr className="bg-slate-50/90 border-b border-indigo-100">
                          <td colSpan={8} className="p-3 sm:p-4">
                            <div className="rounded-xl p-4 bg-white border border-slate-200/80 space-y-3 shadow-sm">
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2.5 border-b border-slate-100">
                                <div className="flex items-center gap-2">
                                  <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5m0 0h4m0 0v-5a2 2 0 00-2-2h-2a2 2 0 00-2 2v5" />
                                  </svg>
                                  <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                                    รายละเอียดสถานที่จัดเก็บในแต่ละโกดัง ({p.sku})
                                  </h4>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-slate-500 font-medium">รวมทุกโกดัง:</span>
                                  <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-emerald-50 text-emerald-600 border border-emerald-200">
                                    {totalStock.toLocaleString()} {p.base_unit}
                                  </span>
                                </div>
                              </div>

                              <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="text-slate-500 bg-slate-50 border-b border-slate-200 text-left">
                                      <th className="py-2.5 px-3 font-semibold">โกดัง</th>
                                      <th className="py-2.5 px-3 font-semibold">ตำแหน่ง</th>
                                      <th className="py-2.5 px-3 font-semibold text-right">จำนวนคงเหลือ</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100">
                                    {(p.locations_breakdown && p.locations_breakdown.length > 0
                                      ? p.locations_breakdown
                                      : [
                                          {
                                            warehouse_id: (p as any).warehouse_id || "wh-1",
                                            warehouse_name: "โกดัง 1",
                                            location: p.location || "-",
                                            quantity: totalStock,
                                          },
                                        ]
                                    ).map((locItem, lIdx) => (
                                      <tr key={lIdx} className="hover:bg-emerald-50/80 transition-colors">
                                        <td className="py-2.5 px-3 font-semibold text-slate-800">
                                          {locItem.warehouse_name}
                                        </td>
                                        <td className="py-2.5 px-3 font-mono font-bold text-emerald-600">
                                          {locItem.location && locItem.location !== "-" ? locItem.location : "-"}
                                        </td>
                                        <td className="py-2.5 px-3 font-mono text-right font-bold text-slate-800">
                                          {locItem.quantity.toLocaleString()} {p.base_unit}
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
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          <div className="px-5 py-3 border-t border-white/[0.07] flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
            <div className="flex items-center gap-3">
              <span>แสดงหน้าละ</span>
              <select
                value={pageSize}
                onChange={(e) => handlePageSizeChange(e.target.value === "ALL" ? "ALL" : Number(e.target.value))}
                className="px-2 py-1 rounded-md bg-white/[0.04] border border-white/[0.09] text-slate-200 text-xs font-medium focus:outline-none cursor-pointer"
              >
                {[10, 20, 30, 50, 100, "ALL"].map((size) => (
                  <option key={size} value={size} className="bg-[#111118] text-white">
                    {size}
                  </option>
                ))}
              </select>
              <span>
                แสดง {totalItems > 0 ? startIndex + 1 : 0} - {endIndex} จาก {totalItems} รายการ
              </span>
            </div>

            {/* Navigation buttons */}
            <div className="flex items-center gap-1.5">
              <button
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                className="px-2.5 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] disabled:opacity-30 disabled:cursor-not-allowed text-slate-300 font-medium transition-all"
              >
                ◀ ก่อนหน้า
              </button>

              {/* Page numbers */}
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter((p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
                .map((p, i, arr) => {
                  const prev = arr[i - 1];
                  const showDots = prev && p - prev > 1;
                  return (
                    <span key={p} className="flex items-center gap-1">
                      {showDots && <span className="px-1 text-slate-600">...</span>}
                      <button
                        onClick={() => setCurrentPage(p)}
                        className={`px-2.5 py-1.5 rounded-lg font-medium transition-all ${
                          currentPage === p
                            ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                            : "bg-white/[0.04] border border-white/[0.08] text-slate-400 hover:bg-white/[0.08]"
                        }`}
                      >
                        {p}
                      </button>
                    </span>
                  );
                })}

              <button
                disabled={currentPage === totalPages || totalPages === 0}
                onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
                className="px-2.5 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] disabled:opacity-30 disabled:cursor-not-allowed text-slate-300 font-medium transition-all"
              >
                ถัดไป ▶
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editingProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="glass-card rounded-xl p-6 w-full max-w-xl border border-white/[0.12] space-y-4 shadow-2xl bg-[#111118]">
            <div className="flex items-center justify-between border-b border-white/[0.07] pb-3">
              <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <svg className="w-4.5 h-4.5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                แก้ไขข้อมูลสินค้า ({editingProduct.sku})
              </h2>
              <button
                onClick={() => setEditingProduct(null)}
                className="text-slate-500 hover:text-white p-1 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {editError && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
                {editError}
              </div>
            )}

            <form onSubmit={handleSaveEdit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">รหัสสินค้า (SKU) *</label>
                  <input
                    type="text"
                    required
                    value={editingProduct.sku}
                    onChange={e => setEditingProduct({ ...editingProduct, sku: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.09] text-slate-100 focus:outline-none focus:border-indigo-500/50 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Barcode</label>
                  <input
                    type="text"
                    value={editingProduct.barcode || ""}
                    onChange={e => setEditingProduct({ ...editingProduct, barcode: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.09] text-slate-100 focus:outline-none focus:border-indigo-500/50 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">ชื่อสินค้า *</label>
                <input
                  type="text"
                  required
                  value={editingProduct.product_name}
                  onChange={e => setEditingProduct({ ...editingProduct, product_name: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.09] text-slate-100 focus:outline-none focus:border-indigo-500/50 text-sm"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">หมวดหมู่ *</label>
                  <input
                    type="text"
                    required
                    value={editingProduct.category}
                    onChange={e => setEditingProduct({ ...editingProduct, category: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.09] text-slate-100 focus:outline-none focus:border-indigo-500/50 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">หน่วยนับ *</label>
                  <input
                    type="text"
                    required
                    value={editingProduct.base_unit}
                    onChange={e => setEditingProduct({ ...editingProduct, base_unit: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.09] text-slate-100 focus:outline-none focus:border-indigo-500/50 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">จำนวนขั้นต่ำ *</label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={editingProduct.minimum_stock}
                    onChange={e => setEditingProduct({ ...editingProduct, minimum_stock: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.09] text-slate-100 focus:outline-none focus:border-indigo-500/50 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">ตำแหน่ง</label>
                <input
                  type="text"
                  value={editingProduct.description ? editingProduct.description.replace(/^ตำแหน่ง:\s*/, "") : ""}
                  onChange={e => setEditingProduct({ ...editingProduct, description: e.target.value })}
                  placeholder="กรอกตำแหน่ง (เช่น 14A1)"
                  className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.09] text-slate-100 focus:outline-none focus:border-indigo-500/50 text-sm font-mono"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingProduct(null)}
                  className="flex-1 py-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 font-medium transition-all text-sm"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-2 rounded-lg btn-primary disabled:opacity-50 text-white font-semibold transition-all text-sm"
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

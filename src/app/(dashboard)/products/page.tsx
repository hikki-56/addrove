"use client";
import { useEffect, useState, useCallback } from "react";
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

  // Edit Modal State
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

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">สินค้าทั้งหมด</h1>
          <p className="text-gray-400 text-sm mt-1">
            เพิ่ม แก้ไข และบริหารข้อมูลสินค้า (Server-side Pagination)
          </p>
        </div>
        <button
          id="add-product-btn"
          onClick={() => router.push("/products/new")}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-all shadow-lg shadow-emerald-600/30 border border-emerald-500/40"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          เพิ่มสินค้า
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            id="product-search"
            type="text"
            value={search}
            onChange={e => handleSearchChange(e.target.value)}
            placeholder="ค้นหา รหัสสินค้า, Barcode, ชื่อสินค้า..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white/5 border border-emerald-900/30 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm"
          />
        </div>

        {/* Warehouse Filter */}
        <select
          value={filterWarehouse}
          onChange={e => { setFilterWarehouse(e.target.value); setCurrentPage(1); }}
          className="px-3 py-2.5 rounded-xl bg-white/5 border border-emerald-900/30 text-gray-300 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm font-medium"
        >
          <option value="" className="bg-[#080d0a] text-white">ทุกโกดัง</option>
          {defaultWarehouses.map(w => (
            <option key={w.id} value={w.id} className="bg-[#080d0a] text-white">{w.name}</option>
          ))}
          {warehouses.length > 0 && warehouses.map(w => (
            <option key={w.warehouse_id} value={w.warehouse_id} className="bg-[#080d0a] text-white">{w.warehouse_name}</option>
          ))}
        </select>

        {/* Category Filter */}
        <select
          value={filterCategory}
          onChange={e => handleCategoryChange(e.target.value)}
          className="px-3 py-2.5 rounded-xl bg-white/5 border border-emerald-900/30 text-gray-300 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm font-medium"
        >
          <option value="" className="bg-[#080d0a] text-white">ทุกหมวดหมู่</option>
          {categories.map(c => <option key={c} value={c} className="bg-[#080d0a] text-white">{c}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">กำลังโหลดข้อมูลเฉพาะหน้านี้...</div>
      ) : (
        <div className="glass-card rounded-2xl overflow-hidden border border-emerald-900/30">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-xs text-emerald-400/80 uppercase tracking-wider bg-emerald-950/40 border-b border-emerald-900/30">
                  <th className="text-left px-6 py-3.5">รหัสสินค้า</th>
                  <th className="text-left px-6 py-3.5">ชื่อสินค้า</th>
                  <th className="text-left px-6 py-3.5">หมวดหมู่</th>
                  <th className="text-right px-6 py-3.5">ขั้นต่ำ</th>
                  <th className="text-left px-6 py-3.5">หน่วย</th>
                  <th className="text-left px-6 py-3.5">โกดัง</th>
                  <th className="text-left px-6 py-3.5">ตำแหน่ง</th>
                  <th className="text-right px-6 py-3.5">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-emerald-900/20">
                {products.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-10 text-gray-500">ไม่พบสินค้า</td></tr>
                ) : products.map((p, idx) => (
                  <tr key={`${p.product_id || 'prod'}-${p.sku || idx}-${idx}`} className="hover:bg-emerald-950/30 transition-colors">
                    <td className="px-6 py-3.5">
                      <p className="font-mono text-sm text-emerald-400 font-semibold">{p.sku}</p>
                      {p.barcode && <p className="text-xs text-gray-500">{p.barcode}</p>}
                    </td>
                    <td className="px-6 py-3.5 text-sm text-white max-w-[220px]">
                      <p className="truncate font-medium">{p.product_name}</p>
                    </td>
                    <td className="px-6 py-3.5 text-sm text-gray-300">{p.category}</td>
                    <td className="px-6 py-3.5 text-sm text-emerald-300 font-medium text-right">{p.minimum_stock.toLocaleString()}</td>
                    <td className="px-6 py-3.5 text-sm text-gray-400">{p.base_unit}</td>
                    <td className="px-6 py-3.5 text-sm text-gray-300">
                      {filterWarehouse
                        ? (defaultWarehouses.find(w => w.id === filterWarehouse)?.name || warehouses.find(w => w.warehouse_id === filterWarehouse)?.warehouse_name || "โกดัง 1")
                        : "โกดัง 1"}
                    </td>
                    <td className="px-6 py-3.5 text-sm text-gray-300 font-mono">
                      {p.description ? p.description.replace(/^ตำแหน่ง:\s*/, "") : "-"}
                    </td>
                    <td className="px-6 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setEditingProduct({ ...p })}
                          className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-emerald-600/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-600 hover:text-white transition-all flex items-center gap-1 shadow-sm shadow-emerald-950"
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
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          <div className="px-6 py-4 border-t border-emerald-900/30 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-gray-400">
            <div className="flex items-center gap-3">
              <span className="text-gray-400">แสดงหน้าละ</span>
              <select
                value={pageSize}
                onChange={(e) => handlePageSizeChange(e.target.value === "ALL" ? "ALL" : Number(e.target.value))}
                className="px-2.5 py-1.5 rounded-lg bg-[#080d0a] border border-emerald-900/40 text-white text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/50 cursor-pointer"
              >
                {[10, 20, 30, 50, 100, "ALL"].map((size) => (
                  <option key={size} value={size} className="bg-[#080d0a] text-white">
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
                className="px-3 py-1.5 rounded-lg bg-emerald-950/40 border border-emerald-900/40 hover:bg-emerald-900/50 disabled:opacity-30 disabled:cursor-not-allowed text-white font-medium transition-all"
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
                      {showDots && <span className="px-1 text-gray-600">...</span>}
                      <button
                        onClick={() => setCurrentPage(p)}
                        className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                          currentPage === p
                            ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/30"
                            : "bg-emerald-950/40 border border-emerald-900/40 text-gray-300 hover:bg-emerald-900/50"
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
                className="px-3 py-1.5 rounded-lg bg-emerald-950/40 border border-emerald-900/40 hover:bg-emerald-900/50 disabled:opacity-30 disabled:cursor-not-allowed text-white font-medium transition-all"
              >
                ถัดไป ▶
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Full Edit Modal */}
      {editingProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="glass-card rounded-2xl p-6 w-full max-w-xl border border-emerald-800/40 space-y-4 shadow-2xl bg-[#09110d]">
            <div className="flex items-center justify-between border-b border-emerald-900/40 pb-3">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                แก้ไขข้อมูลสินค้า ({editingProduct.sku})
              </h2>
              <button
                onClick={() => setEditingProduct(null)}
                className="text-gray-400 hover:text-white p-1 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {editError && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                {editError}
              </div>
            )}

            <form onSubmit={handleSaveEdit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-300 mb-1">รหัสสินค้า (SKU) *</label>
                  <input
                    type="text"
                    required
                    value={editingProduct.sku}
                    onChange={e => setEditingProduct({ ...editingProduct, sku: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-[#050807] border border-emerald-900/40 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-300 mb-1">Barcode</label>
                  <input
                    type="text"
                    value={editingProduct.barcode || ""}
                    onChange={e => setEditingProduct({ ...editingProduct, barcode: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-[#050807] border border-emerald-900/40 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-300 mb-1">ชื่อสินค้า *</label>
                <input
                  type="text"
                  required
                  value={editingProduct.product_name}
                  onChange={e => setEditingProduct({ ...editingProduct, product_name: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-[#050807] border border-emerald-900/40 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-gray-300 mb-1">หมวดหมู่ *</label>
                  <input
                    type="text"
                    required
                    value={editingProduct.category}
                    onChange={e => setEditingProduct({ ...editingProduct, category: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-[#050807] border border-emerald-900/40 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-300 mb-1">หน่วยนับ *</label>
                  <input
                    type="text"
                    required
                    value={editingProduct.base_unit}
                    onChange={e => setEditingProduct({ ...editingProduct, base_unit: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-[#050807] border border-emerald-900/40 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-300 mb-1">จำนวนขั้นต่ำ *</label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={editingProduct.minimum_stock}
                    onChange={e => setEditingProduct({ ...editingProduct, minimum_stock: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-lg bg-[#050807] border border-emerald-900/40 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-300 mb-1">ตำแหน่ง</label>
                <input
                  type="text"
                  value={editingProduct.description ? editingProduct.description.replace(/^ตำแหน่ง:\s*/, "") : ""}
                  onChange={e => setEditingProduct({ ...editingProduct, description: e.target.value })}
                  placeholder="กรอกตำแหน่ง (เช่น 14A1)"
                  className="w-full px-3 py-2 rounded-lg bg-[#050807] border border-emerald-900/40 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm font-mono"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingProduct(null)}
                  className="flex-1 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 font-medium transition-all text-sm"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold transition-all text-sm shadow-lg shadow-emerald-600/30"
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

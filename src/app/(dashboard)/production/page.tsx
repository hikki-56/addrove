"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ProductTable from "./_components/ProductTable";
import type { EnrichedBomFormula } from "./_components/types";
import { useProductionCart, getCart, setCart } from "./_lib/cart-store";

export default function ProductionPage() {
  const router = useRouter();
  const [boms, setBoms] = useState<EnrichedBomFormula[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Quantity inputs per product card (keyed by fg_sku)
  const [produceQty, setProduceQty] = useState<Record<string, number>>({});

  // Pagination — pageSize = 0 คือแสดงทั้งหมด (ALL)
  const [pageSize, setPageSize] = useState<number>(10);
  const [page, setPage] = useState<number>(1);

  // ตะกร้าสั่งผลิต — เก็บใน cart store (แชร์กับหน้า /production/cart)
  const cart = useProductionCart();
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const fetchBoms = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/production/bom");
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setBoms(json.data);
        const initialQty: Record<string, number> = {};
        json.data.forEach((b: EnrichedBomFormula) => {
          initialQty[b.fg_sku] = Math.max(1, Math.min(b.maxProducible || 1, produceQty[b.fg_sku] || 1));
        });
        setProduceQty(initialQty);
      } else {
        setErrorBanner(json.message || "ดึงข้อมูลสินค้าสำหรับผลิตไม่สำเร็จ กรุณากดรีเฟรชอีกครั้ง");
      }
    } catch (e) {
      console.error("Failed to fetch BOM:", e);
      setErrorBanner("ดึงข้อมูลสินค้าสำหรับผลิตไม่สำเร็จ กรุณากดรีเฟรชอีกครั้ง");
    } finally {
      setLoading(false);
    }
  }, [produceQty]);

  useEffect(() => {
    fetchBoms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 3000);
  };

  const handleQuantityChange = (sku: string, val: number, max: number) => {
    const clamped = Math.max(1, Math.min(max > 0 ? max : 1, val));
    setProduceQty((prev) => ({ ...prev, [sku]: clamped }));
  };

  const handleAddToCart = async (bom: EnrichedBomFormula) => {
    setErrorBanner(null);
    if (bom.maxProducible <= 0) {
      setErrorBanner(`วัตถุดิบในโกดัง 2 สำหรับผลิต ${bom.fg_sku} ไม่เพียงพอ — ไม่สามารถผลิตได้`);
      return;
    }
    const qty = produceQty[bom.fg_sku] || 1;

    // หน้า list ได้แค่หัวสูตร — ดึงสูตรเต็ม (พร้อมวัตถุดิบ) ก่อนเก็บลงตะกร้า
    // เพื่อให้หน้าตะกร้าคำนวณวัตถุดิบที่จะถูกตัดได้
    let fullBom = bom;
    try {
      const res = await fetch(`/api/production/bom?sku=${encodeURIComponent(bom.fg_sku)}`);
      const json = await res.json();
      if (json.success && json.data) fullBom = json.data;
    } catch {
      // ใช้หัวสูตรต่อได้ — แค่หน้าตะกร้าจะไม่แสดงสรุปวัตถุดิบชั่วคราว (server ยังตรวจสอบให้อยู่)
    }

    const current = getCart();
    const existing = current.find((item) => item.bom.fg_sku === bom.fg_sku);

    if (existing) {
      const newTotal = existing.quantity + qty;
      if (newTotal > fullBom.maxProducible) {
        setErrorBanner(`ไม่สามารถเพิ่มเกินจำนวนที่ผลิตได้ (ผลิตได้สูงสุด ${fullBom.maxProducible.toLocaleString()} ${fullBom.fg_unit})`);
        return;
      }
      setCart(current.map((item) => (item.bom.fg_sku === bom.fg_sku ? { bom: fullBom, quantity: newTotal } : item)));
    } else {
      setCart([...current, { bom: fullBom, quantity: qty }]);
    }
    showToast(`เพิ่ม ${bom.fg_name} (+${qty.toLocaleString()} ${bom.fg_unit}) ลงในตะกร้าแล้ว`);
  };

  const totalCartUnits = cart.reduce((sum, item) => sum + item.quantity, 0);

  const filteredBoms = boms.filter(
    (b) =>
      b.fg_sku.toLowerCase().includes(search.toLowerCase()) ||
      b.fg_name.toLowerCase().includes(search.toLowerCase()) ||
      b.fg_barcode.includes(search)
  );

  // คำนวณการแบ่งหน้า (pageSize = 0 → แสดงทั้งหมด)
  const total = filteredBoms.length;
  const pageCount = pageSize === 0 ? 1 : Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount);
  const pagedBoms = pageSize === 0 ? filteredBoms : filteredBoms.slice((safePage - 1) * pageSize, safePage * pageSize);
  const rangeStart = total === 0 ? 0 : (safePage - 1) * (pageSize || total) + 1;
  const rangeEnd = pageSize === 0 ? total : Math.min(safePage * pageSize, total);

  return (
    <div className="w-full max-w-full space-y-5 pb-16">
      {/* Toast Notification — Top right so it never overlaps mobile bottom navigation */}
      {toastMessage && (
        <div className="fixed top-5 right-5 z-50 max-w-sm bg-slate-900 text-white px-4 py-3 rounded-xl shadow-2xl flex items-center gap-3 border border-slate-700 animate-in fade-in slide-in-from-top-4 duration-200">
          <div className="w-6 h-6 rounded-full bg-[#0F5C3F] text-white flex items-center justify-center text-xs font-bold shrink-0">
            ✓
          </div>
          <span className="text-sm font-semibold text-white flex-1">{toastMessage}</span>
          <button
            onClick={() => setToastMessage(null)}
            className="text-slate-400 hover:text-white text-xs cursor-pointer font-bold p-1"
          >
            ✕
          </button>
        </div>
      )}

      {/* Top Toolbar */}
      <div className="bg-white rounded-2xl p-3.5 sm:p-4 border border-[#E8ECEA] shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3.5">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 flex-1 min-w-0">
          <div className="flex items-center gap-2.5 shrink-0">
            <span className="text-xl">🏭</span>
            <span className="px-3 py-1 rounded-full text-xs sm:text-sm font-bold bg-[#EAF2EE] text-[#052B1F] border border-[#C9DFD4] whitespace-nowrap">
              โกดัง 2 (สินค้าสำเร็จรูป)
            </span>
          </div>

          {/* ช่องค้นหา — อยู่ในแถบเครื่องมือบนสุด */}
          <div className="relative w-full sm:flex-1 sm:min-w-[180px] sm:max-w-sm">
            <input
              type="text"
              placeholder="ค้นหารหัสสินค้า, ชื่อสินค้า หรือบาร์โค้ด..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-[#E8ECEA] rounded-xl text-sm font-semibold text-slate-900 placeholder:text-slate-500 focus:outline-hidden focus:ring-2 focus:ring-[#0F5C3F] focus:bg-white transition-colors"
            />
            <svg className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </div>

        {/* Right side controls: History Link, Cart Button & Refresh */}
        <div className="flex items-center flex-wrap gap-2.5">
          <Link
            href="/production/history"
            className="px-4 py-2.5 sm:py-3 rounded-xl font-bold text-sm bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all flex items-center gap-2 cursor-pointer border border-[#E8ECEA]/80 shadow-2xs active:scale-95"
            title="ดูประวัติการสั่งผลิตทั้งหมด"
          >
            <svg className="w-4 h-4 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
            </svg>
            <span>ประวัติการสั่งผลิต</span>
          </Link>

          <button
            onClick={() => router.push("/production/cart")}
            className={`relative px-4 py-2.5 sm:py-3 rounded-xl font-bold text-sm transition-all flex items-center gap-2 cursor-pointer active:scale-95 ${
              cart.length > 0
                ? "bg-[#06402B] text-white hover:bg-[#053425] shadow-md shadow-[#06402B]/20"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200 border border-[#E8ECEA]"
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
              />
            </svg>
            <span>ตะกร้าผลิต</span>
            {cart.length > 0 && (
              <span className="ml-1 px-2 py-0.5 rounded-full bg-white text-[#031B14] font-mono font-black text-xs shadow-xs">
                {totalCartUnits.toLocaleString()}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={fetchBoms}
            aria-label="รีเฟรชข้อมูล"
            title="รีเฟรชข้อมูล"
            className="p-2.5 sm:p-3 text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all cursor-pointer border border-[#E8ECEA] active:scale-95"
          >
            <svg className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      {/* Error Banner */}
      {errorBanner && (
        <div className="rounded-xl bg-rose-50 border border-rose-200 p-4 flex items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-2.5 text-rose-800">
            <span className="text-lg">⚠️</span>
            <p className="text-sm font-bold">{errorBanner}</p>
          </div>
          <button
            onClick={() => setErrorBanner(null)}
            className="text-rose-700 hover:text-rose-900 text-xs font-bold px-2.5 py-1 rounded-lg hover:bg-rose-100 cursor-pointer transition-colors"
          >
            ปิด
          </button>
        </div>
      )}

      {/* Product Table — แสดงรูป/รหัส/บาร์โค้ด/ชื่อ/จำนวนที่ผลิตได้/เพิ่มตะกร้า
          กดที่แถวเพื่อขยายดูวัตถุดิบที่ใช้ผลิต (สไตล์เดียวกับตารางประวัติ) */}
      {loading ? (
        <div className="py-20 text-center bg-white rounded-2xl border border-[#E8ECEA] shadow-xs">
          <div className="w-8 h-8 border-3 border-[#0F5C3F] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-slate-600 mt-3 font-semibold">กำลังโหลดข้อมูลสินค้าสำหรับผลิต...</p>
        </div>
      ) : filteredBoms.length === 0 ? (
        <div className="rounded-2xl p-16 text-center border border-[#E8ECEA] bg-white shadow-xs">
          <p className="text-slate-700 text-base font-bold">ไม่พบรายการสินค้าที่ตรงกับคำค้นหา</p>
          <p className="text-slate-500 text-sm mt-1">ลองเปลี่ยนคำค้นหา หรือกดรีเฟรชข้อมูลใหม่อีกครั้ง</p>
        </div>
      ) : (
        <ProductTable
          boms={pagedBoms}
          produceQty={produceQty}
          onQuantityChange={handleQuantityChange}
          onAddToCart={handleAddToCart}
          page={safePage}
          pageCount={pageCount}
          pageSize={pageSize}
          total={total}
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
          onPageChange={setPage}
          onPageSizeChange={(s) => {
            setPageSize(s);
            setPage(1);
          }}
        />
      )}
    </div>
  );
}

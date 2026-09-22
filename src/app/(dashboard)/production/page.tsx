"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import TableBoard from "./_components/TableBoard";
import ProductPickerModal from "./_components/ProductPickerModal";
import type { EnrichedBomFormula } from "./_components/types";
import { useProductionCart, getCart, setCart } from "./_lib/cart-store";

export default function ProductionPage() {
  const router = useRouter();
  const [boms, setBoms] = useState<EnrichedBomFormula[]>([]);
  const [loading, setLoading] = useState(true);

  // หน้าต่างเลือกสินค้า — เปิดให้โต๊ะที่กด "เพิ่มสินค้าผลิต" (null = ปิดอยู่)
  const [pickerTableNo, setPickerTableNo] = useState<number | null>(null);

  // ตะกร้าสั่งผลิต — เก็บใน cart store (แชร์กับหน้า /production/cart)
  const cart = useProductionCart();
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const fetchBoms = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/production/bom");
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setBoms(json.data);
      }
    } catch (e) {
      console.error("Failed to fetch BOM:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBoms();
  }, [fetchBoms]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 3000);
  };

  /** เพิ่มสินค้าลงตะกร้าของโต๊ะ — คืนข้อความ error ถ้าเพิ่มไม่สำเร็จ (null = สำเร็จ) */
  const handleAddToCart = async (
    bom: EnrichedBomFormula,
    tableNo: number,
    qty: number
  ): Promise<string | null> => {
    if (bom.maxProducible <= 0) {
      return `วัตถุดิบในโกดัง 2 สำหรับผลิต ${bom.fg_sku} ไม่เพียงพอ — ไม่สามารถผลิตได้`;
    }

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
    const existing = current.find((item) => item.table_no === tableNo && item.bom.fg_sku === bom.fg_sku);

    // ใบผลิตหนึ่งใบระบุสินค้าเดียวกันได้เพียงหนึ่งโต๊ะ (ระบบตรวจการผลิตจับคู่รายการด้วยรหัสสินค้า)
    // ถ้าอยู่โต๊ะอื่นแล้ว ให้ไปปรับจำนวนที่โต๊ะนั้น หรือยืนยันใบผลิตแยกครั้ง
    const existingOtherTable = current.find(
      (item) => item.table_no !== tableNo && item.bom.fg_sku === bom.fg_sku
    );
    if (existingOtherTable) {
      return `${bom.fg_name} ถูกจัดให้โต๊ะผลิต ${existingOtherTable.table_no} แล้ว — ใบผลิตหนึ่งใบระบุสินค้าเดียวกันได้เพียงหนึ่งโต๊ะ กรุณาปรับจำนวนที่โต๊ะ ${existingOtherTable.table_no} หรือยืนยันใบผลิตแยกอีกครั้ง`;
    }

    if (existing) {
      const newTotal = existing.quantity + qty;
      if (newTotal > fullBom.maxProducible) {
        return `ไม่สามารถเพิ่มเกินจำนวนที่ผลิตได้ (ผลิตได้สูงสุด ${fullBom.maxProducible.toLocaleString()} ${fullBom.fg_unit})`;
      }
      setCart(
        current.map((item) =>
          item.table_no === tableNo && item.bom.fg_sku === bom.fg_sku
            ? { ...item, bom: fullBom, quantity: newTotal }
            : item
        )
      );
    } else {
      setCart([...current, { bom: fullBom, quantity: qty, table_no: tableNo }]);
    }
    showToast(`เพิ่ม ${bom.fg_name} (+${qty.toLocaleString()} ${bom.fg_unit}) ให้โต๊ะผลิต ${tableNo} แล้ว`);
    return null;
  };

  const totalCartUnits = cart.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div className="w-full max-w-full space-y-5 pb-16">
      {/* Top Toolbar */}
      <div className="bg-white rounded-2xl p-3.5 sm:p-4 border border-[#E8ECEA] shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3.5">
        <div className="flex items-center gap-2.5 shrink-0">
          <span className="text-xl">🏭</span>
          <span className="px-3 py-1 rounded-full text-xs sm:text-sm font-bold bg-[#EAF2EE] text-[#052B1F] border border-[#C9DFD4] whitespace-nowrap">
            โกดัง 2 (สินค้าสำเร็จรูป)
          </span>
        </div>

        {/* Right side controls: History Link, Cart Button & Refresh */}
        <div className="flex items-center flex-wrap gap-2.5">
          <Link
            href="/production/history"
            className="px-4 py-2.5 sm:py-3 rounded-xl font-bold text-sm bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all flex items-center gap-2 cursor-pointer border border-[#E8ECEA]/80 shadow-2xs active:scale-95"
            title="ดูรายการใบผลิตทั้งหมด"
          >
            <svg className="w-4 h-4 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
            </svg>
            <span>ใบผลิต</span>
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

      {/* บอร์ดโต๊ะผลิต 1–5 — แต่ละโต๊ะแสดงสินค้าที่จัดให้ และปุ่มเพิ่มสินค้าผลิต */}
      <TableBoard cart={cart} onOpenPicker={setPickerTableNo} />

      {/* หน้าต่างเลือกสินค้าให้โต๊ะ (แทนตารางรายการสินค้าเดิมที่เคยแสดงรวมทั้งหน้า) */}
      {pickerTableNo !== null && (
        <ProductPickerModal
          tableNo={pickerTableNo}
          boms={boms}
          loading={loading}
          existingSkus={
            new Set(cart.filter((i) => i.table_no === pickerTableNo).map((i) => i.bom.fg_sku))
          }
          onAddToCart={handleAddToCart}
          onRefresh={fetchBoms}
          onClose={() => setPickerTableNo(null)}
        />
      )}

      {/* แบนเนอร์แจ้งเตือน — อยู่ใน flow ของหน้า (ดันเนื้อหา ไม่ลอยทับตัวหนังสืออื่น) */}
      {toastMessage && (
        <div className="bg-[#06402B] text-white px-4 py-3 rounded-xl shadow-md flex items-center gap-3 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="w-6 h-6 rounded-full bg-[#0F5C3F] border border-white/30 text-white flex items-center justify-center text-xs font-bold shrink-0">
            ✓
          </div>
          <span className="text-sm font-semibold text-white flex-1">{toastMessage}</span>
          <button
            onClick={() => setToastMessage(null)}
            className="text-slate-300 hover:text-white text-xs cursor-pointer font-bold p-1"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

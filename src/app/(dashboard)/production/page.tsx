"use client";

import { useEffect, useState, useCallback } from "react";
import { useTabAuth } from "@/context/TabAuthContext";
import Link from "next/link";
import ProductCard from "./_components/ProductCard";
import CartDrawer from "./_components/CartDrawer";
import ConfirmProductionModal from "./_components/ConfirmProductionModal";
import SuccessModal from "./_components/SuccessModal";
import type { EnrichedBomFormula, CartItem, ConsumedMaterial } from "./_components/types";

export default function ProductionPage() {
  const { user } = useTabAuth();
  const [boms, setBoms] = useState<EnrichedBomFormula[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Quantity inputs per product card (keyed by fg_sku)
  const [produceQty, setProduceQty] = useState<Record<string, number>>({});

  // Production Cart State
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // Confirmation Modal State (Double-check gate)
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // Success Modal State
  const [successOrderNo, setSuccessOrderNo] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchBoms = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/production/bom?_t=" + Date.now());
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setBoms(json.data);
        const initialQty: Record<string, number> = {};
        json.data.forEach((b: EnrichedBomFormula) => {
          initialQty[b.fg_sku] = Math.max(1, Math.min(b.maxProducible || 1, produceQty[b.fg_sku] || 1));
        });
        setProduceQty(initialQty);
      }
    } catch (e) {
      console.error("Failed to fetch BOM:", e);
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

  const handleAddToCart = (bom: EnrichedBomFormula) => {
    setErrorBanner(null);
    if (bom.maxProducible <= 0) {
      setErrorBanner(`วัตถุดิบในโกดัง 2 สำหรับผลิต ${bom.fg_sku} ไม่เพียงพอ — ไม่สามารถผลิตได้`);
      return;
    }
    const qty = produceQty[bom.fg_sku] || 1;
    let errorMsg: string | null = null;

    setCart((prev) => {
      const existing = prev.find((item) => item.bom.fg_sku === bom.fg_sku);
      if (existing) {
        const newTotal = existing.quantity + qty;
        if (newTotal > bom.maxProducible) {
          errorMsg = `ไม่สามารถเพิ่มเกินจำนวนที่ผลิตได้ (ผลิตได้สูงสุด ${bom.maxProducible.toLocaleString()} ${bom.fg_unit})`;
          return prev;
        }
        return prev.map((item) =>
          item.bom.fg_sku === bom.fg_sku
            ? { ...item, quantity: newTotal }
            : item
        );
      }
      return [...prev, { bom, quantity: qty }];
    });

    if (errorMsg) {
      setErrorBanner(errorMsg);
    } else {
      showToast(`เพิ่ม ${bom.fg_name} (+${qty.toLocaleString()} ${bom.fg_unit}) ลงในตะกร้าแล้ว`);
    }
  };

  const handleUpdateCartQty = (sku: string, newQty: number) => {
    if (newQty <= 0) {
      setCart((prev) => prev.filter((item) => item.bom.fg_sku !== sku));
    } else {
      setCart((prev) =>
        prev.map((item) => {
          if (item.bom.fg_sku === sku) {
            const clamped = Math.min(item.bom.maxProducible || 1, newQty);
            return { ...item, quantity: clamped };
          }
          return item;
        })
      );
    }
  };

  const handleRemoveFromCart = (sku: string) => {
    setCart((prev) => prev.filter((item) => item.bom.fg_sku !== sku));
  };

  const totalCartUnits = cart.reduce((sum, item) => sum + item.quantity, 0);

  // Compute aggregated consumed raw materials for the cart items
  const getConsumedMaterials = (): ConsumedMaterial[] => {
    const map = new Map<string, ConsumedMaterial>();
    for (const item of cart) {
      if (!item.bom.items) continue;
      for (const rm of item.bom.items) {
        const key = rm.rm_sku || rm.rm_name;
        const wasteFactor = 1 + (rm.waste_percentage || 0) / 100;
        const needed = item.quantity * rm.rm_qty_required * wasteFactor;
        if (map.has(key)) {
          const existing = map.get(key)!;
          existing.total_required += needed;
        } else {
          map.set(key, {
            rm_sku: rm.rm_sku,
            rm_name: rm.rm_name,
            rm_unit: rm.rm_unit || "ชิ้น",
            total_required: needed,
            available_qty: rm.available_wh2_qty,
          });
        }
      }
    }
    return Array.from(map.values());
  };

  const consumedMaterials = getConsumedMaterials();

  const filteredBoms = boms.filter(
    (b) =>
      b.fg_sku.toLowerCase().includes(search.toLowerCase()) ||
      b.fg_name.toLowerCase().includes(search.toLowerCase()) ||
      b.fg_barcode.includes(search)
  );

  const handleConfirmProduction = async () => {
    if (cart.length === 0) return;
    setIsSubmitting(true);
    setErrorBanner(null);

    try {
      const storedToken =
        typeof window !== "undefined"
          ? sessionStorage.getItem("stockify_tab_token") || localStorage.getItem("stockify_tab_token")
          : null;

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (storedToken) {
        headers["x-tab-token"] = storedToken;
        headers["Authorization"] = `Bearer ${storedToken}`;
      }

      const res = await fetch("/api/production/orders", {
        method: "POST",
        headers,
        body: JSON.stringify({
          items: cart,
          created_by_name: user?.name || "ผู้ดูแลระบบ (Admin)",
        }),
      });

      const json = await res.json();
      if (json.success && json.data) {
        const orderNo = json.data.order_no;
        setSuccessOrderNo(orderNo);
        setCart([]);
        setCartOpen(false);
        setShowConfirmModal(false);

        // Immediately refresh real-time inventory from Warehouse 2
        await fetchBoms();

        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("stockify-production-created", { detail: json.data }));
        }
      } else {
        setErrorBanner(json.message || "เกิดข้อผิดพลาดในการบันทึกคำสั่งผลิต");
      }
    } catch (e) {
      console.error("Failed to submit production order:", e);
      setErrorBanner("เกิดข้อผิดพลาดในการเชื่อมต่อ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-full space-y-5 pb-16">
      {/* Toast Notification — Top right so it never overlaps mobile bottom navigation */}
      {toastMessage && (
        <div className="fixed top-5 right-5 z-50 max-w-sm bg-slate-900 text-white px-4 py-3 rounded-xl shadow-2xl flex items-center gap-3 border border-slate-700 animate-in fade-in slide-in-from-top-4 duration-200">
          <div className="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs font-bold shrink-0">
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

      {/* Top Banner / Header — sm: breakpoint only (stockify-ui rule 1) */}
      <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center font-bold text-2xl shadow-xs shrink-0">
            🏭
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight flex items-center flex-wrap gap-2">
              สั่งผลิตสินค้า
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                โกดัง 2 (สินค้าสำเร็จรูป)
              </span>
            </h1>
            <p className="text-sm font-medium text-slate-600 pt-0.5">
              เลือกสินค้าสำเร็จรูปที่ต้องการ ระบุจำนวน และเพิ่มลงในตะกร้าเพื่อเริ่มสั่งผลิต
            </p>
          </div>
        </div>

        {/* Right side controls: History Link, Cart Button & Refresh */}
        <div className="flex items-center flex-wrap gap-2.5">
          <Link
            href="/production/history"
            className="px-4 py-2.5 sm:py-3 rounded-xl font-bold text-sm bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all flex items-center gap-2 cursor-pointer border border-slate-200/80 shadow-2xs active:scale-95"
            title="ดูประวัติการสั่งผลิตทั้งหมด"
          >
            <svg className="w-4 h-4 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
            </svg>
            <span>ประวัติการสั่งผลิต</span>
          </Link>

          <button
            onClick={() => setCartOpen(true)}
            className={`relative px-4 py-2.5 sm:py-3 rounded-xl font-bold text-sm transition-all flex items-center gap-2 cursor-pointer active:scale-95 ${
              cart.length > 0
                ? "bg-emerald-600 text-white hover:bg-emerald-700 shadow-md shadow-emerald-600/20"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200"
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
              <span className="ml-1 px-2 py-0.5 rounded-full bg-white text-emerald-950 font-mono font-black text-xs shadow-xs">
                {totalCartUnits.toLocaleString()}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={fetchBoms}
            aria-label="รีเฟรชข้อมูล"
            title="รีเฟรชข้อมูล"
            className="p-2.5 sm:p-3 text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all cursor-pointer border border-slate-200 active:scale-95"
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

      {/* Search Bar */}
      <div className="relative w-full sm:max-w-md">
        <input
          type="text"
          placeholder="ค้นหารหัสสินค้า, ชื่อสินค้า หรือบาร์โค้ด..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-11 pr-4 py-2.5 sm:py-3 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 placeholder:text-slate-500 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 shadow-2xs"
        />
        <svg className="w-5 h-5 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>

      {/* Product Cards Grid — Mobile-first sm: only (stockify-ui rule 1) */}
      {loading ? (
        <div className="py-20 text-center bg-white rounded-2xl border border-slate-200 shadow-xs">
          <div className="w-8 h-8 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-slate-600 mt-3 font-semibold">กำลังโหลดข้อมูลสินค้าสำหรับผลิต...</p>
        </div>
      ) : filteredBoms.length === 0 ? (
        <div className="rounded-2xl p-16 text-center border border-slate-200 bg-white shadow-xs">
          <p className="text-slate-700 text-base font-bold">ไม่พบรายการสินค้าที่ตรงกับคำค้นหา</p>
          <p className="text-slate-500 text-sm mt-1">ลองเปลี่ยนคำค้นหา หรือกดรีเฟรชข้อมูลใหม่อีกครั้ง</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
          {filteredBoms.map((bom) => (
            <ProductCard
              key={bom.fg_sku}
              bom={bom}
              currentQty={produceQty[bom.fg_sku] || 1}
              maxProducible={bom.maxProducible || 0}
              onQuantityChange={handleQuantityChange}
              onAddToCart={() => handleAddToCart(bom)}
            />
          ))}
        </div>
      )}

      {/* Cart Drawer */}
      {cartOpen && (
        <CartDrawer
          cart={cart}
          consumedMaterials={consumedMaterials}
          totalCartUnits={totalCartUnits}
          onClose={() => setCartOpen(false)}
          onUpdateQty={handleUpdateCartQty}
          onRemove={handleRemoveFromCart}
          onConfirm={() => {
            setCartOpen(false);
            setShowConfirmModal(true);
          }}
        />
      )}

      {/* Confirmation Modal (Double-Check Gate before irreversible stock deduction) */}
      {showConfirmModal && (
        <ConfirmProductionModal
          cart={cart}
          consumedMaterials={consumedMaterials}
          totalCartUnits={totalCartUnits}
          isSubmitting={isSubmitting}
          onConfirm={handleConfirmProduction}
          onCancel={() => {
            setShowConfirmModal(false);
            setCartOpen(true);
          }}
        />
      )}

      {/* Success Modal */}
      {successOrderNo && (
        <SuccessModal
          orderNo={successOrderNo}
          onClose={() => setSuccessOrderNo(null)}
        />
      )}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useTabAuth } from "@/context/TabAuthContext";
import Link from "next/link";

interface EnrichedBomFormula {
  bom_id: string;
  fg_sku: string;
  fg_barcode: string;
  fg_name: string;
  fg_unit: string;
  base_qty: number;
  active: boolean;
  image: string;
  maxProducible: number;
  fg_wh2_stock?: number;
  items: Array<{
    rm_sku: string;
    rm_barcode: string;
    rm_name: string;
    rm_wh: string;
    rm_qty_required: number;
    rm_unit: string;
    waste_percentage: number;
    note: string;
    available_wh2_qty?: number;
    possible_units?: number;
  }>;
}

interface CartItem {
  bom: EnrichedBomFormula;
  quantity: number;
}

interface ConsumedMaterial {
  rm_sku: string;
  rm_name: string;
  rm_unit: string;
  total_required: number;
  available_qty?: number;
}

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

  const fetchBoms = async () => {
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
  };

  useEffect(() => {
    fetchBoms();
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
    <div className="w-full max-w-full space-y-6 pb-16">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-5 py-3.5 rounded-2xl shadow-2xl flex items-center gap-3 border border-slate-700 animate-in fade-in slide-in-from-bottom-5 duration-200">
          <div className="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs font-bold shrink-0">
            ✓
          </div>
          <span className="text-sm font-semibold text-white">{toastMessage}</span>
          <button
            onClick={() => setToastMessage(null)}
            className="text-slate-400 hover:text-white text-xs ml-2 cursor-pointer font-bold p-1"
          >
            ✕
          </button>
        </div>
      )}

      {/* Top Banner / Header */}
      <div className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center font-bold text-2xl shadow-xs shrink-0">
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
        </div>

        {/* Right side controls: History Link, Cart Button & Refresh */}
        <div className="flex items-center flex-wrap gap-2.5">
          <Link
            href="/production/history"
            className="px-4 py-3 rounded-xl font-bold text-sm bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all flex items-center gap-2 cursor-pointer border border-slate-200/80 shadow-2xs"
            title="ดูประวัติการสั่งผลิตทั้งหมด"
          >
            <svg className="w-4 h-4 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
            </svg>
            <span>ประวัติการสั่งผลิต</span>
          </Link>

          <button
            onClick={() => setCartOpen(true)}
            className={`relative px-4 py-3 rounded-xl font-bold text-sm transition-all flex items-center gap-2 cursor-pointer ${
              cart.length > 0
                ? "bg-emerald-600 text-white hover:bg-emerald-700 shadow-md shadow-emerald-600/20 active:scale-95"
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
              <span
                className="ml-1 px-2.5 py-0.5 rounded-full bg-white !text-emerald-950 font-mono font-black text-xs shadow-xs"
                style={{ color: "#064e3b" }}
              >
                {totalCartUnits.toLocaleString()}
              </span>
            )}
          </button>

          <button
            onClick={fetchBoms}
            className="p-3 text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all cursor-pointer border border-slate-200"
            title="รีเฟรชข้อมูล"
          >
            <svg className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      {/* Error Banner (Replacing native alerts) */}
      {errorBanner && (
        <div className="rounded-2xl bg-rose-50 border border-rose-200 p-4 flex items-center justify-between gap-3 shadow-xs">
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
      <div className="relative w-full max-w-md sm:max-w-lg">
        <input
          type="text"
          placeholder="ค้นหารหัสสินค้า, ชื่อสินค้า หรือบาร์โค้ด..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-11 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 placeholder:text-slate-500 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 shadow-2xs"
        />
        <svg className="w-5 h-5 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>

      {/* Product Cards Grid */}
      {loading ? (
        <div className="py-20 text-center bg-white rounded-3xl border border-slate-200">
          <div className="w-8 h-8 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-slate-600 mt-3 font-semibold">กำลังโหลดข้อมูลสินค้าสำหรับผลิต...</p>
        </div>
      ) : filteredBoms.length === 0 ? (
        <div className="py-16 text-center bg-white rounded-3xl border border-slate-200 text-slate-600 text-sm font-medium">
          ไม่พบรายการสินค้าที่ตรงกับคำค้นหา
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-5">
          {filteredBoms.map((bom) => {
            const currentQty = produceQty[bom.fg_sku] || 1;
            const maxProducible = bom.maxProducible || 0;

            return (
              <div
                key={bom.fg_sku}
                className="bg-white rounded-3xl border border-slate-200 shadow-xs hover:shadow-xl hover:border-emerald-300 transition-all duration-300 flex flex-col justify-between p-4 sm:p-5 space-y-4 group relative overflow-hidden"
              >
                {/* Product Image */}
                <div className="w-full h-44 sm:h-48 bg-gradient-to-b from-slate-50 to-slate-100/70 rounded-2xl overflow-hidden flex items-center justify-center p-3 border border-slate-100 relative group-hover:scale-[1.02] transition-transform duration-300">
                  <img
                    src={bom.image || "/products/A002.jpg"}
                    alt={bom.fg_name}
                    className="max-h-full max-w-full object-contain drop-shadow-md"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = "none";
                    }}
                  />
                  {typeof bom.fg_wh2_stock === "number" && (
                    <span className="absolute bottom-2.5 left-2.5 px-2.5 py-1 rounded-full bg-slate-900/85 backdrop-blur-xs text-xs font-bold text-white shadow-2xs font-mono">
                      ในคลัง: {bom.fg_wh2_stock.toLocaleString()} {bom.fg_unit}
                    </span>
                  )}
                </div>

                {/* SKU, Barcode, and Name */}
                <div className="space-y-1 text-center">
                  <div className="font-mono font-bold text-base text-slate-900">
                    {bom.fg_sku}
                  </div>
                  {bom.fg_barcode && (
                    <div className="text-xs font-mono font-medium text-slate-600">
                      {bom.fg_barcode}
                    </div>
                  )}
                  <h3 className="text-base font-bold text-slate-900 line-clamp-2 leading-snug pt-0.5">
                    {bom.fg_name}
                  </h3>
                </div>

                {/* Producible Count & Stepper */}
                <div className="bg-slate-50 rounded-2xl p-3.5 border border-slate-200/90 space-y-3">
                  <div className="flex items-center justify-between text-xs font-bold">
                    <span className="text-slate-700 text-sm">ผลิตได้สูงสุด:</span>
                    {maxProducible > 0 ? (
                      <span className="text-emerald-800 bg-emerald-100 border border-emerald-300 px-2.5 py-0.5 rounded-lg text-xs font-bold font-mono">
                        {maxProducible.toLocaleString()} {bom.fg_unit}
                      </span>
                    ) : (
                      <span className="text-rose-800 bg-rose-100 border border-rose-300 px-2.5 py-0.5 rounded-lg text-xs font-bold">
                        วัตถุดิบไม่พอ (0 {bom.fg_unit})
                      </span>
                    )}
                  </div>

                  {/* Quantity Stepper (Compliant with 44-48px touch targets) */}
                  <div className="flex items-center justify-center gap-2">
                    <button
                      type="button"
                      disabled={maxProducible <= 0}
                      onClick={() => handleQuantityChange(bom.fg_sku, currentQty - 1, maxProducible)}
                      className="w-11 h-11 rounded-xl bg-white border border-slate-300 text-slate-800 hover:bg-slate-100 active:scale-95 disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center font-bold text-xl transition-all shadow-2xs cursor-pointer select-none"
                      aria-label="ลดจำนวน"
                    >
                      −
                    </button>

                    <div className="relative flex-1">
                      <input
                        type="number"
                        min={1}
                        max={maxProducible > 0 ? maxProducible : 1}
                        disabled={maxProducible <= 0}
                        value={maxProducible > 0 ? (produceQty[bom.fg_sku] === 0 ? "" : (produceQty[bom.fg_sku] ?? 1)) : 0}
                        onFocus={(e) => e.target.select()}
                        onClick={(e) => (e.target as HTMLInputElement).select()}
                        onChange={(e) => {
                          const raw = e.target.value;
                          if (raw === "") {
                            setProduceQty((prev) => ({ ...prev, [bom.fg_sku]: 0 }));
                            return;
                          }
                          const val = parseInt(raw);
                          if (!isNaN(val)) {
                            handleQuantityChange(bom.fg_sku, val, maxProducible);
                          }
                        }}
                        onBlur={() => {
                          const cur = produceQty[bom.fg_sku] || 0;
                          if (cur < 1) {
                            handleQuantityChange(bom.fg_sku, 1, maxProducible);
                          }
                        }}
                        className="w-full text-center h-11 px-2 bg-white border border-slate-300 rounded-xl font-mono text-base font-bold text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 shadow-inner disabled:bg-slate-100 disabled:text-slate-400 cursor-text select-all"
                      />
                    </div>

                    <button
                      type="button"
                      disabled={maxProducible <= 0}
                      onClick={() => handleQuantityChange(bom.fg_sku, currentQty + 1, maxProducible)}
                      className="w-11 h-11 rounded-xl bg-white border border-slate-300 text-slate-800 hover:bg-slate-100 active:scale-95 disabled:opacity-40 disabled:pointer-events-none flex items-center justify-center font-bold text-xl transition-all shadow-2xs cursor-pointer select-none"
                      aria-label="เพิ่มจำนวน"
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* Add to Cart Button (At least 48px height) */}
                <button
                  type="button"
                  disabled={maxProducible <= 0}
                  onClick={() => handleAddToCart(bom)}
                  className={`w-full py-3.5 px-4 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-md cursor-pointer ${
                    maxProducible > 0
                      ? "bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white shadow-emerald-600/20"
                      : "bg-slate-200 text-slate-500 cursor-not-allowed shadow-none"
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
                  <span>{maxProducible > 0 ? "เพิ่มในตะกร้า" : "วัตถุดิบในโกดัง 2 ไม่พอ"}</span>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Cart Drawer / Slide-Over Modal */}
      {cartOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs transition-opacity"
            onClick={() => setCartOpen(false)}
          />

          {/* Drawer Panel */}
          <div className="relative w-full max-w-lg bg-white h-full shadow-2xl flex flex-col z-10 animate-in slide-in-from-right duration-200">
            {/* Header */}
            <div className="px-6 py-5 border-b border-slate-200 flex items-center justify-between bg-slate-50 shrink-0">
              <div className="flex items-center gap-2.5">
                <span className="text-2xl">🛒</span>
                <div>
                  <h3 className="text-base font-bold text-slate-900">ตะกร้าสั่งผลิตสินค้า</h3>
                  <p className="text-xs text-slate-600">ตรวจสอบรายการก่อนยืนยันผลิต</p>
                </div>
                <span className="ml-1 px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-xs">
                  {cart.length} รายการ
                </span>
              </div>
              <button
                onClick={() => setCartOpen(false)}
                className="w-11 h-11 rounded-xl bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-100 flex items-center justify-center font-bold text-base transition-all cursor-pointer"
                aria-label="ปิดตะกร้า"
              >
                ✕
              </button>
            </div>

            {/* Cart Items & Materials List */}
            <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5">
              {cart.length === 0 ? (
                <div className="py-20 text-center text-slate-500 space-y-3">
                  <span className="text-5xl block">🛒</span>
                  <p className="text-sm font-bold text-slate-700">ยังไม่มีสินค้าในตะกร้า</p>
                  <p className="text-xs text-slate-600">เลือกสินค้าและกด "เพิ่มในตะกร้า" เพื่อเริ่มผลิต</p>
                </div>
              ) : (
                <>
                  {/* Cart Items */}
                  <div className="space-y-3">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                      สินค้าสำเร็จรูปที่สั่งผลิต
                    </p>
                    {cart.map((item) => (
                      <div
                        key={item.bom.fg_sku}
                        className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-14 h-14 rounded-xl bg-white border border-slate-200 overflow-hidden flex items-center justify-center p-1 shrink-0">
                            <img
                              src={item.bom.image || "/products/A002.jpg"}
                              alt={item.bom.fg_name}
                              className="w-full h-full object-contain"
                            />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 font-mono font-bold text-xs">
                                {item.bom.fg_sku}
                              </span>
                            </div>
                            <h4 className="text-sm font-bold text-slate-900 truncate mt-1">
                              {item.bom.fg_name}
                            </h4>
                            <p className="text-xs text-slate-600 font-medium pt-0.5">
                              ปลายทาง: <span className="text-emerald-800 font-bold">โกดัง 2</span>
                            </p>
                          </div>
                          <button
                            onClick={() => handleRemoveFromCart(item.bom.fg_sku)}
                            className="px-2.5 py-1 text-slate-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg font-semibold text-xs cursor-pointer border border-transparent hover:border-rose-200 transition-all"
                            title="ลบรายการนี้"
                          >
                            ลบ
                          </button>
                        </div>

                        <div className="flex items-center justify-between pt-2.5 border-t border-slate-200">
                          <span className="text-sm font-bold text-slate-700">จำนวนที่ผลิต:</span>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleUpdateCartQty(item.bom.fg_sku, item.quantity - 1)}
                              className="w-11 h-11 rounded-xl bg-white border border-slate-300 text-slate-800 hover:bg-slate-100 flex items-center justify-center font-bold text-xl cursor-pointer active:scale-95 transition-all shadow-2xs select-none"
                              aria-label="ลดจำนวน"
                            >
                              −
                            </button>
                            <input
                              type="number"
                              min={1}
                              max={item.bom.maxProducible || 9999}
                              value={item.quantity === 0 ? "" : item.quantity}
                              onFocus={(e) => e.target.select()}
                              onClick={(e) => (e.target as HTMLInputElement).select()}
                              onChange={(e) => {
                                const raw = e.target.value;
                                if (raw === "") {
                                  handleUpdateCartQty(item.bom.fg_sku, 0);
                                  return;
                                }
                                const val = parseInt(raw);
                                if (!isNaN(val)) {
                                  handleUpdateCartQty(item.bom.fg_sku, val);
                                }
                              }}
                              onBlur={() => {
                                if (item.quantity < 1) {
                                  handleUpdateCartQty(item.bom.fg_sku, 1);
                                }
                              }}
                              className="font-mono font-bold text-base text-slate-900 w-20 h-11 text-center py-1 px-1 bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-emerald-500 cursor-text select-all"
                            />
                            <button
                              onClick={() => handleUpdateCartQty(item.bom.fg_sku, item.quantity + 1)}
                              className="w-11 h-11 rounded-xl bg-white border border-slate-300 text-slate-800 hover:bg-slate-100 flex items-center justify-center font-bold text-xl cursor-pointer active:scale-95 transition-all shadow-2xs select-none"
                              aria-label="เพิ่มจำนวน"
                            >
                              +
                            </button>
                            <span className="text-sm font-bold text-slate-600 ml-1">{item.bom.fg_unit}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Consumed Raw Materials Warning Box (Critical Readable Rule) */}
                  {consumedMaterials.length > 0 && (
                    <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 space-y-3 shadow-2xs">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">⚠️</span>
                        <div>
                          <p className="text-sm font-bold text-amber-950">
                            วัตถุดิบที่จะถูกตัดออกจากโกดัง 2
                          </p>
                          <p className="text-xs text-amber-800">
                            ระบบจะหักสต็อกวัตถุดิบเหล่านี้ทันทีเมื่อยืนยัน และย้อนคืนไม่ได้
                          </p>
                        </div>
                      </div>

                      <div className="space-y-1.5 divide-y divide-amber-200/80 pt-1">
                        {consumedMaterials.map((c) => (
                          <div key={c.rm_sku} className="flex items-baseline justify-between gap-3 pt-1.5 first:pt-0">
                            <span className="text-sm font-semibold text-slate-900 min-w-0 truncate">
                              {c.rm_name}
                            </span>
                            <span className="text-base font-mono font-bold text-amber-900 shrink-0">
                              −{Math.ceil(c.total_required).toLocaleString()} {c.rm_unit}
                            </span>
                          </div>
                        ))}
                      </div>

                      <p className="text-xs text-slate-600 pt-1">
                        ตรวจรายการนี้กับของจริงก่อนกดยืนยันการสั่งผลิต
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Footer / Submit */}
            {cart.length > 0 && (
              <div className="p-5 sm:p-6 border-t border-slate-200 bg-slate-50 space-y-4 shrink-0">
                <div className="flex items-center justify-between text-sm font-bold text-slate-700">
                  <span>ยอดผลิตรวมทั้งหมด:</span>
                  <span className="text-xl font-bold text-emerald-800 font-mono">
                    +{totalCartUnits.toLocaleString()} ชิ้น
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => setShowConfirmModal(true)}
                  className="w-full py-4 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white font-bold text-base flex items-center justify-center gap-2 transition-all shadow-md shadow-emerald-600/20 cursor-pointer"
                >
                  <span>ตรวจสอบและยืนยันการสั่งผลิต</span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Confirmation Modal (Double-Check Gate before irreversible stock deduction) */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-md max-h-[90dvh] overflow-y-auto p-5 sm:p-6 space-y-5">
            <div className="space-y-1">
              <h2 className="text-xl font-bold text-slate-900">
                ยืนยันการสั่งผลิตสินค้า
              </h2>
              <p className="text-sm text-slate-600">
                โปรดตรวจสอบรายการสินค้าและวัตถุดิบก่อนดำเนินการ
              </p>
            </div>

            {/* What will be added (+) */}
            <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4 space-y-2">
              <p className="text-xs font-bold text-emerald-800 uppercase tracking-wider">
                + สินค้าสำเร็จรูปที่จะเพิ่มเข้าโกดัง 2
              </p>
              <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                {cart.map((item) => (
                  <div key={item.bom.fg_sku} className="flex items-baseline justify-between text-sm">
                    <span className="font-semibold text-emerald-950 truncate">{item.bom.fg_name}</span>
                    <span className="font-mono font-bold text-emerald-900 shrink-0">
                      +{item.quantity.toLocaleString()} {item.bom.fg_unit}
                    </span>
                  </div>
                ))}
              </div>
              <div className="pt-2 border-t border-emerald-200 flex justify-between items-baseline font-bold">
                <span className="text-xs text-emerald-800">ยอดผลิตรวม</span>
                <span className="text-lg font-mono text-emerald-900">
                  +{totalCartUnits.toLocaleString()} ชิ้น
                </span>
              </div>
            </div>

            {/* What will be deducted (-) */}
            <div className="rounded-2xl bg-amber-50 border border-amber-300 p-4 space-y-2">
              <p className="text-xs font-bold text-amber-800 uppercase tracking-wider">
                − วัตถุดิบที่จะถูกตัดออกจากโกดัง 2 ทันที
              </p>
              <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                {consumedMaterials.map((c) => (
                  <div key={c.rm_sku} className="flex items-baseline justify-between text-sm">
                    <span className="font-semibold text-amber-950 truncate">{c.rm_name}</span>
                    <span className="font-mono font-bold text-amber-900 shrink-0">
                      −{Math.ceil(c.total_required).toLocaleString()} {c.rm_unit}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Critical Warning */}
            <div className="rounded-xl bg-rose-50 border border-rose-200 p-3.5 flex items-center gap-2.5 text-xs text-rose-800 font-bold">
              <span className="text-base shrink-0">⚠️</span>
              <span>กดยืนยันแล้วระบบจะตัดสต็อกวัตถุดิบทันทีและไม่สามารถเรียกคืนได้</span>
            </div>

            {/* Action buttons */}
            <div className="flex flex-col gap-2.5 pt-1">
              <button
                type="button"
                disabled={isSubmitting}
                onClick={handleConfirmProduction}
                className="w-full py-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white font-bold text-base transition-all shadow-md shadow-emerald-600/20 disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <span>ยืนยัน ผลิต {totalCartUnits.toLocaleString()} ชิ้น</span>
                )}
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => setShowConfirmModal(false)}
                className="w-full py-3.5 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm transition-all cursor-pointer border border-slate-200"
              >
                กลับไปตรวจอีกครั้ง
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Success Modal */}
      {successOrderNo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 text-center space-y-4 shadow-2xl border border-slate-200">
            <div className="w-16 h-16 rounded-3xl bg-emerald-100 text-emerald-700 flex items-center justify-center text-3xl mx-auto shadow-xs">
              🎉
            </div>
            <div className="space-y-1.5">
              <h3 className="text-xl font-bold text-slate-900">บันทึกคำสั่งผลิตสำเร็จ!</h3>
              <p className="text-sm text-slate-600">
                เลขที่เอกสาร: <strong className="font-mono text-emerald-800">{successOrderNo}</strong>
              </p>
              <div className="bg-emerald-50 rounded-2xl p-4 border border-emerald-200 text-xs text-emerald-900 font-semibold text-left space-y-1.5 mt-2">
                <div className="font-bold text-emerald-950 flex items-center gap-1">
                  <span>✓ การดำเนินการในโกดัง 2:</span>
                </div>
                <div>• เพิ่มสินค้าสำเร็จรูปเข้า <strong>โกดัง 2</strong> เรียบร้อยแล้ว</div>
                <div>• ตัดสต็อกวัตถุดิบออกจาก <strong>โกดัง 2</strong> เรียบร้อยแล้ว</div>
              </div>
            </div>
            <div className="flex flex-col gap-2 pt-2">
              <Link
                href="/production/history"
                className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm transition-all flex items-center justify-center gap-1.5 shadow-md shadow-emerald-600/20 cursor-pointer"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                </svg>
                <span>ดูประวัติการสั่งผลิต</span>
              </Link>
              <button
                onClick={() => setSuccessOrderNo(null)}
                className="w-full py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm transition-all cursor-pointer border border-slate-200"
              >
                สั่งผลิตรายการอื่นต่อ
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

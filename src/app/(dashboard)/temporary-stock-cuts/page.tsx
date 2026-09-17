"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTabAuth } from "@/context/TabAuthContext";
import CutStockModal from "./_components/CutStockModal";
import QueueConfirmModal from "./_components/QueueConfirmModal";
import HistoryModal from "./_components/HistoryModal";
import {
  TARGET_WAREHOUSE_ID,
  TARGET_WAREHOUSE_NAME,
  displayProductName,
  formatQty,
  matchesProduct,
  type CutDirection,
  type CutQueueItem,
  type TempStockCutRecord,
  type WhProduct,
} from "./_components/types";

const MAX_SUGGESTIONS = 8;

export default function TemporaryStockCutsPage() {
  const { user } = useTabAuth();

  const [products, setProducts] = useState<WhProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  // คิวรายการรอตัดสต็อก
  const [queue, setQueue] = useState<CutQueueItem[]>([]);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [modalProduct, setModalProduct] = useState<WhProduct | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyRecords, setHistoryRecords] = useState<TempStockCutRecord[]>([]);

  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  };

  const fetchProducts = useCallback(async (): Promise<WhProduct[]> => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/products?warehouse_id=${TARGET_WAREHOUSE_ID}`, { cache: "no-store" });
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        const list: WhProduct[] = json.data
          .filter((p: any) => p.sku)
          .map((p: any) => ({
            product_id: p.product_id || p.sku,
            sku: p.sku || "",
            barcode: p.barcode || "",
            product_name: p.product_name || p.sku || "-",
            category: p.category || "",
            base_unit: p.base_unit || "ชิ้น",
            quantity: Number(p.quantity ?? p.total_quantity ?? 0),
          }));
        list.sort((a, b) => a.product_name.localeCompare(b.product_name, "th"));
        setProducts(list);
        return list;
      }
      setLoadError(json.message || "โหลดรายการสินค้าไม่สำเร็จ");
      return [];
    } catch {
      setLoadError("เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch("/api/temporary-stock-cuts", { cache: "no-store" });
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setHistoryRecords(json.data);
      }
    } catch {
      // ปล่อยรายการเดิมไว้ — ประวัติเป็นข้อมูลรอง
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const openHistory = () => {
    setHistoryOpen(true);
    fetchHistory();
  };

  // ===== ค้นหา =====
  const matches = useMemo(() => {
    if (!query.trim()) return [];
    return products.filter((p) => matchesProduct(p, query));
  }, [products, query]);

  const suggestions = useMemo(() => matches.slice(0, MAX_SUGGESTIONS), [matches]);

  useEffect(() => {
    setHighlightIndex(0);
  }, [query]);

  // เลือกสินค้าจากผลค้นหา → เปิด modal ตั้งจำนวน/เหตุผล
  const openAddModal = (p: WhProduct) => {
    setQuery("");
    setSuggestOpen(false);
    setEditingIdx(null);
    setModalProduct(p);
  };

  // แก้ไขรายการในคิว → เปิด modal พร้อมค่าเดิม
  const openEditModal = (idx: number) => {
    setEditingIdx(idx);
    setModalProduct(queue[idx].product);
  };

  const handleQueryChange = (value: string) => {
    setQuery(value);
    setSuggestOpen(true);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!suggestOpen || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      openAddModal(suggestions[highlightIndex] ?? suggestions[0]);
    } else if (e.key === "Escape") {
      setSuggestOpen(false);
    }
  };

  // ===== คิวรายการ =====
  const cutQty = useMemo(
    () => queue.filter((it) => it.direction !== "ADD").reduce((sum, it) => sum + it.quantity, 0),
    [queue]
  );
  const addQty = useMemo(
    () => queue.filter((it) => it.direction === "ADD").reduce((sum, it) => sum + it.quantity, 0),
    [queue]
  );

  /**
   * สต็อกที่ตัดได้จริง = สต็อกปัจจุบัน + รายการเพิ่มในคิว − รายการตัดในคิว
   * (ไม่นับรายการที่กำลังแก้ไข)
   */
  const stockLimitFor = useCallback(
    (product: WhProduct): number => {
      const others = queue.reduce(
        (acc, it, idx) => {
          if (it.product.sku !== product.sku || idx === editingIdx) return acc;
          return it.direction === "ADD" ? acc + it.quantity : acc - it.quantity;
        },
        0
      );
      return Math.max(0, product.quantity + others);
    },
    [queue, editingIdx]
  );

  /** ยอดตัดเกินสต็อกของรายการในคิว (เฉพาะรายการตัด) */
  const isOverStock = useCallback(
    (idx: number): boolean => {
      const it = queue[idx];
      if (!it || it.direction === "ADD") return false;
      const others = queue.reduce(
        (acc, q, i) => {
          if (q.product.sku !== it.product.sku || i === idx) return acc;
          return q.direction === "ADD" ? acc + q.quantity : acc - q.quantity;
        },
        0
      );
      return it.quantity > it.product.quantity + others;
    },
    [queue]
  );

  const handleModalSubmit = ({
    product,
    quantity,
    reason,
    note,
    direction,
  }: {
    product: WhProduct;
    quantity: number;
    reason: string;
    note: string;
    direction: CutDirection;
  }) => {
    if (editingIdx !== null) {
      setQueue((q) => q.map((it, i) => (i === editingIdx ? { product, quantity, reason, note, direction } : it)));
    } else {
      setQueue((q) => [...q, { product, quantity, reason, note, direction }]);
    }
    setModalProduct(null);
    setEditingIdx(null);
    // โฟกัสกลับช่องค้นหาพร้อมพิมพ์รายการถัดไปทันที
    requestAnimationFrame(() => searchRef.current?.focus());
  };

  const removeItem = (idx: number) => {
    setQueue((q) => q.filter((_, i) => i !== idx));
  };

  // ===== ยืนยันตัดสต็อกทั้งหมด =====
  const handleConfirmAll = async () => {
    if (queue.length === 0) return;
    setSubmitting(true);
    setServerError(null);
    try {
      const storedToken =
        typeof window !== "undefined"
          ? sessionStorage.getItem("stockify_tab_token") || localStorage.getItem("stockify_tab_token")
          : null;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (storedToken) {
        headers["x-tab-token"] = storedToken;
        headers["Authorization"] = `Bearer ${storedToken}`;
      }

      const res = await fetch("/api/temporary-stock-cuts", {
        method: "POST",
        headers,
        body: JSON.stringify({
          items: queue.map((it) => ({
            sku: it.product.sku,
            product_name: it.product.product_name,
            quantity: it.quantity,
            reason: it.reason,
            note: it.note,
            direction: it.direction,
          })),
          created_by_name: user?.name || "ผู้ใช้งาน",
        }),
      });
      const json = await res.json();

      if (json.success) {
        setConfirmOpen(false);
        setQueue([]);
        showToast(json.message || "ตัดสต็อกเรียบร้อยแล้ว");
        await fetchProducts();
      } else {
        setServerError(json.message || "ตัดสต็อกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
      }
    } catch {
      setServerError("เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setSubmitting(false);
    }
  };

  const editingItem = editingIdx !== null ? queue[editingIdx] : null;

  return (
    <div className={`max-w-3xl mx-auto space-y-6 ${queue.length > 0 ? "pb-28" : ""}`}>
      {/* Toast */}
      {toast && (
        <div className="fixed top-5 right-5 z-[60] max-w-sm bg-[#06402B] text-white px-4 py-3 rounded-xl shadow-[0_12px_32px_rgba(6,64,43,0.35)] flex items-center gap-3 animate-in fade-in slide-in-from-top-3 duration-200">
          <span className="size-6 shrink-0 rounded-full bg-white/15 grid place-items-center">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </span>
          <span className="text-sm font-semibold flex-1">{toast}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="text-white/60 hover:text-white text-xs font-bold p-1 cursor-pointer"
            aria-label="ปิดการแจ้งเตือน"
          >
            ✕
          </button>
        </div>
      )}

      {/* ============ ส่วนที่ 1: Header ============ */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#06402B]">ตัดสต็อกชั่วคราว</h1>
          <p className="mt-1 text-sm text-slate-500 font-medium">
            ค้นหาและบันทึกรายการสินค้าที่ต้องการตัดออกจาก{TARGET_WAREHOUSE_NAME}
          </p>
        </div>
        <button
          type="button"
          onClick={openHistory}
          className="shrink-0 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[#E8ECEA] bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 hover:border-[#C8DBD1] transition-all cursor-pointer active:scale-[0.98]"
        >
          <svg className="w-4 h-4 text-[#0F5C3F]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
            <path d="M12 7v5l4 2" />
          </svg>
          ประวัติการตัดสต็อก
        </button>
      </div>

      {/* ============ ส่วนที่ 2: Search + Suggestions ============ */}
      <div className="relative">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </span>
        <input
          ref={searchRef}
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onFocus={() => query.trim() && setSuggestOpen(true)}
          onKeyDown={handleSearchKeyDown}
          placeholder="ค้นหาชื่อสินค้า / รหัสสินค้า / บาร์โค้ด"
          autoComplete="off"
          className="w-full rounded-2xl border border-[#E8ECEA] bg-white pl-12 pr-28 py-4 text-sm sm:text-base font-medium text-slate-900 placeholder:text-slate-400 shadow-[0_1px_3px_rgba(16,24,40,0.04)] transition-all outline-none focus:border-[#0F5C3F] focus:ring-4 focus:ring-[#0F5C3F]/10"
        />
        <span className="absolute right-3.5 top-1/2 -translate-y-1/2 inline-flex items-center rounded-lg bg-[#F0F7F3] border border-[#D7EAE0] px-2.5 py-1.5 text-xs font-bold text-[#06402B] pointer-events-none">
          {TARGET_WAREHOUSE_NAME}
        </span>

        {/* Suggestion dropdown */}
        {suggestOpen && query.trim() !== "" && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setSuggestOpen(false)} />
            <div className="absolute left-0 right-0 top-full z-20 mt-2 rounded-2xl border border-[#E8ECEA] bg-white shadow-[0_12px_40px_rgba(16,24,40,0.14)] overflow-hidden animate-in fade-in slide-in-from-top-1 duration-100">
              {loading ? (
                <div className="px-4 py-6 flex items-center justify-center gap-2.5">
                  <div className="w-5 h-5 border-2 border-[#0F5C3F] border-t-transparent rounded-full animate-spin" />
                  <span className="text-sm text-slate-500 font-medium">กำลังค้นหา...</span>
                </div>
              ) : suggestions.length === 0 ? (
                <div className="px-4 py-6 text-center">
                  <p className="text-sm font-semibold text-slate-600">ไม่พบสินค้าที่ตรงกับ “{query}”</p>
                  <p className="mt-0.5 text-xs text-slate-400">ลองค้นหาด้วยชื่อสินค้า รหัสสินค้า หรือบาร์โค้ด</p>
                </div>
              ) : (
                <>
                  <ul className="max-h-[320px] overflow-y-auto py-1.5">
                    {suggestions.map((p, i) => (
                      <li key={p.product_id || p.sku}>
                        <button
                          type="button"
                          onClick={() => openAddModal(p)}
                          onMouseEnter={() => setHighlightIndex(i)}
                          className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors cursor-pointer ${
                            i === highlightIndex ? "bg-[#F0F7F3]" : "bg-white"
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-slate-800 truncate">
                              {displayProductName(p)}
                            </p>
                            <p className="mt-0.5 text-xs text-slate-400 font-medium truncate">
                              รหัส {p.sku}
                              {p.barcode && p.barcode !== p.sku ? ` • ${p.barcode}` : ""}
                            </p>
                          </div>
                          <span className="shrink-0 text-sm font-bold num text-[#06402B]">
                            {formatQty(p.quantity)}
                            <span className="ml-1 text-[11px] font-semibold text-slate-400">{p.base_unit || "ชิ้น"}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {matches.length > suggestions.length && (
                    <p className="border-t border-[#F2F4F3] px-4 py-2 text-[11px] font-semibold text-slate-400">
                      แสดง {suggestions.length} จาก {matches.length.toLocaleString("th-TH")} รายการ — พิมพ์เพิ่มเพื่อให้ผลแม่นยำขึ้น
                    </p>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* ============ ส่วนที่ 3: คิวรายการที่จะตัดสต็อก ============ */}
      {queue.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#D8E2DC] bg-white/60 px-6 py-14 flex flex-col items-center gap-3 text-center">
          <div className="size-14 rounded-2xl bg-[#F7FAF8] border border-[#E8F0EB] grid place-items-center">
            <svg className="w-6 h-6 text-[#6B9C85]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="6" cy="6" r="3" />
              <path d="M8.12 8.12 12 12" />
              <path d="M20 4 8.12 15.88" />
              <circle cx="6" cy="18" r="3" />
              <path d="M14.8 14.8 20 20" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-600">
              {query.trim() ? "เลือกสินค้าจากผลการค้นหาด้านบน" : "ค้นหาสินค้าเพื่อเพิ่มรายการตัดสต็อก"}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              เพิ่มได้หลายรายการ แล้วกดยืนยันตัดสต็อกทั้งหมดพร้อมกันในครั้งเดียว
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-bold text-slate-700">
              รายการที่จะตัดสต็อก
              <span className="ml-2 inline-flex items-center justify-center rounded-full bg-[#F0F7F3] border border-[#D7EAE0] px-2 py-0.5 text-[11px] font-bold text-[#06402B]">
                {queue.length}
              </span>
            </h2>
            <button
              type="button"
              onClick={() => setQueue([])}
              className="text-xs font-semibold text-slate-400 hover:text-[#B42318] transition-colors cursor-pointer"
            >
              ล้างทั้งหมด
            </button>
          </div>

          {queue.map((it, idx) => {
            const overStock = isOverStock(idx);
            const isAdd = it.direction === "ADD";
            return (
              <div
                key={`${it.product.sku}-${idx}`}
                className={`group rounded-2xl border bg-white p-4 sm:p-5 shadow-[0_1px_3px_rgba(16,24,40,0.04)] transition-all ${
                  overStock ? "border-[#FBD1CE]" : "border-[#E8ECEA] hover:border-[#9FC3B1]"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  {/* คลิกรายการเพื่อแก้ไข */}
                  <button
                    type="button"
                    onClick={() => openEditModal(idx)}
                    className="min-w-0 flex-1 text-left cursor-pointer"
                    title="แก้ไขรายการ"
                  >
                    <p className="text-sm font-bold text-slate-800 leading-snug line-clamp-2">
                      {displayProductName(it.product)}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-400 font-medium">
                      รหัส {it.product.sku} • สต็อก {formatQty(it.product.quantity)} {it.product.base_unit || "ชิ้น"}
                    </p>
                    <span
                      className={`mt-2 inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                        isAdd ? "bg-[#E7F6EE] text-[#067647]" : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {it.reason}
                    </span>
                    {it.note && (
                      <span className="ml-1.5 text-[11px] text-slate-400 font-medium">“{it.note}”</span>
                    )}
                  </button>

                  <div className="shrink-0 flex flex-col items-end gap-2">
                    <button
                      type="button"
                      onClick={() => removeItem(idx)}
                      aria-label="ลบรายการ"
                      title="ลบรายการ"
                      className="grid place-items-center size-7 rounded-lg text-slate-300 hover:text-[#B42318] hover:bg-[#FEF3F2] transition-colors cursor-pointer"
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 6 6 18" />
                        <path d="m6 6 12 12" />
                      </svg>
                    </button>
                    <p
                      className={`text-lg font-bold num ${
                        overStock ? "text-[#B42318]" : isAdd ? "text-[#067647]" : "text-[#06402B]"
                      }`}
                    >
                      {isAdd ? "+" : "−"}{formatQty(it.quantity)}
                      <span className="ml-1 text-[11px] font-semibold text-slate-400">{it.product.base_unit || "ชิ้น"}</span>
                    </p>
                  </div>
                </div>
                {overStock && (
                  <p className="mt-2 text-xs font-semibold text-[#B42318]">
                    จำนวนเกินสต็อกที่ตัดได้ — คลิกรายการเพื่อแก้ไข
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* โหลดสินค้าไม่สำเร็จ */}
      {loadError && (
        <div className="rounded-2xl border border-[#FBD1CE] bg-[#FEF3F2] px-6 py-6 flex flex-col items-center gap-3 text-center">
          <p className="text-sm font-semibold text-[#B42318]">{loadError}</p>
          <button
            type="button"
            onClick={() => fetchProducts()}
            className="px-4 py-2 rounded-xl bg-[#06402B] text-white text-sm font-semibold hover:bg-[#0A5C4E] transition-colors cursor-pointer"
          >
            ลองใหม่อีกครั้ง
          </button>
        </div>
      )}

      {/* ============ แถบยืนยันด้านล่าง ============ */}
      {queue.length > 0 && (
        <div className="fixed bottom-4 inset-x-0 z-40 flex justify-center px-4 pointer-events-none">
          <div className="pointer-events-auto w-full max-w-3xl bg-[#06402B] rounded-2xl shadow-[0_16px_48px_rgba(6,64,43,0.4)] px-5 py-3.5 flex items-center justify-between gap-4 animate-in fade-in slide-in-from-bottom-2 duration-200">
            <div className="min-w-0">
              <p className="text-sm font-bold text-white">
                {queue.length} รายการ
                {cutQty > 0 && ` • ตัด ${formatQty(cutQty)} ชิ้น`}
                {addQty > 0 && ` • เพิ่ม ${formatQty(addQty)} ชิ้น`}
              </p>
              <p className="text-[11px] font-medium text-white/60 truncate">
                ตรวจสอบรายการแล้วกดยืนยันเพื่อบันทึกทั้งหมด
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setServerError(null);
                setConfirmOpen(true);
              }}
              className="shrink-0 px-5 py-2.5 rounded-xl bg-white text-sm font-bold text-[#06402B] hover:bg-[#EAF2EE] active:scale-[0.97] transition-all cursor-pointer"
            >
              ยืนยันตัดสต็อก
            </button>
          </div>
        </div>
      )}

      {/* ============ ส่วนที่ 4: Modal ตั้งจำนวน/เหตุผล ============ */}
      <CutStockModal
        product={modalProduct}
        stockLimit={modalProduct ? stockLimitFor(modalProduct) : undefined}
        initial={
          editingItem
            ? { quantity: editingItem.quantity, reason: editingItem.reason, note: editingItem.note }
            : null
        }
        submitLabel={editingIdx !== null ? "บันทึกการแก้ไข" : "เพิ่มรายการ"}
        onClose={() => {
          setModalProduct(null);
          setEditingIdx(null);
        }}
        onSubmit={handleModalSubmit}
      />

      {/* Modal สรุปรายการก่อนยืนยัน */}
      <QueueConfirmModal
        open={confirmOpen}
        items={queue}
        submitting={submitting}
        serverError={serverError}
        onClose={() => !submitting && setConfirmOpen(false)}
        onConfirm={handleConfirmAll}
      />

      {/* ============ ประวัติการตัดสต็อก ============ */}
      <HistoryModal
        open={historyOpen}
        loading={historyLoading}
        records={historyRecords}
        onClose={() => setHistoryOpen(false)}
      />
    </div>
  );
}

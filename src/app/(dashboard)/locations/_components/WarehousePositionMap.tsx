"use client";

import { useEffect, useMemo, useState } from "react";
import { normalizeWarehouseId, getWarehouseName } from "@/lib/warehouse-utils";
import {
  getWarehouseLayout,
  lockPositions,
  parsePositionCode,
  positionLabel,
  positionStatus,
  DEFAULT_POSITION_CAPACITY,
  type PositionStatus as PosStatus,
} from "@/lib/warehouse-layout";

interface BreakdownEntry {
  warehouse_id: string;
  warehouse_name?: string;
  location: string;
  quantity: number;
}

interface ProductLike {
  sku?: string;
  product_name?: string;
  base_unit?: string;
  quantity?: number;
  location?: string;
  locations_breakdown?: BreakdownEntry[];
}

interface PositionItem {
  sku: string;
  name: string;
  qty: number;
  unit: string;
}

interface PositionOccupancy {
  code: string;
  qty: number;
  items: PositionItem[];
}

interface OtherStockEntry {
  location: string;
  sku: string;
  name: string;
  qty: number;
  unit: string;
}

export interface WarehousePositionMapProps {
  warehouses: { warehouse_id: string; warehouse_name: string }[];
}

const STATUS_STYLES: Record<PosStatus, { cell: string; code: string; qty: string; sub: string }> = {
  empty: {
    cell: "bg-slate-50 border-slate-200 hover:border-slate-300",
    code: "text-slate-400",
    qty: "text-slate-500",
    sub: "text-slate-400",
  },
  partial: {
    cell: "bg-emerald-50 border-emerald-300 hover:border-emerald-400",
    code: "text-emerald-700",
    qty: "text-emerald-900",
    sub: "text-emerald-700",
  },
  full: {
    cell: "bg-rose-50 border-rose-300 hover:border-rose-400",
    code: "text-rose-700",
    qty: "text-rose-900",
    sub: "text-rose-700",
  },
};

function statusText(status: PosStatus): string {
  if (status === "empty") return "ว่าง";
  if (status === "full") return "เต็ม";
  return "มีของ";
}

export default function WarehousePositionMap({ warehouses }: WarehousePositionMapProps) {
  const [mapWhId, setMapWhId] = useState("wh-01");
  const [allProducts, setAllProducts] = useState<ProductLike[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [capacity, setCapacity] = useState<number>(DEFAULT_POSITION_CAPACITY);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem("stockify_position_capacity"));
      if (saved > 0) setCapacity(saved);
    } catch {}
  }, []);

  const loadProducts = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/products?_t=${Date.now()}`);
      const d = await res.json();
      if (d.success) {
        setAllProducts(d.data || []);
      } else {
        setError(d.message || "กรุณากดรีเฟรช — โหลดข้อมูลสต็อกไม่สำเร็จ");
      }
    } catch {
      setError("กรุณาตรวจอินเทอร์เน็ตแล้วกดลองอีกครั้ง — โหลดข้อมูลสต็อกไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProducts();
  }, []);

  const layout = getWarehouseLayout(mapWhId);
  const whName =
    warehouses.find((w) => normalizeWarehouseId(w.warehouse_id) === mapWhId)?.warehouse_name ||
    getWarehouseName(mapWhId);

  const { positions, others } = useMemo(() => {
    const posMap = new Map<string, PositionOccupancy>();
    const otherList: OtherStockEntry[] = [];

    const addToPosition = (code: string, item: PositionItem) => {
      const existing = posMap.get(code);
      if (existing) {
        existing.qty += item.qty;
        existing.items.push(item);
      } else {
        posMap.set(code, { code, qty: item.qty, items: [item] });
      }
    };

    allProducts.forEach((p) => {
      const name = p.product_name || p.sku || "สินค้า";
      const sku = p.sku || "-";
      const unit = p.base_unit || "ชิ้น";
      const breakdown = p.locations_breakdown || [];
      const whEntries = breakdown.filter(
        (b) => normalizeWarehouseId(b.warehouse_id) === mapWhId
      );
      whEntries.forEach((b) => {
        const qty = Number(b.quantity) || 0;
        if (qty <= 0) return;
        const parts = String(b.location || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const usefulParts = parts.length > 0 ? parts : [""];
        const per = qty / usefulParts.length;
        usefulParts.forEach((part) => {
          const parsed = parsePositionCode(part);
          if (layout && parsed && parsed.whNum === layout.wh_num) {
            addToPosition(parsed.whNum + "K" + parsed.lock + "-" + parsed.side + parsed.level, {
              sku,
              name,
              qty: per,
              unit,
            });
          } else {
            otherList.push({
              location: part || "ไม่ระบุตำแหน่ง",
              sku,
              name,
              qty: per,
              unit,
            });
          }
        });
      });
    });

    return { positions: posMap, others: otherList };
  }, [allProducts, mapWhId, layout]);

  const summary = useMemo(() => {
    let empty = 0;
    let partial = 0;
    let full = 0;
    if (layout) {
      layout.floors.forEach((f) =>
        f.locks.forEach((lock) => {
          lockPositions(layout.wh_num, lock).forEach((p) => {
            const occ = positions.get(p.code);
            const st = positionStatus(occ ? occ.qty : 0, capacity);
            if (st === "empty") empty++;
            else if (st === "full") full++;
            else partial++;
          });
        })
      );
    }
    return { empty, partial, full };
  }, [layout, positions, capacity]);

  const selectedOcc = selectedCode ? positions.get(selectedCode) : null;
  const selectedParsed = selectedCode ? parsePositionCode(selectedCode) : null;

  const handleCapacityChange = (val: number) => {
    const v = Math.max(1, Math.floor(val) || DEFAULT_POSITION_CAPACITY);
    setCapacity(v);
    try {
      localStorage.setItem("stockify_position_capacity", String(v));
    } catch {}
  };

  return (
    <div className="space-y-4">
      {/* Warehouse tabs */}
      <div className="flex flex-wrap gap-2">
        {warehouses.map((w) => {
          const normId = normalizeWarehouseId(w.warehouse_id);
          const isActive = normId === mapWhId;
          return (
            <button
              key={w.warehouse_id}
              type="button"
              onClick={() => setMapWhId(normId)}
              className={`px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer active:scale-95 border ${
                isActive
                  ? "bg-indigo-600 border-indigo-600 text-white shadow-md shadow-indigo-600/20"
                  : "bg-white border-slate-200 text-slate-700 hover:border-indigo-300 hover:text-indigo-700"
              }`}
            >
              {w.warehouse_name}
            </button>
          );
        })}
      </div>

      {/* Summary + capacity */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-extrabold text-slate-900 text-base sm:text-lg">
              {whName}
              {layout ? (
                <span className="ml-2 font-mono text-sm text-slate-500">({layout.building_code})</span>
              ) : null}
            </p>
            {layout ? (
              <p className="text-sm text-slate-500 font-medium">{layout.address_label}</p>
            ) : (
              <p className="text-sm text-slate-500 font-medium">ยังไม่มีผังล็อกสำหรับโกดังนี้ — แสดงเฉพาะสินค้าที่มีตำแหน่งอยู่ด้านล่าง</p>
            )}
          </div>
          <button
            type="button"
            onClick={loadProducts}
            disabled={loading}
            className="px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-700 font-semibold text-xs hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-2"
          >
            <svg className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            รีเฟรช
          </button>
        </div>

        {layout && (
          <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm font-bold">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
              <span className="w-2.5 h-2.5 rounded-full bg-slate-300" /> ว่าง {summary.empty.toLocaleString()}
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> มีของ {summary.partial.toLocaleString()}
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-rose-100 text-rose-800 border border-rose-200">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500" /> เต็ม {summary.full.toLocaleString()}
            </span>
            <label className="ml-auto flex items-center gap-2 text-slate-600 font-semibold text-xs sm:text-sm">
              ความจุต่อตำแหน่ง
              <input
                type="number"
                min={1}
                inputMode="numeric"
                value={capacity}
                onChange={(e) => handleCapacityChange(Number(e.target.value))}
                className="w-24 px-2.5 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 text-xs sm:text-sm font-mono font-bold focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
              />
              ชิ้น
            </label>
          </div>
        )}
        <p className="text-xs text-slate-400 font-medium">
          ตำแหน่งย่อย: ซ้าย = 1, ขวา = 2, ล่าง = A, บน = B เช่น 1K14-1A คือซ้ายล่างของล็อก 14 • จำนวนเป็นค่าประมาณ (สินค้าที่ระบุหลายตำแหน่งถูกแบ่งเท่า ๆ กัน)
        </p>
      </div>

      {/* Loading / Error */}
      {loading && (
        <div className="text-center py-12 text-slate-500 text-sm font-medium">กำลังโหลดข้อมูลสต็อก...</div>
      )}
      {!loading && error && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-sm font-semibold flex items-center justify-between gap-3">
          {error}
          <button
            type="button"
            onClick={loadProducts}
            className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs cursor-pointer shrink-0"
          >
            ลองอีกครั้ง
          </button>
        </div>
      )}

      {/* Floor plan */}
      {!loading && !error && layout && (
        <div className="space-y-4">
          {layout.floors.map((fl) => {
            const floorCounts = { empty: 0, partial: 0, full: 0 };
            fl.locks.forEach((lock) =>
              lockPositions(layout.wh_num, lock).forEach((p) => {
                const occ = positions.get(p.code);
                const st = positionStatus(occ ? occ.qty : 0, capacity);
                floorCounts[st]++;
              })
            );
            return (
              <div key={`floor-${fl.floor}`} className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
                <div className="px-4 py-3 bg-slate-50/70 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="w-8 h-8 rounded-xl bg-indigo-600 text-white font-black text-base flex items-center justify-center">
                      {fl.floor}
                    </span>
                    <h3 className="font-extrabold text-slate-900 text-base">ชั้น {fl.floor}</h3>
                    {fl.floor === 1 && fl.locks.length > 0 && (
                      <span className="text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2.5 py-0.5 rounded-full">
                        ↥ ทางขึ้นหน้าตึก
                      </span>
                    )}
                  </div>
                  {fl.locks.length > 0 && (
                    <p className="text-xs font-bold text-slate-500">
                      ว่าง {floorCounts.empty} • มีของ {floorCounts.partial} • เต็ม {floorCounts.full}
                    </p>
                  )}
                </div>
                {fl.locks.length === 0 ? (
                  <p className="px-4 py-5 text-center text-sm text-slate-500 font-medium">
                    {fl.note || "ไม่มีล็อกจัดเก็บสินค้าในชั้นนี้"}
                  </p>
                ) : (
                  <div className="p-3 sm:p-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {fl.locks.map((lock) => (
                      <LockCard
                        key={`lock-${lock}`}
                        whNum={layout.wh_num}
                        lock={lock}
                        positions={lockPositions(layout.wh_num, lock)}
                        positionsMap={positions}
                        capacity={capacity}
                        onSelect={setSelectedCode}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Stock outside the plan */}
      {!loading && !error && others.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="px-4 py-3 bg-amber-50/70 border-b border-slate-100">
            <h3 className="font-extrabold text-slate-900 text-sm">
              สินค้าที่ตำแหน่งนอกผัง ({others.length.toLocaleString()} รายการ)
            </h3>
            <p className="text-xs text-slate-500 font-medium">รหัสตำแหน่งไม่ตรงรูปแบบล็อก เช่น ยังไม่ระบุ หรือรหัสเก่า</p>
          </div>
          <ul className="divide-y divide-slate-100">
            {others.slice(0, 50).map((o, i) => (
              <li key={`other-${i}`} className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-sm font-bold text-slate-900 truncate">{o.location}</p>
                  <p className="text-xs text-slate-500 font-medium truncate">
                    [{o.sku}] {o.name}
                  </p>
                </div>
                <span className="font-mono font-black text-slate-900 text-base shrink-0">
                  {Math.round(o.qty).toLocaleString()}
                  <span className="ml-1 text-xs font-bold text-slate-400">{o.unit}</span>
                </span>
              </li>
            ))}
          </ul>
          {others.length > 50 && (
            <p className="px-4 py-2.5 text-xs text-slate-400 font-medium border-t border-slate-100">
              แสดง 50 รายการแรก จากทั้งหมด {others.length.toLocaleString()} รายการ
            </p>
          )}
        </div>
      )}

      {/* Position detail modal */}
      {selectedCode && selectedParsed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl p-5 sm:p-6 w-full max-w-md border border-slate-200 space-y-4 shadow-2xl max-h-[85dvh] overflow-y-auto">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3.5">
              <div>
                <p className="font-mono font-black text-2xl text-indigo-700">{selectedCode}</p>
                <p className="text-sm font-bold text-slate-600 mt-0.5">
                  {selectedParsed
                    ? `ล็อก ${selectedParsed.lock} • ${positionLabel(selectedParsed.side, selectedParsed.level)}`
                    : ""}{" "}
                  • {whName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedCode(null)}
                className="text-slate-400 hover:text-slate-700 p-1.5 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer shrink-0"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {!selectedOcc || selectedOcc.items.length === 0 ? (
              <div className="py-8 text-center space-y-1">
                <p className="text-base font-extrabold text-slate-400">ตำแหน่งว่าง</p>
                <p className="text-sm text-slate-500 font-medium">ยังไม่มีสินค้าจัดเก็บที่ตำแหน่งนี้</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span
                    className={`text-xs px-3 py-1 rounded-full font-bold border ${
                      positionStatus(selectedOcc.qty, capacity) === "full"
                        ? "bg-rose-100 text-rose-800 border-rose-200"
                        : "bg-emerald-100 text-emerald-800 border-emerald-200"
                    }`}
                  >
                    {statusText(positionStatus(selectedOcc.qty, capacity))}
                  </span>
                  <span className="font-black text-2xl text-slate-900 font-mono">
                    {Math.round(selectedOcc.qty).toLocaleString()}
                    <span className="ml-1 text-sm font-bold text-slate-400">ชิ้น</span>
                  </span>
                </div>
                <ul className="divide-y divide-slate-100 border border-slate-200 rounded-2xl overflow-hidden">
                  {selectedOcc.items.map((it, i) => (
                    <li key={`item-${i}`} className="px-4 py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-900 truncate">{it.name}</p>
                        <p className="font-mono text-xs text-slate-500 font-semibold">[{it.sku}]</p>
                      </div>
                      <span className="font-mono font-black text-lg text-slate-900 shrink-0">
                        {Math.round(it.qty).toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function LockCard({
  whNum,
  lock,
  positions,
  positionsMap,
  capacity,
  onSelect,
}: {
  whNum: number;
  lock: number;
  positions: ReturnType<typeof lockPositions>;
  positionsMap: Map<string, PositionOccupancy>;
  capacity: number;
  onSelect: (code: string) => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden bg-white flex flex-col">
      <div className="px-2.5 py-1.5 bg-slate-100/80 flex items-center justify-between">
        <span className="text-xs font-extrabold text-slate-700">ล็อก {lock}</span>
        <span className="font-mono text-xs font-bold text-slate-400">
          {whNum}K{lock}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1 p-1 flex-1">
        {positions.map((p) => {
          const occ = positionsMap.get(p.code);
          const qty = occ ? occ.qty : 0;
          const st = positionStatus(qty, capacity);
          const style = STATUS_STYLES[st];
          return (
            <button
              key={p.code}
              type="button"
              onClick={() => onSelect(p.code)}
              className={`flex flex-col items-start justify-between gap-0.5 p-2 rounded-lg border text-left min-h-[72px] transition-all cursor-pointer active:scale-95 ${style.cell}`}
            >
              <span className={`font-mono font-extrabold text-xs ${style.code}`}>{p.code.split("-")[1]}</span>
              {st === "empty" ? (
                <span className="text-xs font-bold text-slate-400">ว่าง</span>
              ) : (
                <>
                  <span className={`font-black text-lg leading-none font-mono ${style.qty}`}>
                    {Math.round(qty).toLocaleString()}
                  </span>
                  <span className={`text-xs font-bold ${style.sub}`}>
                    {st === "full" ? "เต็ม" : `${occ!.items.length} รายการ`}
                  </span>
                </>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

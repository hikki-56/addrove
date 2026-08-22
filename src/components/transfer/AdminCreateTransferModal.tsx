"use client";

import { useEffect, useState } from "react";
import { useTabAuth } from "@/context/TabAuthContext";
import type { Product, Warehouse, Location } from "@/types/models";

interface StaffUser {
  user_id: string;
  full_name: string;
  email: string;
  role: string;
}

interface AdminCreateTransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  warehouses: Warehouse[];
  locations: Location[];
  products: Product[];
  onSuccess: () => void;
}

export default function AdminCreateTransferModal({
  isOpen,
  onClose,
  warehouses,
  locations,
  products,
  onSuccess,
}: AdminCreateTransferModalProps) {
  const { token: tabToken } = useTabAuth();
  const [staffList, setStaffList] = useState<StaffUser[]>([]);
  const [productId, setProductId] = useState("");
  const [fromWhId, setFromWhId] = useState("");
  const [fromLocId, setFromLocId] = useState("");
  const [toWhId, setToWhId] = useState("");
  const [toLocId, setToLocId] = useState("");
  const [qty, setQty] = useState<number>(1);
  const [assignedUserId, setAssignedUserId] = useState("");
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const getAuthHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const storedToken =
      tabToken ||
      (typeof window !== "undefined"
        ? localStorage.getItem("stockify_tab_token")
        : null);

    if (storedToken) {
      headers["x-tab-token"] = storedToken;
      headers["Authorization"] = `Bearer ${storedToken}`;
    }
    return headers;
  };

  useEffect(() => {
    if (isOpen) {
      // Fetch users list for staff assignment
      fetch("/api/users", { headers: getAuthHeaders() })
        .then((res) => res.json())
        .then((data) => {
          if (data.success && Array.isArray(data.data)) {
            setStaffList(data.data);
            if (data.data.length > 0 && !assignedUserId) {
              setAssignedUserId(data.data[0].user_id);
            }
          }
        })
        .catch(() => {});

      if (warehouses.length > 0) {
        if (!fromWhId) setFromWhId(warehouses[0].warehouse_id);
        if (!toWhId && warehouses.length > 1) setToWhId(warehouses[1].warehouse_id);
      }
    }
  }, [isOpen, warehouses]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!productId) {
      setError("กรุณาเลือกสินค้าที่ต้องการย้าย");
      return;
    }
    if (!fromWhId || !toWhId) {
      setError("กรุณาเลือกคลังต้นทางและคลังปลายทาง");
      return;
    }
    if (fromWhId === toWhId) {
      setError("คลังต้นทางและคลังปลายทางต้องไม่ซ้ำกัน");
      return;
    }
    if (!assignedUserId) {
      setError("กรุณาเลือกพนักงานผู้รับผิดชอบ");
      return;
    }
    if (qty <= 0) {
      setError("จำนวนต้องมากกว่า 0");
      return;
    }

    setIsSubmitting(true);
    try {
      const assignedUser = staffList.find((u) => u.user_id === assignedUserId);
      const res = await fetch("/api/movements/transfer/assign", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          product_id: productId,
          from_warehouse_id: fromWhId,
          from_location_id: fromLocId || "A1",
          to_warehouse_id: toWhId,
          to_location_id: toLocId || "A1",
          qty: Number(qty),
          assigned_to_user_id: assignedUserId,
          assigned_to_name: assignedUser?.full_name || assignedUser?.email || "พนักงาน",
          moved_by: assignedUser?.full_name || "พนักงาน",
          reference_no: `TRF-${Date.now().toString().slice(-6)}`,
          document_date: new Date().toISOString().slice(0, 10),
          note,
          idempotency_key: `assign-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || json.message || "สร้างใบสั่งย้ายไม่สำเร็จ");
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || "เกิดข้อผิดพลาดในการส่งใบสั่งย้ายสินค้า");
    } finally {
      setIsSubmitting(false);
    }
  };

  const fromLocations = locations.filter((l) => l.warehouse_id === fromWhId);
  const toLocations = locations.filter((l) => l.warehouse_id === toWhId);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-2.5 sm:p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl max-w-lg w-full p-4 sm:p-6 space-y-4 sm:space-y-5 shadow-2xl text-slate-100 animate-fadeIn">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h2 className="text-sm sm:text-lg font-bold text-slate-100 flex items-center gap-2">
            <span className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-xs sm:text-sm font-bold">📋</span>
            <span className="truncate">สร้างใบสั่งย้ายสินค้า (Admin Assign)</span>
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-lg sm:text-xl font-bold p-1 cursor-pointer"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-medium">
            ⚠️ {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* Select Product */}
          <div className="space-y-1">
            <label className="font-semibold text-slate-300">1. สินค้าที่ต้องการย้าย *</label>
            <select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              className="w-full p-2.5 rounded-xl bg-black/40 border border-slate-700 text-slate-200 focus:border-indigo-500 outline-none"
              required
            >
              <option value="">-- เลือกรายการสินค้า --</option>
              {products.map((p, idx) => (
                <option key={`prod-${p.product_id || p.sku || idx}-${idx}`} value={p.product_id}>
                  {p.sku} - {p.product_name} {p.barcode ? `(${p.barcode})` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Qty & Assigned Staff */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="font-semibold text-slate-300">2. จำนวนที่ย้าย *</label>
              <input
                type="number"
                min={1}
                value={qty}
                onFocus={(e) => (e.target as HTMLInputElement).select()}
                onClick={(e) => (e.target as HTMLInputElement).select()}
                onChange={(e) => setQty(Number(e.target.value))}
                className="w-full p-2.5 rounded-xl bg-black/40 border border-slate-700 text-slate-200 focus:border-indigo-500 outline-none"
                required
              />
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-amber-300">3. มอบหมายพนักงาน *</label>
              <select
                value={assignedUserId}
                onChange={(e) => setAssignedUserId(e.target.value)}
                className="w-full p-2.5 rounded-xl bg-indigo-950/40 border border-indigo-500/50 text-indigo-200 font-semibold focus:border-indigo-400 outline-none"
                required
              >
                <option value="">-- เลือกพนักงานผู้รับงาน --</option>
                {staffList.map((u, idx) => (
                  <option key={`staff-${u.user_id || u.email || idx}-${idx}`} value={u.user_id}>
                    👤 {u.full_name || u.email} ({u.role})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* From Warehouse & Location */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-xl bg-slate-950/60 border border-slate-800">
            <div className="space-y-1">
              <label className="font-semibold text-rose-300">คลังต้นทาง *</label>
              <select
                value={fromWhId}
                onChange={(e) => setFromWhId(e.target.value)}
                className="w-full p-2 rounded-lg bg-black/40 border border-slate-700 text-slate-200"
              >
                {warehouses.map((w, idx) => (
                  <option key={`from-wh-${w.warehouse_id || idx}-${idx}`} value={w.warehouse_id}>
                    {w.warehouse_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="font-semibold text-slate-400">ตำแหน่งต้นทาง</label>
              <select
                value={fromLocId}
                onChange={(e) => setFromLocId(e.target.value)}
                className="w-full p-2 rounded-lg bg-black/40 border border-slate-700 text-slate-200"
              >
                <option value="">A1 (อัตโนมัติ)</option>
                {fromLocations.map((l, idx) => (
                  <option key={`from-loc-${l.location_id || l.location_code || idx}-${idx}`} value={l.location_code}>
                    {l.location_code} {l.shelf_code ? `(${l.shelf_code})` : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* To Warehouse & Location */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-xl bg-slate-950/60 border border-slate-800">
            <div className="space-y-1">
              <label className="font-semibold text-emerald-300">คลังปลายทาง *</label>
              <select
                value={toWhId}
                onChange={(e) => setToWhId(e.target.value)}
                className="w-full p-2 rounded-lg bg-black/40 border border-slate-700 text-slate-200"
              >
                {warehouses.map((w, idx) => (
                  <option key={`to-wh-${w.warehouse_id || idx}-${idx}`} value={w.warehouse_id}>
                    {w.warehouse_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="font-semibold text-slate-400">ตำแหน่งปลายทาง</label>
              <select
                value={toLocId}
                onChange={(e) => setToLocId(e.target.value)}
                className="w-full p-2 rounded-lg bg-black/40 border border-slate-700 text-slate-200"
              >
                <option value="">A1 (อัตโนมัติ)</option>
                {toLocations.map((l, idx) => (
                  <option key={`to-loc-${l.location_id || l.location_code || idx}-${idx}`} value={l.location_code}>
                    {l.location_code} {l.shelf_code ? `(${l.shelf_code})` : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Note */}
          <div className="space-y-1">
            <label className="font-semibold text-slate-400">คำสั่งเพิ่มเติมถึงพนักงาน (Optional)</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="เช่น ย้ายใส่ชั้นว่างแถวหน้าสุด"
              className="w-full p-2.5 rounded-xl bg-black/40 border border-slate-700 text-slate-200 focus:border-indigo-500 outline-none"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold flex items-center gap-2 shadow-lg shadow-indigo-600/30 disabled:opacity-50"
            >
              {isSubmitting ? "กำลังส่งใบสั่งย้าย..." : "🚀 สั่งงานและส่งการแจ้งเตือน"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTabAuth } from "@/context/TabAuthContext";
import { isProductionReviewer } from "@/lib/production-reviewers";
import type { ProductionOrderRecord } from "@/types/production";
import { safeNavigate } from "@/lib/safe-navigate";

// หน้ารายละเอียดใบผลิต (แยกจากหน้าประวัติ) — เดิมเปิดเป็น modal ในหน้าเดียวกัน
// ทำเป็นหน้าแยกเพื่อลิงก์/แชร์/ refreshing ได้ตรงใบ และพื้นที่อ่านตาราง BOM กว้างขึ้น
export default function ProductionOrderDetailPage() {
  const router = useRouter();
  const params = useParams<{ orderNo: string }>();
  const orderNo = decodeURIComponent(String(params?.orderNo ?? ""));
  const { user } = useTabAuth();
  // แอดมิน และคนตรวจ (แก้ / milk — เพิ่มชื่อได้ใน production-reviewers.ts) กรอกผลจริงและยืนยันตัดสต็อกได้
  const canConfirm = user?.role === "ADMIN" || isProductionReviewer({ email: user?.email, name: user?.name });

  const [order, setOrder] = useState<ProductionOrderRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [copySuccess, setCopySuccess] = useState<string | null>(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  // ---- ฟอร์มบันทึกผลผลิตจริง (ผลิตได้/ของเสีย + วัตถุดิบใช้จริง/เสียจริง) ----
  const [fgReport, setFgReport] = useState<Record<string, { good: string; defect: string }>>({});
  const [rmReport, setRmReport] = useState<Record<string, { used: string; wasted: string }>>({});
  const [reportNote, setReportNote] = useState("");
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportSuccess, setReportSuccess] = useState<{
    round_no: number;
    total_good: number;
    total_defect: number;
    materials_count: number;
  } | null>(null);

  const authHeaders = useCallback((): Record<string, string> => {
    const storedToken =
      typeof window !== "undefined"
        ? sessionStorage.getItem("stockify_tab_token") || localStorage.getItem("stockify_tab_token")
        : null;
    const headers: Record<string, string> = {};
    if (storedToken) {
      headers["x-tab-token"] = storedToken;
      headers["Authorization"] = `Bearer ${storedToken}`;
    }
    return headers;
  }, []);

  const loadOrder = useCallback(async () => {
    if (!orderNo) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/production/orders`, {
        headers: authHeaders(),
        cache: "no-store",
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          const found =
            json.data.find((o: ProductionOrderRecord) => o.order_no === orderNo) ||
            json.data.find((o: ProductionOrderRecord) => o.order_no?.toLowerCase() === orderNo.toLowerCase()) ||
            null;
          setOrder(found);
        }
      }
    } catch (err) {
      console.warn("[ProductionOrderDetail] Fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [orderNo, authHeaders]);

  useEffect(() => {
    loadOrder();
  }, [loadOrder]);

  // Copy helper
  const handleCopy = (text: string, label: string) => {
    if (!text || text === "-") return;
    navigator.clipboard.writeText(text);
    setCopySuccess(label);
    setTimeout(() => setCopySuccess(null), 2000);
  };

  // Update Status action — สำเร็จแล้วดึงข้อมูลใบใหม่เพื่อให้ทุกส่วน (รอบตรวจ/วัตถุดิบ) ตรงจริงเสมอ
  const handleUpdateStatus = async (targetOrderNo: string, newStatus: ProductionOrderRecord["status"]) => {
    setIsUpdatingStatus(true);
    try {
      const res = await fetch("/api/production/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ order_no: targetOrderNo, status: newStatus }),
      });

      if (res.ok) {
        await loadOrder();
        // ให้หน้าประวัติ (ถ้าเปิดค้างไว้) refresh รายการด้วย
        window.dispatchEvent(new Event("storage"));
      }
    } catch (e) {
      console.error("Failed to update status:", e);
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const formatThaiDateTime = (dateStr?: string) => {
    if (!dateStr) return "-";
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleDateString("th-TH", {
        day: "numeric",
        month: "short",
        year: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateStr;
    }
  };

  // ---- ฟอร์มยืนยันผลผลิตจริง: ตัวช่วยคำนวณ ----
  const parsedQty = (v: string): number => {
    const n = parseInt(v, 10);
    return isNaN(n) || n < 0 ? 0 : n;
  };

  // ยอด FG คงเหลือให้ยืนยัน = ที่สั่ง − ผลิตได้จริงสะสม − ของเสียสะสม (รอบที่ยืนยันแล้วนับเข้าไปแล้ว)
  const fgRemaining = useMemo(() => {
    const map: Record<string, number> = {};
    if (!order) return map;
    for (const item of order.items) {
      map[item.fg_sku] = Math.max(
        0,
        item.quantity - (Number(item.produced_qty) || 0) - (Number(item.defect_qty) || 0)
      );
    }
    return map;
  }, [order]);

  // ยอดวัตถุดิบคงเหลือตามแผน = ตามแผน − ใช้จริงสะสม − เสียจริงสะสม
  const rmRemaining = useMemo(() => {
    const map: Record<string, number> = {};
    if (!order?.materials_summary) return map;
    for (const m of order.materials_summary) {
      map[m.rm_sku] = Math.max(
        0,
        m.planned_qty - (Number(m.used_qty) || 0) - (Number(m.wasted_qty) || 0)
      );
    }
    return map;
  }, [order]);

  const reportTotals = useMemo(() => {
    let totalGood = 0;
    let totalDefect = 0;
    for (const item of order?.items || []) {
      const input = fgReport[item.fg_sku];
      totalGood += parsedQty(input?.good || "");
      totalDefect += parsedQty(input?.defect || "");
    }
    let totalUsed = 0;
    let totalWasted = 0;
    for (const m of order?.materials_summary || []) {
      const input = rmReport[m.rm_sku];
      totalUsed += parsedQty(input?.used || "");
      totalWasted += parsedQty(input?.wasted || "");
    }
    return { totalGood, totalDefect, totalUsed, totalWasted };
  }, [order, fgReport, rmReport]);

  const reportErrorHint = useMemo(() => {
    if (!order) return null;
    for (const item of order.items) {
      const input = fgReport[item.fg_sku];
      const sum = parsedQty(input?.good || "") + parsedQty(input?.defect || "");
      if (sum > (fgRemaining[item.fg_sku] ?? 0)) {
        return `"${item.fg_name}" เกินจำนวนคงเหลือให้ยืนยัน (เหลือ ${(fgRemaining[item.fg_sku] ?? 0).toLocaleString()} ${item.fg_unit || "ชิ้น"})`;
      }
    }
    for (const m of order.materials_summary || []) {
      const input = rmReport[m.rm_sku];
      const sum = parsedQty(input?.used || "") + parsedQty(input?.wasted || "");
      if (sum > (rmRemaining[m.rm_sku] ?? 0)) {
        return `วัตถุดิบ "${m.rm_name}" เกินยอดคงเหลือตามแผน (เหลือ ${(rmRemaining[m.rm_sku] ?? 0).toLocaleString()} ${m.rm_unit || "ชิ้น"})`;
      }
    }
    if (reportTotals.totalGood + reportTotals.totalDefect === 0) {
      return "กรอกจำนวนผลิตได้จริงหรือของเสียอย่างน้อย 1 ชิ้น";
    }
    return null;
  }, [order, fgReport, rmReport, fgRemaining, rmRemaining, reportTotals]);

  // Toast ยืนยัน/ผิดพลาด แสดง 6 วินาทีแล้วหายเอง
  useEffect(() => {
    if (!reportSuccess) return;
    const t = setTimeout(() => setReportSuccess(null), 6000);
    return () => clearTimeout(t);
  }, [reportSuccess]);
  useEffect(() => {
    if (!reportError) return;
    const t = setTimeout(() => setReportError(null), 6000);
    return () => clearTimeout(t);
  }, [reportError]);

  // ยืนยันผลผลิตจริง — กดแล้วตัดวัตถุดิบ/เพิ่มสต็อก/บันทึกของเสียทันที (แอดมิน/คนตรวจ)
  const submitActualReport = async () => {
    if (!order || reportErrorHint) return;
    setIsSubmittingReport(true);
    setReportError(null);
    setReportSuccess(null);
    try {
      const materials = (order.materials_summary || [])
        .map((m) => {
          const input = rmReport[m.rm_sku];
          return {
            rm_sku: m.rm_sku,
            used_qty: parsedQty(input?.used || ""),
            wasted_qty: parsedQty(input?.wasted || ""),
          };
        })
        .filter((m) => m.used_qty + m.wasted_qty > 0);

      const res = await fetch(`/api/production/orders/${encodeURIComponent(order.order_no)}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          items: order.items.map((item) => {
            const input = fgReport[item.fg_sku];
            return {
              fg_sku: item.fg_sku,
              good_qty: parsedQty(input?.good || ""),
              defect_qty: parsedQty(input?.defect || ""),
              warehouse_id: item.target_warehouse_id || "wh-02",
              location: "",
            };
          }),
          materials: materials.length > 0 ? materials : undefined,
          note: reportNote,
          confirmed_by_name: user?.name || "คนตรวจ",
        }),
      });
      const json = await res.json();
      if (json.success) {
        setReportSuccess({
          round_no: json.data?.round_no ?? 0,
          total_good: reportTotals.totalGood,
          total_defect: reportTotals.totalDefect,
          materials_count: materials.length,
        });
        setFgReport({});
        setRmReport({});
        setReportNote("");
        await loadOrder();
        window.dispatchEvent(new Event("storage"));
      } else {
        setReportError(json.message || "ยืนยันผลผลิตไม่สำเร็จ");
      }
    } catch {
      setReportError("เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setIsSubmittingReport(false);
    }
  };

  // Status Badge Helper
  const renderStatusBadge = (status: ProductionOrderRecord["status"]) => {
    switch (status) {
      case "COMPLETED":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#EAF2EE] text-[#053425] border border-[#C9DFD4] whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-[#0F5C3F] shrink-0"></span>
            <span>เสร็จสมบูรณ์</span>
          </span>
        );
      case "IN_PROGRESS":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200 whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0"></span>
            <span>ตรวจแล้วบางส่วน</span>
          </span>
        );
      case "PENDING":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-300 whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0"></span>
            <span>รอตรวจ</span>
          </span>
        );
      case "CANCELLED":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200 whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0"></span>
            <span>ยกเลิก</span>
          </span>
        );
      default:
        return null;
    }
  };

  // แก้ยอดจริงในตารางได้ = ใบยังไม่เสร็จ + เป็นแอดมิน/คนตรวจ
  const canEditActuals =
    !!order && (order.status === "PENDING" || order.status === "IN_PROGRESS") && canConfirm;

  return (
    <div className="w-full max-w-4xl mx-auto space-y-4 sm:space-y-5 pb-12">
      {/* Toast Notification */}
      {copySuccess && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-4 py-2.5 rounded-xl shadow-lg text-sm font-semibold flex items-center gap-2 animate-bounce">
          <svg className="w-4 h-4 text-[#5B8A74]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
          <span>คัดลอก {copySuccess} เรียบร้อย</span>
        </div>
      )}

      {/* Toast ยืนยันผลผลิตจริง */}
      {reportSuccess && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[#06402B] text-white px-4 py-2.5 rounded-xl shadow-lg text-sm font-bold flex items-center gap-2 animate-bounce">
          <svg className="w-4 h-4 text-[#7BC4A0]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
          <span>
            ยืนยันผลผลิตรอบที่ {reportSuccess.round_no} และตัดสต็อกเรียบร้อย — ของดี{" "}
            {reportSuccess.total_good.toLocaleString()} · ของเสีย {reportSuccess.total_defect.toLocaleString()}
            {reportSuccess.materials_count > 0 ? ` · วัตถุดิบ ${reportSuccess.materials_count} รายการ` : ""}
          </span>
        </div>
      )}
      {reportError && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-rose-600 text-white px-4 py-2.5 rounded-xl shadow-lg text-sm font-bold flex items-center gap-2">
          <span>⚠️ {reportError}</span>
        </div>
      )}

      {/* ปุ่มกลับ + หัวกระดาษเมื่อพิมพ์ */}
      <div className="flex items-center justify-between gap-3 print:hidden">
        <button
          type="button"
          onClick={() => safeNavigate(router, "/production/history")}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#E8ECEA] bg-white text-slate-600 text-sm font-bold hover:bg-slate-50 hover:text-slate-900 transition-colors cursor-pointer"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          กลับไปประวัติใบผลิต
        </button>
        {order && (
          <span className="text-xs font-semibold text-slate-400 font-mono truncate hidden sm:block">{order.order_no}</span>
        )}
      </div>
      <div className="hidden print:block text-center mb-6 pb-3 border-b-2 border-black">
        <h1 className="text-xl font-bold text-black">ใบสั่งผลิต — {order?.order_no}</h1>
        {order && (
          <p className="text-sm text-slate-600 mt-1">
            วันที่พิมพ์: {new Date().toLocaleDateString("th-TH")} · {order.items.length} รายการ ·{" "}
            {Number(order.total_fg_qty || 0).toLocaleString()} ชิ้น
          </p>
        )}
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl border border-[#E8ECEA] p-12 text-center space-y-3">
          <div className="w-8 h-8 border-3 border-[#0F5C3F] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm font-semibold text-slate-500">กำลังโหลดรายละเอียดใบผลิต...</p>
        </div>
      ) : !order ? (
        <div className="bg-white rounded-2xl border border-[#E8ECEA] p-12 text-center space-y-3">
          <span className="text-4xl">🏭</span>
          <h3 className="text-base font-bold text-slate-700">ไม่พบใบผลิตนี้</h3>
          <p className="text-sm text-slate-400 font-mono break-all">{orderNo}</p>
          <button
            type="button"
            onClick={() => safeNavigate(router, "/production/history")}
            className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-bold transition-colors cursor-pointer"
          >
            กลับไปประวัติใบผลิต
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-3xl w-full p-5 sm:p-6 shadow-xs border border-[#E8ECEA] space-y-5 print:rounded-none print:shadow-none print:border-black">
          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-[#EEF1EF]">
            <div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#0F5C3F]" />
                <h1 className="text-lg font-extrabold text-slate-900">รายละเอียดใบผลิต</h1>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="font-mono text-base font-bold text-[#053425] break-all">{order.order_no}</span>
                <button
                  type="button"
                  onClick={() => handleCopy(order.order_no, "เลขที่ใบผลิต")}
                  className="text-xs text-slate-500 hover:text-[#053425] underline font-semibold cursor-pointer print:hidden"
                >
                  คัดลอก
                </button>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {renderStatusBadge(order.status)}
            </div>
          </div>

          {/* Order Info Meta Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 bg-slate-50 p-4 rounded-2xl border border-[#E8ECEA]/80 text-sm print:bg-white">
            <div>
              <span className="text-slate-500 font-medium">วันที่สร้าง:</span>
              <p className="font-bold text-slate-900 mt-0.5">{formatThaiDateTime(order.created_at)}</p>
            </div>
            <div>
              <span className="text-slate-500 font-medium">ผู้สั่งผลิต:</span>
              <p className="font-bold text-slate-900 mt-0.5">{order.created_by_name || "ผู้ดูแลระบบ (Admin)"}</p>
            </div>
            <div>
              <span className="text-slate-500 font-medium">จำนวนรายการ FG:</span>
              <p className="font-bold text-slate-900 mt-0.5">{order.items.length} รายการ</p>
            </div>
            <div>
              <span className="text-slate-500 font-medium">จำนวนผลิตรวม:</span>
              <p className="font-extrabold text-[#06402B] mt-0.5">{Number(order.total_fg_qty || 0).toLocaleString()} ชิ้น</p>
            </div>
            <div>
              <span className="text-slate-500 font-medium">วัตถุดิบที่ใช้:</span>
              <p className="font-bold text-slate-900 mt-0.5">{order.total_materials_count} รายการ</p>
            </div>
          </div>

          {/* Finished Goods Table */}
          <div>
            <h2 className="text-sm font-extrabold text-slate-900 mb-2.5">
              สินค้าสำเร็จรูปที่สั่งผลิต ({order.items.length} รายการ)
            </h2>
            <div className="border border-[#E8ECEA] rounded-xl overflow-hidden print:border-black">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm min-w-[560px]">
                  <thead>
                    <tr className="bg-slate-100 text-slate-600 font-bold border-b border-[#E8ECEA] print:bg-white">
                      <th className="py-2.5 px-3">รหัสสินค้า / บาร์โค้ด</th>
                      <th className="py-2.5 px-3">ชื่อสินค้า</th>
                      <th className="py-2.5 px-3">คลังปลายทาง</th>
                      <th className="py-2.5 px-3 text-right">ที่สั่ง</th>
                      <th className="py-2.5 px-3 text-right">
                        ผลิตได้จริง{canEditActuals ? " (รอบนี้)" : ""}
                      </th>
                      <th className="py-2.5 px-3 text-right">ของเสีย{canEditActuals ? " (รอบนี้)" : ""}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EEF1EF]">
                    {order.items?.map((item, idx) => (
                      <tr key={item.fg_sku + "-" + (item.table_no ?? "x") + "-" + idx} className="hover:bg-slate-50/70">
                        <td className="py-2.5 px-3 font-mono">
                          <div className="font-bold text-slate-800 flex items-center gap-1.5">
                            {item.fg_sku}
                            {item.table_no && (
                              <span
                                className="font-sans rounded bg-[#06402B] px-1.5 py-0.5 text-[10px] font-bold text-white whitespace-nowrap"
                                title={`ผลิตที่โต๊ะ ${item.table_no}`}
                              >
                                โต๊ะ {item.table_no}
                              </span>
                            )}
                          </div>
                          {item.fg_barcode && item.fg_barcode !== "-" && (
                            <div className="text-xs text-slate-400">{item.fg_barcode}</div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-slate-800">{item.fg_name}</td>
                        <td className="py-2.5 px-3 text-slate-600 text-xs">{item.target_warehouse_name || "-"}</td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                          {Number(item.quantity || 0).toLocaleString()} {item.fg_unit || "ชิ้น"}
                          {canEditActuals && (
                            <div className="mt-0.5 font-sans text-[10px] font-bold text-amber-700">
                              เหลือให้ยืนยัน {(fgRemaining[item.fg_sku] ?? 0).toLocaleString()}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          {canEditActuals ? (
                            <div className="flex flex-col items-end gap-0.5">
                              <input
                                type="number"
                                min={0}
                                max={fgRemaining[item.fg_sku] ?? 0}
                                inputMode="numeric"
                                value={(fgReport[item.fg_sku] || { good: "", defect: "" }).good}
                                onChange={(e) => {
                                  const input = fgReport[item.fg_sku] || { good: "", defect: "" };
                                  setFgReport({ ...fgReport, [item.fg_sku]: { ...input, good: e.target.value } });
                                }}
                                placeholder="0"
                                disabled={(fgRemaining[item.fg_sku] ?? 0) <= 0}
                                className="w-24 rounded-lg border border-[#E1E8EE] bg-white px-2.5 py-1.5 text-right font-mono text-sm font-bold text-[#06402B] focus:border-[#0F5C3F] focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none disabled:bg-slate-50 disabled:text-slate-300"
                              />
                              {Number(item.produced_qty || 0) > 0 && (
                                <span className="font-sans text-[10px] font-bold text-slate-400">
                                  สะสม {Number(item.produced_qty || 0).toLocaleString()}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="font-mono font-bold text-[#06402B]">
                              {Number(item.produced_qty || 0).toLocaleString()}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          {canEditActuals ? (
                            <div className="flex flex-col items-end gap-0.5">
                              <input
                                type="number"
                                min={0}
                                max={fgRemaining[item.fg_sku] ?? 0}
                                inputMode="numeric"
                                value={(fgReport[item.fg_sku] || { good: "", defect: "" }).defect}
                                onChange={(e) => {
                                  const input = fgReport[item.fg_sku] || { good: "", defect: "" };
                                  setFgReport({ ...fgReport, [item.fg_sku]: { ...input, defect: e.target.value } });
                                }}
                                placeholder="0"
                                disabled={(fgRemaining[item.fg_sku] ?? 0) <= 0}
                                className="w-24 rounded-lg border border-[#E1E8EE] bg-white px-2.5 py-1.5 text-right font-mono text-sm font-bold text-rose-700 focus:border-rose-400 focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none disabled:bg-slate-50 disabled:text-slate-300"
                              />
                              {Number(item.defect_qty || 0) > 0 && (
                                <span className="font-sans text-[10px] font-bold text-slate-400">
                                  สะสม {Number(item.defect_qty || 0).toLocaleString()}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="font-mono font-bold text-rose-600">
                              {Number(item.defect_qty || 0).toLocaleString()}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {canEditActuals && (
                <div className="space-y-1.5 border-t border-[#E8ECEA] bg-[#F7FAF8] px-3 py-2.5 print:hidden">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <input
                      type="text"
                      value={reportNote}
                      onChange={(e) => setReportNote(e.target.value)}
                      placeholder="หมายเหตุ (ถ้ามี) เช่น วัตถุดิบแตกหักระหว่างผลิต"
                      className="min-w-[160px] flex-1 rounded-lg border border-[#E1E8EE] bg-white px-2.5 py-2 text-xs font-semibold text-slate-800 focus:border-[#0F5C3F] focus:outline-none"
                    />
                    <span className="ml-auto font-mono text-[11px] font-bold text-slate-500 whitespace-nowrap">
                      รวมรอบนี้: ของดี {reportTotals.totalGood.toLocaleString()} · ของเสีย{" "}
                      {reportTotals.totalDefect.toLocaleString()}
                    </span>
                    <button
                      type="button"
                      onClick={submitActualReport}
                      disabled={!!reportErrorHint || isSubmittingReport}
                      className="flex items-center justify-center gap-2 rounded-lg bg-[#06402B] px-4 py-2 text-xs font-bold text-white shadow-md shadow-[#06402B]/20 transition-all hover:bg-[#053425] active:scale-95 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                    >
                      {isSubmittingReport ? (
                        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      ) : (
                        "ยืนยันและตัดสต็อกทันที"
                      )}
                    </button>
                  </div>
                  {reportErrorHint && (
                    <p className="text-[11px] font-bold text-amber-700">⚠️ {reportErrorHint}</p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Inspection Rounds (ระบบตรวจการผลิต) */}
          {order.inspections && order.inspections.length > 0 && (
            <div>
              <h2 className="text-sm font-extrabold text-slate-900 mb-2.5">
                ประวัติการตรวจการผลิต ({order.inspections.length} รอบ)
              </h2>
              <div className="space-y-2.5">
                {order.inspections.map((round) => {
                  const roundStatus = round.status || "APPROVED";
                  return (
                    <div key={round.round_no} className="rounded-xl border border-[#EEF1EF] bg-[#F7FAF8] p-3.5">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-sm font-extrabold text-slate-900">
                          รอบที่ {round.round_no}
                          <span
                            className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-extrabold ${
                              roundStatus === "APPROVED"
                                ? "bg-[#EAF2EE] text-[#053425]"
                                : roundStatus === "SUBMITTED"
                                  ? "bg-slate-100 text-slate-500"
                                  : "bg-amber-100 text-amber-800"
                            }`}
                          >
                            {roundStatus === "APPROVED"
                              ? "ยืนยันแล้ว"
                              : roundStatus === "SUBMITTED"
                                ? "รอบเก่าระบบเดิม (ไม่ได้ใช้)"
                                : "ถูกตีกลับ (ระบบเดิม)"}
                          </span>
                        </span>
                        <span className="text-xs font-semibold text-slate-500">
                          {formatThaiDateTime(round.inspected_at)} · ยืนยันโดย{" "}
                          {round.reviewed_by_name || round.inspected_by_name || "-"}
                        </span>
                      </div>
                      <div className="mt-2 space-y-1">
                        {round.items.map((ri) => (
                          <div key={ri.fg_sku} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                            <span className="font-semibold text-slate-800">
                              {ri.fg_name}
                              <span className="ml-1.5 font-mono text-xs text-slate-400">{ri.fg_sku}</span>
                            </span>
                            <span className="font-mono text-xs font-bold">
                              <span className="text-[#06402B]">ดี {ri.good_qty.toLocaleString()}</span>
                              <span className="mx-1.5 text-slate-300">·</span>
                              <span className="text-rose-600">เสีย {ri.defect_qty.toLocaleString()}</span>
                              {(ri.warehouse_name || ri.location) && (
                                <span className="ml-1.5 font-sans text-slate-500">
                                  → {ri.warehouse_name}
                                  {ri.location ? ` (${ri.location})` : ""}
                                </span>
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                      {round.note && <p className="mt-2 text-xs font-medium text-slate-500">หมายเหตุ: {round.note}</p>}
                      {round.materials && round.materials.length > 0 && (
                        <div className="mt-2 rounded-lg border border-[#E1E8EE] bg-white px-3 py-2">
                          <p className="text-xs font-bold text-slate-600">วัตถุดิบใช้จริง/เสียจริงในรอบนี้:</p>
                          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                            {round.materials.map((mat) => (
                              <span key={mat.rm_sku} className="font-mono text-xs font-bold">
                                <span className="text-slate-600">{mat.rm_name}</span>{" "}
                                <span className="text-[#06402B]">ใช้ {mat.used_qty.toLocaleString()}</span>
                                {mat.wasted_qty > 0 && (
                                  <span className="text-rose-600"> · เสีย {mat.wasted_qty.toLocaleString()}</span>
                                )}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {round.review_note && <p className="mt-1 text-xs font-bold text-amber-700">คนตรวจ: {round.review_note}</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Materials summary แบบรวมต่อใบ (ระบบตรวจการผลิต) */}
          {order.materials_summary && order.materials_summary.length > 0 && (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                <h2 className="text-sm font-extrabold text-slate-900">สรุปวัตถุดิบทั้งใบ (แผน vs ใช้จริง)</h2>
                {order.leftover_destination && (
                  <span className="text-xs text-slate-500 font-semibold">
                    เศษวัตถุดิบไป: {order.leftover_destination.warehouse_name || order.leftover_destination.warehouse_id}
                    {order.leftover_destination.location ? ` (${order.leftover_destination.location})` : ""}
                  </span>
                )}
              </div>
              <div className="border border-[#E8ECEA] rounded-xl overflow-hidden print:border-black">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm min-w-[560px]">
                    <thead>
                      <tr className="bg-slate-100 text-slate-600 font-bold border-b border-[#E8ECEA] print:bg-white">
                        <th className="py-2.5 px-3">รหัสวัตถุดิบ</th>
                        <th className="py-2.5 px-3">ชื่อวัตถุดิบ</th>
                        <th className="py-2.5 px-3 text-right">ตามแผน</th>
                        <th className="py-2.5 px-3 text-right">
                          ใช้จริง{canEditActuals ? " (รอบนี้)" : ""}
                        </th>
                        {(canEditActuals ||
                          order.materials_summary.some((m) => (Number(m.wasted_qty) || 0) > 0)) && (
                          <th className="py-2.5 px-3 text-right">
                            เสียจริง{canEditActuals ? " (รอบนี้)" : ""}
                          </th>
                        )}
                        <th className="py-2.5 px-3 text-right">เศษคงเหลือ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EEF1EF]">
                      {order.materials_summary.map((m) => {
                        const remaining = rmRemaining[m.rm_sku] ?? 0;
                        const input = rmReport[m.rm_sku] || { used: "", wasted: "" };
                        const showWastedCol = canEditActuals || (Number(m.wasted_qty) || 0) > 0;
                        const afterLeftover = Math.max(
                          0,
                          m.leftover_qty - parsedQty(input.used) - parsedQty(input.wasted)
                        );
                        return (
                          <tr key={m.rm_sku} className="hover:bg-slate-50/70">
                            <td className="py-2.5 px-3 font-mono font-bold text-slate-800">{m.rm_sku}</td>
                            <td className="py-2.5 px-3 font-semibold text-slate-800">{m.rm_name}</td>
                            <td className="py-2.5 px-3 text-right font-mono">{m.planned_qty.toLocaleString()}</td>
                            <td className="py-2.5 px-3 text-right">
                              {canEditActuals ? (
                                <div className="flex flex-col items-end gap-0.5">
                                  <input
                                    type="number"
                                    min={0}
                                    max={remaining}
                                    inputMode="numeric"
                                    value={input.used}
                                    onChange={(e) =>
                                      setRmReport({ ...rmReport, [m.rm_sku]: { ...input, used: e.target.value } })
                                    }
                                    placeholder="0"
                                    className="w-24 rounded-lg border border-[#E1E8EE] bg-white px-2.5 py-1.5 text-right font-mono text-sm font-bold text-[#06402B] focus:border-[#0F5C3F] focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                  />
                                  {m.used_qty > 0 && (
                                    <span className="font-sans text-[10px] font-bold text-slate-400">
                                      สะสม {m.used_qty.toLocaleString()}
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span className="font-mono font-bold text-slate-900">
                                  {m.used_qty.toLocaleString()} {m.rm_unit}
                                </span>
                              )}
                            </td>
                            {showWastedCol && (
                              <td className="py-2.5 px-3 text-right">
                                {canEditActuals ? (
                                  <div className="flex flex-col items-end gap-0.5">
                                    <input
                                      type="number"
                                      min={0}
                                      max={remaining}
                                      inputMode="numeric"
                                      value={input.wasted}
                                      onChange={(e) =>
                                        setRmReport({ ...rmReport, [m.rm_sku]: { ...input, wasted: e.target.value } })
                                      }
                                      placeholder="0"
                                      className="w-24 rounded-lg border border-[#E1E8EE] bg-white px-2.5 py-1.5 text-right font-mono text-sm font-bold text-rose-700 focus:border-rose-400 focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                    />
                                    {Number(m.wasted_qty || 0) > 0 && (
                                      <span className="font-sans text-[10px] font-bold text-slate-400">
                                        สะสม {Number(m.wasted_qty).toLocaleString()}
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <span className="font-mono font-bold text-rose-600">
                                    {Number(m.wasted_qty).toLocaleString()}
                                  </span>
                                )}
                              </td>
                            )}
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-amber-700">
                              {canEditActuals ? afterLeftover.toLocaleString() : m.leftover_qty.toLocaleString()}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Bill of Materials (Raw Materials required) */}
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
              <h2 className="text-sm font-extrabold text-slate-900">รายการตัดสต็อกวัตถุดิบ (Bill of Materials)</h2>
              <span className="text-xs text-slate-500 font-semibold">ปลายทางตัดสต็อก: โกดัง 2 (วัตถุดิบ)</span>
            </div>
            <div className="border border-[#E8ECEA] rounded-xl overflow-hidden print:border-black">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm min-w-[560px]">
                  <thead>
                    <tr className="bg-slate-100 text-slate-600 font-bold border-b border-[#E8ECEA] print:bg-white">
                      <th className="py-2.5 px-3">สำหรับสินค้า</th>
                      <th className="py-2.5 px-3">รหัสวัตถุดิบ (RM)</th>
                      <th className="py-2.5 px-3">ชื่อวัตถุดิบ</th>
                      <th className="py-2.5 px-3">คลังตัดสต็อก</th>
                      <th className="py-2.5 px-3 text-right">จำนวนที่ใช้</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EEF1EF]">
                    {order.items?.flatMap((fgItem) =>
                      fgItem.materials?.map((mat, matIdx) => (
                        <tr key={fgItem.fg_sku + mat.rm_sku + matIdx} className="hover:bg-slate-50/70">
                          <td className="py-2.5 px-3 font-mono font-semibold text-slate-500">{fgItem.fg_sku}</td>
                          <td className="py-2.5 px-3 font-mono font-bold text-slate-800">{mat.rm_sku}</td>
                          <td className="py-2.5 px-3 font-semibold text-slate-800">{mat.rm_name}</td>
                          <td className="py-2.5 px-3 text-slate-600 text-xs">{mat.rm_wh || "โกดัง 2"}</td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                            {Number(mat.rm_qty_required || 0).toLocaleString()} {mat.rm_unit}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Status Update Controls */}
          <div className="p-4 rounded-2xl bg-slate-50 border border-[#E8ECEA]/80 space-y-2.5 print:hidden">
            <div className="block text-sm font-extrabold text-slate-900">เปลี่ยนสถานะใบผลิต:</div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                disabled={isUpdatingStatus || order.status === "COMPLETED"}
                onClick={() => handleUpdateStatus(order.order_no, "COMPLETED")}
                className="px-3.5 py-2 rounded-xl bg-[#06402B] hover:bg-[#053425] text-white text-sm font-bold disabled:opacity-40 transition-all cursor-pointer"
              >
                ✓ ทำเครื่องหมายว่า เสร็จสมบูรณ์
              </button>
              <button
                type="button"
                disabled={isUpdatingStatus || order.status === "IN_PROGRESS"}
                onClick={() => handleUpdateStatus(order.order_no, "IN_PROGRESS")}
                className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold disabled:opacity-40 transition-all cursor-pointer"
              >
                ⚙ ตรวจแล้วบางส่วน
              </button>
              {/* ยกเลิกได้เฉพาะใบที่ยังไม่มีรอบตรวจ (ยังไม่ตัดสต็อก) */}
              <button
                type="button"
                disabled={isUpdatingStatus || order.status === "CANCELLED" || order.status !== "PENDING"}
                title={
                  order.status !== "PENDING"
                    ? "ยกเลิกได้เฉพาะใบผลิตสถานะรอตรวจที่ยังไม่มีรอบตรวจ"
                    : "ยกเลิกใบผลิตนี้"
                }
                onClick={() => handleUpdateStatus(order.order_no, "CANCELLED")}
                className="px-3.5 py-2 rounded-xl bg-slate-200 hover:bg-rose-100 hover:text-rose-700 text-slate-800 text-sm font-bold disabled:opacity-40 transition-all cursor-pointer"
              >
                ✕ ยกเลิกใบผลิต
              </button>
            </div>
          </div>

          {/* Page Actions */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#EEF1EF] print:hidden">
            <button
              type="button"
              onClick={() => window.print()}
              className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-bold transition-colors cursor-pointer"
            >
              พิมพ์ใบสั่งผลิต
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

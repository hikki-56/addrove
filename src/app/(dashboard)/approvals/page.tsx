"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { to8DigitBarcode } from "@/lib/barcode-utils";
import { batchTagExpressItems } from "@/lib/express-tag-utils";

interface ApprovalDoc {
  document_id: string;
  document_no: string;
  warehouse_id: string;
  document_date: string;
  status: string;
  created_by: string;
  created_at: string;
  target_sheet: string;
  rows: Array<[string, string, string, string, number, string, string, string]>;
}

// Friendly display name formatter for User ID / UUIDs
function formatUserName(userVal?: string): string {
  if (!userVal) return "พนักงานคลัง (Staff)";
  const trimmed = userVal.trim();
  if (trimmed.includes("@")) return trimmed.split("@")[0];
  if (/^[0-9a-f]{8}-[0-9a-f]{4}/i.test(trimmed)) {
    return "ไม่ทราบผู้ใช้งาน";
  }
  return trimmed;
}

// Format supplier display value (filters out UUIDs)
function formatSupplierName(supplierVal?: string): string {
  if (!supplierVal) return "-";
  const trimmed = supplierVal.trim();
  if (!trimmed || trimmed === "-") return "-";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}/i.test(trimmed)) {
    return "-";
  }
  return trimmed;
}

// Format quantity safely
function formatQuantity(val: any): string {
  if (val === null || val === undefined) return "1";
  const num = Number(val);
  if (isNaN(num)) return "1";
  if (num > 100000) return "1";
  return num.toLocaleString();
}

// Helper to extract 2-digit Express warehouse code (e.g. "01", "02", "03")
function toExpressWhCode(targetSheet: string): string {
  if (!targetSheet) return "01";
  const match = targetSheet.match(/\d+/);
  if (match) return match[0].padStart(2, "0");
  return "01";
}

export default function ApprovalsPage() {
  const [pendingDocs, setPendingDocs] = useState<ApprovalDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedWarehouse, setSelectedWarehouse] = useState("ALL");
  const [notificationMsg, setNotificationMsg] = useState<string | null>(null);

  const fetchApprovals = async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    try {
      const ts = Date.now();
      const res = await fetch(`/api/approvals?status=PENDING&_t=${ts}`, { cache: "no-store" });
      const pendingJson = await res.json();

      if (pendingJson.success && Array.isArray(pendingJson.data)) {
        if (typeof window !== "undefined") {
          localStorage.removeItem("stockify_pending_receives");
        }
        setPendingDocs(pendingJson.data);
      }
    } catch (e) {
      console.error("Failed to fetch approvals:", e);
    } finally {
      if (!isSilent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchApprovals(false);
    const interval = setInterval(() => fetchApprovals(true), 30000);
    return () => clearInterval(interval);
  }, []);

  const handleApprove = async (doc: ApprovalDoc) => {
    // --- OPTIMISTIC UI: Instant response in 0.05s ---
    setPendingDocs((prev) => prev.filter((d) => d.document_id !== doc.document_id));

    if (typeof window !== "undefined") {
      try {
        const localPending = JSON.parse(localStorage.getItem("stockify_pending_receives") || "[]");
        const updated = localPending.filter((ld: any) => ld.document_id !== doc.document_id);
        localStorage.setItem("stockify_pending_receives", JSON.stringify(updated));
      } catch {}
    }

    // Automatically tag all approved items under "นำเข้าสินค้าเข้าExpress"
    const itemsToTag = (doc.rows || []).map((row, idx) => {
      const sku = String(row[0] ?? "").trim();
      const location = String(row[1] ?? "-").trim() || "-";
      const rawBarcode = String(row[2] ?? "").trim();
      const productName = String(row[3] ?? "").trim() || sku;
      const qtyVal = parseFloat(String(row[4] ?? "1").replace(/,/g, "").trim());
      const quantity = !isNaN(qtyVal) && qtyVal > 0 ? qtyVal : 1;
      const targetWarehouse = String(row[5] ?? doc.target_sheet ?? "").trim() || doc.target_sheet;
      const supplier = String(row[6] ?? "-").trim() || "-";

      const barcode =
        rawBarcode && rawBarcode !== "-" && rawBarcode !== "null" && rawBarcode !== "undefined"
          ? rawBarcode
          : to8DigitBarcode(rawBarcode, sku) || sku;

      return {
        id: `rec_${doc.document_id}_${sku}_${idx}`,
        type: "RECEIVE" as const,
        tag: "นำเข้าสินค้าเข้าExpress",
        status: "PENDING" as const,
        sku,
        barcode,
        product_name: productName,
        quantity,
        location,
        warehouse: targetWarehouse,
        warehouse_code: toExpressWhCode(targetWarehouse),
        document_no: doc.document_no,
        document_date: doc.document_date || doc.created_at?.slice(0, 10) || new Date().toISOString().slice(0, 10),
        supplier,
      };
    });

    batchTagExpressItems(itemsToTag);
    setNotificationMsg(`อนุมัติเอกสาร ${doc.document_no} สำเร็จ และบันทึกเข้าแท็ก "นำเข้าสินค้าเข้าExpress" เรียบร้อยแล้ว`);
    setTimeout(() => setNotificationMsg(null), 5000);

    // Background server call
    try {
      const res = await fetch(`/api/approvals/${encodeURIComponent(doc.document_id)}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(doc),
      });
      const json = await res.json();
      if (!json.success) {
        // Rollback
        setPendingDocs((prev) => [doc, ...prev.filter((d) => d.document_id !== doc.document_id)]);
        alert(json.message || "เกิดข้อผิดพลาดในการอนุมัติจากเซิร์ฟเวอร์");
      }
    } catch {
      // Rollback
      setPendingDocs((prev) => [doc, ...prev.filter((d) => d.document_id !== doc.document_id)]);
      alert("เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์");
    }
  };

  const handleReject = async (docId: string) => {
    if (!confirm("คุณแน่ใจหรือไม่ว่าต้องการปฏิเสธรายการรับสินค้านี้?")) return;
    const targetDoc = pendingDocs.find((d) => d.document_id === docId);
    
    // --- OPTIMISTIC UI ---
    setPendingDocs((prev) => prev.filter((d) => d.document_id !== docId));
    if (typeof window !== "undefined") {
      try {
        const localPending = JSON.parse(localStorage.getItem("stockify_pending_receives") || "[]");
        const updated = localPending.filter((ld: any) => ld.document_id !== docId);
        localStorage.setItem("stockify_pending_receives", JSON.stringify(updated));
      } catch {}
    }

    try {
      const res = await fetch(`/api/approvals/${docId}/reject`, {
        method: "POST",
      });
      const json = await res.json();
      if (!json.success) {
        if (targetDoc) setPendingDocs((prev) => [targetDoc, ...prev.filter((d) => d.document_id !== docId)]);
        alert(json.message || "เกิดข้อผิดพลาดในการปฏิเสธรายการ");
      }
    } catch {
      alert("เกิดข้อผิดพลาดในการปฏิเสธรายการ");
    } finally {
      setActionLoading(null);
    }
  };

  const currentDocs = pendingDocs;

  // Filtered docs
  const filteredDocs = useMemo(() => {
    return currentDocs.filter((doc) => {
      const matchesWarehouse =
        selectedWarehouse === "ALL" ||
        doc.target_sheet === selectedWarehouse ||
        doc.warehouse_id === selectedWarehouse;

      if (!matchesWarehouse) return false;

      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();

      const inDocNo = doc.document_no.toLowerCase().includes(q);
      const inSheet = doc.target_sheet.toLowerCase().includes(q);
      const inUser = formatUserName(doc.created_by).toLowerCase().includes(q);
      const inItems = doc.rows?.some(
        (r) =>
          r[0]?.toLowerCase().includes(q) ||
          r[1]?.toLowerCase().includes(q) ||
          r[6]?.toLowerCase().includes(q) ||
          r[7]?.toLowerCase().includes(q)
      );

      return inDocNo || inSheet || inUser || inItems;
    });
  }, [currentDocs, selectedWarehouse, searchQuery]);

  const availableWarehouses = useMemo(() => {
    const set = new Set<string>();
    currentDocs.forEach((d) => set.add(d.target_sheet));
    return Array.from(set);
  }, [currentDocs]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Toast Notification Banner */}
      {notificationMsg && (
        <div className="p-4 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 text-sm font-bold flex items-center justify-between shadow-lg animate-in fade-in slide-in-from-top-3">
          <div className="flex items-center gap-2.5">
            <span className="text-lg">🏷️</span>
            <span>{notificationMsg}</span>
          </div>
          <Link
            href="/express-import/receive"
            className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all shrink-0 cursor-pointer shadow-xs"
          >
            เปิดดูในหน้านำเข้า Express →
          </Link>
        </div>
      )}

      {/* Status View Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
        <div className="px-4 py-2 rounded-xl text-xs font-bold bg-amber-50 text-amber-800 border border-amber-300 shadow-xs flex items-center gap-2">
          <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>รออนุมัติ ({pendingDocs.length})</span>
        </div>
      </div>

      {/* Filter & Search Bar */}
      {currentDocs.length > 0 && (
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs">
          {/* Search Box */}
          <div className="relative flex-1">
            <svg className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ค้นหาเลขเอกสาร, SKU, ชื่อสินค้า, ผู้จำหน่าย..."
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>

          {/* Warehouse Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            <button
              onClick={() => setSelectedWarehouse("ALL")}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                selectedWarehouse === "ALL"
                  ? "bg-indigo-600 text-white shadow-xs"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200"
              }`}
            >
              ทั้งหมด ({currentDocs.length})
            </button>
            {availableWarehouses.map((wh) => (
              <button
                key={wh}
                onClick={() => setSelectedWarehouse(wh)}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                  selectedWarehouse === wh
                    ? "bg-indigo-600 text-white shadow-xs"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200"
                }`}
              >
                {wh}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Main Content Area */}
      {loading ? (
        <div className="rounded-2xl p-16 text-center border border-slate-200 bg-white shadow-xs">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-500 text-sm font-medium">กำลังโหลดรายการเอกสาร...</p>
        </div>
      ) : currentDocs.length === 0 ? (
        <div className="rounded-2xl p-16 text-center border border-slate-200 bg-white shadow-xs">
          <div className="w-14 h-14 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center mx-auto mb-4 text-emerald-600">
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h3 className="text-base font-bold text-slate-900 mb-1">
            ไม่มีรายการรออนุมัติ
          </h3>
          <p className="text-slate-500 text-xs sm:text-sm">
            รายการรับสินค้าเข้าคลังทั้งหมดได้รับการตรวจสอบและอนุมัติเรียบร้อยแล้ว
          </p>
        </div>
      ) : filteredDocs.length === 0 ? (
        <div className="rounded-2xl p-12 text-center border border-slate-200 bg-white shadow-xs">
          <p className="text-slate-500 text-sm">ไม่พบรายการที่ตรงกับเงื่อนไขการค้นหา &quot;{searchQuery}&quot;</p>
          <button
            onClick={() => {
              setSearchQuery("");
              setSelectedWarehouse("ALL");
            }}
            className="mt-3 px-3 py-1.5 text-xs text-indigo-600 hover:underline font-bold cursor-pointer"
          >
            ล้างตัวกรองทั้งหมด
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          {filteredDocs.map((doc, idx) => {
            const formattedUser = formatUserName(doc.created_by);
            const docDate = doc.document_date || doc.created_at?.slice(0, 10) || "-";
            const isApprovedDoc = doc.status === "POSTED" || doc.status === "APPROVED";
            const isProcessingDoc = doc.status === "PROCESSING";

            return (
              <div
                key={`${doc.document_id}-${idx}`}
                className={`rounded-2xl p-4 sm:p-5 border border-slate-200 bg-white shadow-xs space-y-4 relative border-l-4 ${
                  isApprovedDoc ? "border-l-emerald-500" : "border-l-amber-500"
                }`}
              >
                {/* Card Header */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
                  <div className="flex flex-wrap items-center gap-4">
                    {/* Document Number */}
                    <div className="flex items-center gap-1.5 text-xs font-mono font-black text-slate-900">
                      <svg className="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <span>{doc.document_no}</span>
                    </div>

                    {isProcessingDoc && (
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-200">
                        ต้องตรวจสอบรายการค้างดำเนินการ
                      </span>
                    )}

                    {/* Target Warehouse */}
                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                      <svg className="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5m0 0h4m-4 0V11m0 0h4" />
                      </svg>
                      <span>เป้าหมาย: <strong className="text-slate-900 font-black">{doc.target_sheet}</strong></span>
                    </div>
                  </div>

                  {/* Creator and Date Info */}
                  <div className="flex items-center gap-4 text-xs font-mono text-slate-600">
                    <div className="flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      <span>ผู้บันทึก: <strong className="text-slate-800 font-bold">{formattedUser}</strong></span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      <span>วันที่: <strong className="text-slate-800 font-semibold">{docDate}</strong></span>
                    </div>
                  </div>
                </div>

                {/* Items Table */}
                <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-slate-50 text-slate-500 border-b border-slate-200">
                        <th className="py-2.5 px-3 font-semibold">รหัสสินค้า</th>
                        <th className="py-2.5 px-3 font-semibold">ตำแหน่ง</th>
                        <th className="py-2.5 px-3 font-semibold">ผู้จำหน่าย</th>
                        <th className="py-2.5 px-3 font-semibold">บาร์โค้ด</th>
                        <th className="py-2.5 px-3 font-semibold">ชื่อสินค้า</th>
                        <th className="py-2.5 px-3 font-semibold text-center">จำนวน</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {doc.rows.map((row, idx) => {
                        const qtyNum = !isNaN(Number(row[4])) && String(row[4]).trim() !== "" ? Number(row[4]) : 1;
                        return (
                          <tr key={idx} className="hover:bg-slate-50/80 transition-colors text-slate-700">
                            {/* รหัสสินค้า */}
                            <td className="py-2.5 px-3 font-mono font-bold text-slate-900">
                              {row[0] || "-"}
                            </td>

                            {/* ตำแหน่ง */}
                            <td className="py-2.5 px-3">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 font-mono font-bold text-xs border border-emerald-200">
                                📍 {row[1] || "-"}
                              </span>
                            </td>

                            {/* ผู้จำหน่าย */}
                            <td className="py-2.5 px-3 text-slate-600 font-medium">
                              {formatSupplierName(row[6])}
                            </td>

                            {/* บาร์โค้ด */}
                            <td className="py-2.5 px-3 font-mono text-slate-700">
                              {row[2] && row[2] !== "-" ? row[2] : (to8DigitBarcode(row[2], row[0]) || row[0] || "-")}
                            </td>

                            {/* ชื่อสินค้า */}
                            <td className="py-2.5 px-3 font-bold text-slate-900 max-w-xs truncate">
                              {row[3] || "-"}
                            </td>

                            {/* จำนวน */}
                            <td className="py-2.5 px-3 text-center font-mono font-extrabold text-slate-900 text-sm">
                              {qtyNum.toLocaleString()}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Footer Action Buttons */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
                  <div className="text-xs text-slate-500 font-mono">
                    จำนวน <strong className="text-slate-800">{doc.rows?.length || 0}</strong> รายการในเอกสารนี้
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    {!isApprovedDoc && !isProcessingDoc && (
                      <>
                        {/* Reject Button */}
                        <button
                          onClick={() => handleReject(doc.document_id)}
                          disabled={actionLoading === doc.document_id}
                          className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white font-bold text-xs transition-all disabled:opacity-50 flex items-center gap-1.5 cursor-pointer shadow-xs active:scale-95"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                          <span>ไม่อนุมัติ</span>
                        </button>

                        {/* Approve Button */}
                        <button
                          onClick={() => handleApprove(doc)}
                          disabled={actionLoading === doc.document_id}
                          className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold text-xs sm:text-sm transition-all disabled:opacity-50 flex items-center gap-2 cursor-pointer shadow-md shadow-emerald-600/20 active:scale-95"
                        >
                          {actionLoading === doc.document_id ? (
                            <>
                              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                              <span>กำลังบันทึกเข้าโกดัง...</span>
                            </>
                          ) : (
                            <>
                              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                              </svg>
                              <span>อนุมัติ (บันทึกเข้าโกดัง & เก็บแท็ก Express)</span>
                            </>
                          )}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

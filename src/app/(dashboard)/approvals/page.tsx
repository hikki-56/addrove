"use client";

import { useState, useEffect, useMemo } from "react";
import ExpressImportModal, { ApprovedDocumentItem } from "@/components/ui/ExpressImportModal";
import { to8DigitBarcode } from "@/lib/barcode-utils";

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

export default function ApprovalsPage() {
  const [activeTab, setActiveTab] = useState<"PENDING" | "POSTED">("PENDING");
  const [pendingDocs, setPendingDocs] = useState<ApprovalDoc[]>([]);
  const [approvedDocs, setApprovedDocs] = useState<ApprovalDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedWarehouse, setSelectedWarehouse] = useState("ALL");

  // Express Modal state
  const [isExpressModalOpen, setIsExpressModalOpen] = useState(false);
  const [expressModalDocId, setExpressModalDocId] = useState<string | null>(null);

  const fetchApprovals = async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    try {
      const ts = Date.now();
      const [pendingRes, postedRes] = await Promise.all([
        fetch(`/api/approvals?status=PENDING&_t=${ts}`, { cache: "no-store" }),
        fetch(`/api/approvals?status=POSTED&_t=${ts}`, { cache: "no-store" }),
      ]);

      const pendingJson = await pendingRes.json();
      const postedJson = await postedRes.json();

      if (pendingJson.success && Array.isArray(pendingJson.data)) {
        if (typeof window !== "undefined") {
          localStorage.removeItem("stockify_pending_receives");
        }
        setPendingDocs(pendingJson.data);
      }

      if (postedJson.success && Array.isArray(postedJson.data)) {
        setApprovedDocs(postedJson.data);
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
    setActionLoading(doc.document_id);
    try {
      const res = await fetch(`/api/approvals/${encodeURIComponent(doc.document_id)}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(doc),
      });
      const json = await res.json();
      if (json.success) {
        const approvedItem: ApprovalDoc = {
          ...doc,
          status: "POSTED",
        };
        setPendingDocs((prev) => prev.filter((d) => d.document_id !== doc.document_id));
        setApprovedDocs((prev) => [approvedItem, ...prev]);

        if (typeof window !== "undefined") {
          try {
            const localPending = JSON.parse(localStorage.getItem("stockify_pending_receives") || "[]");
            const updated = localPending.filter((ld: any) => ld.document_id !== doc.document_id);
            localStorage.setItem("stockify_pending_receives", JSON.stringify(updated));
          } catch {}
        }

        // Prompt to view Express Barcodes
        if (confirm("อนุมัติและบันทึกเข้าโกดังสำเร็จ! คุณต้องการเปิดบาร์โค้ดเพื่อสแกนเข้า Express ทันทีหรือไม่?")) {
          setExpressModalDocId(doc.document_id);
          setIsExpressModalOpen(true);
        }
      } else {
        alert(json.message || "เกิดข้อผิดพลาดในการอนุมัติ");
      }
    } catch {
      alert("เกิดข้อผิดพลาดในการอนุมัติ");
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (docId: string) => {
    if (!confirm("คุณแน่ใจหรือไม่ว่าต้องการปฏิเสธรายการรับสินค้านี้?")) return;
    setActionLoading(docId);
    try {
      const res = await fetch(`/api/approvals/${docId}/reject`, {
        method: "POST",
      });
      const json = await res.json();
      if (json.success) {
        setPendingDocs((prev) => prev.filter((d) => d.document_id !== docId));
        if (typeof window !== "undefined") {
          try {
            const localPending = JSON.parse(localStorage.getItem("stockify_pending_receives") || "[]");
            const updated = localPending.filter((ld: any) => ld.document_id !== docId);
            localStorage.setItem("stockify_pending_receives", JSON.stringify(updated));
          } catch {}
        }
      } else {
        alert(json.message || "เกิดข้อผิดพลาดในการปฏิเสธรายการ");
      }
    } catch {
      alert("เกิดข้อผิดพลาดในการปฏิเสธรายการ");
    } finally {
      setActionLoading(null);
    }
  };

  const openExpressModal = (docId: string | null = null) => {
    setExpressModalDocId(docId);
    setIsExpressModalOpen(true);
  };

  const currentDocs = activeTab === "PENDING" ? pendingDocs : approvedDocs;

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

  const totalItemsCount = useMemo(() => {
    return currentDocs.reduce((acc, doc) => acc + (doc.rows?.length || 0), 0);
  }, [currentDocs]);

  const availableWarehouses = useMemo(() => {
    const set = new Set<string>();
    currentDocs.forEach((d) => set.add(d.target_sheet));
    return Array.from(set);
  }, [currentDocs]);

  // Transform approvedDocs to type ApprovedDocumentItem (Deduplicated by document_id)
  const approvedDocsForModal: ApprovedDocumentItem[] = useMemo(() => {
    const docMap = new Map<string, ApprovedDocumentItem>();
    [...approvedDocs, ...pendingDocs].forEach((d) => {
      if (!docMap.has(d.document_id)) {
        docMap.set(d.document_id, {
          document_id: d.document_id,
          document_no: d.document_no,
          warehouse_id: d.warehouse_id,
          target_sheet: d.target_sheet,
          document_date: d.document_date,
          created_by: d.created_by,
          status: d.status,
          rows: d.rows || [],
        });
      }
    });
    return Array.from(docMap.values());
  }, [approvedDocs, pendingDocs]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">

      {/* Status View Tabs */}
      <div className="flex items-center gap-2 border-b border-white/10 pb-3">
        <button
          onClick={() => setActiveTab("PENDING")}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
            activeTab === "PENDING"
              ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm"
              : "bg-[#111118] text-slate-400 hover:text-slate-200 border border-white/5"
          }`}
        >
          <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>รออนุมัติ ({pendingDocs.length})</span>
        </button>

        <button
          onClick={() => setActiveTab("POSTED")}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
            activeTab === "POSTED"
              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm"
              : "bg-[#111118] text-slate-400 hover:text-slate-200 border border-white/5"
          }`}
        >
          <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>อนุมัติแล้ว ({approvedDocs.length})</span>
        </button>
      </div>



      {/* Filter & Search Bar */}
      {currentDocs.length > 0 && (
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-[#111118] p-3 rounded-2xl border border-white/10 shadow-sm">
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
              className="w-full pl-10 pr-4 py-2 bg-[#16161f] border border-white/10 rounded-xl text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-200"
              >
                ✕
              </button>
            )}
          </div>

          {/* Warehouse Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            <button
              onClick={() => setSelectedWarehouse("ALL")}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap cursor-pointer ${
                selectedWarehouse === "ALL"
                  ? "bg-emerald-600 text-white shadow-xs"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200"
              }`}
            >
              ทั้งหมด ({currentDocs.length})
            </button>
            {availableWarehouses.map((wh) => (
              <button
                key={wh}
                onClick={() => setSelectedWarehouse(wh)}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap cursor-pointer ${
                  selectedWarehouse === wh
                    ? "bg-emerald-600 text-white shadow-xs"
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
        <div className="rounded-2xl p-16 text-center border border-white/10 bg-[#111118] shadow-sm">
          <div className="w-8 h-8 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-400 text-sm font-medium">กำลังโหลดรายการเอกสาร...</p>
        </div>
      ) : currentDocs.length === 0 ? (
        <div className="rounded-2xl p-16 text-center border border-emerald-500/20 bg-[#111118] shadow-sm">
          <div className="w-14 h-14 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mx-auto mb-4 text-emerald-400">
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h3 className="text-base font-bold text-slate-100 mb-1">
            {activeTab === "PENDING" ? "ไม่มีรายการรออนุมัติ" : "ไม่มีรายการอนุมัติแล้ว"}
          </h3>
          <p className="text-slate-400 text-xs sm:text-sm">
            {activeTab === "PENDING"
              ? "รายการรับสินค้าเข้าคลังทั้งหมดได้รับการตรวจสอบและอนุมัติเรียบร้อยแล้ว"
              : "ยังไม่มีรายการที่ได้รับการอนุมัติ"}
          </p>
        </div>
      ) : filteredDocs.length === 0 ? (
        <div className="rounded-2xl p-12 text-center border border-white/10 bg-[#111118] shadow-sm">
          <p className="text-slate-400 text-sm">ไม่พบรายการที่ตรงกับเงื่อนไขการค้นหา &quot;{searchQuery}&quot;</p>
          <button
            onClick={() => {
              setSearchQuery("");
              setSelectedWarehouse("ALL");
            }}
            className="mt-3 px-3 py-1.5 text-xs text-emerald-400 hover:underline font-semibold"
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
                className={`rounded-2xl p-5 border border-white/10 bg-[#111118] shadow-sm space-y-4 relative border-l-4 ${
                  isApprovedDoc ? "border-l-emerald-500" : "border-l-amber-500"
                }`}
              >
                {/* Card Header */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-white/10 pb-3.5">
                  <div className="flex flex-wrap items-center gap-4">
                    {/* Document Number */}
                    <div className="flex items-center gap-1.5 text-xs font-mono font-black text-slate-900">
                      <svg className="w-3.5 h-3.5 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <span>{doc.document_no}</span>
                    </div>

                    {isProcessingDoc && (
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-orange-500/20 text-orange-700 border border-orange-200">
                        ต้องตรวจสอบรายการค้างดำเนินการ
                      </span>
                    )}

                    {/* Target Warehouse */}
                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                      <svg className="w-3.5 h-3.5 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5m0 0h4m-4 0V11m0 0h4" />
                      </svg>
                      <span>เป้าหมาย: <strong className="text-slate-950 font-black">{doc.target_sheet}</strong></span>
                    </div>
                  </div>

                  {/* Creator and Date Info */}
                  <div className="flex items-center gap-4 text-xs font-mono text-slate-700">
                    <div className="flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      <span>ผู้บันทึก: <strong className="text-slate-900 font-bold">{formattedUser}</strong></span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      <span>วันที่: <strong className="text-slate-900 font-semibold">{docDate}</strong></span>
                    </div>
                  </div>
                </div>

                {/* Items Table */}
                <div className="overflow-x-auto rounded-xl border border-white/10 bg-[#16161f]">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-[#111118] text-slate-400 border-b border-white/10">
                        <th className="py-2.5 px-3 font-semibold">รหัสสินค้า</th>
                        <th className="py-2.5 px-3 font-semibold">ตำแหน่ง</th>
                        <th className="py-2.5 px-3 font-semibold">ผู้จำหน่าย</th>
                        <th className="py-2.5 px-3 font-semibold">บาร์โค้ด</th>
                        <th className="py-2.5 px-3 font-semibold">ชื่อสินค้า</th>
                        <th className="py-2.5 px-3 font-semibold text-center">จำนวน</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {doc.rows.map((row, idx) => (
                        <tr key={idx} className="hover:bg-white/[0.03] transition-colors text-slate-300">
                          {/* รหัสสินค้า */}
                          <td className="py-2.5 px-3 font-mono font-bold text-slate-200">
                            {row[0] || "-"}
                          </td>

                          {/* ตำแหน่ง */}
                          <td className="py-2.5 px-3">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 font-mono font-bold text-xs border border-emerald-500/30">
                              📍 {row[1] || "-"}
                            </span>
                          </td>

                          {/* ผู้จำหน่าย */}
                          <td className="py-2.5 px-3 text-slate-300 font-semibold">
                            {formatSupplierName(row[6])}
                          </td>

                          {/* บาร์โค้ด */}
                          <td className="py-2.5 px-3 font-mono font-bold text-slate-200">
                            {row[2] && row[2] !== "-" ? row[2] : (to8DigitBarcode(row[2], row[0]) || row[0] || "-")}
                          </td>

                          {/* ชื่อสินค้า */}
                          <td className="py-2.5 px-3 font-bold text-slate-200 max-w-xs truncate">
                            {row[3] || "-"}
                          </td>

                          {/* จำนวน */}
                          <td className="py-2.5 px-3 text-center font-mono font-extrabold text-emerald-400 text-sm">
                            {!isNaN(Number(row[4])) && String(row[4]).trim() !== ""
                              ? Number(row[4])
                              : 1}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Footer Action Buttons */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
                  <div className="text-xs text-slate-400 font-mono">
                    จำนวน <strong className="text-slate-200">{doc.rows?.length || 0}</strong> รายการในเอกสารนี้
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    {/* Express Import Button per document */}
                    <button
                      onClick={() => openExpressModal(doc.document_id)}
                      className="px-3.5 py-2 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 font-bold text-xs transition-all flex items-center gap-1.5 cursor-pointer shadow-xs"
                    >
                      <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                      </svg>
                      <span>นำเข้า Express (สแกนบาร์โค้ด)</span>
                    </button>

                    {!isApprovedDoc && !isProcessingDoc && (
                      <>
                        {/* Reject Button */}
                        <button
                          onClick={() => handleReject(doc.document_id)}
                          disabled={actionLoading === doc.document_id}
                          className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 active:bg-red-800 text-white font-semibold text-xs transition-all disabled:opacity-50 flex items-center gap-1.5 cursor-pointer shadow-xs"
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
                          className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold text-xs transition-all disabled:opacity-50 flex items-center gap-2 cursor-pointer shadow-sm"
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
                              <span>อนุมัติ (บันทึกเข้าโกดัง)</span>
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

      {/* Express Import Barcode Modal */}
      <ExpressImportModal
        isOpen={isExpressModalOpen}
        onClose={() => setIsExpressModalOpen(false)}
        approvedDocs={approvedDocsForModal}
        initialDocId={expressModalDocId}
      />
    </div>
  );
}

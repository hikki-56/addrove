"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import Link from "next/link";
import { to8DigitBarcode } from "@/lib/barcode-utils";
import { batchTagExpressItems } from "@/lib/express-tag-utils";
import { useEscapeKey } from "@/hooks/use-escape-key";
import { usePollingWhenVisible } from "@/hooks/use-visibility-polling";
import { isSameJson } from "@/lib/json-equal";
import CustomSelect from "@/components/ui/CustomSelect";

interface ApprovalDoc {
  document_id: string;
  document_no: string;
  warehouse_id: string;
  document_date: string;
  status: string;
  created_by: string;
  created_by_name?: string;
  created_at: string;
  target_sheet: string;
  rows: Array<[string, string, string, string, number, string, string, string]>;
}

type NotificationState = {
  tone: "progress" | "success" | "error";
  message: string;
};

// Friendly display name formatter for User ID / UUIDs
function formatUserName(userVal?: string, createdByName?: string): string {
  const candidate = (createdByName || userVal || "").trim();
  if (!candidate || candidate === "staff" || candidate === "unknown" || candidate === "-") {
    return "พนักงานรับสินค้า";
  }
  if (candidate.includes("@")) return candidate.split("@")[0];
  const lower = candidate.toLowerCase();
  if (lower === "usr-admin-01" || lower === "admin" || lower.includes("admin")) {
    return "ผู้ดูแลระบบ (Admin)";
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}/i.test(candidate) || /^id-[0-9]+/i.test(candidate) || /^usr-/i.test(candidate)) {
    return "พนักงานรับสินค้า";
  }
  return candidate;
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

// Helper to extract 2-digit Express warehouse code (e.g. "01", "02", "03")
function toExpressWhCode(targetSheet: string): string {
  if (!targetSheet) return "01";
  const match = targetSheet.match(/\d+/);
  if (match) return match[0].padStart(2, "0");
  return "01";
}

function statusMetaFor(doc: ApprovalDoc) {
  if (doc.status === "PROCESSING") {
    return { label: "ต้องตรวจสอบ", badge: "bg-rose-50 text-rose-700 border-rose-200", dot: "bg-rose-500" };
  }
  if (doc.status === "POSTED" || doc.status === "APPROVED" || doc.status === "COMPLETED") {
    return { label: "อนุมัติแล้ว", badge: "bg-[#EAF2EE] text-[#053425] border-[#C9DFD4]", dot: "bg-[#0F5C3F]" };
  }
  return { label: "รออนุมัติ", badge: "bg-amber-50 text-amber-700 border-amber-200", dot: "bg-amber-500" };
}

function docTotalQty(doc: ApprovalDoc): number {
  return (doc.rows || []).reduce((sum, r) => {
    const n = Number(r[4]);
    return sum + (!isNaN(n) && String(r[4]).trim() !== "" ? n : 1);
  }, 0);
}

// นับสินค้าแบบไม่ซ้ำ — สินค้าตัวเดียวที่แบ่งเก็บหลาย location จะถูกแยกเป็นหลายแถว
function docSkuCount(doc: ApprovalDoc): number {
  const skus = new Set(
    (doc.rows || []).map((r) => String(r[0] ?? "").trim().toLowerCase()).filter(Boolean)
  );
  return skus.size;
}

function formatDocDate(doc: ApprovalDoc): string {
  const src = doc.created_at || doc.document_date;
  if (!src) return "-";
  const d = new Date(src);
  if (isNaN(d.getTime())) return doc.document_date || "-";
  return d.toLocaleString("th-TH", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ตรวจความถูกต้องรายแถวของตารางแก้ไข — ใช้ไฮไลต์ช่องที่ผิดหลังกดบันทึก
function isRowSkuMissing(row: any[]): boolean {
  return !String(row[0] || "").trim();
}

function isRowQtyInvalid(row: any[]): boolean {
  const q = Number(row[4]);
  return isNaN(q) || q <= 0;
}

// คลาสร่วมของช่องกรอกใน modal แก้ไข (mono = รหัส/ตัวเลข)
function editInputClass(invalid: boolean, mono: boolean): string {
  return [
    "w-full px-2.5 py-1.5 rounded-lg border text-sm font-bold focus:ring-2 focus:outline-hidden transition-colors",
    mono ? "font-mono text-slate-900" : "text-slate-800",
    invalid
      ? "border-rose-400 bg-rose-50/70 focus:ring-rose-400"
      : "border-[#D5DDD9] focus:ring-[#0F5C3F]",
  ].join(" ");
}

export default function ApprovalsPage() {
  const [pendingDocs, setPendingDocs] = useState<ApprovalDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedWarehouse, setSelectedWarehouse] = useState("ALL");
  const [notification, setNotification] = useState<NotificationState | null>(null);

  // Review modal & confirmation state
  const [reviewDoc, setReviewDoc] = useState<ApprovalDoc | null>(null);
  const [confirmAction, setConfirmAction] = useState<null | { type: "approve" | "reject"; doc: ApprovalDoc }>(null);

  useEscapeKey(Boolean(reviewDoc), () => setReviewDoc(null));
  useEscapeKey(Boolean(confirmAction), () => setConfirmAction(null));

  useEffect(() => {
    if (!notification || notification.tone === "progress") return;
    const timeoutId = window.setTimeout(() => setNotification(null), 5000);
    return () => window.clearTimeout(timeoutId);
  }, [notification]);

  const fetchApprovals = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    try {
      const res = await fetch(`/api/approvals?status=PENDING`, { cache: "no-store" });
      const pendingJson = await res.json();

      if (pendingJson.success && Array.isArray(pendingJson.data)) {
        if (typeof window !== "undefined") {
          localStorage.removeItem("stockify_pending_receives");
        }
        // คง state เดิมเมื่อรายการไม่เปลี่ยน เพื่อไม่ให้ polling ทั้งหน้า re-render ทุก 30 วิ
        setPendingDocs((prev) => (isSameJson(prev, pendingJson.data) ? prev : pendingJson.data));
      }
    } catch (e) {
      console.error("Failed to fetch approvals:", e);
    } finally {
      if (!isSilent) setLoading(false);
    }
  }, []);

  // hook ส่ง initial=true เฉพาะครั้งแรก — ครั้งแรกโชว์ loading, รอบ polling ต้อง refresh เงียบ ๆ
  // wrapper ต้อง memoize เพราะ hook ใช้ callback เป็น dependency ของ effect
  const pollingFetch = useCallback((initial?: boolean) => {
    void fetchApprovals(!initial);
  }, [fetchApprovals]);
  usePollingWhenVisible(pollingFetch, 30000);

  const handleApprove = async (doc: ApprovalDoc) => {
    setActionLoading(doc.document_id);
    // --- OPTIMISTIC UI: Instant response in 0.05s ---
    setPendingDocs((prev) => prev.filter((d) => d.document_id !== doc.document_id));
    setNotification({ tone: "progress", message: `กำลังอนุมัติเอกสาร ${doc.document_no}...` });

    if (typeof window !== "undefined") {
      try {
        const localPending = JSON.parse(localStorage.getItem("stockify_pending_receives") || "[]");
        const updated = localPending.filter((ld: any) => ld.document_id !== doc.document_id);
        localStorage.setItem("stockify_pending_receives", JSON.stringify(updated));
      } catch { }
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

    try {
      const res = await fetch(`/api/approvals/${encodeURIComponent(doc.document_id)}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(doc),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || "เกิดข้อผิดพลาดในการอนุมัติจากเซิร์ฟเวอร์");
      }

      batchTagExpressItems(itemsToTag);
      setNotification({
        tone: "success",
        message: `อนุมัติเอกสาร ${doc.document_no} สำเร็จ และเพิ่มเข้าสู่คิวนำเข้า Express แล้ว`,
      });
    } catch (error) {
      // Rollback
      setPendingDocs((prev) => [doc, ...prev.filter((d) => d.document_id !== doc.document_id)]);
      setNotification({
        tone: "error",
        message: error instanceof Error ? error.message : "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองอีกครั้ง",
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (doc: ApprovalDoc) => {
    const docId = doc.document_id;
    setActionLoading(docId);

    // --- OPTIMISTIC UI ---
    setPendingDocs((prev) => prev.filter((d) => d.document_id !== docId));
    setNotification({ tone: "progress", message: `กำลังบันทึกผลไม่อนุมัติเอกสาร ${doc.document_no}...` });
    if (typeof window !== "undefined") {
      try {
        const localPending = JSON.parse(localStorage.getItem("stockify_pending_receives") || "[]");
        const updated = localPending.filter((ld: any) => ld.document_id !== docId);
        localStorage.setItem("stockify_pending_receives", JSON.stringify(updated));
      } catch { }
    }

    try {
      const res = await fetch(`/api/approvals/${docId}/reject`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || "เกิดข้อผิดพลาดในการบันทึกผลไม่อนุมัติ");
      }
      setNotification({ tone: "success", message: `บันทึกผลไม่อนุมัติเอกสาร ${doc.document_no} แล้ว` });
    } catch (error) {
      setPendingDocs((prev) => [doc, ...prev.filter((d) => d.document_id !== docId)]);
      setNotification({
        tone: "error",
        message: error instanceof Error ? error.message : "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองอีกครั้ง",
      });
    } finally {
      setActionLoading(null);
    }
  };

  const currentDocs = pendingDocs;

  // Edit Document Modal States
  const [editingDoc, setEditingDoc] = useState<ApprovalDoc | null>(null);
  const [editRows, setEditRows] = useState<any[]>([]);
  const [editWarehouse, setEditWarehouse] = useState("");
  const [editDocDate, setEditDocDate] = useState("");
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  useEscapeKey(Boolean(editingDoc), () => {
    if (!isSavingEdit) setEditingDoc(null);
  });

  const openEditModal = (doc: ApprovalDoc) => {
    setReviewDoc(null);
    setEditingDoc(doc);
    setEditError(null);
    setEditWarehouse(doc.target_sheet || "โกดัง1");
    setEditDocDate(doc.document_date || doc.created_at?.slice(0, 10) || new Date().toISOString().slice(0, 10));
    setEditRows(
      (doc.rows || []).map((r) => [
        String(r[0] ?? ""),
        String(r[1] ?? "-"),
        String(r[2] ?? ""),
        String(r[3] ?? ""),
        Number(r[4]) || 1,
        String(r[5] ?? doc.target_sheet ?? "โกดัง1"),
        String(r[6] ?? "-"),
        String(r[7] ?? ""),
      ])
    );
  };

  const handleRowChange = (index: number, fieldIndex: number, val: any) => {
    setEditError(null);
    setEditRows((prev) => {
      const copy = prev.map((row) => [...row]);
      copy[index][fieldIndex] = val;
      return copy;
    });
  };

  const handleAddRow = () => {
    setEditError(null);
    setEditRows((prev) => [
      ...prev,
      ["", "-", "", "", 1, editWarehouse || "โกดัง1", "-", new Date().toISOString()],
    ]);
  };

  const handleDeleteRow = (index: number) => {
    // ปุ่มลบแถวสุดท้ายถูก disabled ไว้ — เอกสารต้องมีสินค้าอย่างน้อย 1 รายการเสมอ
    if (editRows.length <= 1) return;
    setEditError(null);
    setEditRows((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSaveEdit = async () => {
    if (!editingDoc) return;
    if (editRows.length === 0) {
      setEditError("เอกสารต้องมีรายการสินค้าอย่างน้อย 1 รายการ");
      return;
    }
    for (let i = 0; i < editRows.length; i++) {
      if (isRowSkuMissing(editRows[i])) {
        setEditError(`กรุณากรอกรหัสสินค้า (SKU) ในรายการที่ ${i + 1}`);
        return;
      }
      if (isRowQtyInvalid(editRows[i])) {
        setEditError(`กรุณากระบุจำนวนสินค้าที่ถูกต้อง (มากกว่า 0) ในรายการที่ ${i + 1}`);
        return;
      }
    }
    setEditError(null);

    setIsSavingEdit(true);
    const updatedDocData: ApprovalDoc = {
      ...editingDoc,
      target_sheet: editWarehouse,
      document_date: editDocDate,
      rows: editRows.map((r) => [
        String(r[0] || "").trim(),
        String(r[1] || "-").trim() || "-",
        String(r[2] || r[0] || "").trim(),
        String(r[3] || r[0] || "").trim(),
        Number(r[4]) || 1,
        editWarehouse,
        String(r[6] || "-").trim() || "-",
        String(r[7] || new Date().toISOString()),
      ]),
    };

    // Optimistic UI
    setPendingDocs((prev) =>
      prev.map((d) => (d.document_id === editingDoc.document_id ? updatedDocData : d))
    );
    setNotification({ tone: "progress", message: `กำลังบันทึกการแก้ไขเอกสาร ${editingDoc.document_no}...` });
    setEditingDoc(null);

    try {
      const res = await fetch(`/api/approvals/${encodeURIComponent(editingDoc.document_id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedDocData),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || "เกิดข้อผิดพลาดในการบันทึกการแก้ไข");
      }
      setNotification({ tone: "success", message: `บันทึกการแก้ไขเอกสาร ${editingDoc.document_no} เรียบร้อยแล้ว` });
    } catch (error) {
      setPendingDocs((prev) =>
        prev.map((d) => (d.document_id === editingDoc.document_id ? editingDoc : d))
      );
      setNotification({
        tone: "error",
        message: error instanceof Error ? error.message : "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองอีกครั้ง",
      });
    } finally {
      setIsSavingEdit(false);
    }
  };

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
      const inUser = formatUserName(doc.created_by, doc.created_by_name).toLowerCase().includes(q);
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

  const renderReviewItems = (doc: ApprovalDoc) => (
    <>
      {/* Desktop: ตาราง */}
      <div className="hidden md:block overflow-x-auto rounded-xl border border-[#E8ECEA] bg-white">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="bg-slate-50/70 text-slate-500 border-b border-[#EEF1EF]">
              <th className="py-2.5 px-3 font-semibold whitespace-nowrap">รหัสสินค้า</th>
              <th className="py-2.5 px-3 font-semibold whitespace-nowrap">ชื่อสินค้า</th>
              <th className="py-2.5 px-3 font-semibold whitespace-nowrap">ตำแหน่ง</th>
              <th className="py-2.5 px-3 font-semibold whitespace-nowrap">บาร์โค้ด</th>
              <th className="py-2.5 px-3 font-semibold whitespace-nowrap">ผู้จำหน่าย</th>
              <th className="py-2.5 px-3 font-semibold text-center whitespace-nowrap">จำนวน</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#EEF1EF]">
            {(doc.rows || []).map((row, idx) => {
              const qtyNum = !isNaN(Number(row[4])) && String(row[4]).trim() !== "" ? Number(row[4]) : 1;
              return (
                <tr key={idx} className="hover:bg-slate-50/80 transition-colors text-slate-700">
                  <td className="py-2.5 px-3 font-mono font-bold text-slate-900 whitespace-nowrap">{row[0] || "-"}</td>
                  <td className="py-2.5 px-3 font-bold text-slate-900 max-w-[220px] truncate" title={row[3]}>
                    {row[3] || "-"}
                  </td>
                  <td className="py-2.5 px-3 font-mono font-bold text-slate-900 whitespace-nowrap">{row[1] || "-"}</td>
                  <td className="py-2.5 px-3 font-mono text-slate-600 whitespace-nowrap">
                    {row[2] && row[2] !== "-" ? row[2] : (to8DigitBarcode(row[2], row[0]) || row[0] || "-")}
                  </td>
                  <td className="py-2.5 px-3 font-bold text-slate-900 whitespace-nowrap">{formatSupplierName(row[6])}</td>
                  <td className="py-2.5 px-3 text-center font-mono font-extrabold text-sm text-slate-900 whitespace-nowrap tabular-nums">
                    {qtyNum.toLocaleString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile: การ์ดรายการ */}
      <div className="md:hidden space-y-2.5">
        {(doc.rows || []).map((row, idx) => {
          const qtyNum = !isNaN(Number(row[4])) && String(row[4]).trim() !== "" ? Number(row[4]) : 1;
          const barcodeVal =
            row[2] && row[2] !== "-" ? row[2] : (to8DigitBarcode(row[2], row[0]) || row[0] || "-");
          return (
            <div key={idx} className="rounded-xl border border-[#E8ECEA] p-3 space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-bold text-slate-900 leading-snug min-w-0">{row[3] || "-"}</p>
                <span className="font-mono font-extrabold text-[#053425] text-sm shrink-0">
                  {qtyNum.toLocaleString()}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
                <span className="text-slate-500">
                  รหัส: <span className="font-mono font-bold text-slate-800">{row[0] || "-"}</span>
                </span>
                <span className="text-slate-500">
                  ตำแหน่ง: <span className="font-mono font-bold text-slate-800">{row[1] || "-"}</span>
                </span>
                <span className="text-slate-500">
                  บาร์โค้ด: <span className="font-mono text-slate-700">{barcodeVal}</span>
                </span>
                <span className="text-slate-500">
                  ผู้จำหน่าย: <span className="font-bold text-slate-800">{formatSupplierName(row[6])}</span>
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Toast Notification Banner */}
      {notification && (
        <div
          role={notification.tone === "error" ? "alert" : "status"}
          aria-live="polite"
          className={`p-4 rounded-2xl border text-sm font-bold flex items-center justify-between gap-3 shadow-sm animate-in fade-in slide-in-from-top-3 ${
            notification.tone === "error"
              ? "bg-rose-50 border-rose-200 text-rose-800"
              : notification.tone === "progress"
              ? "bg-amber-50 border-amber-200 text-amber-800"
              : "bg-[#EAF2EE] border-[#C9DFD4] text-[#053425]"
          }`}
        >
          <div className="flex items-center gap-2.5">
            {notification.tone === "progress" ? (
              <span className="w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin shrink-0" />
            ) : (
              <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d={notification.tone === "error" ? "M6 18L18 6M6 6l12 12" : "M5 13l4 4L19 7"} />
              </svg>
            )}
            <span>{notification.message}</span>
          </div>
          {notification.tone === "success" && notification.message.includes("Express") && (
            <Link
              href="/express-import/receive"
              className="hidden sm:inline-flex px-3 py-1.5 rounded-xl bg-[#06402B] hover:bg-[#0F5C3F] text-white text-sm font-bold transition-all shrink-0 cursor-pointer shadow-xs"
            >
              เปิดคิวนำเข้า Express →
            </Link>
          )}
        </div>
      )}

      {/* Page Header */}
      <div className="flex flex-wrap items-center gap-2.5 pt-1">
        <div className="mr-auto">
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">อนุมัติการรับเข้า</h1>
          <p className="mt-1 text-sm text-slate-500 font-medium">ตรวจสอบเอกสารก่อนเพิ่มยอดสินค้าเข้าคลัง</p>
        </div>
        <span
          className={`px-2.5 py-1 rounded-full text-xs font-bold border whitespace-nowrap ${
            pendingDocs.length > 0
              ? "bg-amber-50 text-amber-700 border-amber-200"
              : "bg-[#EAF2EE] text-[#053425] border-[#C9DFD4]"
          }`}
        >
          {pendingDocs.length > 0 ? `รออนุมัติ ${pendingDocs.length} เอกสาร` : "อนุมัติครบทุกรายการ"}
        </span>
      </div>

      {/* Filter & Search Bar */}
      {currentDocs.length > 0 && (
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 sm:gap-3">
          <div className="relative flex-1 min-w-[200px] bg-slate-50 rounded-xl border border-[#E8ECEA] focus-within:bg-white focus-within:border-[#0F5C3F] focus-within:ring-2 focus-within:ring-[#0F5C3F]/20 overflow-hidden transition-all">
            <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              aria-label="ค้นหาเอกสารรับเข้า"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ค้นหาเลขเอกสาร, SKU, ชื่อสินค้า, ผู้จำหน่าย..."
              className="w-full h-10 pl-10 pr-10 bg-transparent text-sm text-slate-900 placeholder-slate-400 font-medium focus:outline-none"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                aria-label="ล้างคำค้นหา"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          <div className="w-full sm:w-44 shrink-0">
            <CustomSelect
              value={selectedWarehouse}
              onChange={(value) => setSelectedWarehouse(value || "ALL")}
              options={availableWarehouses.map((wh) => ({ value: wh, label: wh }))}
              placeholder={`ทุกโกดัง (${currentDocs.length})`}
              visibleOptions={4}
            />
          </div>
        </div>
      )}

      {/* Main Content Area */}
      {loading ? (
        <div aria-busy="true" aria-label="กำลังโหลดรายการเอกสาร">
          {/* Desktop: โครงตาราง */}
          <div className="hidden md:block bg-white rounded-3xl border border-[#E8ECEA]/90 shadow-sm overflow-hidden">
            <div className="grid grid-cols-[1.3fr_1fr_1fr_0.7fr_1.1fr_0.9fr_0.6fr] gap-4 px-4 py-3.5 bg-slate-50/70 border-b border-[#EEF1EF]">
              {[...Array(7)].map((_, i) => (
                <div key={i} className="h-2.5 rounded-full bg-slate-200/70 animate-pulse" />
              ))}
            </div>
            <div className="divide-y divide-[#EEF1EF]">
              {[...Array(4)].map((_, r) => (
                <div key={r} className="grid grid-cols-[1.3fr_1fr_1fr_0.7fr_1.1fr_0.9fr_0.6fr] gap-4 items-center px-4 py-4">
                  {[...Array(7)].map((_, i) => (
                    <div
                      key={i}
                      className="h-3 rounded-full bg-slate-200/70 animate-pulse"
                      style={{ width: i === 4 ? "90%" : `${58 + ((r + i) % 3) * 12}%` }}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
          {/* Mobile: การ์ดเอกสาร */}
          <div className="md:hidden space-y-3">
            {[...Array(3)].map((_, c) => (
              <div key={c} className="bg-white rounded-2xl border border-[#E8ECEA]/90 shadow-2xs p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-2 min-w-0">
                    <div className="h-3.5 w-40 rounded-full bg-slate-200/70 animate-pulse" />
                    <div className="h-2.5 w-28 rounded-full bg-slate-100 animate-pulse" />
                  </div>
                  <div className="h-6 w-20 rounded-full bg-slate-100 animate-pulse shrink-0" />
                </div>
                <div className="flex items-center justify-between">
                  <div className="h-5 w-16 rounded-md bg-slate-100 animate-pulse" />
                  <div className="h-3 w-32 rounded-full bg-slate-200/70 animate-pulse" />
                </div>
                <div className="h-9 w-full rounded-xl bg-slate-100 animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      ) : currentDocs.length === 0 ? (
        <div className="rounded-3xl border border-[#E8ECEA]/90 bg-white shadow-sm px-6 py-14 text-center space-y-5">
          <div className="w-16 h-16 mx-auto rounded-full bg-[#EAF2EE] border border-[#DFEDE6] flex items-center justify-center text-[#06402B]">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div className="space-y-1">
            <h3 className="text-lg font-black text-slate-900">ไม่มีรายการรออนุมัติ</h3>
            <p className="text-sm text-slate-500 font-medium">
              เอกสารรับเข้าใหม่จะแสดงที่นี่เมื่อพนักงานบันทึกรายการ
            </p>
          </div>
          <button
            type="button"
            onClick={() => fetchApprovals(false)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#06402B] hover:bg-[#053425] text-white text-sm font-bold transition-all cursor-pointer shadow-md shadow-[#06402B]/20 active:scale-95"
          >
            <svg className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>รีเฟรช</span>
          </button>
        </div>
      ) : filteredDocs.length === 0 ? (
        <div className="rounded-3xl p-12 text-center border border-[#E8ECEA] bg-white shadow-sm space-y-3">
          <p className="text-slate-500 text-sm">ไม่พบรายการที่ตรงกับเงื่อนไขการค้นหา &quot;{searchQuery}&quot;</p>
          <button
            onClick={() => {
              setSearchQuery("");
              setSelectedWarehouse("ALL");
            }}
            className="mt-1 px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-bold cursor-pointer transition-colors"
          >
            ล้างตัวกรองทั้งหมด
          </button>
        </div>
      ) : (
        <>
          {/* Desktop: ตารางกระชับ */}
          <div className="hidden md:block bg-white rounded-3xl border border-[#E8ECEA]/90 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="bg-slate-50/70 border-b border-[#EEF1EF] text-slate-500 font-semibold">
                    <th className="py-3.5 px-4 font-semibold whitespace-nowrap">เลขที่เอกสาร</th>
                    <th className="py-3.5 px-4 font-semibold whitespace-nowrap">ผู้ขออนุมัติ</th>
                    <th className="py-3.5 px-4 font-semibold whitespace-nowrap">วันที่</th>
                    <th className="py-3.5 px-4 font-semibold whitespace-nowrap">คลัง</th>
                    <th className="py-3.5 px-4 font-semibold text-right whitespace-nowrap">รายการ</th>
                    <th className="py-3.5 px-4 font-semibold whitespace-nowrap">สถานะ</th>
                    <th className="py-3.5 px-4 font-semibold text-center whitespace-nowrap">ตรวจสอบ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EEF1EF]">
                  {filteredDocs.map((doc, idx) => {
                    const meta = statusMetaFor(doc);
                    return (
                      <tr
                        key={`${doc.document_id}-${idx}`}
                        className="hover:bg-slate-50/80 transition-colors"
                      >
                        <td className="py-3.5 px-4 font-mono font-bold text-[#06402B] whitespace-nowrap">
                          {doc.document_no}
                        </td>
                        <td className="py-3.5 px-4 text-slate-700 font-semibold whitespace-nowrap">
                          {formatUserName(doc.created_by, doc.created_by_name)}
                        </td>
                        <td className="py-3.5 px-4 text-slate-500 font-medium whitespace-nowrap">
                          {formatDocDate(doc)}
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <span className="px-2 py-0.5 rounded-md text-xs font-bold bg-[#EAF2EE] text-[#053425] border border-[#DFEDE6]/80">
                            {doc.target_sheet}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-700 whitespace-nowrap">
                          สินค้า {docSkuCount(doc).toLocaleString()} ชนิด / {docTotalQty(doc).toLocaleString()} ชิ้น
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border whitespace-nowrap ${meta.badge}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                            {meta.label}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-center whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setReviewDoc(doc)}
                            className="px-3.5 py-1.5 rounded-full text-sm font-bold text-[#053425] bg-[#EAF2EE] hover:bg-[#DFEDE6] border border-[#C9DFD4]/90 inline-flex items-center gap-1.5 transition-all shadow-2xs cursor-pointer active:scale-95"
                          >
                            <svg className="w-3.5 h-3.5 text-[#06402B]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                            <span>ตรวจสอบ</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile: การ์ดเอกสาร */}
          <div className="md:hidden space-y-3">
            {filteredDocs.map((doc, idx) => {
              const meta = statusMetaFor(doc);
              return (
                <div key={`${doc.document_id}-m-${idx}`} className="bg-white rounded-2xl border border-[#E8ECEA]/90 shadow-2xs p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono font-bold text-[#06402B] text-sm truncate">{doc.document_no}</p>
                      <p className="text-sm text-slate-500 font-medium mt-0.5">
                        {formatUserName(doc.created_by, doc.created_by_name)} · {formatDocDate(doc)}
                      </p>
                    </div>
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border whitespace-nowrap shrink-0 ${meta.badge}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                      {meta.label}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2 text-sm">
                    <span className="px-2 py-0.5 rounded-md text-xs font-bold bg-[#EAF2EE] text-[#053425] border border-[#DFEDE6]/80">
                      {doc.target_sheet}
                    </span>
                    <span className="font-mono font-bold text-slate-700">
                      สินค้า {docSkuCount(doc).toLocaleString()} ชนิด / {docTotalQty(doc).toLocaleString()} ชิ้น
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setReviewDoc(doc)}
                    className="mt-3 w-full py-2.5 rounded-xl text-sm font-bold text-[#053425] bg-[#EAF2EE] hover:bg-[#DFEDE6] border border-[#C9DFD4]/90 transition-all cursor-pointer active:scale-95"
                  >
                    ตรวจสอบเอกสาร
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Review Document Modal */}
      {reviewDoc && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div role="dialog" aria-modal="true" aria-labelledby="review-dialog-title" className="bg-white rounded-3xl border border-[#E8ECEA] shadow-2xl w-full max-w-4xl my-auto max-h-[92dvh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95">
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-[#EEF1EF] flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 id="review-dialog-title" className="text-base sm:text-lg font-black text-slate-900 font-mono">{reviewDoc.document_no}</h3>
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border whitespace-nowrap ${statusMetaFor(reviewDoc).badge}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${statusMetaFor(reviewDoc).dot}`} />
                    {statusMetaFor(reviewDoc).label}
                  </span>
                </div>
                <p className="text-sm text-slate-500 font-medium mt-1">
                  ผู้ขออนุมัติ: <strong className="text-slate-700">{formatUserName(reviewDoc.created_by, reviewDoc.created_by_name)}</strong>
                  <span className="mx-1.5 text-slate-300">·</span>
                  {formatDocDate(reviewDoc)}
                  <span className="mx-1.5 text-slate-300">·</span>
                  คลังเป้าหมาย: <strong className="text-slate-700">{reviewDoc.target_sheet}</strong>
                </p>

              </div>
              <button
                type="button"
                onClick={() => setReviewDoc(null)}
                aria-label="ปิดหน้าต่างตรวจสอบ"
                className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer transition-colors shrink-0"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Items */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
              <span className="text-sm font-extrabold text-slate-700">
                รายการสินค้า (สินค้า {docSkuCount(reviewDoc).toLocaleString()} ชนิด / {docTotalQty(reviewDoc).toLocaleString()} ชิ้น)
              </span>
              {renderReviewItems(reviewDoc)}
            </div>

            {/* Modal Footer */}
            <div className="p-4 sm:px-5 border-t border-[#EEF1EF] flex items-center justify-end gap-2.5 bg-slate-50/60">
              <div className="grid grid-cols-2 sm:flex sm:items-center gap-2.5 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => openEditModal(reviewDoc)}
                  className="px-4 py-2.5 rounded-xl bg-white hover:bg-slate-100 border border-[#E8ECEA] text-slate-700 font-bold text-sm transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95"
                >
                  <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  <span>แก้ไขเอกสาร</span>
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmAction({ type: "reject", doc: reviewDoc })}
                  className="px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-sm transition-all flex items-center justify-center gap-2 cursor-pointer shadow-xs active:scale-95"
                >
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  <span>ไม่อนุมัติ</span>
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmAction({ type: "approve", doc: reviewDoc })}
                  className="col-span-2 sm:col-span-1 px-4 py-2.5 rounded-xl bg-[#06402B] hover:bg-[#053425] text-white font-extrabold text-sm transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md shadow-[#06402B]/20 active:scale-95"
                >
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                  <span>อนุมัติ</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Action Modal */}
      {confirmAction && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title" className="bg-white rounded-3xl p-6 w-full max-w-md border border-[#E8ECEA] space-y-4 shadow-2xl">
            <div className="flex items-start gap-3">
              <span
                className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${
                  confirmAction.type === "approve"
                    ? "bg-[#EAF2EE] text-[#06402B] border border-[#C9DFD4]"
                    : "bg-rose-50 text-rose-600 border border-rose-200"
                }`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {confirmAction.type === "approve" ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  )}
                </svg>
              </span>
              <div>
                <h4 id="confirm-dialog-title" className="text-base font-black text-slate-900">
                  {confirmAction.type === "approve" ? "ยืนยันอนุมัติการรับเข้า?" : "ยืนยันไม่อนุมัติเอกสารนี้?"}
                </h4>
                <p className="text-sm text-slate-500 font-medium mt-1 leading-relaxed">
                  {confirmAction.doc.document_no} · สินค้า {docSkuCount(confirmAction.doc).toLocaleString()} ชนิด /{" "}
                  {docTotalQty(confirmAction.doc).toLocaleString()} ชิ้น
                </p>
                <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                  {confirmAction.type === "approve"
                    ? "เมื่อยืนยัน ระบบจะเพิ่มยอดสินค้าเข้าคลังและส่งรายการต่อไปยังคิวนำเข้า Express"
                    : "เอกสารจะถูกนำออกจากคิวรออนุมัติ โดยไม่มีการเพิ่มยอดสินค้าเข้าคลัง"}
                </p>
              </div>
            </div>
            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                className="flex-1 py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm transition-all cursor-pointer border border-[#E8ECEA]"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                disabled={actionLoading === confirmAction.doc.document_id}
                onClick={() => {
                  const { type, doc } = confirmAction;
                  setConfirmAction(null);
                  setReviewDoc(null);
                  if (type === "approve") handleApprove(doc);
                  else handleReject(doc);
                }}
                className={`flex-1 py-3 rounded-2xl text-white font-extrabold text-sm transition-all disabled:opacity-50 cursor-pointer shadow-md active:scale-95 ${
                  confirmAction.type === "approve"
                    ? "bg-[#06402B] hover:bg-[#053425] shadow-[#06402B]/20"
                    : "bg-rose-600 hover:bg-rose-700 shadow-rose-600/20"
                }`}
              >
                {confirmAction.type === "approve" ? "ยืนยันอนุมัติ" : "ยืนยันไม่อนุมัติ"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Document Modal */}
      {editingDoc && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div role="dialog" aria-modal="true" aria-labelledby="edit-dialog-title" className="bg-white rounded-2xl border border-[#E8ECEA] shadow-2xl w-full max-w-5xl my-auto max-h-[92dvh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95">
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-[#E8ECEA] flex items-center justify-between bg-slate-50">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2.5">
                  <span
                    aria-hidden="true"
                    className="w-9 h-9 rounded-xl bg-amber-50 text-amber-700 border border-amber-200 flex items-center justify-center shrink-0"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </span>
                  <div>
                    <h3 id="edit-dialog-title" className="text-base font-extrabold text-slate-900 leading-snug">
                      แก้ไขเอกสารรับเข้า <span className="font-mono whitespace-nowrap">{editingDoc.document_no}</span>
                    </h3>
                    <p className="text-sm text-slate-500 font-medium">
                      ปรับเปลี่ยนข้อมูลสินค้า จำนวน หรือตำแหน่งจัดเก็บก่อนทำการอนุมัติ
                    </p>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  if (!isSavingEdit) setEditingDoc(null);
                }}
                disabled={isSavingEdit}
                aria-label="ปิดหน้าต่างแก้ไข"
                className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-200 cursor-pointer transition-colors shrink-0"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Meta Settings (Warehouse & Date) */}
            <div className="p-4 sm:px-6 bg-slate-50/50 border-b border-[#E8ECEA] grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1.5">
                  โกดังเป้าหมาย
                </label>
                <select
                  value={editWarehouse}
                  onChange={(e) => setEditWarehouse(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-xl border border-[#D5DDD9] bg-white font-bold text-slate-800 focus:ring-2 focus:ring-[#0F5C3F] focus:outline-hidden"
                >
                  <option value="โกดัง1">โกดัง1</option>
                  <option value="โกดัง2">โกดัง2</option>
                  <option value="โกดัง3">โกดัง3</option>
                  <option value="โกดัง4">โกดัง4</option>
                  <option value="โกดัง5">โกดัง5</option>
                  <option value="สำนักงานใหญ่">สำนักงานใหญ่</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1.5">
                  วันที่เอกสาร
                </label>
                <input
                  type="date"
                  value={editDocDate}
                  onChange={(e) => setEditDocDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-xl border border-[#D5DDD9] bg-white font-medium text-slate-800 focus:ring-2 focus:ring-[#0F5C3F] focus:outline-hidden"
                />
              </div>
            </div>

            {/* Modal Items Table */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm font-bold text-slate-700 uppercase tracking-wider">
                  รายการสินค้าในเอกสาร ({editRows.length} รายการ)
                </span>
                <button
                  type="button"
                  onClick={handleAddRow}
                  className="px-3 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 font-bold text-sm flex items-center gap-1.5 cursor-pointer transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 5v14M5 12h14" />
                  </svg>
                  <span>เพิ่มรายการ</span>
                </button>
              </div>

              {/* ข้อความผิดพลาดของฟอร์ม — บอกว่าแถวไหนผิดและแก้อย่างไร */}
              {editError && (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 rounded-xl bg-rose-50 border border-rose-200 px-3.5 py-3 text-rose-800"
                >
                  <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
                  </svg>
                  <p className="text-sm font-bold leading-relaxed">{editError}</p>
                </div>
              )}

              {/* Desktop: ตารางแก้ไข */}
              <div className="hidden sm:block overflow-x-auto rounded-xl border border-[#E8ECEA]">
                <table className="w-full text-left text-sm min-w-[820px]">
                  <thead>
                    <tr className="bg-slate-50/70 text-slate-500 border-b border-[#EEF1EF]">
                      <th className="py-2.5 px-3 font-semibold w-32">รหัสสินค้า (SKU)</th>
                      <th className="py-2.5 px-3 font-semibold">ชื่อสินค้า</th>
                      <th className="py-2.5 px-3 font-semibold w-28">ตำแหน่ง</th>
                      <th className="py-2.5 px-3 font-semibold w-32">บาร์โค้ด</th>
                      <th className="py-2.5 px-3 font-semibold w-36">ผู้จำหน่าย</th>
                      <th className="py-2.5 px-3 font-semibold text-center w-24">จำนวน</th>
                      <th className="py-2.5 px-2 text-center w-10">
                        <span className="sr-only">ลบรายการ</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E8ECEA]">
                    {editRows.map((row, rIdx) => {
                      const skuBad = Boolean(editError) && isRowSkuMissing(row);
                      const qtyBad = Boolean(editError) && isRowQtyInvalid(row);
                      const canDelete = editRows.length > 1;
                      return (
                        <tr key={rIdx} className="hover:bg-slate-50/70">
                          {/* SKU */}
                          <td className="p-2">
                            <input
                              type="text"
                              value={row[0] || ""}
                              onChange={(e) => handleRowChange(rIdx, 0, e.target.value)}
                              placeholder="รหัส SKU"
                              aria-label={`รหัสสินค้า (SKU) รายการที่ ${rIdx + 1}`}
                              aria-invalid={skuBad || undefined}
                              className={editInputClass(skuBad, true)}
                            />
                          </td>
                          {/* Name */}
                          <td className="p-2">
                            <input
                              type="text"
                              value={row[3] || ""}
                              onChange={(e) => handleRowChange(rIdx, 3, e.target.value)}
                              placeholder="ชื่อสินค้า"
                              aria-label={`ชื่อสินค้า รายการที่ ${rIdx + 1}`}
                              className={editInputClass(false, false)}
                            />
                          </td>
                          {/* Location */}
                          <td className="p-2">
                            <input
                              type="text"
                              value={row[1] === "-" ? "" : row[1]}
                              onChange={(e) => handleRowChange(rIdx, 1, e.target.value)}
                              placeholder="ตำแหน่ง"
                              aria-label={`ตำแหน่งจัดเก็บ รายการที่ ${rIdx + 1}`}
                              className={editInputClass(false, true)}
                            />
                          </td>
                          {/* Barcode */}
                          <td className="p-2">
                            <input
                              type="text"
                              value={row[2] || ""}
                              onChange={(e) => handleRowChange(rIdx, 2, e.target.value)}
                              placeholder="บาร์โค้ด"
                              aria-label={`บาร์โค้ด รายการที่ ${rIdx + 1}`}
                              className={editInputClass(false, true)}
                            />
                          </td>
                          {/* Supplier */}
                          <td className="p-2">
                            <input
                              type="text"
                              value={row[6] === "-" ? "" : row[6]}
                              onChange={(e) => handleRowChange(rIdx, 6, e.target.value)}
                              placeholder="ผู้จำหน่าย"
                              aria-label={`ผู้จำหน่าย รายการที่ ${rIdx + 1}`}
                              className={editInputClass(false, false)}
                            />
                          </td>
                          {/* Quantity */}
                          <td className="p-2">
                            <input
                              type="number"
                              min="1"
                              value={row[4]}
                              onChange={(e) => handleRowChange(rIdx, 4, e.target.value)}
                              aria-label={`จำนวนสินค้า รายการที่ ${rIdx + 1}`}
                              aria-invalid={qtyBad || undefined}
                              className={`${editInputClass(qtyBad, true)} text-center`}
                            />
                          </td>
                          {/* Delete Row */}
                          <td className="p-2 text-center">
                            <button
                              type="button"
                              onClick={() => handleDeleteRow(rIdx)}
                              disabled={!canDelete}
                              aria-label={`ลบรายการที่ ${rIdx + 1}`}
                              title={canDelete ? "ลบรายการนี้" : "เอกสารต้องมีสินค้าอย่างน้อย 1 รายการ"}
                              className="w-7 h-7 rounded-lg text-rose-500 hover:text-rose-700 hover:bg-rose-50 flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile: ฟอร์มแบบการ์ด */}
              <div className="sm:hidden space-y-3">
                {editRows.map((row, rIdx) => {
                  const skuBad = Boolean(editError) && isRowSkuMissing(row);
                  const qtyBad = Boolean(editError) && isRowQtyInvalid(row);
                  const canDelete = editRows.length > 1;
                  return (
                    <div key={rIdx} className="rounded-xl border border-[#E8ECEA] p-3 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold text-slate-400 uppercase tracking-wider">
                          รายการที่ {rIdx + 1}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleDeleteRow(rIdx)}
                          disabled={!canDelete}
                          aria-label={`ลบรายการที่ ${rIdx + 1}`}
                          title={canDelete ? "ลบรายการนี้" : "เอกสารต้องมีสินค้าอย่างน้อย 1 รายการ"}
                          className="w-7 h-7 rounded-lg text-rose-500 hover:text-rose-700 hover:bg-rose-50 flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                      <div>
                        <label className="block text-sm font-bold text-slate-500 mb-1">รหัสสินค้า (SKU) *</label>
                        <input
                          type="text"
                          value={row[0] || ""}
                          onChange={(e) => handleRowChange(rIdx, 0, e.target.value)}
                          placeholder="รหัส SKU"
                          aria-label={`รหัสสินค้า (SKU) รายการที่ ${rIdx + 1}`}
                          aria-invalid={skuBad || undefined}
                          className={editInputClass(skuBad, true)}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-bold text-slate-500 mb-1">ชื่อสินค้า</label>
                        <input
                          type="text"
                          value={row[3] || ""}
                          onChange={(e) => handleRowChange(rIdx, 3, e.target.value)}
                          placeholder="ชื่อสินค้า"
                          aria-label={`ชื่อสินค้า รายการที่ ${rIdx + 1}`}
                          className={editInputClass(false, false)}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2.5">
                        <div>
                          <label className="block text-sm font-bold text-slate-500 mb-1">ตำแหน่ง</label>
                          <input
                            type="text"
                            value={row[1] === "-" ? "" : row[1]}
                            onChange={(e) => handleRowChange(rIdx, 1, e.target.value)}
                            placeholder="ตำแหน่ง"
                            aria-label={`ตำแหน่งจัดเก็บ รายการที่ ${rIdx + 1}`}
                            className={editInputClass(false, true)}
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-slate-500 mb-1">บาร์โค้ด</label>
                          <input
                            type="text"
                            value={row[2] || ""}
                            onChange={(e) => handleRowChange(rIdx, 2, e.target.value)}
                            placeholder="บาร์โค้ด"
                            aria-label={`บาร์โค้ด รายการที่ ${rIdx + 1}`}
                            className={editInputClass(false, true)}
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-bold text-slate-500 mb-1">ผู้จำหน่าย</label>
                        <input
                          type="text"
                          value={row[6] === "-" ? "" : row[6]}
                          onChange={(e) => handleRowChange(rIdx, 6, e.target.value)}
                          placeholder="ผู้จำหน่าย"
                          aria-label={`ผู้จำหน่าย รายการที่ ${rIdx + 1}`}
                          className={editInputClass(false, false)}
                        />
                      </div>
                      <div className="w-28">
                        <label className="block text-sm font-bold text-slate-500 mb-1">จำนวน</label>
                        <input
                          type="number"
                          min="1"
                          value={row[4]}
                          onChange={(e) => handleRowChange(rIdx, 4, e.target.value)}
                          aria-label={`จำนวนสินค้า รายการที่ ${rIdx + 1}`}
                          aria-invalid={qtyBad || undefined}
                          className={`${editInputClass(qtyBad, true)} text-center`}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 sm:px-6 border-t border-[#E8ECEA] bg-slate-50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <span className="text-sm text-slate-500 leading-relaxed">
                รวมทั้งหมด <strong className="text-slate-800">{editRows.length}</strong> รายการ | ยอดรวม{" "}
                <strong className="text-slate-900 font-mono tabular-nums">
                  {editRows.reduce((sum, r) => sum + (Number(r[4]) || 0), 0).toLocaleString()}
                </strong>{" "}
                ชิ้น
              </span>

              <div className="grid grid-cols-2 sm:flex sm:items-center gap-2.5 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => setEditingDoc(null)}
                  disabled={isSavingEdit}
                  className="px-4 py-2.5 rounded-xl text-slate-600 hover:bg-slate-200 font-bold text-sm cursor-pointer transition-colors"
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  disabled={isSavingEdit}
                  className="px-5 py-2.5 rounded-xl bg-[#06402B] hover:bg-[#053425] text-white font-bold text-sm transition-all disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer shadow-md shadow-[#06402B]/20 active:scale-95 whitespace-nowrap"
                >
                  {isSavingEdit ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>กำลังบันทึก...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span>บันทึกการแก้ไข</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

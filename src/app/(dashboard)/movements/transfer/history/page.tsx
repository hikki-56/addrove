"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { useTabAuth } from "@/context/TabAuthContext";
import { getWarehouseName, normalizeWarehouseId } from "@/lib/warehouse-utils";
import {
  getTransferNotifications,
  getDisplayProductName,
  isTransferCompleted,
  parseTransferMetadata,
  purgeInvalidNotifications,
} from "@/lib/transfer-notification-utils";
import type { Product, Warehouse } from "@/types/models";

export interface TransferHistoryRecord {
  id: string;
  doc_no: string;
  reference_no: string;
  barcode: string;
  sku: string;
  product_id: string;
  product_name: string;
  from_warehouse_id: string;
  from_warehouse_name: string;
  to_warehouse_id: string;
  to_warehouse_name: string;
  qty: number;
  base_unit: string;
  created_by_name: string;
  created_by: string;
  moved_by: string;
  assigned_to_name: string;
  assigned_to_user_id: string;
  status: "PENDING" | "ACKNOWLEDGED" | "WAITING_APPROVAL" | "COMPLETED" | "CANCELLED" | "REJECTED";
  created_at: string;
  document_date: string;
  from_location_id?: string;
  to_location_id?: string;
  source_allocations?: Array<{ location_id: string; location_name?: string; qty: number }>;
  note?: string;
  original_note?: string;
}

export default function TransferHistoryPage() {
  const { user } = useTabAuth();

  // Data states
  const [records, setRecords] = useState<TransferHistoryRecord[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Filter states
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<string>("ALL");
  const [selectedFromWh, setSelectedFromWh] = useState<string>("ALL");
  const [selectedToWh, setSelectedToWh] = useState<string>("ALL");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  // Detail Modal state
  const [selectedRecord, setSelectedRecord] = useState<TransferHistoryRecord | null>(null);
  const [copySuccess, setCopySuccess] = useState<string | null>(null);

  // Fetch all transfer records, products, and warehouses
  const loadData = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setIsRefreshing(true);
    try {
      purgeInvalidNotifications();

      // 1. Fetch products & warehouses for data enrichment
      const [prodsRes, whsRes] = await Promise.allSettled([
        fetch("/api/products").then((r) => (r.ok ? r.json() : { data: [] })),
        fetch("/api/warehouses").then((r) => (r.ok ? r.json() : { data: [] })),
      ]);

      const loadedProducts: Product[] =
        prodsRes.status === "fulfilled" && Array.isArray(prodsRes.value.data)
          ? prodsRes.value.data
          : [];
      const loadedWarehouses: Warehouse[] =
        whsRes.status === "fulfilled" && Array.isArray(whsRes.value.data)
          ? whsRes.value.data
          : [];

      setProducts(loadedProducts);
      setWarehouses(loadedWarehouses);

      // Create quick lookup maps for fast enrichment
      const prodMapBySku = new Map<string, Product>();
      const prodMapById = new Map<string, Product>();
      const prodMapByBarcode = new Map<string, Product>();

      for (const p of loadedProducts) {
        if (p.sku) prodMapBySku.set(p.sku.trim().toLowerCase(), p);
        if (p.product_id) prodMapById.set(p.product_id.trim().toLowerCase(), p);
        if (p.barcode) prodMapByBarcode.set(p.barcode.trim().toLowerCase(), p);
      }

      // 2. Fetch server transfer documents
      const storedToken =
        typeof window !== "undefined"
          ? sessionStorage.getItem("stockify_tab_token") ||
            localStorage.getItem("stockify_tab_token") ||
            (function () {
              try {
                return JSON.parse(sessionStorage.getItem("stockify_tab_session") || "{}")?.token;
              } catch {
                return null;
              }
            })()
          : null;

      const headers: Record<string, string> = {};
      if (storedToken) {
        headers["x-tab-token"] = storedToken;
        headers["Authorization"] = `Bearer ${storedToken}`;
      }

      let serverDocs: any[] = [];
      try {
        const res = await fetch(`/api/movements/transfer?_t=${Date.now()}`, { headers, cache: "no-store" });
        if (res.ok) {
          const json = await res.json();
          if (json.success && Array.isArray(json.data)) {
            serverDocs = json.data;
          }
        }
      } catch (err) {
        console.warn("[TransferHistory] Server fetch error:", err);
      }

      // 3. Get local notifications for optimistic and recent transfers
      const localNotifs = getTransferNotifications();

      // 4. Map & Enrich all records
      const recordMap = new Map<string, TransferHistoryRecord>();

      // A. Process server documents
      for (const doc of serverDocs) {
        if (!doc) continue;
        const docId = String(doc.document_id || doc.document_no || "").trim();
        if (!docId) continue;

        const meta = parseTransferMetadata(doc.note);

        const rawProdId = String(meta.product_id || doc.product_id || "").trim();
        const rawSku = String(meta.sku || doc.sku || (rawProdId.startsWith("prod-") ? rawProdId.replace(/^prod-/, "") : ""));
        const rawBarcode = String(meta.barcode || doc.barcode || "");

        // Product fallback enrichment
        const matchedProduct =
          (rawSku ? prodMapBySku.get(rawSku.toLowerCase()) : undefined) ||
          (rawProdId ? prodMapById.get(rawProdId.toLowerCase()) : undefined) ||
          (rawBarcode ? prodMapByBarcode.get(rawBarcode.toLowerCase()) : undefined);

        const sku = rawSku || matchedProduct?.sku || (rawProdId && !rawProdId.startsWith("trf") ? rawProdId : "-");
        const barcode = rawBarcode || matchedProduct?.barcode || "-";
        const productName =
          String(meta.product_name || doc.product_name || matchedProduct?.product_name || (sku !== "-" ? `สินค้า ${sku}` : "รายการเบิกสินค้า")).trim();
        const baseUnit = String(meta.base_unit || doc.base_unit || matchedProduct?.base_unit || "ชิ้น").trim();

        const fromWhId = normalizeWarehouseId(meta.from_warehouse_id || doc.from_warehouse_id || "wh-01");
        const toWhId = normalizeWarehouseId(meta.to_warehouse_id || doc.to_warehouse_id || "wh-02");
        const fromWhName = getWarehouseName(fromWhId);
        const toWhName = getWarehouseName(toWhId);

        const qty = Number(meta.qty !== undefined && meta.qty !== null ? meta.qty : (doc.qty || 1));
        const rawMovedBy = String(
          meta.moved_by ||
          meta.assigned_to_name ||
          doc.assigned_to_name ||
          doc.moved_by ||
          ""
        ).trim();

        const movedBy =
          rawMovedBy && rawMovedBy !== "null" && rawMovedBy !== "undefined" && rawMovedBy !== "-"
            ? rawMovedBy
            : "-";

        const createdBy = String(meta.created_by || doc.created_by || "").trim();
        const rawCreatedByName = String(
          meta.created_by_name ||
          doc.created_by_name ||
          (createdBy && !createdBy.toLowerCase().includes("admin") && !createdBy.startsWith("usr-") ? createdBy : "") ||
          ""
        ).trim();
        const createdByName = rawCreatedByName || "ผู้ดูแลระบบ (Admin)";

        let status = (doc.status || "PENDING").toUpperCase() as TransferHistoryRecord["status"];
        if (isTransferCompleted(docId) || isTransferCompleted(doc.document_no)) {
          status = "COMPLETED";
        }

        const item: TransferHistoryRecord = {
          id: docId,
          doc_no: doc.document_no || docId,
          reference_no: doc.reference_no || meta.reference_no || "-",
          barcode: barcode !== "-" && barcode.trim() ? barcode.trim() : (sku !== "-" ? sku : "-"),
          sku: sku,
          product_id: rawProdId || matchedProduct?.product_id || "",
          product_name: getDisplayProductName({ product_name: productName, note: doc.note, sku }),
          from_warehouse_id: fromWhId,
          from_warehouse_name: fromWhName,
          to_warehouse_id: toWhId,
          to_warehouse_name: toWhName,
          qty: qty,
          base_unit: baseUnit,
          created_by: createdBy || "admin",
          created_by_name: createdByName,
          moved_by: movedBy,
          assigned_to_name: String(meta.assigned_to_name || doc.assigned_to_name || movedBy).trim(),
          assigned_to_user_id: String(meta.assigned_to_user_id || doc.assigned_to_user_id || "").trim(),
          status: status,
          created_at: String(doc.created_at || new Date().toISOString()),
          document_date: doc.document_date || meta.document_date || String(doc.created_at || "").slice(0, 10),
          from_location_id: meta.from_location_id || undefined,
          to_location_id: meta.to_location_id || undefined,
          source_allocations: meta.source_allocations || undefined,
          note: doc.note,
          original_note: meta.original_note || (typeof doc.note === "string" && !doc.note.startsWith("{") ? doc.note : undefined),
        };

        recordMap.set(docId.toLowerCase(), item);
        if (doc.document_no) {
          recordMap.set(doc.document_no.toLowerCase(), item);
        }
      }

      // B. Merge local storage transfer notifications (ONLY for un-synced/optimistic items)
      for (const notif of localNotifs) {
        if (!notif || !notif.id) continue;
        const key = notif.id.toLowerCase();
        const docNoKey = notif.doc_no ? notif.doc_no.toLowerCase() : "";
        const existing = recordMap.get(key) || (docNoKey ? recordMap.get(docNoKey) : undefined);

        // Server record already exists -> Never let stale/dummy localStorage overwrite valid server data
        if (existing) {
          if (notif.status === "COMPLETED" && existing.status !== "COMPLETED") {
            existing.status = "COMPLETED";
          }
          if (notif.moved_by && notif.moved_by !== "-" && notif.moved_by !== "พนักงาน" && (!existing.moved_by || existing.moved_by === "-")) {
            existing.moved_by = notif.moved_by;
          }
          continue;
        }

        const rawProdId = notif.product_id || "";
        const rawSku = notif.sku || (rawProdId.startsWith("prod-") ? rawProdId.replace(/^prod-/, "") : "");
        const rawBarcode = notif.barcode || "";

        const matchedProduct =
          (rawSku ? prodMapBySku.get(rawSku.toLowerCase()) : undefined) ||
          (rawProdId ? prodMapById.get(rawProdId.toLowerCase()) : undefined) ||
          (rawBarcode ? prodMapByBarcode.get(rawBarcode.toLowerCase()) : undefined);

        const sku = notif.sku || matchedProduct?.sku || "-";
        const barcode =
          notif.barcode && notif.barcode.trim() !== "-"
            ? notif.barcode.trim()
            : matchedProduct?.barcode || "-";
        const productName =
          notif.product_name ||
          matchedProduct?.product_name ||
          (sku !== "-" ? `สินค้า ${sku}` : "รายการเบิกสินค้า");
        const baseUnit = matchedProduct?.base_unit || "ชิ้น";

        const fromWhId = normalizeWarehouseId(notif.from_warehouse_id || "wh-01");
        const toWhId = normalizeWarehouseId(notif.to_warehouse_id || "wh-02");
        const fromWhName = notif.from_warehouse_name || getWarehouseName(fromWhId);
        const toWhName = notif.to_warehouse_name || getWarehouseName(toWhId);

        let status = notif.status || "PENDING";
        if (isTransferCompleted(notif.id) || (notif.doc_no && isTransferCompleted(notif.doc_no))) {
          status = "COMPLETED";
        }

        const merged: TransferHistoryRecord = {
          id: notif.id,
          doc_no: notif.doc_no || notif.id,
          reference_no: "-",
          barcode: barcode !== "-" && barcode.trim() ? barcode.trim() : (sku !== "-" ? sku : "-"),
          sku: sku,
          product_id: rawProdId || matchedProduct?.product_id || "",
          product_name: getDisplayProductName({ product_name: productName, note: notif.note, sku }),
          from_warehouse_id: fromWhId,
          from_warehouse_name: fromWhName,
          to_warehouse_id: toWhId,
          to_warehouse_name: toWhName,
          qty: Number(notif.qty) || 1,
          base_unit: baseUnit,
          created_by: notif.created_by || "admin",
          created_by_name: notif.created_by_name || "ผู้ดูแลระบบ (Admin)",
          moved_by: notif.moved_by || "-",
          assigned_to_name: notif.assigned_to_name || notif.moved_by || "",
          assigned_to_user_id: notif.assigned_to_user_id || "",
          status: status,
          created_at: notif.created_at || new Date().toISOString(),
          document_date: String(notif.created_at || "").slice(0, 10),
          from_location_id: notif.from_location_id,
          to_location_id: notif.to_location_id,
          source_allocations: notif.source_allocations,
          note: notif.note,
        };

        recordMap.set(key, merged);
      }

      // 5. Unique records list sorted by newest first
      const uniqueRecords = Array.from(
        new Map(Array.from(recordMap.values()).map((r) => [r.id.toLowerCase(), r])).values()
      );

      uniqueRecords.sort((a, b) => {
        const timeA = new Date(a.created_at || 0).getTime();
        const timeB = new Date(b.created_at || 0).getTime();
        if (timeB !== timeA) return timeB - timeA;
        return (b.doc_no || "").localeCompare(a.doc_no || "");
      });

      setRecords(uniqueRecords);
    } catch (e) {
      console.error("[TransferHistory] Load data error:", e);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();

    // Event listeners for real-time live sync
    const handleUpdate = () => loadData();
    window.addEventListener("stockify-transfer-updated", handleUpdate);
    window.addEventListener("stockify-transfer-created", handleUpdate);
    window.addEventListener("storage", handleUpdate);

    // Broadcast channel
    let syncChannel: BroadcastChannel | null = null;
    if (typeof window !== "undefined" && "BroadcastChannel" in window) {
      try {
        syncChannel = new BroadcastChannel("stockify_transfer_sync");
        syncChannel.onmessage = () => loadData();
      } catch {}
    }

    return () => {
      window.removeEventListener("stockify-transfer-updated", handleUpdate);
      window.removeEventListener("stockify-transfer-created", handleUpdate);
      window.removeEventListener("storage", handleUpdate);
      syncChannel?.close();
    };
  }, [loadData]);

  // Copy to clipboard helper
  const handleCopy = (text: string, label: string) => {
    if (!text || text === "-") return;
    navigator.clipboard.writeText(text);
    setCopySuccess(label);
    setTimeout(() => setCopySuccess(null), 2000);
  };

  // Filtered & Searched Data
  const filteredRecords = useMemo(() => {
    return records.filter((item) => {
      // 1. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchDocNo = item.doc_no?.toLowerCase().includes(q);
        const matchRefNo = item.reference_no?.toLowerCase().includes(q);
        const matchBarcode = item.barcode?.toLowerCase().includes(q);
        const matchSku = item.sku?.toLowerCase().includes(q);
        const matchProdName = item.product_name?.toLowerCase().includes(q);
        const matchCreatedBy = item.created_by_name?.toLowerCase().includes(q);
        const matchMovedBy = item.moved_by?.toLowerCase().includes(q) || item.assigned_to_name?.toLowerCase().includes(q);
        const matchFromWh = item.from_warehouse_name?.toLowerCase().includes(q);
        const matchToWh = item.to_warehouse_name?.toLowerCase().includes(q);

        if (!matchDocNo && !matchRefNo && !matchBarcode && !matchSku && !matchProdName && !matchCreatedBy && !matchMovedBy && !matchFromWh && !matchToWh) {
          return false;
        }
      }

      // 2. Status Filter
      if (selectedStatus !== "ALL") {
        if (selectedStatus === "COMPLETED" && item.status !== "COMPLETED") return false;
        if (selectedStatus === "WAITING_APPROVAL" && item.status !== "WAITING_APPROVAL") return false;
        if (selectedStatus === "PENDING" && item.status !== "PENDING" && item.status !== "ACKNOWLEDGED") return false;
        if (selectedStatus === "CANCELLED" && item.status !== "CANCELLED" && item.status !== "REJECTED") return false;
      }

      // 3. Source Warehouse Filter
      if (selectedFromWh !== "ALL" && item.from_warehouse_id !== selectedFromWh) {
        return false;
      }

      // 4. Destination Warehouse Filter
      if (selectedToWh !== "ALL" && item.to_warehouse_id !== selectedToWh) {
        return false;
      }

      // 5. Date Range Filter
      if (dateFrom) {
        const itemDate = (item.created_at || item.document_date || "").slice(0, 10);
        if (itemDate < dateFrom) return false;
      }
      if (dateTo) {
        const itemDate = (item.created_at || item.document_date || "").slice(0, 10);
        if (itemDate > dateTo) return false;
      }

      return true;
    });
  }, [records, searchQuery, selectedStatus, selectedFromWh, selectedToWh, dateFrom, dateTo]);

  // Statistics summaries
  const stats = useMemo(() => {
    const total = records.length;
    const totalUnits = records.reduce((acc, r) => acc + (Number(r.qty) || 0), 0);
    const completed = records.filter((r) => r.status === "COMPLETED").length;
    const waitingApproval = records.filter((r) => r.status === "WAITING_APPROVAL").length;
    const pending = records.filter((r) => r.status === "PENDING" || r.status === "ACKNOWLEDGED").length;
    const cancelled = records.filter((r) => r.status === "CANCELLED" || r.status === "REJECTED").length;

    return { total, totalUnits, completed, waitingApproval, pending, cancelled };
  }, [records]);

  // Pagination logic
  const totalPages = Math.ceil(filteredRecords.length / pageSize) || 1;
  const paginatedRecords = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredRecords.slice(start, start + pageSize);
  }, [filteredRecords, currentPage, pageSize]);

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  // Reset all filters
  const handleResetFilters = () => {
    setSearchQuery("");
    setSelectedStatus("ALL");
    setSelectedFromWh("ALL");
    setSelectedToWh("ALL");
    setDateFrom("");
    setDateTo("");
    setCurrentPage(1);
  };

  // Export to CSV
  const handleExportCSV = () => {
    if (filteredRecords.length === 0) {
      alert("ไม่มีข้อมูลสำหรับส่งออก");
      return;
    }

    const headers = [
      "ลำดับ",
      "เลขที่เอกสาร",
      "บาร์โค้ด",
      "รหัสสินค้า",
      "ชื่อสินค้า",
      "โกดังต้นทาง",
      "โกดังปลายทาง",
      "จำนวน",
      "หน่วย",
      "คนสร้าง",
      "คนเบิก",
      "สถานะ",
      "วันที่สร้าง",
    ];

    const rows = filteredRecords.map((item, index) => [
      index + 1,
      `"${item.doc_no || "-"}"`,
      `"\t${item.barcode || "-"}"`,
      `"${item.sku || "-"}"`,
      `"${(item.product_name || "-").replace(/"/g, '""')}"`,
      `"${item.from_warehouse_name || "-"}"`,
      `"${item.to_warehouse_name || "-"}"`,
      item.qty || 0,
      `"${item.base_unit || "ชิ้น"}"`,
      `"${item.created_by_name || "-"}"`,
      `"${item.moved_by || item.assigned_to_name || "-"}"`,
      `"${
        item.status === "COMPLETED"
          ? "เบิกสำเร็จ"
          : item.status === "WAITING_APPROVAL"
          ? "รออนุมัติ"
          : item.status === "CANCELLED"
          ? "ยกเลิก"
          : item.status === "REJECTED"
          ? "ปฏิเสธ"
          : "รอดำเนินการ"
      }"`,
      `"${new Date(item.created_at).toLocaleString("th-TH")}"`,
    ]);

    const csvContent =
      "\uFEFF" + [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute(
      "download",
      `transfer_history_${new Date().toISOString().slice(0, 10)}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Status Badge Component
  const renderStatusBadge = (status: TransferHistoryRecord["status"]) => {
    switch (status) {
      case "COMPLETED":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"></span>
            <span>เบิกสำเร็จ</span>
          </span>
        );
      case "WAITING_APPROVAL":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-300 whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0"></span>
            <span>รออนุมัติ</span>
          </span>
        );
      case "CANCELLED":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-slate-100 text-slate-600 border border-slate-200 whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0"></span>
            <span>ยกเลิก</span>
          </span>
        );
      case "REJECTED":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200 whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0"></span>
            <span>ปฏิเสธ</span>
          </span>
        );
      case "PENDING":
      case "ACKNOWLEDGED":
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0"></span>
            <span>รอดำเนินการ</span>
          </span>
        );
    }
  };

  return (
    <div className="w-full max-w-full space-y-4 sm:space-y-5">
      {/* Toast Copy Success Notification */}
      {copySuccess && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-4 py-2.5 rounded-xl shadow-lg text-xs font-semibold flex items-center gap-2 animate-bounce">
          <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
          <span>คัดลอก {copySuccess} เรียบร้อย</span>
        </div>
      )}

      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-purple-50 border border-purple-200 text-purple-700 flex items-center justify-center shadow-xs">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight">
                ประวัติเบิกสินค้า
              </h1>
              <p className="text-xs text-slate-500 font-normal">
                บันทึกและประวัติรายการเบิก-โอนย้ายสินค้าทั้งหมดในระบบ
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => loadData(true)}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-xs transition-all cursor-pointer disabled:opacity-50"
            title="รีเฟรชข้อมูล"
          >
            <svg
              className={`w-3.5 h-3.5 text-slate-500 ${isRefreshing ? "animate-spin text-purple-600" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>{isRefreshing ? "กำลังโหลด..." : "รีเฟรช"}</span>
          </button>

          <button
            type="button"
            onClick={handleExportCSV}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-xs transition-all cursor-pointer"
            title="ส่งออกไฟล์ CSV"
          >
            <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span>ส่งออก CSV</span>
          </button>

          <Link
            href="/movements/transfer"
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-xs transition-all cursor-pointer active:scale-95"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span>+ ไปหน้าเบิกสินค้า</span>
          </Link>
        </div>
      </div>

      {/* Summary Statistics Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3.5">
        <div className="bg-white rounded-2xl p-3.5 border border-slate-200 shadow-xs space-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">รายการเบิกทั้งหมด</span>
            <div className="w-6 h-6 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
          </div>
          <div className="text-xl font-black text-slate-900">{stats.total.toLocaleString()}</div>
          <div className="text-[11px] text-slate-400">รายการทั้งหมดในระบบ</div>
        </div>

        <div className="bg-white rounded-2xl p-3.5 border border-slate-200 shadow-xs space-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">จำนวนชิ้นรวม</span>
            <div className="w-6 h-6 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
          </div>
          <div className="text-xl font-black text-indigo-600">{stats.totalUnits.toLocaleString()}</div>
          <div className="text-[11px] text-slate-400">หน่วยสินค้ารวมทั้งหมด</div>
        </div>

        <div className="bg-white rounded-2xl p-3.5 border border-slate-200 shadow-xs space-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">เบิกสำเร็จแล้ว</span>
            <div className="w-6 h-6 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </div>
          <div className="text-xl font-black text-emerald-600">{stats.completed.toLocaleString()}</div>
          <div className="text-[11px] text-slate-400">ตัดสต็อกและส่งมอบแล้ว</div>
        </div>

        <div className="bg-white rounded-2xl p-3.5 border border-slate-200 shadow-xs space-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">รออนุมัติ / กำลังเบิก</span>
            <div className="w-6 h-6 rounded-lg bg-amber-50 flex items-center justify-center text-amber-600">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
          <div className="text-xl font-black text-amber-600">
            {(stats.waitingApproval + stats.pending).toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-400">
            {stats.waitingApproval > 0 ? `รออนุมัติ ${stats.waitingApproval} รายการ` : "รอดำเนินการ"}
          </div>
        </div>
      </div>

      {/* Search and Filters Bar */}
      <div className="bg-white rounded-2xl p-3.5 sm:p-4 border border-slate-200 shadow-xs space-y-3">
        <div className="flex flex-wrap items-end gap-2.5 sm:gap-3">
          {/* Main Search Input */}
          <div className="flex-[2_1_220px] min-w-[200px] relative">
            <label className="block text-[11px] font-bold text-slate-600 mb-1">ค้นหาข้อมูล</label>
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                placeholder="เลขเอกสาร, บาร์โค้ด, รหัส, ชื่อสินค้า, คนสร้าง, คนเบิก..."
                className="w-full pl-8 pr-7 py-2 rounded-xl bg-slate-50 border border-slate-200 text-slate-800 placeholder-slate-400 text-xs font-medium focus:outline-none focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 transition-all"
              />
              <svg
                className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* Status Filter */}
          <div className="flex-[1_1_125px] min-w-[120px]">
            <label className="block text-[11px] font-bold text-slate-600 mb-1">สถานะ</label>
            <select
              value={selectedStatus}
              onChange={(e) => {
                setSelectedStatus(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full px-2.5 py-2 rounded-xl bg-slate-50 border border-slate-200 text-slate-800 text-xs font-semibold focus:outline-none focus:border-indigo-500 focus:bg-white transition-all cursor-pointer"
            >
              <option value="ALL">สถานะทั้งหมด</option>
              <option value="COMPLETED">สำเร็จแล้ว (Completed)</option>
              <option value="WAITING_APPROVAL">รออนุมัติ (Waiting Approval)</option>
              <option value="PENDING">รอดำเนินการ (Pending)</option>
              <option value="CANCELLED">ยกเลิก / ปฏิเสธ (Cancelled)</option>
            </select>
          </div>

          {/* From Warehouse Filter */}
          <div className="flex-[1_1_125px] min-w-[120px]">
            <label className="block text-[11px] font-bold text-slate-600 mb-1">โกดังต้นทาง</label>
            <select
              value={selectedFromWh}
              onChange={(e) => {
                setSelectedFromWh(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full px-2.5 py-2 rounded-xl bg-slate-50 border border-slate-200 text-slate-800 text-xs font-semibold focus:outline-none focus:border-indigo-500 focus:bg-white transition-all cursor-pointer"
            >
              <option value="ALL">โกดังต้นทางทั้งหมด</option>
              <option value="wh-01">โกดัง1</option>
              <option value="wh-02">โกดัง2</option>
              <option value="wh-03">โกดัง3</option>
              <option value="wh-04">โกดัง4</option>
              <option value="wh-05">โกดัง5</option>
              <option value="wh-06">สำนักงานใหญ่</option>
            </select>
          </div>

          {/* To Warehouse Filter */}
          <div className="flex-[1_1_125px] min-w-[120px]">
            <label className="block text-[11px] font-bold text-slate-600 mb-1">โกดังปลายทาง</label>
            <select
              value={selectedToWh}
              onChange={(e) => {
                setSelectedToWh(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full px-2.5 py-2 rounded-xl bg-slate-50 border border-slate-200 text-slate-800 text-xs font-semibold focus:outline-none focus:border-indigo-500 focus:bg-white transition-all cursor-pointer"
            >
              <option value="ALL">โกดังปลายทางทั้งหมด</option>
              <option value="wh-01">โกดัง1</option>
              <option value="wh-02">โกดัง2</option>
              <option value="wh-03">โกดัง3</option>
              <option value="wh-04">โกดัง4</option>
              <option value="wh-05">โกดัง5</option>
              <option value="wh-06">สำนักงานใหญ่</option>
            </select>
          </div>

          {/* Date Range Filter & Reset Button */}
          <div className="flex-[1.8_1_250px] min-w-[240px] flex items-end gap-1.5">
            <div className="flex-1">
              <label className="block text-[11px] font-bold text-slate-600 mb-1">ช่วงวันที่</label>
              <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-xl px-2 py-1.5 focus-within:border-indigo-500 focus-within:bg-white focus-within:ring-2 focus-within:ring-indigo-500/20 transition-all">
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => {
                    setDateFrom(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="w-full bg-transparent text-slate-800 text-xs font-medium focus:outline-none cursor-pointer"
                  title="จากวันที่"
                />
                <span className="text-slate-400 text-xs shrink-0 font-medium">-</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => {
                    setDateTo(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="w-full bg-transparent text-slate-800 text-xs font-medium focus:outline-none cursor-pointer"
                  title="ถึงวันที่"
                />
              </div>
            </div>

            {(searchQuery || selectedStatus !== "ALL" || selectedFromWh !== "ALL" || selectedToWh !== "ALL" || dateFrom || dateTo) && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-semibold shrink-0 transition-all cursor-pointer mb-0.5"
                title="ล้างตัวกรองทั้งหมด"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Filter Summary Results */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 text-xs text-slate-500">
          <div>
            พบทั้งหมด <span className="font-bold text-slate-800">{filteredRecords.length.toLocaleString()}</span> รายการ
            {filteredRecords.length !== records.length && (
              <span className="ml-1 text-slate-400">(จากทั้งหมด {records.length.toLocaleString()} รายการ)</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span>แสดงแถวละ:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="px-2 py-0.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-700 text-xs font-semibold cursor-pointer"
            >
              <option value={10}>10</option>
              <option value={15}>15</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
        </div>
      </div>

      {/* Main Table Card */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        {loading ? (
          <div className="py-16 text-center space-y-3">
            <div className="w-9 h-9 border-3 border-purple-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
            <p className="text-xs font-semibold text-slate-600">กำลังโหลดข้อมูลประวัติการเบิกสินค้า...</p>
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="py-14 px-4 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-center mx-auto text-slate-400">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div className="space-y-0.5 max-w-sm mx-auto">
              <h3 className="text-sm font-bold text-slate-800">ไม่พบรายการประวัติการเบิกสินค้า</h3>
              <p className="text-xs text-slate-500">
                {searchQuery || selectedStatus !== "ALL" || selectedFromWh !== "ALL" || selectedToWh !== "ALL" || dateFrom || dateTo
                  ? "ลองปรับเปลี่ยนคำค้นหาหรือตัวกรองใหม่อีกครั้ง"
                  : "ยังไม่มีประวัติการทำรายการเบิกในระบบ สามารถเริ่มสร้างใบเบิกได้ที่หน้าเบิกสินค้า"}
              </p>
            </div>
            {(searchQuery || selectedStatus !== "ALL" || selectedFromWh !== "ALL" || selectedToWh !== "ALL" || dateFrom || dateTo) && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-all cursor-pointer"
              >
                <span>ล้างตัวกรองทั้งหมด</span>
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/90 border-b border-slate-200 text-slate-600 text-[11px] font-bold uppercase tracking-wider">
                  <th className="py-2.5 px-2 text-center w-8 whitespace-nowrap">ลำดับ</th>
                  <th className="py-2.5 px-2 whitespace-nowrap">เลขที่เอกสาร</th>
                  <th className="py-2.5 px-2 whitespace-nowrap">บาร์โค้ด</th>
                  <th className="py-2.5 px-2 whitespace-nowrap">รหัสสินค้า</th>
                  <th className="py-2.5 px-2.5 whitespace-nowrap min-w-[130px]">ชื่อสินค้า</th>
                  <th className="py-2.5 px-2 whitespace-nowrap text-center">โกดังต้นทาง</th>
                  <th className="py-2.5 px-2 whitespace-nowrap text-center">โกดังปลายทาง</th>
                  <th className="py-2.5 px-2 text-right whitespace-nowrap">จำนวน</th>
                  <th className="py-2.5 px-1.5 text-center whitespace-nowrap">หน่วย</th>
                  <th className="py-2.5 px-2 whitespace-nowrap">คนสร้าง</th>
                  <th className="py-2.5 px-2 whitespace-nowrap">คนเบิก</th>
                  <th className="py-2.5 px-2 text-center whitespace-nowrap">สถานะ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {paginatedRecords.map((item, index) => {
                  const globalIndex = (currentPage - 1) * pageSize + index + 1;
                  const isBarcodeReal = item.barcode && item.barcode !== "-" && item.barcode !== item.sku;

                  return (
                    <tr
                      key={item.id || item.doc_no || index}
                      onClick={() => setSelectedRecord(item)}
                      className="hover:bg-slate-50/90 transition-colors cursor-pointer group"
                    >
                      {/* 1. ลำดับ */}
                      <td className="py-2.5 px-2 text-center text-slate-400 font-semibold font-mono text-[11px]">
                        {globalIndex}
                      </td>

                      {/* 2. เลขที่เอกสาร */}
                      <td className="py-2.5 px-2 whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          <span className="font-mono font-bold text-indigo-700 bg-indigo-50/80 px-1.5 py-0.5 rounded text-[11px] border border-indigo-100">
                            {item.doc_no || "-"}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopy(item.doc_no, `เลขที่เอกสาร ${item.doc_no}`);
                            }}
                            className="text-slate-400 hover:text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity p-0.5"
                            title="คัดลอกเลขที่เอกสาร"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                          </button>
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          {item.created_at ? new Date(item.created_at).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" }) : "-"}
                        </div>
                      </td>

                      {/* 3. บาร์โค้ด */}
                      <td className="py-2.5 px-2 whitespace-nowrap">
                        <div className="flex items-center gap-1 font-mono font-semibold text-slate-700 text-[11px]">
                          {isBarcodeReal ? (
                            <>
                              <svg className="w-3 h-3 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                              </svg>
                              <span>{item.barcode}</span>
                            </>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </div>
                      </td>

                      {/* 4. รหัสสินค้า */}
                      <td className="py-2.5 px-2 whitespace-nowrap">
                        <span className="font-mono font-bold text-slate-800 bg-slate-100 px-1.5 py-0.5 rounded text-[11px] border border-slate-200">
                          {item.sku || "-"}
                        </span>
                      </td>

                      {/* 5. ชื่อสินค้า */}
                      <td className="py-2.5 px-2.5 min-w-[130px] max-w-[200px]">
                        <div className="font-bold text-slate-900 leading-snug truncate text-xs" title={item.product_name}>
                          {item.product_name || "-"}
                        </div>
                      </td>

                      {/* 6. โกดังต้นทาง */}
                      <td className="py-2.5 px-2 text-center whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 font-semibold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-md border border-rose-200 text-[11px]">
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0"></span>
                          <span>{item.from_warehouse_name}</span>
                        </span>
                      </td>

                      {/* 7. โกดังปลายทาง */}
                      <td className="py-2.5 px-2 text-center whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200 text-[11px]">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"></span>
                          <span>{item.to_warehouse_name}</span>
                        </span>
                      </td>

                      {/* 8. จำนวน */}
                      <td className="py-2.5 px-2 text-right whitespace-nowrap">
                        <span className="font-mono font-black text-slate-900 text-xs">
                          {Number(item.qty || 0).toLocaleString()}
                        </span>
                      </td>

                      {/* 9. หน่วย */}
                      <td className="py-2.5 px-1.5 text-center whitespace-nowrap">
                        <span className="text-slate-600 font-medium bg-slate-100 px-1.5 py-0.5 rounded text-[10px]">
                          {item.base_unit || "ชิ้น"}
                        </span>
                      </td>

                      {/* 10. คนสร้าง */}
                      <td className="py-2.5 px-2 whitespace-nowrap">
                        <div className="flex items-center gap-1 text-slate-700 font-medium text-[11px]">
                          <div className="w-4 h-4 rounded-full bg-purple-100 text-purple-700 text-[9px] font-bold flex items-center justify-center shrink-0">
                            {item.created_by_name?.charAt(0) || "A"}
                          </div>
                          <span className="truncate max-w-[85px]" title={item.created_by_name}>
                            {item.created_by_name || "Admin"}
                          </span>
                        </div>
                      </td>

                      {/* 11. คนเบิก */}
                      <td className="py-2.5 px-2 whitespace-nowrap">
                        {item.moved_by && item.moved_by !== "-" && item.moved_by !== "พนักงาน" ? (
                          <div className="flex items-center gap-1 text-slate-800 font-semibold text-[11px]">
                            <div className="w-4 h-4 rounded-full bg-indigo-100 text-indigo-700 text-[9px] font-bold flex items-center justify-center shrink-0">
                              {item.moved_by.charAt(0)}
                            </div>
                            <span className="truncate max-w-[120px]" title={item.moved_by}>
                              {item.moved_by}
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-400 font-normal text-[11px]">-</span>
                        )}
                      </td>

                      {/* 12. สถานะ */}
                      <td className="py-2.5 px-2 text-center whitespace-nowrap">
                        {renderStatusBadge(item.status)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Table Footer with Pagination */}
        {!loading && filteredRecords.length > 0 && (
          <div className="px-3.5 py-2.5 border-t border-slate-200 bg-slate-50/60 flex flex-col sm:flex-row items-center justify-between gap-2.5 text-xs">
            <div className="text-slate-500 font-medium">
              แสดง <span className="font-bold text-slate-800">{(currentPage - 1) * pageSize + 1}</span> -{" "}
              <span className="font-bold text-slate-800">{Math.min(currentPage * pageSize, filteredRecords.length)}</span> จาก{" "}
              <span className="font-bold text-slate-800">{filteredRecords.length.toLocaleString()}</span> รายการ
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => handlePageChange(1)}
                disabled={currentPage === 1}
                className="px-2 py-1 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed text-[11px] font-medium transition-colors cursor-pointer"
                title="หน้าแรก"
              >
                «
              </button>
              <button
                type="button"
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
                className="px-2 py-1 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed text-[11px] font-medium transition-colors cursor-pointer"
              >
                ก่อนหน้า
              </button>

              <span className="px-2.5 py-0.5 font-bold text-slate-800 bg-white border border-slate-200 rounded-lg text-[11px] shadow-2xs">
                หน้า {currentPage} / {totalPages}
              </span>

              <button
                type="button"
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage >= totalPages}
                className="px-2 py-1 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed text-[11px] font-medium transition-colors cursor-pointer"
              >
                ถัดไป
              </button>
              <button
                type="button"
                onClick={() => handlePageChange(totalPages)}
                disabled={currentPage >= totalPages}
                className="px-2 py-1 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed text-[11px] font-medium transition-colors cursor-pointer"
                title="หน้าสุดท้าย"
              >
                »
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selectedRecord && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={() => setSelectedRecord(null)}
        >
          <div
            className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-2xl w-full overflow-hidden space-y-0 relative max-h-[90vh] flex flex-col animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="p-4 sm:p-6 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-purple-100 text-purple-700 flex items-center justify-center shrink-0 shadow-xs">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base sm:text-lg font-black text-slate-900">
                      รายละเอียดใบเบิกสินค้า
                    </h2>
                    {renderStatusBadge(selectedRecord.status)}
                  </div>
                  <p className="text-xs text-slate-500 font-mono mt-0.5">
                    เลขที่เอกสาร: <span className="font-bold text-indigo-700">{selectedRecord.doc_no}</span>
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelectedRecord(null)}
                className="w-8 h-8 rounded-full bg-white border border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-100 flex items-center justify-center transition-all cursor-pointer shrink-0"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 sm:p-6 overflow-y-auto space-y-4 text-xs sm:text-sm">
              {/* Product Information Card */}
              <div className="bg-slate-50/80 rounded-2xl p-4 border border-slate-200/80 space-y-2.5">
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  ข้อมูลสินค้าที่เบิก
                </div>
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <h3 className="font-extrabold text-slate-900 text-base">
                      {selectedRecord.product_name}
                    </h3>
                    <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-slate-600">
                      <span className="bg-white px-2 py-0.5 rounded border border-slate-200 font-bold">
                        รหัส: {selectedRecord.sku || "-"}
                      </span>
                      {selectedRecord.barcode && selectedRecord.barcode !== "-" && (
                        <span className="bg-white px-2 py-0.5 rounded border border-slate-200">
                          บาร์โค้ด: {selectedRecord.barcode}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="text-right shrink-0 bg-white px-3 py-2 rounded-xl border border-slate-200 shadow-2xs">
                    <div className="text-[10px] text-slate-500 font-medium">จำนวนที่เบิก</div>
                    <div className="text-xl font-black text-indigo-600 font-mono">
                      {selectedRecord.qty.toLocaleString()}{" "}
                      <span className="text-xs font-normal text-slate-600">{selectedRecord.base_unit}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Warehouse Route Card */}
              <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs space-y-2.5">
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  เส้นทางการโอนย้าย
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                  <div className="p-3 rounded-xl bg-rose-50/80 border border-rose-200/80 space-y-1">
                    <div className="text-[10px] font-bold text-rose-600 uppercase">โกดังต้นทาง (เบิกออก)</div>
                    <div className="font-extrabold text-slate-900 text-sm flex items-center gap-1.5">
                      <span>{selectedRecord.from_warehouse_name}</span>
                      <span className="text-[11px] text-rose-700 font-mono font-bold">
                        ({selectedRecord.from_warehouse_id})
                      </span>
                    </div>
                    {selectedRecord.from_location_id && (
                      <div className="text-[11px] text-slate-600 font-mono">
                        ตำแหน่ง: {selectedRecord.from_location_id}
                      </div>
                    )}
                  </div>

                  <div className="p-3 rounded-xl bg-emerald-50/80 border border-emerald-200/80 space-y-1">
                    <div className="text-[10px] font-bold text-emerald-600 uppercase">โกดังปลายทาง (นำเข้า)</div>
                    <div className="font-extrabold text-slate-900 text-sm flex items-center gap-1.5">
                      <span>{selectedRecord.to_warehouse_name}</span>
                      <span className="text-[11px] text-emerald-700 font-mono font-bold">
                        ({selectedRecord.to_warehouse_id})
                      </span>
                    </div>
                    {selectedRecord.to_location_id && (
                      <div className="text-[11px] text-slate-600 font-mono">
                        ตำแหน่ง: {selectedRecord.to_location_id}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Personnel Involved */}
              <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs space-y-3">
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  ผู้รับผิดชอบและวันที่ดำเนินการ
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div className="space-y-0.5">
                    <span className="text-[10px] text-slate-400 font-medium">ผู้สร้างใบเบิก</span>
                    <p className="font-bold text-slate-800 text-xs sm:text-sm">
                      {selectedRecord.created_by_name || "Admin"}
                    </p>
                  </div>

                  <div className="space-y-0.5">
                    <span className="text-[10px] text-slate-400 font-medium">พนักงานผู้ไปเบิกสินค้า</span>
                    <p className="font-bold text-slate-800 text-xs sm:text-sm">
                      {selectedRecord.moved_by && selectedRecord.moved_by !== "-" && selectedRecord.moved_by !== "พนักงาน"
                        ? selectedRecord.moved_by
                        : "รอพนักงานไปเบิก"}
                    </p>
                  </div>

                  <div className="space-y-0.5">
                    <span className="text-[10px] text-slate-400 font-medium">วันที่และเวลาบันทึก</span>
                    <p className="font-medium text-slate-700 text-xs sm:text-sm">
                      {new Date(selectedRecord.created_at).toLocaleString("th-TH")}
                    </p>
                  </div>
                </div>
              </div>

              {/* Note / Remarks if present */}
              {selectedRecord.original_note && (
                <div className="bg-slate-50 rounded-2xl p-3.5 border border-slate-200 text-xs space-y-1">
                  <div className="font-bold text-slate-700">หมายเหตุเพิ่มเติม:</div>
                  <p className="text-slate-600 leading-relaxed">{selectedRecord.original_note}</p>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3 shrink-0">
              <button
                type="button"
                onClick={() => handleCopy(selectedRecord.doc_no, `เลขที่ ${selectedRecord.doc_no}`)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-semibold shadow-2xs transition-all cursor-pointer"
              >
                <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <span>คัดลอกเลขเอกสาร</span>
              </button>

              <button
                type="button"
                onClick={() => setSelectedRecord(null)}
                className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-xs transition-all cursor-pointer"
              >
                ปิดหน้าต่าง
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

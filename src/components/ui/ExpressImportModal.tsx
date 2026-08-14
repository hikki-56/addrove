"use client";

import { useState, useMemo } from "react";
import BarcodeSvg from "./BarcodeSvg";
import { to8DigitBarcode } from "@/lib/barcode-utils";

export interface ApprovedDocumentItem {
  document_id: string;
  document_no: string;
  warehouse_id: string;
  target_sheet: string;
  document_date: string;
  created_by: string;
  status: string;
  rows: Array<[string, string, string, string, number, string, string, string]>;
}

export interface DisplayFields {
  barcode: boolean;
  productName: boolean;
  warehouse: boolean;
  quantity: boolean;
  sku: boolean;
  location: boolean;
  docNo: boolean;
}

const DEFAULT_DISPLAY_FIELDS: DisplayFields = {
  barcode: true,
  productName: true,
  warehouse: true,
  quantity: true,
  sku: false,
  location: false,
  docNo: false,
};

interface ExpressImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  approvedDocs: ApprovedDocumentItem[];
  initialDocId?: string | null;
}

export default function ExpressImportModal({
  isOpen,
  onClose,
  approvedDocs,
  initialDocId = null,
}: ExpressImportModalProps) {
  const [selectedDocId, setSelectedDocId] = useState<string>(initialDocId || "ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [copySuccess, setCopySuccess] = useState<string | null>(null);
  const [copiedItemSku, setCopiedItemSku] = useState<string | null>(null);
  const [displayFields, setDisplayFields] = useState<DisplayFields>(DEFAULT_DISPLAY_FIELDS);

  // Helper to extract 2-digit Express warehouse code (e.g. "01", "02", "03")
  const toExpressWhCode = (targetSheet: string): string => {
    if (!targetSheet) return "01";
    const match = targetSheet.match(/\d+/);
    if (match) return match[0].padStart(2, "0");
    return "01";
  };

  // Flatten items with document metadata
  const allItems = useMemo(() => {
    const list: Array<{
      document_id: string;
      document_no: string;
      target_sheet: string;
      document_date: string;
      created_by: string;
      sku: string;
      product_name: string;
      category: string;
      unit: string;
      quantity: number;
      location: string;
      supplier: string;
      barcode: string;
    }> = [];

    approvedDocs.forEach((doc) => {
      if (selectedDocId !== "ALL" && doc.document_id !== selectedDocId) return;

      doc.rows?.forEach((row) => {
        const sku = String(row[0] ?? "").trim();
        const location = String(row[1] ?? "-").trim() || "-";
        const rawBarcode = String(row[2] ?? "").trim();
        const productName = String(row[3] ?? "").trim() || sku;
        const qtyVal = parseFloat(String(row[4] ?? "1").replace(/,/g, "").trim());
        const quantity = !isNaN(qtyVal) && qtyVal > 0 ? qtyVal : 1;
        const targetWarehouse = String(row[5] ?? doc.target_sheet ?? "").trim() || doc.target_sheet;
        const supplier = String(row[6] ?? "-").trim() || "-";

        // Generate barcode using that product's exact barcode number (or fallback to SKU if none)
        const barcode = (rawBarcode && rawBarcode !== "-" && rawBarcode !== "null" && rawBarcode !== "undefined")
          ? rawBarcode
          : (to8DigitBarcode(rawBarcode, sku) || sku);

        list.push({
          document_id: doc.document_id,
          document_no: doc.document_no,
          target_sheet: targetWarehouse,
          document_date: doc.document_date || "-",
          created_by: doc.created_by || "-",
          sku,
          product_name: productName,
          category: "ทั่วไป",
          unit: "ชิ้น",
          quantity,
          location,
          supplier,
          barcode,
        });
      });
    });

    return list;
  }, [approvedDocs, selectedDocId]);

  // Filter items by search query
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return allItems;
    const q = searchQuery.toLowerCase().trim();
    return allItems.filter(
      (item) =>
        item.sku.toLowerCase().includes(q) ||
        item.product_name.toLowerCase().includes(q) ||
        item.barcode.toLowerCase().includes(q) ||
        item.document_no.toLowerCase().includes(q) ||
        item.target_sheet.toLowerCase().includes(q)
    );
  }, [allItems, searchQuery]);

  // Copy single item barcode
  const handleCopySingle = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedItemSku(code);
    setTimeout(() => setCopiedItemSku(null), 2000);
  };

  // Copy all items matching Express columns: บาร์โค้ด | รายละเอียด | คลัง | จำนวน
  const handleCopyExpressData = () => {
    if (filteredItems.length === 0) return;
    const lines = filteredItems.map((item) => {
      const parts: string[] = [];
      if (displayFields.barcode) parts.push(item.barcode);
      if (displayFields.productName) parts.push(item.product_name.replace(/\t/g, " "));
      if (displayFields.warehouse) parts.push(toExpressWhCode(item.target_sheet));
      if (displayFields.quantity) parts.push(String(item.quantity));
      if (displayFields.sku) parts.push(item.sku);
      if (displayFields.location) parts.push(item.location);
      if (displayFields.docNo) parts.push(item.document_no);

      if (parts.length === 0) {
        return `${item.barcode}\t${item.product_name.replace(/\t/g, " ")}\t${toExpressWhCode(item.target_sheet)}\t${item.quantity}`;
      }
      return parts.join("\t");
    });
    const content = lines.join("\n");
    navigator.clipboard.writeText(content);
    setCopySuccess("คัดลอกข้อมูลเรียบร้อยแล้ว!");
    setTimeout(() => setCopySuccess(null), 3000);
  };

  // Download Express batch import file (.txt)
  const handleDownloadExpressTxt = () => {
    if (filteredItems.length === 0) return;
    const headers: string[] = [];
    if (displayFields.barcode) headers.push("บาร์โค้ด");
    if (displayFields.productName) headers.push("ชื่อสินค้า");
    if (displayFields.warehouse) headers.push("โกดัง");
    if (displayFields.quantity) headers.push("จำนวน");
    if (displayFields.sku) headers.push("รหัสสินค้า");
    if (displayFields.location) headers.push("ตำแหน่ง");
    if (displayFields.docNo) headers.push("เลขที่เอกสาร");

    const headerLine = (headers.length > 0 ? headers.join("\t") : "บาร์โค้ด\tชื่อสินค้า\tโกดัง\tจำนวน") + "\n";
    const body = filteredItems
      .map((item) => {
        const parts: string[] = [];
        if (displayFields.barcode) parts.push(item.barcode);
        if (displayFields.productName) parts.push(item.product_name.replace(/\t/g, " "));
        if (displayFields.warehouse) parts.push(toExpressWhCode(item.target_sheet));
        if (displayFields.quantity) parts.push(String(item.quantity));
        if (displayFields.sku) parts.push(item.sku);
        if (displayFields.location) parts.push(item.location);
        if (displayFields.docNo) parts.push(item.document_no);

        if (parts.length === 0) {
          return `${item.barcode}\t${item.product_name.replace(/\t/g, " ")}\t${toExpressWhCode(item.target_sheet)}\t${item.quantity}`;
        }
        return parts.join("\t");
      })
      .join("\n");

    const blob = new Blob([headerLine + body], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `express_import_${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Print barcode sheet for scanning
  const handlePrintBarcodes = () => {
    window.print();
  };

  const toggleField = (field: keyof DisplayFields) => {
    setDisplayFields((prev) => ({ ...prev, [field]: !prev[field] }));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-md fade-in overflow-y-auto">
      <div className="relative w-full max-w-5xl bg-[#111118] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[94vh] print:max-h-none print:border-none print:shadow-none print:bg-white print:text-black">
        {/* Modal Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4 border-b border-white/10 bg-[#16161f] print:hidden">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 font-bold flex-shrink-0">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <span>นำเข้า Express — บาร์โค้ดสินค้าที่อนุมัติแล้ว</span>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  {filteredItems.length} รายการ
                </span>
              </h2>
              <p className="text-slate-400 text-xs mt-0.5">
                เลือกข้อมูลที่ต้องการแสดงและสแกนนำเข้าโปรแกรม Express ERP
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handlePrintBarcodes}
              className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-white/10 flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              <span>พิมพ์ใบสแกน</span>
            </button>

            <button
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Filter & Column Selector Controls Header */}
        <div className="p-4 bg-[#14141c] border-b border-white/10 space-y-3 print:hidden">
          {/* Top Row: Doc Selector & Search */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <div className="flex-1 relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="🔍 ค้นหาบาร์โค้ด, ชื่อสินค้า, โกดัง..."
                className="w-full pl-3.5 pr-4 py-2 bg-[#1b1b26] border border-white/10 rounded-xl text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-white"
                >
                  ✕
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <select
                value={selectedDocId}
                onChange={(e) => setSelectedDocId(e.target.value)}
                className="px-3 py-2 bg-[#1b1b26] border border-white/10 rounded-xl text-xs font-mono font-bold text-slate-200 focus:outline-none focus:border-emerald-500 cursor-pointer"
              >
                <option value="ALL">เอกสารทั้งหมด ({approvedDocs.length})</option>
                {approvedDocs.map((doc) => (
                  <option key={doc.document_id} value={doc.document_id}>
                    {doc.document_no} ({doc.target_sheet})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Bottom Row: Field Selection Pills */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-white/5 pt-3">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-bold text-slate-400 mr-1 flex items-center gap-1">
                <span>เลือกข้อมูลที่แสดง:</span>
              </span>

              {/* Barcode Toggle */}
              <button
                type="button"
                onClick={() => toggleField("barcode")}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer border ${
                  displayFields.barcode
                    ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-xs"
                    : "bg-[#1b1b26] text-slate-500 border-white/5 hover:text-slate-300"
                }`}
              >
                <span>{displayFields.barcode ? "✓" : "+"}</span>
                <span>บาร์โค้ด</span>
              </button>

              {/* Product Name Toggle */}
              <button
                type="button"
                onClick={() => toggleField("productName")}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer border ${
                  displayFields.productName
                    ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-xs"
                    : "bg-[#1b1b26] text-slate-500 border-white/5 hover:text-slate-300"
                }`}
              >
                <span>{displayFields.productName ? "✓" : "+"}</span>
                <span>ชื่อสินค้า</span>
              </button>

              {/* Warehouse Toggle */}
              <button
                type="button"
                onClick={() => toggleField("warehouse")}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer border ${
                  displayFields.warehouse
                    ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-xs"
                    : "bg-[#1b1b26] text-slate-500 border-white/5 hover:text-slate-300"
                }`}
              >
                <span>{displayFields.warehouse ? "✓" : "+"}</span>
                <span>โกดังที่รับเข้า</span>
              </button>

              {/* Quantity Toggle */}
              <button
                type="button"
                onClick={() => toggleField("quantity")}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer border ${
                  displayFields.quantity
                    ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-xs"
                    : "bg-[#1b1b26] text-slate-500 border-white/5 hover:text-slate-300"
                }`}
              >
                <span>{displayFields.quantity ? "✓" : "+"}</span>
                <span>จำนวน</span>
              </button>

              {/* SKU Toggle */}
              <button
                type="button"
                onClick={() => toggleField("sku")}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer border ${
                  displayFields.sku
                    ? "bg-indigo-500/20 text-indigo-300 border-indigo-500/40 shadow-xs"
                    : "bg-[#1b1b26] text-slate-500 border-white/5 hover:text-slate-300"
                }`}
              >
                <span>{displayFields.sku ? "✓" : "+"}</span>
                <span>รหัส SKU</span>
              </button>

              {/* Location Toggle */}
              <button
                type="button"
                onClick={() => toggleField("location")}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer border ${
                  displayFields.location
                    ? "bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-xs"
                    : "bg-[#1b1b26] text-slate-500 border-white/5 hover:text-slate-300"
                }`}
              >
                <span>{displayFields.location ? "✓" : "+"}</span>
                <span>ตำแหน่ง</span>
              </button>

              {/* Doc No Toggle */}
              <button
                type="button"
                onClick={() => toggleField("docNo")}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer border ${
                  displayFields.docNo
                    ? "bg-purple-500/20 text-purple-300 border-purple-500/40 shadow-xs"
                    : "bg-[#1b1b26] text-slate-500 border-white/5 hover:text-slate-300"
                }`}
              >
                <span>{displayFields.docNo ? "✓" : "+"}</span>
                <span>เลขเอกสาร</span>
              </button>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleCopyExpressData}
                className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                </svg>
                <span>{copySuccess || "คัดลอกข้อมูล"}</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadExpressTxt}
                className="px-3 py-1.5 rounded-xl bg-[#1b1b26] hover:bg-[#252536] text-slate-200 border border-white/10 font-semibold text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                title="ดาวน์โหลดไฟล์ .txt สำหรับ Express"
              >
                <span>.txt</span>
              </button>
            </div>
          </div>
        </div>

        {/* Printable Barcode Content Area */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 print:p-0 print:overflow-visible">
          {/* Printable Header */}
          <div className="hidden print:block text-center mb-6 pb-3 border-b-2 border-black">
            <h1 className="text-xl font-bold text-black">ใบสแกนบาร์โค้ดสินค้าอนุมัติรับเข้า — Express ERP</h1>
            <p className="text-xs text-gray-600 mt-1">
              วันที่พิมพ์: {new Date().toLocaleDateString("th-TH")} | รวม {filteredItems.length} รายการ
            </p>
          </div>

          {filteredItems.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-sm">
              <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center mx-auto mb-3 text-slate-500">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                </svg>
              </div>
              ไม่พบรายการสินค้าที่อนุมัติแล้วตรงตามเงื่อนไข
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 print:grid-cols-2 print:gap-3">
              {filteredItems.map((item, idx) => {
                const barcodeValue = item.barcode || item.sku;
                const isCopied = copiedItemSku === barcodeValue;

                return (
                  <div
                    key={`${item.document_id}-${item.sku}-${idx}`}
                    className="p-4 rounded-2xl border border-white/10 bg-[#16161f] shadow-sm space-y-3 print:border-black print:bg-white print:break-inside-avoid"
                  >
                    {/* Item Info Headers based on selected fields */}
                    <div className="space-y-1.5">
                      {displayFields.productName && (
                        <div className="text-sm font-bold text-slate-100 print:text-black leading-snug break-words">
                          {displayFields.sku && <span className="font-mono text-emerald-400 print:text-black mr-1.5">[{item.sku}]</span>}
                          {item.product_name}
                        </div>
                      )}

                      {(!displayFields.productName && displayFields.sku) && (
                        <div className="text-sm font-mono font-bold text-emerald-400 print:text-black">
                          รหัสสินค้า: {item.sku}
                        </div>
                      )}

                      {/* Badges: Warehouse, Quantity, Location, Doc No */}
                      <div className="flex items-center gap-2 flex-wrap text-xs">
                        {displayFields.warehouse && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-indigo-500/15 text-indigo-300 font-bold border border-indigo-500/30 print:border-black print:text-black print:bg-gray-100">
                            🏢 โกดัง: <strong className="text-white print:text-black">{item.target_sheet} ({toExpressWhCode(item.target_sheet)})</strong>
                          </span>
                        )}

                        {displayFields.quantity && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-emerald-500/15 text-emerald-300 font-mono font-extrabold border border-emerald-500/30 print:border-black print:text-black print:bg-gray-100">
                            📦 จำนวน: <strong className="text-emerald-400 print:text-black">{item.quantity} ชิ้น</strong>
                          </span>
                        )}

                        {displayFields.location && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-amber-500/15 text-amber-300 font-mono font-bold border border-amber-500/30 print:border-black print:text-black print:bg-gray-100">
                            📍 {item.location}
                          </span>
                        )}

                        {displayFields.docNo && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-slate-500/15 text-slate-300 font-mono text-[11px] border border-slate-500/30 print:border-black print:text-black print:bg-gray-100">
                            📄 {item.document_no}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Visual Code 128 Barcode Image */}
                    {displayFields.barcode && (
                      <div className="py-2.5 w-full flex flex-col items-center justify-center bg-white p-3.5 rounded-xl border border-slate-300 shadow-xs print:border-black">
                        <BarcodeSvg value={barcodeValue} height={70} showText={true} />
                      </div>
                    )}

                    {/* Footer Row */}
                    <div className="flex items-center justify-between text-xs pt-1 print:hidden">
                      <span className="text-slate-500 font-mono text-[11px]">
                        บาร์โค้ด: <strong className="text-slate-300">{barcodeValue}</strong>
                      </span>
                      <button
                        type="button"
                        onClick={() => handleCopySingle(barcodeValue)}
                        className="px-2.5 py-1 rounded-lg text-xs font-bold bg-white/10 hover:bg-white/20 text-slate-200 transition-colors cursor-pointer"
                        title="คัดลอกเฉพาะเลขบาร์โค้ด"
                      >
                        {isCopied ? "✓ คัดลอกแล้ว" : "คัดลอกบาร์โค้ด"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-[#16161f] border-t border-white/10 flex items-center justify-between text-xs text-slate-400 font-mono print:hidden">
          <div>
            รวมบาร์โค้ดทั้งหมด <strong className="text-slate-200">{filteredItems.length}</strong> รายการ
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-[#111118] hover:bg-[#1c1c28] text-slate-200 border border-white/10 font-semibold cursor-pointer transition-all"
          >
            ปิดหน้าต่าง
          </button>
        </div>
      </div>
    </div>
  );
}

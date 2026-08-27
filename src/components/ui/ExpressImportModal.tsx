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
  const [copiedAll, setCopiedAll] = useState(false);
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

  const handleCopyAllBarcodes = () => {
    const codes = filteredItems.map(item => item.barcode).join("\n");
    navigator.clipboard.writeText(codes);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  const handlePrintBarcodes = () => {
    window.print();
  };

  const toggleField = (field: keyof DisplayFields) => {
    setDisplayFields((prev) => ({ ...prev, [field]: !prev[field] }));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-3 sm:p-5 bg-slate-900/40 backdrop-blur-xs fade-in overflow-y-auto">
      <div className="relative w-full max-w-5xl bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90dvh] print:max-h-none print:border-none print:shadow-none print:bg-white print:text-black">
        {/* Modal Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4 border-b border-slate-200 bg-slate-50 print:hidden">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600 font-bold flex-shrink-0">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <span>นำเข้า Express — บาร์โค้ดสินค้าที่อนุมัติแล้ว</span>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                  {filteredItems.length} รายการ
                </span>
              </h2>
              <p className="text-slate-500 text-xs mt-0.5">
                เลือกข้อมูลที่ต้องการแสดงและสแกนนำเข้าโปรแกรม Express ERP
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handlePrintBarcodes}
              className="px-3.5 py-1.5 rounded-xl bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold border border-slate-200 flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs active:scale-95"
            >
              <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              <span>พิมพ์ใบสแกน</span>
            </button>

            <button
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors cursor-pointer"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Filter & Column Selector Controls Header */}
        <div className="p-4 bg-slate-50/50 border-b border-slate-200 space-y-3 print:hidden">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <div className="flex-1 relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ค้นหาบาร์โค้ด, ชื่อสินค้า, โกดัง..."
                className="w-full pl-3.5 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs sm:text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
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

            <div className="flex items-center gap-2">
              <select
                value={selectedDocId}
                onChange={(e) => setSelectedDocId(e.target.value)}
                className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-mono font-bold text-slate-800 focus:outline-none focus:border-indigo-500 cursor-pointer shadow-xs"
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

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-slate-200 pt-3">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-bold text-slate-500 mr-1 flex items-center gap-1">
                <span>เลือกข้อมูลที่แสดง:</span>
              </span>

              <button
                type="button"
                onClick={() => toggleField("barcode")}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer border ${
                  displayFields.barcode
                    ? "bg-emerald-50 text-emerald-800 border-emerald-300 shadow-xs"
                    : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50 hover:text-slate-700"
                }`}
              >
                <span>🏷️</span>
                <span>บาร์โค้ดแท่ง</span>
              </button>

              <button
                type="button"
                onClick={() => toggleField("sku")}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer border ${
                  displayFields.sku
                    ? "bg-indigo-50 text-indigo-700 border-indigo-300 shadow-xs"
                    : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50 hover:text-slate-700"
                }`}
              >
                <span>รหัสสินค้า</span>
              </button>

              <button
                type="button"
                onClick={() => toggleField("productName")}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer border ${
                  displayFields.productName
                    ? "bg-indigo-50 text-indigo-700 border-indigo-300 shadow-xs"
                    : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50 hover:text-slate-700"
                }`}
              >
                <span>ชื่อสินค้า</span>
              </button>

              <button
                type="button"
                onClick={() => toggleField("warehouse")}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer border ${
                  displayFields.warehouse
                    ? "bg-indigo-50 text-indigo-700 border-indigo-300 shadow-xs"
                    : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50 hover:text-slate-700"
                }`}
              >
                <span>โกดัง</span>
              </button>

              <button
                type="button"
                onClick={() => toggleField("quantity")}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer border ${
                  displayFields.quantity
                    ? "bg-emerald-50 text-emerald-800 border-emerald-300 shadow-xs"
                    : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50 hover:text-slate-700"
                }`}
              >
                <span>จำนวน</span>
              </button>

              <button
                type="button"
                onClick={() => toggleField("location")}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer border ${
                  displayFields.location
                    ? "bg-amber-50 text-amber-800 border-amber-300 shadow-xs"
                    : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50 hover:text-slate-700"
                }`}
              >
                <span>ตำแหน่ง</span>
              </button>

              <button
                type="button"
                onClick={() => toggleField("docNo")}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer border ${
                  displayFields.docNo
                    ? "bg-slate-200 text-slate-800 border-slate-300 shadow-xs"
                    : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50 hover:text-slate-700"
                }`}
              >
                <span>เลขที่เอกสาร</span>
              </button>
            </div>

            <button
              type="button"
              onClick={handleCopyAllBarcodes}
              className="px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs active:scale-95 shrink-0"
            >
              <span>📋</span>
              <span>{copiedAll ? "✓ คัดลอกแล้ว" : "คัดลอกทุกบาร์โค้ด"}</span>
            </button>
          </div>
        </div>

        {/* Modal Scrollable Body: Barcode Cards */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 bg-white space-y-4 print:p-0 print:overflow-visible">
          {filteredItems.length === 0 ? (
            <div className="py-16 text-center text-slate-500 text-sm">
              <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3 text-slate-400">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
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
                    className="p-4 rounded-2xl border border-slate-200 bg-slate-50/50 shadow-xs space-y-3 print:border-black print:bg-white print:break-inside-avoid"
                  >
                    <div className="space-y-1.5">
                      {displayFields.productName && (
                        <div className="text-sm font-bold text-slate-900 print:text-black leading-snug break-words">
                          {displayFields.sku && <span className="font-mono text-indigo-600 print:text-black mr-1.5">[{item.sku}]</span>}
                          {item.product_name}
                        </div>
                      )}

                      {(!displayFields.productName && displayFields.sku) && (
                        <div className="text-sm font-mono font-bold text-indigo-600 print:text-black">
                          รหัสสินค้า: {item.sku}
                        </div>
                      )}

                      <div className="flex items-center gap-2 flex-wrap text-xs">
                        {displayFields.warehouse && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-indigo-50 text-indigo-700 font-bold border border-indigo-200 print:border-black print:text-black print:bg-gray-100">
                            🏢 โกดัง: <strong className="text-slate-900 print:text-black">{item.target_sheet} ({toExpressWhCode(item.target_sheet)})</strong>
                          </span>
                        )}

                        {displayFields.quantity && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-emerald-50 text-emerald-800 font-mono font-extrabold border border-emerald-200 print:border-black print:text-black print:bg-gray-100">
                            📦 จำนวน: <strong className="text-emerald-700 print:text-black">{item.quantity.toLocaleString()} ชิ้น</strong>
                          </span>
                        )}

                        {displayFields.location && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-amber-50 text-amber-800 font-mono font-bold border border-amber-200 print:border-black print:text-black print:bg-gray-100">
                            📍 {item.location}
                          </span>
                        )}

                        {displayFields.docNo && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-slate-100 text-slate-600 font-mono text-[11px] border border-slate-200 print:border-black print:text-black print:bg-gray-100">
                            📄 {item.document_no}
                          </span>
                        )}
                      </div>
                    </div>

                    {displayFields.barcode && (
                      <div className="py-2.5 w-full flex flex-col items-center justify-center bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs print:border-black">
                        <BarcodeSvg value={barcodeValue} height={70} showText={true} />
                      </div>
                    )}

                    <div className="flex items-center justify-between text-xs pt-1 print:hidden">
                      <span className="text-slate-500 font-mono text-[11px]">
                        บาร์โค้ด: <strong className="text-slate-800 font-bold">{barcodeValue}</strong>
                      </span>
                      <button
                        type="button"
                        onClick={() => handleCopySingle(barcodeValue)}
                        className="px-2.5 py-1 rounded-lg text-xs font-bold bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 shadow-2xs transition-colors cursor-pointer active:scale-95"
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
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600 font-mono print:hidden">
          <div>
            รวมบาร์โค้ดทั้งหมด <strong className="text-slate-900 font-bold">{filteredItems.length}</strong> รายการ
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 font-bold cursor-pointer transition-all shadow-xs active:scale-95"
          >
            ปิดหน้าต่าง
          </button>
        </div>
      </div>
    </div>
  );
}

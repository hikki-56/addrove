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
  rows: Array<[string, string, string, string, number, string, string, string]>; // [sku, name, category, unit, qty, loc, note/supplier, barcode]
}

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
  const [copySuccess, setCopySuccess] = useState(false);
  const [copiedItemSku, setCopiedItemSku] = useState<string | null>(null);

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
        const rawBarcode = String(row[1] ?? "").trim();
        const productName = String(row[2] ?? "").trim() || sku;
        const category = String(row[3] ?? "").trim() || "ทั่วไป";
        const unit = "ชิ้น";
        const qtyVal = parseFloat(String(row[5] ?? row[4] ?? "1").replace(/,/g, "").trim());
        const quantity = !isNaN(qtyVal) && qtyVal > 0 ? qtyVal : 1;
        const location = String(row[6] ?? "-").trim() || "-";
        const supplier = String(row[7] ?? "-").trim() || "-";

        const barcode = to8DigitBarcode(rawBarcode, sku) || rawBarcode || sku;

        list.push({
          document_id: doc.document_id,
          document_no: doc.document_no,
          target_sheet: doc.target_sheet,
          document_date: doc.document_date || "-",
          created_by: doc.created_by || "-",
          sku,
          product_name: productName,
          category,
          unit,
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

  // Helper to extract 2-digit Express warehouse code (e.g. "01", "02", "03")
  const toExpressWhCode = (targetSheet: string): string => {
    if (!targetSheet) return "01";
    const match = targetSheet.match(/\d+/);
    if (match) return match[0].padStart(2, "0");
    return "01";
  };

  // Copy all items matching exact Express ERP grid columns: บาร์โค้ด | รายละเอียด | คลัง | จำนวน
  const handleCopyAllExpress = () => {
    if (filteredItems.length === 0) return;
    const lines = filteredItems.map(
      (item) =>
        `${item.barcode}\t${item.product_name.replace(/\t/g, " ")}\t${toExpressWhCode(item.target_sheet)}\t${item.quantity}`
    );
    const content = lines.join("\n");
    navigator.clipboard.writeText(content);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 3000);
  };

  // Copy compact 3-column Express format: บาร์โค้ด | คลัง | จำนวน
  const handleCopyExpressCompact = () => {
    if (filteredItems.length === 0) return;
    const lines = filteredItems.map(
      (item) => `${item.barcode}\t${toExpressWhCode(item.target_sheet)}\t${item.quantity}`
    );
    const content = lines.join("\n");
    navigator.clipboard.writeText(content);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 3000);
  };

  // Download Express batch import file (.txt) matching Express ERP columns
  const handleDownloadExpressTxt = () => {
    if (filteredItems.length === 0) return;
    // Header format matching Express ERP: บาร์โค้ด, รายละเอียด, คลัง, จำนวน, SKU, ตำแหน่ง, เลขที่เอกสาร
    const header = "บาร์โค้ด\tรายละเอียด\tคลัง\tจำนวน\tSKU\tตำแหน่ง\tเลขที่เอกสาร\n";
    const body = filteredItems
      .map(
        (i) =>
          `${i.barcode}\t${i.product_name.replace(/\t/g, " ")}\t${toExpressWhCode(i.target_sheet)}\t${i.quantity}\t${i.sku}\t${i.location}\t${i.document_no}`
      )
      .join("\n");

    const blob = new Blob([header + body], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `express_import_barcodes_${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Print barcode sheet for scanning
  const handlePrintBarcodes = () => {
    window.print();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-md fade-in overflow-y-auto">
      <div className="relative w-full max-w-5xl bg-[#111118] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] print:max-h-none print:border-none print:shadow-none print:bg-white print:text-black">
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
                รายการบาร์โค้ดสินค้าที่อนุมัติเข้าคลังเรียบร้อยแล้ว เพื่อสแกนหรือนำเข้าโปรแกรม Express ERP
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors self-end sm:self-auto cursor-pointer"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
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
                const isCopied = copiedItemSku === (item.barcode || item.sku);

                return (
                  <div
                    key={`${item.document_id}-${item.sku}-${idx}`}
                    className="p-4 rounded-xl border border-white/10 bg-[#16161f] shadow-sm flex items-center justify-center print:border-black print:bg-white print:break-inside-avoid"
                  >
                    {/* Visual Code 128 Barcode Image ONLY */}
                    <div className="py-2 w-full flex flex-col items-center justify-center bg-white p-3.5 rounded-xl border border-slate-300 print:border-black">
                      <BarcodeSvg value={item.barcode || item.sku} height={65} showText={true} />
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
            รวมบาร์โค้ดทั้งหมด <strong className="text-slate-200">{filteredItems.length}</strong> รายการพร้อมสแกน
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

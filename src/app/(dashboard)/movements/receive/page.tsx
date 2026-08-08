"use client";

import { useSearchParams } from "next/navigation";
import { useWarehouseData } from "@/hooks/use-warehouse-data";
import WarehouseTabs from "@/components/warehouse/WarehouseTabs";
import BarcodeScanInput from "@/components/scanner/BarcodeScanInput";
import ScanFeedbackBanner from "@/components/scanner/ScanFeedbackBanner";
import CameraBarcodeScannerModal from "@/components/ui/CameraBarcodeScannerModal";
import ProductSearchInput from "@/components/ui/ProductSearchInput";
import { useReceiveMovement } from "./_hooks/use-receive-movement";
import ReceiveLinesTable from "./_components/ReceiveLinesTable";
import ReceiveConfirmModal from "./_components/ReceiveConfirmModal";
import ReceiveSuccessCard from "./_components/ReceiveSuccessCard";

export default function ReceivePage() {
  const searchParams = useSearchParams();
  const whParam = searchParams?.get("warehouse_id") || searchParams?.get("wh");

  const {
    activeWhId,
    setActiveWhId,
    warehouses,
    locations,
    products,
    setProducts,
    refreshData,
    getWarehouseName,
  } = useWarehouseData({ initialWarehouseId: whParam || undefined });

  const activeWhName =
    warehouses.find((w) => w.warehouse_id === activeWhId)?.warehouse_name ||
    getWarehouseName(activeWhId);

  const receiveHook = useReceiveMovement({
    activeWhId,
    locations,
    products,
    setProducts,
    refreshWarehouseData: refreshData,
  });

  const {
    form,
    fields,
    remove,
    submitted,
    error,
    barcodeInput,
    setBarcodeInput,
    barcodeInputRef,
    scanFeedback,
    setScanFeedback,
    cameraScanLineIndex,
    setCameraScanLineIndex,
    confirmedLines,
    toggleConfirmLine,
    handleAddLocationForProduct,
    handleScanLocationForLine,
    handleScanBarcode,
    searchOpen,
    setSearchOpen,
    searchQuery,
    setSearchQuery,
    confirmModalOpen,
    setConfirmModalOpen,
    isCameraOpen,
    setIsCameraOpen,
    onSubmit,
    resetForm,
    handleProductSelect,
  } = receiveHook;

  if (submitted) {
    return <ReceiveSuccessCard onReset={resetForm} />;
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header & Warehouse Tabs */}
      <div className="glass-card rounded-2xl p-5 border border-white/10 shadow-xl space-y-4">
        <WarehouseTabs
          activeWarehouseId={activeWhId}
          onSelectWarehouse={(whId) => {
            setActiveWhId(whId);
            resetForm();
          }}
          warehouses={warehouses}
        />

        <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            <span className="font-bold text-white text-lg sm:text-xl">รับสินค้าเข้า {activeWhName}</span>
          </div>

          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span className="text-slate-200 text-sm sm:text-base font-semibold">
              {form.watch("document_date")
                ? new Date(form.watch("document_date") + "T00:00:00").toLocaleDateString("th-TH", { year: "numeric", month: "long", day: "numeric" })
                : new Date().toLocaleDateString("th-TH", { year: "numeric", month: "long", day: "numeric" })}
            </span>
          </div>
        </div>
      </div>

      {/* Barcode Scanner Input */}
      <BarcodeScanInput
        value={barcodeInput}
        onChange={setBarcodeInput}
        onScanSubmit={handleScanBarcode}
        onOpenScannerModal={() => setIsCameraOpen(true)}
        inputRef={barcodeInputRef}
        placeholder={`สแกนบาร์โค้ดสินค้า เพื่อรับเข้า ${activeWhName}...`}
      />

      {/* Scan Feedback Banner */}
      <ScanFeedbackBanner feedback={scanFeedback} onDismiss={() => setScanFeedback(null)} />

      {error && (
        <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-medium">
          {error}
        </div>
      )}

      {/* Main Table of Receive Line Items */}
      <ReceiveLinesTable
        form={form}
        fields={fields}
        locations={locations}
        products={products}
        activeWhId={activeWhId}
        confirmedLines={confirmedLines}
        onToggleConfirm={toggleConfirmLine}
        onAddLocationForProduct={handleAddLocationForProduct}
        onRemove={remove}
        onOpenLocationCamera={(lineIdx) => setCameraScanLineIndex(lineIdx)}
        onScanLocation={handleScanLocationForLine}
        onOpenProductSearch={() => setSearchOpen(true)}
        onOpenConfirmModal={() => setConfirmModalOpen(true)}
      />

      {/* Product Search Selection Modal */}
      {searchOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-150">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-700/80 rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-slate-100 text-base">ค้นหาและเลือกสินค้า</h3>
              <button
                type="button"
                onClick={() => setSearchOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 cursor-pointer"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <ProductSearchInput
              products={products}
              value={searchQuery}
              onChange={(val) => {
                setSearchQuery(val);
                const matched = products.find(
                  (p) =>
                    p.product_id.toLowerCase() === val.toLowerCase() ||
                    p.sku.toLowerCase() === val.toLowerCase()
                );
                if (matched) {
                  handleProductSelect(matched);
                }
              }}
              placeholder="พิมพ์ชื่อสินค้า หรือ SKU..."
            />
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      <ReceiveConfirmModal
        isOpen={confirmModalOpen}
        onClose={() => setConfirmModalOpen(false)}
        form={form}
        locations={locations}
        products={products}
        activeWhName={activeWhName}
        onSubmit={onSubmit}
      />

      {/* Camera Barcode Scanner Modal for Main Scanner */}
      <CameraBarcodeScannerModal
        isOpen={isCameraOpen}
        onClose={() => setIsCameraOpen(false)}
        onScanSuccess={(scannedText) => {
          handleScanBarcode(scannedText);
          setIsCameraOpen(false);
        }}
      />

      {/* Camera Scanner for specific line item location */}
      <CameraBarcodeScannerModal
        isOpen={cameraScanLineIndex !== null}
        onClose={() => setCameraScanLineIndex(null)}
        onScanSuccess={(scannedText) => {
          if (cameraScanLineIndex !== null) {
            handleScanLocationForLine(cameraScanLineIndex, scannedText);
            setCameraScanLineIndex(null);
          }
        }}
      />
    </div>
  );
}

"use client";

import { useSearchParams } from "next/navigation";
import { useWarehouseData } from "@/hooks/use-warehouse-data";
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
    setActiveWhId,
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
      {/* Header Info */}
      <div className="glass-card rounded-2xl p-5 border border-white/10 shadow-xl space-y-3">
        {/* Title Row (Centered without Icon) */}
        <div className="text-center">
          <h1 className="font-extrabold text-white text-lg sm:text-xl tracking-wide">
            รับสินค้าเข้าคลัง
          </h1>
        </div>

        {/* Info Row: Far Left = Warehouse, Far Right = Date (Exact Same Line) */}
        <div className="flex items-center justify-between gap-4 pt-1">
          {/* Far Left: Active Warehouse */}
          <span className="text-xs sm:text-sm text-emerald-400 font-bold flex items-center gap-1.5 bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-500/20">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            {activeWhName}
          </span>

          {/* Far Right: Date */}
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span className="text-slate-300 text-xs sm:text-sm font-medium">
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
        inputRef={barcodeInputRef}
        placeholder="สแกนบาร์โค้ด..."
      />



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

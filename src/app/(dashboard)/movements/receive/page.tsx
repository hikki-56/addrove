
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
    <div className="max-w-full sm:max-w-3xl md:max-w-4xl lg:max-w-5xl xl:max-w-6xl mx-auto px-2 sm:px-4 md:px-6 pb-20 sm:pb-8 space-y-5 sm:space-y-6">
      {/* Header Info - Clean White Card with Warehouse Illustration */}
      <div className="relative rounded-3xl bg-white border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="p-4 sm:p-5 md:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          {/* Left side: Title + Badges */}
          <div className="space-y-3 sm:space-y-4 flex-1 min-w-0 z-10">
            <h1 className="font-extrabold text-slate-900 text-xl sm:text-2xl md:text-3xl tracking-tight">
              รับสินค้าเข้าคลัง
            </h1>

            {/* Info Row: Warehouse & Date on the Exact Same Line */}
            <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
              {/* Active Warehouse Badge */}
              <span className="inline-flex items-center gap-1.5 bg-slate-50 px-3 py-1.5 rounded-full border border-slate-200 text-xs sm:text-sm font-bold text-slate-800 shadow-2xs shrink-0">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                {activeWhName}
              </span>

              {/* Date Badge */}
              <div className="inline-flex items-center gap-1.5 text-slate-600 text-xs sm:text-sm font-medium shrink-0">
                <svg className="w-4 h-4 text-slate-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span>
                  {form.watch("document_date")
                    ? new Date(form.watch("document_date") + "T00:00:00").toLocaleDateString("th-TH", { year: "numeric", month: "long", day: "numeric" })
                    : new Date().toLocaleDateString("th-TH", { year: "numeric", month: "long", day: "numeric" })}
                </span>
              </div>
            </div>
          </div>

          {/* Right side: Warehouse illustration */}
          <div className="hidden sm:flex shrink-0 relative items-center justify-end">
            <img
              src="/warehouse-receive-header.jpg"
              alt="warehouse"
              className="w-28 h-20 sm:w-40 sm:h-28 md:w-48 md:h-32 object-contain rounded-2xl"
            />
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
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-sm font-semibold">
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

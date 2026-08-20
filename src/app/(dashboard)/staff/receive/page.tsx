"use client";

import { useSearchParams } from "next/navigation";
import { useWarehouseData } from "@/hooks/use-warehouse-data";
import BarcodeScanInput from "@/components/scanner/BarcodeScanInput";
import CameraBarcodeScannerModal from "@/components/ui/CameraBarcodeScannerModal";
import ProductSearchInput from "@/components/ui/ProductSearchInput";
import { useReceiveMovement } from "../../movements/receive/_hooks/use-receive-movement";
import ReceiveLinesTable from "../../movements/receive/_components/ReceiveLinesTable";
import ReceiveConfirmModal from "../../movements/receive/_components/ReceiveConfirmModal";
import ReceiveSuccessCard from "../../movements/receive/_components/ReceiveSuccessCard";

export default function StaffReceivePage() {
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
    cameraScanLineIndex,
    setCameraScanLineIndex,
    confirmedLines,
    toggleConfirmLine,
    handleAddLocationForProduct,
    handleScanLocationForLine,
    handleScanBarcode,
    setSearchOpen,
    confirmModalOpen,
    setConfirmModalOpen,
    isCameraOpen,
    setIsCameraOpen,
    onSubmit,
    resetForm,
  } = receiveHook;

  if (submitted) {
    return <ReceiveSuccessCard onReset={resetForm} />;
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* Staff Header Card */}
      <div className="rounded-3xl bg-white border border-slate-200 shadow-sm p-5 flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse" />
            <h1 className="font-extrabold text-slate-900 text-lg sm:text-xl tracking-tight">
              สแกนรับสินค้าเข้าคลัง
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
            คลัง: <span className="font-bold text-slate-800">{activeWhName}</span> • ยิงบาร์โค้ดสินค้าเพื่อนับยอดรับเข้า
          </p>
        </div>

        <button
          type="button"
          onClick={() => refreshData()}
          className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs shrink-0"
        >
          <svg className="w-4 h-4 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span>รีเฟรช</span>
        </button>
      </div>

      {/* Barcode Scanner Input */}
      <BarcodeScanInput
        value={barcodeInput}
        onChange={setBarcodeInput}
        onScanSubmit={handleScanBarcode}
        inputRef={barcodeInputRef}
        placeholder="สแกนบาร์โค้ดสินค้าที่รับเข้า..."
      />

      {error && (
        <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-600 text-xs font-medium">
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

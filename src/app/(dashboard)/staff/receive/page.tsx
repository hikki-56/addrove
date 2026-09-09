"use client";

import { useSearchParams } from "next/navigation";
import { useWarehouseData } from "@/hooks/use-warehouse-data";
import BarcodeScanInput from "@/components/scanner/BarcodeScanInput";
import ScanFeedbackBanner from "@/components/scanner/ScanFeedbackBanner";
import CameraBarcodeScannerModal from "@/components/ui/CameraBarcodeScannerModal";
import { useReceiveMovement } from "../../movements/receive/_hooks/use-receive-movement";
import ReceiveLinesTable from "../../movements/receive/_components/ReceiveLinesTable";
import ReceiveConfirmModal from "../../movements/receive/_components/ReceiveConfirmModal";
import ReceiveSuccessCard from "../../movements/receive/_components/ReceiveSuccessCard";

const cardClass =
  "bg-white rounded-[20px] border border-[#E8ECEA] shadow-[0_1px_2px_rgba(16,24,40,0.05)]";

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
    successMessage,
    barcodeInput,
    setBarcodeInput,
    barcodeInputRef,
    scanFeedback,
    setScanFeedback,
    confirmedLines,
    toggleConfirmLine,
    handleAddLocationForProduct,
    handleScanLocationForLine,
    handleScanBarcode,
    confirmModalOpen,
    setConfirmModalOpen,
    isCameraOpen,
    setIsCameraOpen,
    onSubmit,
    resetForm,
  } = receiveHook;

  if (submitted) {
    return <ReceiveSuccessCard onReset={resetForm} successMessage={successMessage} />;
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4 pb-24 sm:pb-10">
      <section className={`${cardClass} p-4 flex items-center justify-between gap-3`}>
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#0F5C3F] shrink-0" />
            <h1 className="font-extrabold text-[#111827] text-base sm:text-xl tracking-tight truncate">
              รับสินค้าเข้าคลัง
            </h1>
          </div>
          <span className="inline-block max-w-full truncate bg-[#EAF2EE] px-3 py-1 rounded-full border border-[#DFEDE6] text-sm font-bold text-[#052B1F]">
            {activeWhName}
          </span>
        </div>

        <button
          type="button"
          onClick={() => refreshData()}
          className="min-h-11 px-3.5 rounded-xl bg-black/[.04] hover:bg-black/[.07] text-slate-700 font-bold text-sm transition-colors cursor-pointer flex items-center gap-1.5 shrink-0"
        >
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span>รีเฟรช</span>
        </button>
      </section>

      <BarcodeScanInput
        value={barcodeInput}
        onChange={setBarcodeInput}
        onScanSubmit={handleScanBarcode}
        onOpenScannerModal={() => setIsCameraOpen(true)}
        inputRef={barcodeInputRef}
        placeholder="สแกนบาร์โค้ดสินค้า / ตำแหน่ง / โกดัง…"
      />

      {scanFeedback && (
        <ScanFeedbackBanner
          feedback={scanFeedback}
          onDismiss={() => setScanFeedback(null)}
          className="fade-in"
        />
      )}

      {error && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-sm font-semibold fade-in">
          {error}
        </div>
      )}

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
        onScanLocation={handleScanLocationForLine}
        onScanFeedback={setScanFeedback}
        onOpenConfirmModal={() => setConfirmModalOpen(true)}
      />

      <ReceiveConfirmModal
        isOpen={confirmModalOpen}
        onClose={() => setConfirmModalOpen(false)}
        form={form}
        locations={locations}
        products={products}
        activeWhName={activeWhName}
        onSubmit={onSubmit}
      />

      <CameraBarcodeScannerModal
        isOpen={isCameraOpen}
        onClose={() => setIsCameraOpen(false)}
        onScan={(scannedText) => {
          handleScanBarcode(scannedText);
        }}
      />
    </div>
  );
}

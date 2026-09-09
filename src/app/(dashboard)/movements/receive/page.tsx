
"use client";

import { useSearchParams } from "next/navigation";
import { useWarehouseData } from "@/hooks/use-warehouse-data";
import BarcodeScanInput from "@/components/scanner/BarcodeScanInput";
import ScanFeedbackBanner from "@/components/scanner/ScanFeedbackBanner";
import CameraBarcodeScannerModal from "@/components/ui/CameraBarcodeScannerModal";
import { useReceiveMovement } from "./_hooks/use-receive-movement";
import ReceiveLinesTable from "./_components/ReceiveLinesTable";
import ReceiveConfirmModal from "./_components/ReceiveConfirmModal";
import ReceiveSuccessCard from "./_components/ReceiveSuccessCard";

const cardClass =
  "bg-white rounded-[20px] border border-[#E8ECEA] shadow-[0_1px_2px_rgba(16,24,40,0.05)]";

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
    <div className="max-w-full sm:max-w-3xl md:max-w-4xl lg:max-w-5xl xl:max-w-6xl mx-auto pb-24 sm:pb-10 space-y-4 sm:space-y-5">
      <section className={`${cardClass} p-4 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4`}>
        <div className="space-y-3 min-w-0">
          <h1 className="font-extrabold text-[#111827] text-xl sm:text-2xl tracking-tight leading-tight">
            รับสินค้าเข้าคลัง
          </h1>

          <div className="flex items-center gap-2 sm:gap-2.5 flex-wrap">
            <span className="inline-flex items-center gap-1.5 bg-[#EAF2EE] px-3 py-1.5 rounded-full border border-[#DFEDE6] text-sm font-bold text-[#052B1F] shrink-0">
              <span className="w-2.5 h-2.5 rounded-full bg-[#0F5C3F] shrink-0" />
              {activeWhName}
            </span>

            <span className="inline-flex items-center gap-1.5 text-sm text-slate-600 font-semibold shrink-0">
              <svg className="w-4 h-4 text-slate-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              {form.watch("document_date")
                ? new Date(form.watch("document_date") + "T00:00:00").toLocaleDateString("th-TH", { year: "numeric", month: "long", day: "numeric" })
                : new Date().toLocaleDateString("th-TH", { year: "numeric", month: "long", day: "numeric" })}
            </span>
          </div>
        </div>

        <div className="hidden sm:flex shrink-0 items-center justify-end">
          <img
            src="/warehouse-receive-header.jpg"
            alt="warehouse"
            className="w-40 h-28 md:w-48 md:h-32 object-contain rounded-2xl"
          />
        </div>
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

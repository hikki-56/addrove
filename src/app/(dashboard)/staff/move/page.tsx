"use client";

import { useSearchParams } from "next/navigation";
import { useWarehouseData } from "@/hooks/use-warehouse-data";
import BarcodeScanInput from "@/components/scanner/BarcodeScanInput";
import CameraBarcodeScannerModal from "@/components/ui/CameraBarcodeScannerModal";
import { useMoveMovement } from "../../movements/move/_hooks/use-move-movement";
import MoveForm from "../../movements/move/_components/MoveForm";
import MoveSuccessModal from "../../movements/move/_components/MoveSuccessModal";

export default function StaffMovePage() {
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

  const moveHook = useMoveMovement({
    activeWhId,
    setActiveWhId,
    activeWhName,
    locations,
    products,
    setProducts,
    refreshWarehouseData: refreshData,
  });

  const {
    step,
    setStep,
    form,
    submitted,
    error,
    setError,
    barcodeInput,
    setBarcodeInput,
    scanFeedback,
    setScanFeedback,
    isCameraOpen,
    setIsCameraOpen,
    watchFromLocation,
    watchProduct,
    watchQty,
    watchToLocation,
    selectedProduct,
    selectedFromLoc,
    selectedToLoc,
    displayName,
    displaySku,
    displayBarcode,
    handleScanBarcode,
    handleNextStep1,
    handleNextStep2,
    onSubmit,
    resetForm,
  } = moveHook;

  if (submitted) {
    return <MoveSuccessModal onReset={resetForm} />;
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      {/* Staff Header Card */}
      <div className="rounded-3xl bg-white border border-slate-200 shadow-sm p-5 flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-blue-500 animate-pulse" />
            <h1 className="font-extrabold text-slate-900 text-lg sm:text-xl tracking-tight">
              สแกนจัดตำแหน่งสินค้า
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
            คลัง: <span className="font-bold text-slate-800">{activeWhName}</span> • ย้ายตำแหน่ง/จัดเข้าเชลฟ์
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

      {/* 2-Step Guided Progress Indicator */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs space-y-3">
        <div className="flex items-center justify-between max-w-xs mx-auto px-4 pt-1">
          {/* Step 1 */}
          <div className="flex flex-col items-center gap-1.5 flex-1">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${
                step >= 1
                  ? "bg-blue-600 text-white shadow-md shadow-blue-600/30 ring-4 ring-blue-500/10 scale-105"
                  : "bg-slate-100 text-slate-500 border border-slate-300 shadow-sm"
              }`}
            >
              {step > 1 ? "✓" : "1"}
            </div>
            <span
              className={`text-[11px] font-extrabold text-center leading-tight pt-1 ${
                step >= 1 ? "text-blue-600" : "text-slate-400"
              }`}
            >
              {step > 1 ? "สินค้าถูกต้อง" : "สินค้าและจำนวน"}
            </span>
          </div>

          <div
            className={`h-0.5 w-16 -mt-5 transition-all duration-300 ${
              step > 1 ? "bg-blue-500" : "bg-slate-200 opacity-80"
            }`}
          />

          {/* Step 2 */}
          <div className="flex flex-col items-center gap-1.5 flex-1">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${
                step >= 2
                  ? "bg-blue-600 text-white shadow-md shadow-blue-600/30 ring-4 ring-blue-500/10 scale-105"
                  : "bg-slate-100 text-slate-500 border border-slate-300 shadow-sm"
              }`}
            >
              2
            </div>
            <span
              className={`text-[11px] font-extrabold text-center leading-tight pt-1 ${
                step >= 2 ? "text-blue-600" : "text-slate-400"
              }`}
            >
              ตำแหน่งปลายทาง
            </span>
          </div>
        </div>
      </div>

      {/* Barcode Scanner Input */}
      <BarcodeScanInput
        value={barcodeInput}
        onChange={setBarcodeInput}
        onScanSubmit={handleScanBarcode}
        placeholder={
          step === 1
            ? "สแกนบาร์โค้ดสินค้าที่ต้องการย้าย..."
            : "สแกน QR Code / บาร์โค้ด ตำแหน่งปลายทาง..."
        }
      />

      {/* Main Move Form */}
      <MoveForm
        form={form}
        step={step}
        setStep={setStep}
        activeWhName={activeWhName}
        locations={locations}
        products={products}
        selectedFromLoc={selectedFromLoc}
        selectedToLoc={selectedToLoc}
        selectedProduct={selectedProduct}
        watchProduct={watchProduct}
        watchFromLocation={watchFromLocation}
        watchToLocation={watchToLocation}
        watchQty={watchQty}
        maxAvailableQty={moveHook.maxAvailableQty}
        displayName={displayName}
        displaySku={displaySku}
        displayBarcode={displayBarcode}
        hasDistinctName={Boolean(displayName)}
        error={error}
        scanFeedback={scanFeedback}
        onDismissScanFeedback={() => setScanFeedback(null)}
        onNextStep1={handleNextStep1}
        onNextStep2={handleNextStep2}
        onSubmit={onSubmit}
        onErrorPrompt={setError}
      />

      {/* Camera Barcode Scanner Modal */}
      <CameraBarcodeScannerModal
        isOpen={isCameraOpen}
        onClose={() => setIsCameraOpen(false)}
        onScanSuccess={(scannedText) => {
          handleScanBarcode(scannedText);
          setIsCameraOpen(false);
        }}
      />
    </div>
  );
}

"use client";

import { useSearchParams } from "next/navigation";
import { useWarehouseData } from "@/hooks/use-warehouse-data";
import WarehouseTabs from "@/components/warehouse/WarehouseTabs";
import BarcodeScanInput from "@/components/scanner/BarcodeScanInput";
import CameraBarcodeScannerModal from "@/components/ui/CameraBarcodeScannerModal";
import { useMoveMovement } from "./_hooks/use-move-movement";
import MoveForm from "./_components/MoveForm";
import MoveProductCard from "./_components/MoveProductCard";
import MoveSuccessModal from "./_components/MoveSuccessModal";

export default function MovePage() {
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
    <div className="max-w-2xl mx-auto space-y-6">
      {/* 3-Step Guided Progress Indicator Header */}
      <div className="glass-card rounded-2xl p-5 border border-white/10 shadow-xl space-y-4">
        <WarehouseTabs
          activeWarehouseId={activeWhId}
          onSelectWarehouse={(whId) => {
            setActiveWhId(whId);
            resetForm();
          }}
          warehouses={warehouses}
        />

        <div className="flex items-center justify-between max-w-md mx-auto px-4 pt-2">
          {/* Step 1 */}
          <div className="flex flex-col items-center gap-1.5 flex-1">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${
                step >= 1
                  ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/40 ring-4 ring-emerald-500/20 scale-105"
                  : "bg-white text-slate-600 border-2 border-slate-300 shadow-sm"
              }`}
            >
              {step > 1 ? "✓" : "1"}
            </div>
            <span
              className={`text-[11px] font-bold text-center leading-tight pt-1 ${
                step >= 1 ? "text-emerald-400" : "text-slate-400"
              }`}
            >
              {step > 1 ? "ต้นทางถูกต้อง" : "ตำแหน่งต้นทาง"}
            </span>
          </div>

          <div
            className={`h-0.5 w-12 -mt-5 transition-all duration-300 ${
              step > 1 ? "bg-emerald-500" : "bg-slate-300 opacity-60"
            }`}
          />

          {/* Step 2 */}
          <div className="flex flex-col items-center gap-1.5 flex-1">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${
                step >= 2
                  ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/40 ring-4 ring-emerald-500/20 scale-105"
                  : "bg-white text-slate-600 border-2 border-slate-300 shadow-sm"
              }`}
            >
              {step > 2 ? "✓" : "2"}
            </div>
            <span
              className={`text-[11px] font-bold text-center leading-tight pt-1 ${
                step >= 2 ? "text-emerald-400" : "text-slate-400"
              }`}
            >
              {step > 2 ? "สินค้าถูกต้อง" : "สินค้าและจำนวน"}
            </span>
          </div>

          <div
            className={`h-0.5 w-12 -mt-5 transition-all duration-300 ${
              step > 2 ? "bg-emerald-500" : "bg-slate-300 opacity-60"
            }`}
          />

          {/* Step 3 */}
          <div className="flex flex-col items-center gap-1.5 flex-1">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${
                step >= 3
                  ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/40 ring-4 ring-emerald-500/20 scale-105"
                  : "bg-white text-slate-600 border-2 border-slate-300 shadow-sm"
              }`}
            >
              3
            </div>
            <span
              className={`text-[11px] font-bold text-center leading-tight pt-1 ${
                step >= 3 ? "text-emerald-400" : "text-slate-400"
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
        onOpenScannerModal={() => setIsCameraOpen(true)}
        placeholder={
          step === 1
            ? `สแกน QR Code ตำแหน่งต้นทางใน ${activeWhName}...`
            : step === 2
            ? `สแกนบาร์โค้ดสินค้าใน ${activeWhName}...`
            : `สแกน QR Code ตำแหน่งปลายทางใน ${activeWhName}...`
        }
      />

      {/* Selected Product Card Preview */}
      <MoveProductCard
        selectedProduct={selectedProduct}
        displayName={displayName}
        displaySku={displaySku}
        displayBarcode={displayBarcode}
        watchProduct={watchProduct}
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

"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useWarehouseData } from "@/hooks/use-warehouse-data";
import BarcodeScanInput from "@/components/scanner/BarcodeScanInput";
import CameraBarcodeScannerModal from "@/components/ui/CameraBarcodeScannerModal";
import { useMoveMovement } from "./_hooks/use-move-movement";
import MoveForm from "./_components/MoveForm";
import MoveSuccessModal from "./_components/MoveSuccessModal";

export default function MovePage() {
  const { data: session } = useSession();
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

  const isAdmin = session?.user?.role === "ADMIN";

  return (
    <div className="max-w-full sm:max-w-xl md:max-w-2xl lg:max-w-3xl xl:max-w-4xl mx-auto px-2 sm:px-4 md:px-6 space-y-5 sm:space-y-6">
      {/* 2-Step Guided Progress Indicator Header */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-lg space-y-4">
        <div className="flex items-center justify-between max-w-xs mx-auto px-4 pt-1">
          {/* Step 1 */}
          <div className="flex flex-col items-center gap-1.5 flex-1">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${
                step >= 1
                  ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/30 ring-4 ring-emerald-500/10 scale-105"
                  : "bg-slate-100 text-slate-500 border border-slate-300 shadow-sm"
              }`}
            >
              {step > 1 ? "✓" : "1"}
            </div>
            <span
              className={`text-[11px] font-extrabold text-center leading-tight pt-1 ${
                step >= 1 ? "text-emerald-600" : "text-slate-400"
              }`}
            >
              {step > 1 ? "สินค้าถูกต้อง" : "สินค้าและจำนวน"}
            </span>
          </div>

          <div
            className={`h-0.5 w-16 -mt-5 transition-all duration-300 ${
              step > 1 ? "bg-emerald-500" : "bg-slate-200 opacity-80"
            }`}
          />

          {/* Step 2 */}
          <div className="flex flex-col items-center gap-1.5 flex-1">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${
                step >= 2
                  ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/30 ring-4 ring-emerald-500/10 scale-105"
                  : "bg-slate-100 text-slate-500 border border-slate-300 shadow-sm"
              }`}
            >
              2
            </div>
            <span
              className={`text-[11px] font-extrabold text-center leading-tight pt-1 ${
                step >= 2 ? "text-emerald-600" : "text-slate-400"
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
            ? "สแกนบาร์โค้ดสินค้า..."
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
        /* toLocaleString formatted inside MoveForm */
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

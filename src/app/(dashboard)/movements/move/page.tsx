"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useWarehouseData } from "@/hooks/use-warehouse-data";
import BarcodeScanInput from "@/components/scanner/BarcodeScanInput";
import CameraBarcodeScannerModal from "@/components/ui/CameraBarcodeScannerModal";
import { useMoveMovement } from "@/features/move/hooks/use-move-movement";
import MoveForm from "@/features/move/components/MoveForm";
import MoveSuccessModal from "@/features/move/components/MoveSuccessModal";

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
    <div className="max-w-full sm:max-w-xl md:max-w-2xl lg:max-w-3xl xl:max-w-4xl mx-auto px-2 sm:px-4 md:px-6 pb-20 sm:pb-8 space-y-5 sm:space-y-6">
      {/* 2-Step Guided Progress Indicator Header */}
      <div className="bg-white rounded-xl p-4 sm:p-5 border border-[rgba(145,158,171,0.2)] shadow-sm space-y-4">
        <div className="flex items-center justify-between max-w-sm mx-auto px-4 pt-1">
          {/* Step 1 */}
          <div className="flex flex-col items-center gap-1.5 flex-1">
            <div
              className={`w-11 h-11 rounded-full flex items-center justify-center text-base font-extrabold transition-all duration-300 ${
                step >= 1
                  ? "bg-m3-primary text-white shadow-md shadow-m3-primary/30 ring-4 ring-m3-primary/10 scale-105"
                  : "bg-m3-grey-200 text-m3-grey-600 border border-[rgba(145,158,171,0.32)] shadow-sm"
              }`}
            >
              {step > 1 ? "✓" : "1"}
            </div>
            <span
              className={`text-sm font-bold text-center leading-tight pt-1 ${
                step >= 1 ? "text-m3-primary-darker font-extrabold" : "text-m3-grey-600"
              }`}
            >
              {step > 1 ? "สินค้าถูกต้อง" : "สินค้าและจำนวน"}
            </span>
          </div>

          <div
            className={`h-1 w-16 -mt-6 transition-all duration-300 rounded-full ${
              step > 1 ? "bg-m3-primary" : "bg-m3-grey-300"
            }`}
          />

          {/* Step 2 */}
          <div className="flex flex-col items-center gap-1.5 flex-1">
            <div
              className={`w-11 h-11 rounded-full flex items-center justify-center text-base font-extrabold transition-all duration-300 ${
                step >= 2
                  ? "bg-m3-primary text-white shadow-md shadow-m3-primary/30 ring-4 ring-m3-primary/10 scale-105"
                  : "bg-m3-grey-200 text-m3-grey-600 border border-[rgba(145,158,171,0.32)] shadow-sm"
              }`}
            >
              2
            </div>
            <span
              className={`text-sm font-bold text-center leading-tight pt-1 ${
                step >= 2 ? "text-m3-primary-darker font-extrabold" : "text-m3-grey-600"
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
        feedbackHandledByCaller
        feedback={scanFeedback}
        isOpen={isCameraOpen}
        onClose={() => setIsCameraOpen(false)}
        onScanSuccess={(scannedText, playSound) => {
          const result = handleScanBarcode(scannedText, playSound);
          setIsCameraOpen(false);
          return result;
        }}
      />
    </div>
  );
}

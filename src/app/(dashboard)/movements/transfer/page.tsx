"use client";

import { useSearchParams } from "next/navigation";
import { useWarehouseData } from "@/hooks/use-warehouse-data";
import WarehouseTabs from "@/components/warehouse/WarehouseTabs";
import CameraBarcodeScannerModal from "@/components/ui/CameraBarcodeScannerModal";
import { useTransferMovement, defaultStaff } from "./_hooks/use-transfer-movement";
import TransferNotificationList from "./_components/TransferNotificationList";
import TransferForm from "./_components/TransferForm";
import TransferStaffWorkflowModal from "./_components/TransferStaffWorkflowModal";

export default function TransferPage() {
  const searchParams = useSearchParams();
  const whParam = searchParams?.get("warehouse_id") || searchParams?.get("wh");

  const {
    activeWhId,
    setActiveWhId,
    warehouses,
    products,
    refreshData,
  } = useWarehouseData({ initialWarehouseId: whParam || undefined });

  const transferHook = useTransferMovement({
    activeWhId,
    warehouses,
    products,
    refreshData,
  });

  const {
    activeMode,
    setActiveMode,
    tabUser,
    form,
    pendingTasks,
    cancellingId,
    isCleaningUp,
    selectedTask,
    setSelectedTask,
    staffStep,
    setStaffStep,
    staffScanProductInput,
    setStaffScanProductInput,
    staffScanWhInput,
    setStaffScanWhInput,
    staffScanLocationInput,
    setStaffScanLocationInput,
    staffError,
    staffSuccess,
    isStaffCameraOpen,
    setIsStaffCameraOpen,
    staffCameraTarget,
    setStaffCameraTarget,
    staffProductInputRef,
    staffWhInputRef,
    staffLocationInputRef,
    watchProduct,
    watchFromWh,
    watchToWh,
    selectedProduct,
    handleCleanupHistory,
    handleCancelTransfer,
    handleVerifyProductBarcode,
    handleVerifyWarehouseBarcode,
    handleVerifyLocationBarcode,
    onSubmit,
    resetForm,
    error,
    setError,
  } = transferHook;

  const isAdmin = tabUser?.role === "ADMIN";

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Warehouse Tabs Header */}
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
            <svg className="w-5 h-5 text-amber-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
            <h2 className="font-bold text-white text-lg sm:text-xl">โอนสินค้าระหว่างโกดัง</h2>
          </div>

          {isAdmin && (
            <div className="flex items-center gap-1.5 p-1 bg-slate-900/80 rounded-xl border border-slate-800 text-xs">
              <button
                type="button"
                onClick={() => setActiveMode("ADMIN_CREATE")}
                className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                  activeMode === "ADMIN_CREATE"
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                สร้างใบย้ายสินค้า
              </button>
              <button
                type="button"
                onClick={() => setActiveMode("STAFF_EXECUTE")}
                className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                  activeMode === "STAFF_EXECUTE"
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                รายการที่ต้องย้าย ({pendingTasks.length})
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Mode View */}
      {activeMode === "ADMIN_CREATE" && isAdmin ? (
        <div className="space-y-6">
          <TransferForm
            form={form}
            warehouses={warehouses}
            products={products}
            selectedProduct={selectedProduct}
            staffList={defaultStaff}
            watchProduct={watchProduct}
            watchFromWh={watchFromWh}
            watchToWh={watchToWh}
            error={error}
            onSubmit={onSubmit}
            onErrorPrompt={setError}
          />

          <TransferNotificationList
            notifications={pendingTasks}
            isAdmin={isAdmin}
            onSelectTask={(task) => {
              setSelectedTask(task);
              setStaffStep(1);
            }}
            onCancelTask={handleCancelTransfer}
            onCleanupHistory={handleCleanupHistory}
            isCleaningUp={isCleaningUp}
            cancellingId={cancellingId}
          />
        </div>
      ) : (
        <TransferNotificationList
          notifications={pendingTasks}
          isAdmin={isAdmin}
          onSelectTask={(task) => {
            setSelectedTask(task);
            setStaffStep(1);
          }}
          onCancelTask={handleCancelTransfer}
          onCleanupHistory={handleCleanupHistory}
          isCleaningUp={isCleaningUp}
          cancellingId={cancellingId}
        />
      )}

      {/* Staff Guided 3-Step Execution Modal */}
      <TransferStaffWorkflowModal
        selectedTask={selectedTask}
        onClose={() => setSelectedTask(null)}
        staffStep={staffStep}
        setStaffStep={setStaffStep}
        staffScanProductInput={staffScanProductInput}
        setStaffScanProductInput={setStaffScanProductInput}
        staffScanWhInput={staffScanWhInput}
        setStaffScanWhInput={setStaffScanWhInput}
        staffScanLocationInput={staffScanLocationInput}
        setStaffScanLocationInput={setStaffScanLocationInput}
        staffError={staffError}
        staffSuccess={staffSuccess}
        staffProductInputRef={staffProductInputRef}
        staffWhInputRef={staffWhInputRef}
        staffLocationInputRef={staffLocationInputRef}
        onVerifyProductBarcode={handleVerifyProductBarcode}
        onVerifyWarehouseBarcode={handleVerifyWarehouseBarcode}
        onVerifyLocationBarcode={handleVerifyLocationBarcode}
        onOpenStaffCamera={(target) => {
          setStaffCameraTarget(target);
          setIsStaffCameraOpen(true);
        }}
      />

      {/* Camera Barcode Scanner for Staff modal */}
      <CameraBarcodeScannerModal
        isOpen={isStaffCameraOpen}
        onClose={() => setIsStaffCameraOpen(false)}
        onScanSuccess={(scannedText) => {
          if (staffCameraTarget === "PRODUCT") {
            handleVerifyProductBarcode(scannedText);
          } else if (staffCameraTarget === "WAREHOUSE") {
            handleVerifyWarehouseBarcode(scannedText);
          } else if (staffCameraTarget === "LOCATION") {
            handleVerifyLocationBarcode(scannedText);
          }
          setIsStaffCameraOpen(false);
        }}
      />
    </div>
  );
}

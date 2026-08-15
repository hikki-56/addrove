"use client";

import { useSearchParams } from "next/navigation";
import { useWarehouseData } from "@/hooks/use-warehouse-data";

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
    staffScanSourceLocationInput,
    setStaffScanSourceLocationInput,
    staffScanDestLocationInput,
    setStaffScanDestLocationInput,
    staffError,
    staffSuccess,
    isStaffCameraOpen,
    setIsStaffCameraOpen,
    staffCameraTarget,
    setStaffCameraTarget,
    staffProductInputRef,
    staffSourceLocationInputRef,
    staffDestLocationInputRef,
    watchProduct,
    watchFromWh,
    watchToWh,
    selectedProduct,
    handleCleanupHistory,
    handleCancelTransfer,
    handleVerifyProductBarcode,
    handleVerifySourceLocationBarcode,
    handleVerifyDestinationLocationBarcode,
    onSubmit,
    resetForm,
    error,
    setError,
  } = transferHook;

  const isAdmin = tabUser?.role === "ADMIN";

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Warehouse Header */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-amber-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
            <h2 className="font-bold text-slate-800 text-lg sm:text-xl">โอนสินค้าระหว่างโกดัง</h2>
          </div>

          {isAdmin && (
            <div className="flex items-center gap-1.5 p-1 bg-slate-100/90 rounded-2xl border border-slate-200 text-xs font-bold">
              <button
                type="button"
                onClick={() => setActiveMode("ADMIN_CREATE")}
                className={`px-3.5 py-2 rounded-xl font-bold transition-all cursor-pointer ${
                  activeMode === "ADMIN_CREATE"
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                สร้างใบย้ายสินค้า
              </button>
              <button
                type="button"
                onClick={() => setActiveMode("STAFF_EXECUTE")}
                className={`px-3.5 py-2 rounded-xl font-bold transition-all cursor-pointer flex items-center gap-2 ${
                  activeMode === "STAFF_EXECUTE"
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span>ติดตามขั้นตอนพนักงาน ({pendingTasks.length})</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Mode View */}
      {activeMode === "ADMIN_CREATE" && isAdmin ? (
        <TransferForm
          form={form}
          warehouses={warehouses}
          products={transferHook.fromWhProducts.length > 0 ? transferHook.fromWhProducts : products}
          selectedProduct={selectedProduct}
          staffList={transferHook.staffList}
          watchProduct={watchProduct}
          watchFromWh={watchFromWh}
          watchToWh={watchToWh}
          error={error}
          onSubmit={onSubmit}
          onErrorPrompt={setError}
          selectedItems={transferHook.selectedItems}
          addTransferItem={transferHook.addTransferItem}
          updateItemQty={transferHook.updateItemQty}
          removeItem={transferHook.removeItem}
          clearItems={transferHook.clearItems}
        />
      ) : (
        <TransferNotificationList
          notifications={pendingTasks}
          isAdmin={isAdmin}
          onSelectTask={(task) => {
            if (!isAdmin) {
              setSelectedTask(task);
              setStaffStep(1);
            }
          }}
          onCancelTask={handleCancelTransfer}
          onCleanupHistory={handleCleanupHistory}
          isCleaningUp={isCleaningUp}
          cancellingId={cancellingId}
        />
      )}

      {/* Staff Guided 4-Step Execution Modal */}
      <TransferStaffWorkflowModal
        selectedTask={selectedTask}
        onClose={() => setSelectedTask(null)}
        staffStep={staffStep}
        setStaffStep={setStaffStep}
        staffScanProductInput={staffScanProductInput}
        setStaffScanProductInput={setStaffScanProductInput}
        staffScanSourceLocationInput={staffScanSourceLocationInput}
        setStaffScanSourceLocationInput={setStaffScanSourceLocationInput}
        staffScanDestLocationInput={staffScanDestLocationInput}
        setStaffScanDestLocationInput={setStaffScanDestLocationInput}
        sourceAllocations={transferHook.sourceAllocations}
        onUpdateSourceAllocationQty={transferHook.handleUpdateSourceAllocationQty}
        onRemoveSourceAllocation={transferHook.handleRemoveSourceAllocation}
        onProceedToDestStep={transferHook.handleProceedToDestStep}
        staffError={staffError}
        staffSuccess={staffSuccess}
        staffProductInputRef={staffProductInputRef}
        staffSourceLocationInputRef={staffSourceLocationInputRef}
        staffDestLocationInputRef={staffDestLocationInputRef}
        onVerifyProductBarcode={handleVerifyProductBarcode}
        onVerifySourceLocationBarcode={handleVerifySourceLocationBarcode}
        onVerifyDestinationLocationBarcode={handleVerifyDestinationLocationBarcode}
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
          } else if (staffCameraTarget === "SOURCE_LOCATION") {
            handleVerifySourceLocationBarcode(scannedText);
          } else if (staffCameraTarget === "DEST_LOCATION") {
            handleVerifyDestinationLocationBarcode(scannedText);
          }
          setIsStaffCameraOpen(false);
        }}
      />
    </div>
  );
}

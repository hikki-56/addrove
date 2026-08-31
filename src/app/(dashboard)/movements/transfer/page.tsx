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
    waitingApprovalTasks,
    approvingId,
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
    handleApproveTransfer,
    handleRejectTransfer,
    handleVerifyProductBarcode,
    handleVerifySourceLocationBarcode,
    handleVerifyDestinationLocationBarcode,
    onSubmit,
    resetForm,
    error,
    setError,
  } = transferHook;

  const isAdmin = tabUser?.role === "ADMIN";
  const isApprover = tabUser?.role === "APPROVER";
  const canApprove = isAdmin || isApprover;

  const containerWidth = "max-w-4xl lg:max-w-5xl";

  return (
    <div className={`${containerWidth} mx-auto w-full px-3 sm:px-6 pt-2 pb-20 sm:pt-4 sm:pb-8 space-y-4`}>
      {isApprover ? (
        /* Dedicated Approver Banner */
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <span className="px-3.5 py-1 rounded-full text-sm font-bold bg-amber-500 text-slate-950 shadow-xs shrink-0">
            รออนุมัติ {waitingApprovalTasks.length} รายการ
          </span>
        </div>
      ) : (
        /* Segmented Switch Bar: สลับไปทำรายการ / สร้างใบย้าย / รออนุมัติ */
        <div className={`grid ${isAdmin || waitingApprovalTasks.length > 0 ? "grid-cols-3" : "grid-cols-2"} p-1.5 bg-slate-100 border border-slate-200 rounded-2xl gap-1.5 sm:gap-2 shadow-xs items-stretch`}>
          <button
            type="button"
            onClick={() => setActiveMode("ADMIN_CREATE")}
            className={`relative w-full h-full min-h-[58px] sm:min-h-[46px] py-2 sm:py-2.5 px-2 sm:px-3 rounded-xl font-bold text-xs sm:text-sm transition-all flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 cursor-pointer border text-center ${
              activeMode === "ADMIN_CREATE"
                ? "bg-white text-slate-900 shadow-xs border-slate-200"
                : "text-slate-600 hover:text-slate-900 border-transparent hover:bg-white/60"
            }`}
          >
            <svg className="w-4 h-4 text-emerald-700 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span className="leading-tight">สร้างใบเบิกสินค้า</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveMode("STAFF_EXECUTE")}
            className={`relative w-full h-full min-h-[58px] sm:min-h-[46px] py-2 sm:py-2.5 px-2 sm:px-3 rounded-xl font-bold text-xs sm:text-sm transition-all flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 cursor-pointer border text-center ${
              activeMode === "STAFF_EXECUTE"
                ? "bg-white text-slate-900 shadow-xs border-slate-200"
                : "text-slate-600 hover:text-slate-900 border-transparent hover:bg-white/60"
            }`}
          >
            <svg className="w-4 h-4 text-indigo-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
            <span className="leading-tight">รายการที่ต้องไปเบิก</span>
            {pendingTasks.length > 0 && (
              <span className="absolute top-1.5 right-1.5 sm:static sm:top-auto sm:right-auto px-1.5 sm:px-2 py-0.5 rounded-full text-[11px] sm:text-xs font-black bg-rose-600 text-white shadow-xs">
                {pendingTasks.length}
              </span>
            )}
          </button>

          {(isAdmin || waitingApprovalTasks.length > 0) && (
            <button
              type="button"
              onClick={() => setActiveMode("WAITING_APPROVAL")}
              className={`relative w-full h-full min-h-[58px] sm:min-h-[46px] py-2 sm:py-2.5 px-2 sm:px-3 rounded-xl font-bold text-xs sm:text-sm transition-all flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 cursor-pointer border text-center ${
                activeMode === "WAITING_APPROVAL"
                  ? "bg-white text-slate-900 shadow-xs border-slate-200"
                : "text-slate-600 hover:text-slate-900 border-transparent hover:bg-white/60"
              }`}
            >
              <svg className="w-4 h-4 text-amber-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              <span className="leading-tight">รออนุมัติ</span>
              {waitingApprovalTasks.length > 0 && (
                <span className="absolute top-1.5 right-1.5 sm:static sm:top-auto sm:right-auto px-1.5 sm:px-2 py-0.5 rounded-full text-[11px] sm:text-xs font-black bg-amber-500 text-slate-950 shadow-xs">
                  {waitingApprovalTasks.length}
                </span>
              )}
            </button>
          )}
        </div>
      )}

      {/* Main View based on activeMode */}
      {activeMode === "ADMIN_CREATE" ? (
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
          successMessage={transferHook.successMessage}
          onSubmit={onSubmit}
          onErrorPrompt={setError}
          selectedItems={transferHook.selectedItems}
          addTransferItem={transferHook.addTransferItem}
          updateItemQty={transferHook.updateItemQty}
          /* toLocaleString formatted inside TransferForm */
          removeItem={transferHook.removeItem}
          clearItems={transferHook.clearItems}
        />
      ) : activeMode === "WAITING_APPROVAL" ? (
        <TransferNotificationList
          notifications={waitingApprovalTasks}
          isAdmin={canApprove}
          products={transferHook.fromWhProducts.length > 0 ? transferHook.fromWhProducts : products}
          onSelectTask={(task) => {
            if (!canApprove && task.status !== "WAITING_APPROVAL") {
              setSelectedTask(task);
              setStaffStep(task.current_step && task.current_step >= 1 && task.current_step <= 3 ? task.current_step : 1);
            }
          }}
          onCancelTask={canApprove ? handleCancelTransfer : undefined}
          onApproveTask={handleApproveTransfer}
          onRejectTask={handleRejectTransfer}
          onCleanupHistory={handleCleanupHistory}
          isCleaningUp={isCleaningUp}
          cancellingId={cancellingId}
          approvingId={approvingId}
        />
      ) : (
        /* activeMode === "STAFF_EXECUTE" */
        <TransferNotificationList
          notifications={pendingTasks}
          isAdmin={isAdmin}
          products={transferHook.fromWhProducts.length > 0 ? transferHook.fromWhProducts : products}
          onSelectTask={(task) => {
            setSelectedTask(task);
            setStaffStep(task.current_step && task.current_step >= 1 && task.current_step <= 3 ? task.current_step : 1);
          }}
          onCancelTask={isAdmin ? handleCancelTransfer : undefined}
          onApproveTask={handleApproveTransfer}
          onRejectTask={handleRejectTransfer}
          onCleanupHistory={handleCleanupHistory}
          isCleaningUp={isCleaningUp}
          cancellingId={cancellingId}
          approvingId={approvingId}
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
        scannedToLocation={transferHook.scannedToLocation}
        setScannedToLocation={transferHook.setScannedToLocation}
        isSubmittingTransfer={transferHook.isSubmittingTransfer}
        onSubmitTransfer={transferHook.handleSubmitTransfer}
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

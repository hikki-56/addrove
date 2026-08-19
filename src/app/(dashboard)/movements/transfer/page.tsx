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

  const containerWidth =
    activeMode === "WAITING_APPROVAL" && isAdmin
      ? "max-w-4xl"
      : activeMode === "STAFF_EXECUTE"
      ? "max-w-2xl"
      : "max-w-md";

  return (
    <div className={`${containerWidth} mx-auto w-full px-2 sm:px-4 space-y-4`}>
      {/* Segmented Switch Bar: สลับไปทำรายการ / สร้างใบย้าย / รออนุมัติ */}
      <div className="flex items-center p-1 bg-slate-100/90 border border-slate-200/80 rounded-2xl gap-1 shadow-xs">
        <button
          type="button"
          onClick={() => setActiveMode("ADMIN_CREATE")}
          className={`flex-1 py-2.5 px-2.5 rounded-xl font-black text-xs sm:text-sm transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
            activeMode === "ADMIN_CREATE"
              ? "bg-white text-emerald-800 shadow-xs border border-slate-200/60"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <span>➕ สร้างใบเบิกสินค้า</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveMode("STAFF_EXECUTE")}
          className={`flex-1 py-2.5 px-2.5 rounded-xl font-black text-xs sm:text-sm transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
            activeMode === "STAFF_EXECUTE"
              ? "bg-white text-indigo-700 shadow-xs border border-slate-200/60"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          <span>📦 รายการที่ต้องไปเบิก</span>
          {pendingTasks.length > 0 && (
            <span className="px-2 py-0.5 rounded-full text-[11px] font-black bg-rose-500 text-white animate-pulse">
              {pendingTasks.length}
            </span>
          )}
        </button>

        {(isAdmin || waitingApprovalTasks.length > 0) && (
          <button
            type="button"
            onClick={() => setActiveMode("WAITING_APPROVAL")}
            className={`flex-1 py-2.5 px-2.5 rounded-xl font-black text-xs sm:text-sm transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              activeMode === "WAITING_APPROVAL"
                ? "bg-white text-indigo-900 shadow-xs border border-slate-200/60"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <span>🛡️ รออนุมัติ</span>
            {waitingApprovalTasks.length > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[11px] font-black bg-amber-500 text-white">
                {waitingApprovalTasks.length}
              </span>
            )}
          </button>
        )}
      </div>

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
          onSubmit={onSubmit}
          onErrorPrompt={setError}
          selectedItems={transferHook.selectedItems}
          addTransferItem={transferHook.addTransferItem}
          updateItemQty={transferHook.updateItemQty}
          removeItem={transferHook.removeItem}
          clearItems={transferHook.clearItems}
        />
      ) : activeMode === "WAITING_APPROVAL" ? (
        <TransferNotificationList
          notifications={waitingApprovalTasks}
          isAdmin={isAdmin}
          onSelectTask={(task) => {
            if (!isAdmin && task.status !== "WAITING_APPROVAL") {
              setSelectedTask(task);
              setStaffStep(1);
            }
          }}
          onCancelTask={handleCancelTransfer}
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
          onSelectTask={(task) => {
            setSelectedTask(task);
            setStaffStep(1);
          }}
          onCancelTask={handleCancelTransfer}
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

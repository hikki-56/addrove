"use client";

import { useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useWarehouseData } from "@/hooks/use-warehouse-data";
import { useTabAuth } from "@/context/TabAuthContext";

import { useTransferMovement } from "./_hooks/use-transfer-movement";
import TransferNotificationList from "./_components/TransferNotificationList";
import TransferForm from "./_components/TransferForm";
import TransferStaffWorkflowModal from "./_components/TransferStaffWorkflowModal";

export default function TransferPage() {
  const searchParams = useSearchParams();
  const whParam = searchParams?.get("warehouse_id") || searchParams?.get("wh");
  const { user: authUser, status: authStatus } = useTabAuth();
  const router = useRouter();

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
    actionError,
    clearActionError,
    confirmDialogElement,
  } = transferHook;

  const isAdmin = tabUser?.role === "ADMIN";
  const isApprover = tabUser?.role === "APPROVER";
  const canApprove = isAdmin || isApprover;

  // Guard role (สเปก 10.13): WAREHOUSE_STAFF ที่พิมพ์ URL /movements/transfer ตรง
  // ให้เด้งไปหน้าพนักงาน /staff/transfer — ไม่พึ่งการซ่อนเมนูเพียงอย่างเดียว
  // คง query string (warehouse_id) เดิมไว้ เพื่อไม่ให้โกดังจาก deep-link หายระหว่างเด้ง
  useEffect(() => {
    if (authStatus !== "loading" && authUser?.role === "WAREHOUSE_STAFF") {
      const query = typeof window !== "undefined" ? window.location.search : "";
      router.replace(`/staff/transfer${query}`);
    }
  }, [authStatus, authUser, router]);

  const containerWidth = "max-w-4xl lg:max-w-5xl";

  if (authStatus !== "loading" && authUser?.role === "WAREHOUSE_STAFF") {
    return null;
  }

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
        <div className={`grid ${isAdmin || waitingApprovalTasks.length > 0 ? "grid-cols-3" : "grid-cols-2"} p-2 bg-[#F8FAF9] border border-[#E5E7EB] rounded-[16px] gap-2 items-stretch shadow-[0_1px_2px_rgba(16,24,40,0.04)]`}>
          <button
            type="button"
            onClick={() => setActiveMode("ADMIN_CREATE")}
            className={`relative w-full h-full min-h-[58px] sm:min-h-[48px] py-2 px-2 sm:px-3 rounded-[14px] font-semibold text-sm transition-all duration-200 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 cursor-pointer text-center active:scale-[0.98] ${
              activeMode === "ADMIN_CREATE"
                ? "bg-white text-slate-900 border border-[#E5E7EB] shadow-[0_2px_8px_-2px_rgba(16,24,40,0.08)]"
                : "text-slate-500 hover:text-slate-800 border border-transparent hover:bg-white/70"
            }`}
          >
            <svg
              className="w-[18px] h-[18px] shrink-0 transition-colors duration-200"
              style={{ color: activeMode === "ADMIN_CREATE" ? "#0F5C3F" : "#94A3B8" }}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 4v16m8-8H4" />
            </svg>
            <span className="leading-tight">สร้างใบเบิกสินค้า</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveMode("STAFF_EXECUTE")}
            className={`relative w-full h-full min-h-[58px] sm:min-h-[48px] py-2 px-2 sm:px-3 rounded-[14px] font-semibold text-sm transition-all duration-200 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 cursor-pointer text-center active:scale-[0.98] ${
              activeMode === "STAFF_EXECUTE"
                ? "bg-white text-slate-900 border border-[#E5E7EB] shadow-[0_2px_8px_-2px_rgba(16,24,40,0.08)]"
                : "text-slate-500 hover:text-slate-800 border border-transparent hover:bg-white/70"
            }`}
          >
            <svg
              className="w-[18px] h-[18px] shrink-0 transition-colors duration-200"
              style={{ color: activeMode === "STAFF_EXECUTE" ? "#0F5C3F" : "#94A3B8" }}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
            <span className="leading-tight">รายการที่ต้องไปเบิก</span>
            {pendingTasks.length > 0 && (
              <span className="absolute top-1.5 right-1.5 sm:static sm:top-auto sm:right-auto min-w-[20px] h-5 px-1.5 rounded-full text-xs font-bold bg-rose-500/90 text-white ring-2 ring-white flex items-center justify-center tabular-nums">
                {pendingTasks.length}
              </span>
            )}
          </button>

          {(isAdmin || waitingApprovalTasks.length > 0) && (
            <button
              type="button"
              onClick={() => setActiveMode("WAITING_APPROVAL")}
              className={`relative w-full h-full min-h-[58px] sm:min-h-[48px] py-2 px-2 sm:px-3 rounded-[14px] font-semibold text-sm transition-all duration-200 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 cursor-pointer text-center active:scale-[0.98] ${
                activeMode === "WAITING_APPROVAL"
                  ? "bg-white text-slate-900 border border-[#E5E7EB] shadow-[0_2px_8px_-2px_rgba(16,24,40,0.08)]"
                  : "text-slate-500 hover:text-slate-800 border border-transparent hover:bg-white/70"
              }`}
            >
              <svg
                className="w-[18px] h-[18px] shrink-0 transition-colors duration-200"
                style={{ color: activeMode === "WAITING_APPROVAL" ? "#B45309" : "#94A3B8" }}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              <span className="leading-tight">รออนุมัติ</span>
              {waitingApprovalTasks.length > 0 && (
                <span className="absolute top-1.5 right-1.5 sm:static sm:top-auto sm:right-auto min-w-[20px] h-5 px-1.5 rounded-full text-xs font-bold bg-amber-400/90 text-amber-950 ring-2 ring-white flex items-center justify-center tabular-nums">
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
          errorBanner={actionError}
          onDismissError={clearActionError}
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
          errorBanner={actionError}
          onDismissError={clearActionError}
        />
      )}

      {/* Staff Guided 4-Step Execution Modal */}
      <TransferStaffWorkflowModal
        selectedTask={selectedTask}
        products={transferHook.fromWhProducts.length > 0 ? transferHook.fromWhProducts : products}
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
      />

      {/* Modal ยืนยันแบบอ่านง่าย (แทน window.confirm) */}
      {confirmDialogElement}
    </div>
  );
}

"use client";

import { useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useWarehouseData } from "@/hooks/use-warehouse-data";
import { useTabAuth } from "@/context/TabAuthContext";

import { useTransferMovement } from "@/features/transfer/hooks/use-transfer-movement";
import TransferNotificationList from "@/features/transfer/components/TransferNotificationList";
import TransferForm from "@/features/transfer/components/TransferForm";
import TransferStaffWorkflowModal from "@/features/transfer/components/TransferStaffWorkflowModal";
import { M3Banner } from "@/components/ui/m3";

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
    error: warehouseError,
    loading: productsLoading,
  } = useWarehouseData({ initialWarehouseId: whParam || undefined });

  const transferHook = useTransferMovement({
    activeWhId,
    warehouses,
    products,
    refreshData,
    productsLoading,
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
      {warehouseError && (
        <M3Banner
          tone="error"
          role="alert"
          action={
            <button type="button" className="m3-btn m3-btn-sm m3-btn-outline" onClick={() => void refreshData()}>
              ลองโหลดใหม่
            </button>
          }
        >
          {warehouseError}
        </M3Banner>
      )}
      {isApprover ? (
        /* Dedicated Approver Banner */
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <span className="m3-label m3-label-warning shrink-0">รออนุมัติ {waitingApprovalTasks.length} รายการ</span>
        </div>
      ) : (
        /* แท็บ: สร้างใบเบิก / รายการที่ต้องไปเบิก / รออนุมัติ — มือถือเป็นปุ่มเม็ดยา, จอใหญ่เป็นแท็บขีดเส้นใต้ (D17) */
        <nav
          aria-label="โหมดเบิกสินค้า"
          className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-0.5 sm:mx-0 sm:gap-8 sm:overflow-visible sm:rounded-2xl sm:bg-white sm:px-6 sm:pb-0 sm:shadow-m3-card"
        >
          {(
            [
              { mode: "ADMIN_CREATE", label: "สร้างใบเบิกสินค้า", show: true, badge: 0, badgeCls: "" },
              { mode: "STAFF_EXECUTE", label: "รายการที่ต้องไปเบิก", show: true, badge: pendingTasks.length, badgeCls: "bg-[rgba(0,184,217,0.16)] text-m3-info-dark" },
              { mode: "WAITING_APPROVAL", label: "รออนุมัติ", show: isAdmin || waitingApprovalTasks.length > 0, badge: waitingApprovalTasks.length, badgeCls: "bg-m3-warning text-m3-grey-800" },
            ] as const
          )
            .filter((t) => t.show)
            .map((t) => {
              const active = activeMode === t.mode;
              return (
                <button
                  key={t.mode}
                  type="button"
                  onClick={() => setActiveMode(t.mode)}
                  aria-current={active ? "page" : undefined}
                  className={`relative flex h-11 shrink-0 cursor-pointer items-center gap-2 rounded-full px-4 text-sm font-semibold whitespace-nowrap transition-colors sm:h-14 sm:rounded-none sm:px-0 sm:after:absolute sm:after:inset-x-0 sm:after:bottom-0 sm:after:h-0.5 sm:after:rounded-full ${
                    active
                      ? "text-m3-grey-800 max-sm:bg-m3-grey-800 max-sm:text-white sm:after:bg-m3-grey-800"
                      : "text-m3-grey-600 hover:text-m3-grey-800 max-sm:bg-m3-grey-200"
                  }`}
                >
                  <span>{t.label}</span>
                  {t.badge > 0 && (
                    <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-md px-1.5 text-xs font-bold tabular-nums ${t.badgeCls}`}>
                      {t.badge}
                    </span>
                  )}
                </button>
              );
            })}
        </nav>
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

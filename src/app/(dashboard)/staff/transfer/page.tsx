"use client";

import { useSearchParams } from "next/navigation";
import { useWarehouseData } from "@/hooks/use-warehouse-data";
import { useTransferMovement } from "@/features/transfer/hooks/use-transfer-movement";
import TransferNotificationList from "@/features/transfer/components/TransferNotificationList";
import TransferStaffWorkflowModal from "@/features/transfer/components/TransferStaffWorkflowModal";
import { M3Banner } from "@/components/ui/m3";
import { SolarHome, SolarRefresh } from "@/components/icons";

export default function StaffTransferPage() {
  const searchParams = useSearchParams();
  const whParam = searchParams?.get("warehouse_id") || searchParams?.get("wh");

  const {
    activeWhId,
    warehouses,
    products,
    refreshData,
    error: warehouseError,
    loading: productsLoading,
    getWarehouseName,
  } = useWarehouseData({ initialWarehouseId: whParam || undefined, loadLocations: false });

  const transferHook = useTransferMovement({
    activeWhId,
    warehouses,
    products,
    refreshData,
    productsLoading,
  });

  const {
    tabUser,
    pendingTasks,
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
    handleVerifyProductBarcode,
    handleVerifySourceLocationBarcode,
    handleVerifyDestinationLocationBarcode,
  } = transferHook;

  const activeWhName =
    warehouses.find((w) => w.warehouse_id === activeWhId)?.warehouse_name ||
    getWarehouseName(activeWhId);

  return (
    <div className="scale-original max-w-2xl mx-auto w-full px-2 sm:px-4 pb-20 sm:pb-8 space-y-4">
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
      {/* Staff Info Bar */}
      <div className="m3-card flex items-center justify-between gap-4 p-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-m3-grey-600">
          <span className="m3-label m3-label-primary shrink-0 gap-1.5">
            <SolarHome size={14} />
            {activeWhName}
          </span>
          <span className="truncate">
            พนักงาน: <span className="font-semibold text-m3-grey-800">{tabUser?.name || "พนักงานคลัง"}</span>
          </span>
        </div>

        <button type="button" onClick={() => refreshData()} className="m3-btn m3-btn-outline shrink-0 gap-1.5">
          <SolarRefresh size={16} className="shrink-0" />
          <span>รีเฟรช</span>
        </button>
      </div>

      {/* Task List: Only staff tasks without admin actions */}
      <TransferNotificationList
        notifications={pendingTasks}
        isAdmin={false}
        products={products}
        onSelectTask={(task) => {
          setSelectedTask(task);
          setStaffStep(task.current_step && task.current_step >= 1 && task.current_step <= 3 ? task.current_step : 1);
        }}
      />

      {/* Staff Guided 4-Step Execution Modal */}
      <TransferStaffWorkflowModal
        selectedTask={selectedTask}
        products={products}
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
        /* toLocaleString formatted inside TransferStaffWorkflowModal */
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
    </div>
  );
}

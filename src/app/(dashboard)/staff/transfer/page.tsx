"use client";

import { useSearchParams } from "next/navigation";
import { useWarehouseData } from "@/hooks/use-warehouse-data";
import CameraBarcodeScannerModal from "@/components/ui/CameraBarcodeScannerModal";
import { useTransferMovement } from "../../movements/transfer/_hooks/use-transfer-movement";
import TransferNotificationList from "../../movements/transfer/_components/TransferNotificationList";
import TransferStaffWorkflowModal from "../../movements/transfer/_components/TransferStaffWorkflowModal";

export default function StaffTransferPage() {
  const searchParams = useSearchParams();
  const whParam = searchParams?.get("warehouse_id") || searchParams?.get("wh");

  const {
    activeWhId,
    warehouses,
    products,
    refreshData,
    getWarehouseName,
  } = useWarehouseData({ initialWarehouseId: whParam || undefined });

  const transferHook = useTransferMovement({
    activeWhId,
    warehouses,
    products,
    refreshData,
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
    isStaffCameraOpen,
    setIsStaffCameraOpen,
    staffCameraTarget,
    setStaffCameraTarget,
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
    <div className="max-w-2xl mx-auto w-full px-2 sm:px-4 space-y-4">
      {/* Staff Header Card */}
      <div className="bg-white rounded-3xl p-5 border border-slate-200 shadow-sm flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-purple-500 animate-pulse" />
            <h1 className="font-extrabold text-slate-900 text-lg sm:text-xl tracking-tight">
              รายการที่ต้องไปเบิกสินค้า
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
            พนักงาน: <span className="font-bold text-slate-800">{tabUser?.name || "พนักงานคลัง"}</span> • <span className="font-extrabold text-indigo-700">{activeWhName}</span>
          </p>
        </div>

        <button
          type="button"
          onClick={() => refreshData()}
          className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs shrink-0"
        >
          <svg className="w-4 h-4 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span>รีเฟรช</span>
        </button>
      </div>

      {/* Task List: Only staff tasks without admin actions */}
      <TransferNotificationList
        notifications={pendingTasks}
        isAdmin={false}
        onSelectTask={(task) => {
          setSelectedTask(task);
          setStaffStep(task.current_step && task.current_step >= 1 && task.current_step <= 3 ? task.current_step : 1);
        }}
        onCancelTask={transferHook.handleCancelTransfer}
      />

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

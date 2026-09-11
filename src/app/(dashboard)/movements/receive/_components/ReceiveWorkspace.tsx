"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useWarehouseData } from "@/hooks/use-warehouse-data";
import { useTabAuth } from "@/context/TabAuthContext";
import BarcodeScanInput from "@/components/scanner/BarcodeScanInput";
import ScanFeedbackBanner from "@/components/scanner/ScanFeedbackBanner";
import CameraBarcodeScannerModal from "@/components/ui/CameraBarcodeScannerModal";

import { useReceiveMovement } from "../_hooks/use-receive-movement";
import { useReceivingPlans, isPlanOpen } from "../_hooks/use-receiving-plans";
import ReceiveLinesTable from "./ReceiveLinesTable";
import ReceiveConfirmModal from "./ReceiveConfirmModal";
import ReceiveSuccessCard from "./ReceiveSuccessCard";
import ReceivingPlanInbox from "./ReceivingPlanInbox";
import ReceivingPlanCreateForm from "./ReceivingPlanCreateForm";
import ReceivingPlanAllList from "./ReceivingPlanAllList";
import PlanProgressPanel from "./PlanProgressPanel";

const cardClass =
  "bg-white rounded-[20px] border border-[#E8ECEA] shadow-[0_1px_2px_rgba(16,24,40,0.05)]";

type ReceiveMode = "INBOX" | "SCAN" | "PLAN_CREATE" | "PLAN_ALL";

export default function ReceiveWorkspace() {
  const [mode, setMode] = useState<ReceiveMode>("SCAN");
  const { user: tabUser } = useTabAuth();
  const isAdmin = tabUser?.role === "ADMIN";

  const searchParams = useSearchParams();
  const whParam = searchParams?.get("warehouse_id") || searchParams?.get("wh") || "";

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

  const receiveHook = useReceiveMovement({
    activeWhId,
    setActiveWhId,
    locations,
    products,
    setProducts,
    refreshWarehouseData: refreshData,
  });

  // โหลดทุกสถานะ — inbox กรองเอาเฉพาะที่ยังเปิด, แท็บ "แผนทั้งหมด" ใช้ทั้งชุด (แอดมิน)
  const plansHook = useReceivingPlans({ activeWhId, includeAllStatuses: true });

  const {
    form,
    fields,
    remove,
    submitted,
    error,
    successMessage,
    barcodeInput,
    setBarcodeInput,
    barcodeInputRef,
    scanFeedback,
    setScanFeedback,
    confirmedLines,
    toggleConfirmLine,
    handleAddLocationForProduct,
    handleScanLocationForLine,
    handleScanBarcode,
    confirmModalOpen,
    setConfirmModalOpen,
    isCameraOpen,
    setIsCameraOpen,
    onSubmit,
    resetForm,
    watchLines,
    activePlan,
    startPlanReceive,
    exitPlanMode,
  } = receiveHook;

  const openPlans = plansHook.plans.filter(isPlanOpen);

  // ส่งเอกสารรับเข้า (ตามแผนหรือทั่วไป) สำเร็จ → ดึงสถานะแผนล่าสุด
  useEffect(() => {
    if (submitted) {
      plansHook.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitted]);

  const handleSelectPlan = (plan: (typeof plansHook.plans)[number]) => {
    startPlanReceive(plan);
    setMode("SCAN");
    setTimeout(() => {
      document.getElementById("receive-scan-input")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
  };

  if (submitted) {
    return (
      <div className="max-w-full sm:max-w-3xl md:max-w-4xl lg:max-w-5xl xl:max-w-6xl mx-auto pb-24 sm:pb-10">
        <ReceiveSuccessCard onReset={resetForm} successMessage={successMessage} />
        {activePlan && (
          <p className="mt-3 text-center text-sm text-slate-500 font-semibold">
            ส่งการรับตามแผน {activePlan.document_no} เรียบร้อย — รอแอดมินอนุมัติ และติดตามความคืบหน้าของแผนได้ในแท็บ “รายการที่ต้องรับ”
          </p>
        )}
      </div>
    );
  }

  const modeButtons: Array<{ value: ReceiveMode; label: string; badge?: number; adminOnly?: boolean }> = [
    { value: "INBOX", label: "รายการที่ต้องรับ", badge: openPlans.length },
    { value: "SCAN", label: activePlan ? "กำลังรับตามแผน" : "รับเข้า" },
    { value: "PLAN_CREATE", label: "สร้างแผนรับ", adminOnly: true },
    { value: "PLAN_ALL", label: "แผนทั้งหมด", adminOnly: true },
  ];
  const visibleModeButtons = modeButtons.filter((b) => !b.adminOnly || isAdmin);

  return (
    <div className="max-w-full sm:max-w-3xl md:max-w-4xl lg:max-w-5xl xl:max-w-6xl mx-auto pb-24 sm:pb-10 space-y-4 sm:space-y-5">
      {/* Segmented switch: รายการที่ต้องรับ / รับเข้า / (แอดมิน) สร้างแผน + แผนทั้งหมด */}
      <div
        className="p-1.5 bg-slate-100 border border-[#E8ECEA] rounded-2xl gap-1.5 sm:gap-2 shadow-xs items-stretch grid"
        style={{ gridTemplateColumns: `repeat(${visibleModeButtons.length}, minmax(0, 1fr))` }}
      >
        {visibleModeButtons.map((btn) => (
          <button
            key={btn.value}
            type="button"
            onClick={() => setMode(btn.value)}
            className={`relative w-full h-full min-h-[58px] sm:min-h-[46px] py-2 px-2 sm:px-3 rounded-xl font-bold text-sm transition-colors flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 cursor-pointer border text-center ${
              mode === btn.value
                ? "bg-white text-slate-900 shadow-xs border-[#E8ECEA]"
                : "text-slate-600 hover:text-slate-900 border-transparent hover:bg-white/60"
            }`}
          >
            <span className="leading-tight">{btn.label}</span>
            {!!btn.badge && btn.badge > 0 && (
              <span className="absolute top-1.5 right-1.5 sm:static sm:top-auto sm:right-auto px-2 py-0.5 rounded-full text-[13px] font-black bg-rose-600 text-white shadow-xs">
                {btn.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {mode === "INBOX" && (
        <>
          {(plansHook.actionError || plansHook.error) && (
            <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-sm font-semibold">
              {plansHook.actionError || plansHook.error}
            </div>
          )}
          <ReceivingPlanInbox
            plans={openPlans}
            loading={plansHook.loading}
            error={plansHook.error}
            warehouseName={activeWhName}
            onSelectPlan={handleSelectPlan}
          />
        </>
      )}

      {mode === "PLAN_CREATE" && isAdmin && (
        <>
          {(plansHook.actionError || plansHook.error) && (
            <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-sm font-semibold">
              {plansHook.actionError || plansHook.error}
            </div>
          )}
          {plansHook.actionSuccess && (
            <div className="p-4 rounded-2xl bg-[#EAF2EE] border border-[#C9DFD4] text-[#052B1F] text-sm font-bold flex items-center gap-2.5 shadow-xs">
              <svg className="w-5 h-5 text-[#053425] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
              <span>{plansHook.actionSuccess}</span>
            </div>
          )}
          <ReceivingPlanCreateForm
            warehouses={warehouses}
            products={products}
            defaultWarehouseId={activeWhId}
            isSubmitting={plansHook.isMutating}
            onSubmit={plansHook.createPlan}
          />
        </>
      )}

      {mode === "PLAN_ALL" && isAdmin && (
        <>
          {(plansHook.actionError || plansHook.error) && (
            <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-sm font-semibold">
              {plansHook.actionError || plansHook.error}
            </div>
          )}
          {plansHook.actionSuccess && (
            <div className="p-4 rounded-2xl bg-[#EAF2EE] border border-[#C9DFD4] text-[#052B1F] text-sm font-bold flex items-center gap-2.5 shadow-xs">
              <svg className="w-5 h-5 text-[#053425] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
              <span>{plansHook.actionSuccess}</span>
            </div>
          )}
          <ReceivingPlanAllList
            plans={plansHook.plans}
            loading={plansHook.loading}
            error={plansHook.error}
            isMutating={plansHook.isMutating}
            onClosePlan={(plan) => plansHook.closePlan(plan.document_id, "ปิดแผนโดยแอดมิน — ของที่เหลือไม่มาอีกแล้ว")}
            onCancelPlan={(plan) => plansHook.cancelPlan(plan.document_id, "ยกเลิกโดยแอดมิน")}
          />
        </>
      )}

      {mode === "SCAN" && (
        <>
          <section className={`${cardClass} p-3.5 sm:p-4 flex items-center justify-between gap-4`}>
            <div className="flex items-center gap-2 sm:gap-2.5 flex-wrap">
              <span className="inline-flex items-center gap-1.5 bg-[#EAF2EE] px-3 py-1.5 rounded-full border border-[#DFEDE6] text-sm font-bold text-[#052B1F] shrink-0">
                <span className="w-2.5 h-2.5 rounded-full bg-[#0F5C3F] shrink-0" />
                {activeWhName}
              </span>

              <span className="inline-flex items-center gap-1.5 text-sm text-slate-600 font-semibold shrink-0">
                <svg className="w-4 h-4 text-slate-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                {form.watch("document_date")
                  ? new Date(form.watch("document_date") + "T00:00:00").toLocaleDateString("th-TH", { year: "numeric", month: "long", day: "numeric" })
                  : new Date().toLocaleDateString("th-TH", { year: "numeric", month: "long", day: "numeric" })}
              </span>
            </div>

            <button
              type="button"
              onClick={() => {
                refreshData();
                plansHook.refresh();
              }}
              className="min-h-11 px-3.5 rounded-xl bg-black/[.04] hover:bg-black/[.07] text-slate-700 font-bold text-sm transition-colors cursor-pointer flex items-center gap-1.5 shrink-0"
            >
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>รีเฟรช</span>
            </button>
          </section>

          {activePlan && (
            <PlanProgressPanel
              plan={activePlan}
              formLines={watchLines}
              onExitPlan={exitPlanMode}
            />
          )}

          <div id="receive-scan-input">
            <BarcodeScanInput
              value={barcodeInput}
              onChange={setBarcodeInput}
              onScanSubmit={handleScanBarcode}
              onOpenScannerModal={() => setIsCameraOpen(true)}
              inputRef={barcodeInputRef}
              placeholder={
                activePlan
                  ? `กำลังรับตามแผน ${activePlan.document_no} — สแกนเฉพาะสินค้าในแผน / ตำแหน่ง…`
                  : "สแกนบาร์โค้ดสินค้า / ตำแหน่ง / โกดัง…"
              }
            />
          </div>

          {scanFeedback && (
            <ScanFeedbackBanner
              feedback={scanFeedback}
              onDismiss={() => setScanFeedback(null)}
              className="fade-in"
            />
          )}

          {error && (
            <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-sm font-semibold fade-in">
              {error}
            </div>
          )}

          <ReceiveLinesTable
            form={form}
            fields={fields}
            locations={locations}
            products={products}
            activeWhId={activeWhId}
            confirmedLines={confirmedLines}
            onToggleConfirm={toggleConfirmLine}
            onAddLocationForProduct={handleAddLocationForProduct}
            onRemove={remove}
            onScanLocation={handleScanLocationForLine}
            onScanFeedback={setScanFeedback}
            onOpenConfirmModal={() => setConfirmModalOpen(true)}
          />

          <ReceiveConfirmModal
            isOpen={confirmModalOpen}
            onClose={() => setConfirmModalOpen(false)}
            form={form}
            locations={locations}
            products={products}
            activeWhName={activeWhName}
            onSubmit={onSubmit}
          />

          <CameraBarcodeScannerModal
            isOpen={isCameraOpen}
            onClose={() => setIsCameraOpen(false)}
            onScan={(scannedText) => {
              handleScanBarcode(scannedText);
            }}
          />
        </>
      )}
    </div>
  );
}

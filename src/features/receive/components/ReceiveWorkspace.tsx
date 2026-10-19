"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useWarehouseData } from "@/hooks/use-warehouse-data";
import { useTabAuth } from "@/context/TabAuthContext";
import BarcodeScanInput from "@/components/scanner/BarcodeScanInput";
import ScanFeedbackBanner from "@/components/scanner/ScanFeedbackBanner";
import CameraBarcodeScannerModal from "@/components/ui/CameraBarcodeScannerModal";

import { useReceiveMovement } from "@/features/receive/hooks/use-receive-movement";
import { useReceivingPlans, isPlanOpen } from "@/features/receive/hooks/use-receiving-plans";
import ReceiveLinesTable from "./ReceiveLinesTable";
import ReceiveConfirmModal from "./ReceiveConfirmModal";
import ReceiveSuccessCard from "./ReceiveSuccessCard";
import ReceivingPlanInbox from "./ReceivingPlanInbox";
import ReceivingPlanCreateForm from "./ReceivingPlanCreateForm";
import ReceivingPlanAllList from "./ReceivingPlanAllList";
import PlanProgressPanel from "./PlanProgressPanel";
import ReceiveRestoreBanner from "./ReceiveRestoreBanner";
import PlanExitConfirmModal from "./PlanExitConfirmModal";
import { ReceiveSummaryCard } from "./ReceiveLinesTable";
import { M3Banner } from "@/components/ui/m3";
import { SolarCalendarPlan, SolarHome, SolarRefresh } from "@/components/icons";

const cardClass =
  "m3-card";

type ReceiveMode = "INBOX" | "SCAN" | "PLAN_CREATE" | "PLAN_ALL";

export default function ReceiveWorkspace() {
  const [mode, setMode] = useState<ReceiveMode>("SCAN");
  const [planExitOpen, setPlanExitOpen] = useState(false);
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
    error: warehouseError,
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
    setActivePlan,
    startPlanReceive,
    exitPlanMode,
    restoredInfo,
  } = receiveHook;

  const openPlans = plansHook.plans.filter(isPlanOpen);

  // ส่งเอกสารรับเข้า (ตามแผนหรือทั่วไป) สำเร็จ → ดึงสถานะแผนล่าสุด
  useEffect(() => {
    if (submitted) {
      plansHook.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitted]);

  // ซิงก์ snapshot ของแผนที่กำลังรับกับข้อมูลสดจาก polling — สำคัญหลังกู้คืน draft
  // เพราะ snapshot ใน draft อาจตกรุ่น (received_qty/สถานะแผนเปลี่ยนไปขณะออกจากหน้า)
  useEffect(() => {
    if (!activePlan) return;
    const fresh = plansHook.plans.find((p) => p.document_id === activePlan.document_id);
    if (!fresh || JSON.stringify(fresh) === JSON.stringify(activePlan)) return;
    setActivePlan(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plansHook.plans]);

  // ออกจากโหมดแผน = ล้างรายการที่สแกนไว้ — ต้องยืนยันก่อนถ้ายังมีรายการค้างอยู่
  const handleExitPlan = () => {
    if ((watchLines?.length || 0) > 0) {
      setPlanExitOpen(true);
      return;
    }
    exitPlanMode();
  };

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
        <ReceiveSuccessCard onReset={resetForm} />
        {activePlan && (
          <p className="mt-3 text-center text-sm text-m3-grey-600 font-semibold">
            แผน {activePlan.document_no}
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
      {/* แท็บ: รายการที่ต้องรับ / รับเข้า / (แอดมิน) สร้างแผน + แผนทั้งหมด — มือถือเป็นปุ่มเม็ดยา, จอใหญ่เป็นแท็บขีดเส้นใต้ (D14/M05) */}
      <nav
        aria-label="โหมดรับสินค้า"
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 sm:mx-0 sm:gap-8 sm:overflow-visible sm:rounded-2xl sm:bg-white sm:px-6 sm:pb-0 sm:shadow-m3-card"
      >
        {visibleModeButtons.map((btn) => {
          const active = mode === btn.value;
          return (
            <button
              key={btn.value}
              type="button"
              onClick={() => setMode(btn.value)}
              aria-current={active ? "page" : undefined}
              className={`relative flex h-11 shrink-0 cursor-pointer items-center gap-2 rounded-full px-4 text-sm font-semibold whitespace-nowrap transition-colors sm:h-14 sm:rounded-none sm:px-0 sm:after:absolute sm:after:inset-x-0 sm:after:bottom-0 sm:after:h-0.5 sm:after:rounded-full ${
                active
                  ? "text-m3-grey-800 max-sm:bg-m3-grey-800 max-sm:text-white sm:after:bg-m3-grey-800"
                  : "text-m3-grey-600 hover:text-m3-grey-800 max-sm:bg-m3-grey-200"
              }`}
            >
              <span>{btn.label}</span>
              {!!btn.badge && btn.badge > 0 && (
                <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-m3-warning px-1.5 text-xs font-bold text-m3-grey-800 tabular-nums">
                  {btn.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {mode === "INBOX" && (
        <>
          {(plansHook.actionError || plansHook.error) && (
            <M3Banner tone="error" role="alert">{plansHook.actionError || plansHook.error}</M3Banner>
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
            <M3Banner tone="error" role="alert">{plansHook.actionError || plansHook.error}</M3Banner>
          )}
          {plansHook.actionSuccess && (
            <M3Banner tone="success" role="status">{plansHook.actionSuccess}</M3Banner>
          )}
          <ReceivingPlanCreateForm
            warehouses={warehouses}
            defaultWarehouseId={activeWhId}
            isSubmitting={plansHook.isMutating}
            onSubmit={plansHook.createPlan}
          />
        </>
      )}

      {mode === "PLAN_ALL" && isAdmin && (
        <>
          {(plansHook.actionError || plansHook.error) && (
            <M3Banner tone="error" role="alert">{plansHook.actionError || plansHook.error}</M3Banner>
          )}
          {plansHook.actionSuccess && (
            <M3Banner tone="success" role="status">{plansHook.actionSuccess}</M3Banner>
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
          <div className="grid grid-cols-1 items-start gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-4 sm:space-y-5">
          <section className={`${cardClass} flex items-center justify-between gap-4 p-4`}>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <span className="m3-label m3-label-primary shrink-0 gap-1.5">
                <SolarHome size={14} />
                {activeWhName}
              </span>
              <span className="inline-flex shrink-0 items-center gap-1.5 text-sm text-m3-grey-600">
                <SolarCalendarPlan size={16} className="shrink-0 text-m3-grey-500" />
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
              className="m3-btn m3-btn-outline shrink-0 gap-1.5"
            >
              <SolarRefresh size={16} className="shrink-0" />
              <span>รีเฟรช</span>
            </button>
          </section>

          {restoredInfo && (watchLines?.length || 0) > 0 && (
            <ReceiveRestoreBanner
              lineCount={restoredInfo.lineCount}
              planNo={restoredInfo.planNo}
              onDiscard={resetForm}
            />
          )}

          {activePlan && (
            <PlanProgressPanel
              plan={activePlan}
              control={form.control}
              onExitPlan={handleExitPlan}
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
            <M3Banner tone="error" role="alert" className="fade-in">{error}</M3Banner>
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
          </div>

          <div className="hidden lg:sticky lg:top-24 lg:block">
            <ReceiveSummaryCard
              form={form}
              fields={fields}
              confirmedLines={confirmedLines}
              onOpenConfirmModal={() => setConfirmModalOpen(true)}
            />
          </div>
          </div>

          <ReceiveConfirmModal
            isOpen={confirmModalOpen}
            onClose={() => setConfirmModalOpen(false)}
            form={form}
            locations={locations}
            products={products}
            activeWhName={activeWhName}
            onSubmit={onSubmit}
            planNo={activePlan?.document_no}
          />

          <CameraBarcodeScannerModal
            isOpen={isCameraOpen}
            onClose={() => setIsCameraOpen(false)}
            onScan={(scannedText) => {
              handleScanBarcode(scannedText);
            }}
          />

          <PlanExitConfirmModal
            isOpen={planExitOpen}
            onClose={() => setPlanExitOpen(false)}
            onConfirm={exitPlanMode}
            lineCount={watchLines?.length || 0}
            planNo={activePlan?.document_no || ""}
          />
        </>
      )}
    </div>
  );
}

"use client";

import ScrollSelect from "@/components/ui/ScrollSelect";

export type ExpressStatusFilter = "ALL" | "TAGGED_ONLY" | "PENDING" | "IMPORTED" | "UNTAGGED";
export type ExpressDatePreset = "ALL" | "TODAY" | "YESTERDAY" | "LAST_7_DAYS" | "THIS_MONTH";

export const EXPRESS_DATE_PRESET_OPTIONS: Array<{ value: ExpressDatePreset; label: string }> = [
  { value: "ALL", label: "ทั้งหมด" },
  { value: "TODAY", label: "วันนี้" },
  { value: "YESTERDAY", label: "เมื่อวาน" },
  { value: "LAST_7_DAYS", label: "7 วันล่าสุด" },
  { value: "THIS_MONTH", label: "เดือนนี้" },
];

interface ExpressImportWorkspaceHeaderProps {
  mode: "receive" | "issue";
  loading: boolean;
  totalCount: number;
  pendingCount: number;
  importedCount: number;
  visibleCount: number;
  statusFilter: ExpressStatusFilter;
  onStatusFilterChange: (filter: ExpressStatusFilter) => void;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  selectedWarehouse: string;
  onWarehouseChange: (warehouse: string) => void;
  warehouseOptions: Array<{ value: string; label: string }>;
  datePreset: ExpressDatePreset;
  onDatePresetChange: (preset: ExpressDatePreset) => void;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
}

const STATUS_OPTIONS: Array<{
  key: Extract<ExpressStatusFilter, "ALL" | "PENDING" | "IMPORTED">;
  label: string;
  shortLabel: string;
}> = [
  { key: "ALL", label: "รายการทั้งหมด", shortLabel: "ทั้งหมด" },
  { key: "PENDING", label: "รอนำเข้า Express", shortLabel: "รอนำเข้า" },
  { key: "IMPORTED", label: "นำเข้าเรียบร้อย", shortLabel: "สำเร็จแล้ว" },
];

function WorkspaceIcon({ mode }: { mode: "receive" | "issue" }) {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 8.5 12 4l8 4.5v8L12 21l-8-4.5v-8Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m4 8.5 8 4.5 8-4.5M12 13v8" />
      {mode === "receive" ? (
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 2v6m-2.5-2.5L12 8l2.5-2.5" />
      ) : (
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8V2m-2.5 2.5L12 2l2.5 2.5" />
      )}
    </svg>
  );
}

export default function ExpressImportWorkspaceHeader({
  mode,
  loading,
  totalCount,
  pendingCount,
  importedCount,
  visibleCount,
  statusFilter,
  onStatusFilterChange,
  searchQuery,
  onSearchQueryChange,
  selectedWarehouse,
  onWarehouseChange,
  warehouseOptions,
  datePreset,
  onDatePresetChange,
  hasActiveFilters,
  onClearFilters,
}: ExpressImportWorkspaceHeaderProps) {
  const isReceive = mode === "receive";
  const completionPercent = totalCount > 0 ? Math.round((importedCount / totalCount) * 100) : 0;
  const statusValues: Record<(typeof STATUS_OPTIONS)[number]["key"], number> = {
    ALL: totalCount,
    PENDING: pendingCount,
    IMPORTED: importedCount,
  };

  return (
    <header className="print:hidden" aria-labelledby={`express-${mode}-title`}>
      <div className="rounded-2xl border border-[#E0E6E3] bg-white shadow-[0_1px_3px_rgba(16,24,40,0.05),0_1px_2px_rgba(16,24,40,0.03)] overflow-hidden transition-all">
        {/* Top Deck: Context, Title, Navigation Tabs & Interactive KPI Filters */}
        <div className="p-5 sm:p-6 lg:flex lg:items-center lg:justify-between lg:gap-8">
          {/* Left: Mode Icon & Prominent Title */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#EAF2EE] text-[#06402B] grid place-items-center shrink-0">
                <WorkspaceIcon mode={mode} />
              </div>
              <h1 id={`express-${mode}-title`} className="text-[32px] sm:text-[38px] font-black tracking-tight text-[#101828] leading-tight">
                {isReceive ? "รับสินค้าเข้า Express" : "เบิกสินค้าเข้า Express"}
              </h1>
            </div>
            <p className="mt-2 text-base sm:text-lg text-[#344054] leading-relaxed">
              {isReceive
                ? "ตรวจรายการรับสินค้า คัดลอกข้อมูลไปยัง Express และปิดงานเมื่อบันทึกเรียบร้อย"
                : "ตรวจรายการเบิกสินค้า สแกนบาร์โค้ดเข้าโปรแกรม Express และติดตามงานที่ยังรอดำเนินการ"}
            </p>
          </div>

          {/* Right: Connected KPI Metric Strip */}
          <div className="mt-4 lg:mt-0 shrink-0 w-full lg:w-auto">
            <div className="rounded-xl border border-[#E4EAE6] bg-[#F7F9F8] p-3 sm:p-3.5">
              <div className="flex items-center gap-2.5 sm:gap-3" role="group" aria-label="กรองรายการตามสถานะ Express">
                {STATUS_OPTIONS.map((option) => {
                  const isActive = statusFilter === option.key;
                  const value = statusValues[option.key];
                  return (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => onStatusFilterChange(option.key)}
                      aria-pressed={isActive}
                      aria-label={`${option.label} ${value.toLocaleString()} รายการ`}
                      className={`min-w-[115px] sm:min-w-[135px] rounded-xl px-4 py-3 text-left transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#06402B] ${
                        isActive
                          ? "bg-white border border-[#B7CEC2] shadow-xs"
                          : "border border-transparent hover:bg-white/60 hover:border-[#E0E6E3]"
                      }`}
                    >
                      <div className="flex items-center gap-2 text-sm sm:text-base font-bold text-[#344054]">
                        <span
                          className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                            option.key === "PENDING"
                              ? "bg-[#D97706]"
                              : option.key === "IMPORTED"
                              ? "bg-[#087857]"
                              : "bg-[#98A2B3]"
                          }`}
                          aria-hidden="true"
                        />
                        <span className="truncate">{option.shortLabel}</span>
                      </div>
                      {loading ? (
                        <div className="skeleton mt-2 h-8 w-14" aria-hidden="true" />
                      ) : (
                        <span
                          className={`mt-1.5 block font-mono text-3xl sm:text-[34px] font-black leading-none ${
                            isActive ? "text-[#06402B]" : "text-[#101828]"
                          }`}
                        >
                          {value.toLocaleString()}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Compact Progress Bar */}
              <div className="mt-3.5 flex items-center gap-3 px-1">
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-[#DFE7E3]" aria-hidden="true">
                  <div
                    className="h-full rounded-full bg-[#087857] transition-[width] duration-500"
                    style={{ width: `${loading ? 0 : completionPercent}%` }}
                  />
                </div>
                <span className="text-sm font-bold text-[#344054] font-mono whitespace-nowrap">
                  {loading ? "…" : `สำเร็จ ${completionPercent}%`}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Lower Deck: Unified Precision Toolbar */}
        <div className="border-t border-[#EEF2F0] bg-[#FAFCFB] px-5 py-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Left Controls: Search + Warehouse + Date Presets */}
            <div className="flex flex-wrap items-center gap-3 flex-1 min-w-0">
              {/* Search Bar */}
              <div className="relative w-full sm:w-80 lg:w-96 shrink-0">
                <svg
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-[#475467] pointer-events-none"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z" />
                </svg>
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => onSearchQueryChange(e.target.value)}
                  placeholder="ค้นหาเอกสาร, SKU, บาร์โค้ด…"
                  aria-label="ค้นหารายการ"
                  className="w-full min-h-[46px] pl-11 pr-9 rounded-xl border border-[#D5DDD9] bg-white py-2.5 text-base sm:text-[17px] font-medium text-[#101828] placeholder:text-slate-400 focus:border-[#06402B] focus:outline-none focus:ring-2 focus:ring-[#06402B]/15 transition-all"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => onSearchQueryChange("")}
                    aria-label="ล้างคำค้นหา"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 h-7 w-7 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 grid place-items-center transition-colors"
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="m18 6-12 12M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>

              {/* Warehouse Dropdown */}
              <div className="w-full sm:w-56 lg:w-64 shrink-0 text-base">
                <ScrollSelect
                  value={selectedWarehouse}
                  onChange={onWarehouseChange}
                  options={warehouseOptions}
                  maxVisibleItems={4}
                  title="เลือกคลังสินค้า"
                  activeColor="emerald"
                />
              </div>

              {/* Date Presets Segmented Strip */}
              <div className="flex items-center gap-1.5 overflow-x-auto py-0.5" role="group" aria-label="กรองตามช่วงเวลา">
                {EXPRESS_DATE_PRESET_OPTIONS.map((option) => {
                  const isActive = datePreset === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => onDatePresetChange(option.value)}
                      aria-pressed={isActive}
                      className={`min-h-[44px] px-4 py-2 rounded-xl text-base font-bold transition-all cursor-pointer whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#06402B] ${
                        isActive
                          ? "bg-[#06402B] text-white shadow-xs"
                          : "border border-[#E0E6E3] bg-white text-[#344054] hover:border-[#B7CEC2] hover:text-[#06402B]"
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Right Status / Actions */}
            <div className="flex items-center gap-3 shrink-0 ml-auto sm:ml-0">
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={onClearFilters}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-3.5 text-base font-bold text-[#475467] hover:text-[#9B1C1C] hover:bg-[#FDF3F1] border border-transparent hover:border-[#F3C4BA] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9B1C1C]"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M5.6 15.5A8 8 0 0 0 19 8.5M18.4 8.5A8 8 0 0 0 5 15.5" />
                  </svg>
                  <span>ล้างตัวกรอง</span>
                </button>
              )}

              <div
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#EAF2EE] text-[#06402B] text-base sm:text-[17px] font-bold font-mono"
                aria-live="polite"
              >
                <span>{visibleCount.toLocaleString()}</span>
                <span className="text-[#475467] font-semibold text-base">/ {totalCount.toLocaleString()} รายการ</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

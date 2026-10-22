"use client";

import { useMemo, useState } from "react";
import { SolarPrinter } from "@/components/icons";
import { buildProductionReportSlip } from "@/features/production/lib/production-report-print";
import type { ProductionJob, ProductionReport } from "@/types/production";
import { ProductionPrintPortal } from "./ProductionPrintButton";
import ProductionReportSlipSheet from "./ProductionReportSlipSheet";
import "./production-print.css";

/** ปุ่ม “ปริ้น” ต่อรายงาน 1 รอบ — เปิดตัวอย่าง A4 แล้วสั่งพิมพ์อัตโนมัติ (พิมพ์เฉพาะรอบนี้) */
export default function ProductionReportPrintButton({ job, report, className = "" }: { job: ProductionJob; report: ProductionReport; className?: string }) {
  const [open, setOpen] = useState(false);
  const label = report.kind === "ADJUSTMENT" ? "ปรับปรุงยอด" : `รอบที่ ${report.report_no}`;
  return <>
    <button type="button" className={`m3-btn m3-btn-sm m3-btn-outline inline-flex items-center gap-1 whitespace-nowrap ${className}`} onClick={() => setOpen(true)} aria-label={`ปริ้นใบรายงาน ${label}`}>
      <SolarPrinter size={16} />ปริ้น
    </button>
    {open && <ReportSlipPreview job={job} report={report} title={`ใบรายงานผลผลิต · ${job.job_no} · ${label}`} onClose={() => setOpen(false)} />}
  </>;
}

function ReportSlipPreview({ job, report, title, onClose }: { job: ProductionJob; report: ProductionReport; title: string; onClose: () => void }) {
  const slip = useMemo(() => buildProductionReportSlip(job, report), [job, report]);
  return <ProductionPrintPortal title={title} onClose={onClose} autoPrint><ProductionReportSlipSheet slip={slip} /></ProductionPrintPortal>;
}

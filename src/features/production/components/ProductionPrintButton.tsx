"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useEscapeKey } from "@/hooks/use-escape-key";
import { productionApi } from "@/features/production/lib/api";
import { buildJobsQueryString } from "@/features/production/lib/jobs-query";
import { buildProductionPrintJobs, isPrintableProductionJob } from "@/features/production/lib/production-print";
import type { ProductionJob } from "@/types/production";
import ProductionWorkOrderSheets from "./ProductionWorkOrderSheets";
import "./production-print.css";

export default function ProductionPrintButton({ jobs, disabled = false }: { jobs: ProductionJob[]; disabled?: boolean }) {
  const [printingJobs, setPrintingJobs] = useState<ProductionJob[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const candidates = jobs.filter(isPrintableProductionJob);
  const open = async () => {
    if (pending.current || !candidates.length) return;
    pending.current = true; setLoading(true); setError(null);
    try {
      let refreshed: ProductionJob[];
      if (candidates.length === 1) {
        const response = await productionApi<{ job: ProductionJob }>(`/api/production/jobs/${encodeURIComponent(candidates[0].job_no)}`);
        if (!response.success || !response.data) throw new Error(response.message);
        refreshed = [response.data.job];
      } else {
        const dates = candidates.map(j => j.production_date).sort();
        const table = candidates.every(j => j.table_no === candidates[0].table_no) ? candidates[0].table_no : "ALL";
        const query = buildJobsQueryString({ date_from: dates[0], date_to: dates[dates.length - 1], table_no: table });
        const response = await productionApi<ProductionJob[]>(`/api/production/jobs${query}`);
        if (!response.success || !Array.isArray(response.data)) throw new Error(response.message);
        const selected = new Set(candidates.map(j => j.job_no));
        refreshed = response.data.filter(j => selected.has(j.job_no));
      }
      refreshed = refreshed.filter(isPrintableProductionJob);
      if (!refreshed.length) throw new Error("ไม่มีงานที่ยังต้องผลิตสำหรับพิมพ์");
      setPrintingJobs(refreshed);
    } catch (e) { setError(e instanceof Error ? e.message : "โหลดใบงานพิมพ์ไม่สำเร็จ"); }
    finally { pending.current = false; setLoading(false); }
  };
  return <div className="production-print-action">
    <button type="button" className="m3-btn m3-btn-outline" disabled={disabled || loading || !candidates.length} onClick={open}>
      {loading ? "กำลังโหลดใบงาน…" : "พิมพ์ใบงาน"}
    </button>
    {error && <p role="alert" className="mt-1 max-w-sm text-xs font-semibold text-m3-error-dark">{error}</p>}
    {printingJobs && <ProductionPrintPreview jobs={printingJobs} onClose={() => setPrintingJobs(null)} />}
  </div>;
}

function ProductionPrintPreview({ jobs, onClose }: { jobs: ProductionJob[]; onClose: () => void }) {
  const entries = useMemo(() => buildProductionPrintJobs(jobs), [jobs]);
  const invalid = entries.some(entry => entry.issues.length > 0);
  return <ProductionPrintPortal title={`ตัวอย่างใบงานผลิต · ${entries.length} ใบ`} onClose={onClose} blockedMessage={invalid ? "กรุณาให้ Admin ตรวจสูตรวัตถุดิบก่อนพิมพ์" : null}>
    <ProductionWorkOrderSheets entries={entries} />
  </ProductionPrintPortal>;
}

/**
 * หน้าต่างตัวอย่างก่อนพิมพ์ (portal ไป body เป็น #production-print-root)
 * ตอนพิมพ์ CSS ซ่อนลูกอื่นของ body ทั้งหมด → พิมพ์เฉพาะเอกสารใน portal นี้ (เปิดได้ทีละอัน)
 */
export function ProductionPrintPortal({ title, onClose, blockedMessage = null, autoPrint = false, children }: {
  title: string; onClose: () => void; blockedMessage?: string | null; autoPrint?: boolean; children: ReactNode;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const [printing, setPrinting] = useState(false);
  const [previewScale, setPreviewScale] = useState(1);
  const [error, setError] = useState<string | null>(null);
  useEscapeKey(!printing, onClose);
  useEffect(() => {
    const fitPreview = () => setPreviewScale(Math.min(1, (window.innerWidth - 24) / (210 * 96 / 25.4)));
    fitPreview();
    window.addEventListener("resize", fitPreview);
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.body.classList.add("production-print-open");
    document.documentElement.classList.add("production-print-open");
    closeButton.current?.focus();
    return () => {
      window.removeEventListener("resize", fitPreview);
      document.body.style.overflow = overflow;
      document.body.classList.remove("production-print-open");
      document.documentElement.classList.remove("production-print-open");
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  const print = useCallback(async () => {
    setPrinting(true); setError(null);
    try { await document.fonts.ready; window.print(); }
    catch { setError("เปิดหน้าพิมพ์ไม่สำเร็จ กรุณาลองใหม่"); }
    finally { setPrinting(false); }
  }, []);
  const autoPrinted = useRef(false);
  useEffect(() => {
    if (!autoPrint || blockedMessage || autoPrinted.current) return;
    autoPrinted.current = true;
    const id = window.setTimeout(() => { void print(); }, 0);
    return () => window.clearTimeout(id);
  }, [autoPrint, blockedMessage, print]);
  return createPortal(<div id="production-print-root" role="dialog" aria-modal="true" aria-labelledby="production-print-title" style={{ "--production-print-scale": previewScale } as CSSProperties}>
    <div className="production-print-toolbar">
      <h2 id="production-print-title">{title}</h2>
      <div><button ref={closeButton} type="button" onClick={onClose} disabled={printing}>ปิด</button><button type="button" onClick={print} disabled={printing || !!blockedMessage}>{printing ? "กำลังเปิดหน้าพิมพ์…" : "พิมพ์ / บันทึก PDF"}</button></div>
      {blockedMessage && <p role="alert">{blockedMessage}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
    {children}
  </div>, document.body);
}

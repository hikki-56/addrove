"use client";

// Data hooks ระบบผลิต — ดึงรายการงาน/รายละเอียด + refresh ผ่าน custom event เดียวกันทั้งระบบ
// (TabAuthContext monkey-patch fetch ใส่ header สิทธิ์ให้อัตโนมัติ — หน้าจึงเรียก fetch ตรง ๆ ได้)
import { useCallback, useEffect, useState } from "react";
import type { ProductionJob, ProductionReport, ProductionHistoryEntry } from "@/types/production";

export const PRODUCTION_UPDATED_EVENT = "stockify-production-updated";

export function emitProductionUpdated(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(PRODUCTION_UPDATED_EVENT));
  }
}

export interface JobsState {
  jobs: ProductionJob[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

export function useProductionJobs(): JobsState {
  const [jobs, setJobs] = useState<ProductionJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/production/jobs", { cache: "no-store" });
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setJobs(json.data as ProductionJob[]);
        setError(null);
      } else {
        setError(json.message || "ดึงรายการงานผลิตไม่สำเร็จ");
      }
    } catch {
      setError("เกิดข้อผิดพลาดในการเชื่อมต่อ กรุณาลองใหม่");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    const handler = () => reload();
    window.addEventListener(PRODUCTION_UPDATED_EVENT, handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener(PRODUCTION_UPDATED_EVENT, handler);
      window.removeEventListener("storage", handler);
    };
  }, [reload]);

  return { jobs, loading, error, reload };
}

export interface JobDetail {
  job: ProductionJob;
  reports: ProductionReport[];
  history: ProductionHistoryEntry[];
}

export function useProductionJobDetail(jobNo: string | undefined) {
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!jobNo) return;
    try {
      const res = await fetch(`/api/production/jobs/${encodeURIComponent(jobNo)}`, { cache: "no-store" });
      const json = await res.json();
      if (json.success && json.data) {
        setDetail(json.data as JobDetail);
        setError(null);
      } else {
        setError(json.message || "ดึงข้อมูลงานไม่สำเร็จ");
      }
    } catch {
      setError("เกิดข้อผิดพลาดในการเชื่อมต่อ กรุณาลองใหม่");
    } finally {
      setLoading(false);
    }
  }, [jobNo]);

  useEffect(() => {
    reload();
    const handler = () => reload();
    window.addEventListener(PRODUCTION_UPDATED_EVENT, handler);
    return () => window.removeEventListener(PRODUCTION_UPDATED_EVENT, handler);
  }, [reload]);

  return { detail, loading, error, reload };
}

/** POST/PATCH/DELETE ที่ไม่ใช่ GET พร้อม error message ภาษาไทย */
export async function productionFetch(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown
): Promise<{ success: boolean; message: string; data?: unknown }> {
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({ success: false, message: "เกิดข้อผิดพลาดในการเชื่อมต่อ" }));
    return { success: !!json.success, message: json.message || (json.success ? "สำเร็จ" : "ไม่สำเร็จ"), data: json.data };
  } catch {
    return { success: false, message: "เกิดข้อผิดพลาดในการเชื่อมต่อ กรุณาลองใหม่" };
  }
}

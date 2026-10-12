"use client";

// Data hooks ระบบผลิต — ดึงรายการงาน/รายละเอียด + refresh เมื่อมีการเปลี่ยนแปลง (แท็บนี้ + แท็บอื่น)
// (TabAuthContext monkey-patch fetch ใส่ header สิทธิ์ให้อัตโนมัติ — productionApi จึงเรียก fetch ตรง ๆ ได้)
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProductionJob, ProductionReport, ProductionHistoryEntry } from "@/types/production";
import { PRODUCTION_UPDATED_EVENT, emitProductionUpdated, subscribeProductionUpdated } from "@/features/production/lib/events";
import { productionApi } from "@/features/production/lib/api";
import { buildJobsQueryString, type ProductionJobsQuery } from "@/features/production/lib/jobs-query";

export { PRODUCTION_UPDATED_EVENT, emitProductionUpdated };

const LOAD_JOBS_FAILED = "ดึงรายการงานผลิตไม่สำเร็จ";
const LOAD_DETAIL_FAILED = "ดึงข้อมูลงานไม่สำเร็จ";
/** รอบ polling ของหน้าระบบผลิต (หยุดเมื่อแท็บถูกซ่อน — usePollingWhenVisible) */
export const PRODUCTION_POLL_MS = 30_000;
export const MISSING_JOB_NO_MESSAGE = "ไม่พบเลขใบสั่งผลิตในลิงก์นี้";

export interface JobsState {
  jobs: ProductionJob[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

export interface UseProductionJobsOptions {
  /** false = ยังไม่ดึง (เช่น รอค่าวันที่เริ่มต้น หรือผู้ใช้ไม่มีสิทธิ์หน้านี้) — ค่าเริ่มต้น true */
  enabled?: boolean;
}

/**
 * รายการงานผลิต — ส่งตัวกรอง (date_from/date_to/table_no/status) ให้เซิร์ฟเวอร์กรองก่อน
 * หน้าจอยังกรองซ้ำฝั่ง client เสมอ (fallback + ให้ผลถูกต้องทันทีระหว่างรอคำตอบใหม่)
 */
export function useProductionJobs(query: ProductionJobsQuery = {}, options: UseProductionJobsOptions = {}): JobsState {
  const { enabled = true } = options;
  const [jobs, setJobs] = useState<ProductionJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // กันคำตอบเก่ามาทับคำตอบใหม่ (polling + event + เปลี่ยนตัวกรอง + กดรีเฟรชซ้อนกัน)
  const seq = useRef(0);
  const { date_from, date_to, table_no, status } = query;
  const queryString = useMemo(
    () => buildJobsQueryString({ date_from, date_to, table_no, status }),
    [date_from, date_to, table_no, status]
  );

  const reload = useCallback(async () => {
    if (!enabled) return;
    const id = ++seq.current;
    const res = await productionApi<ProductionJob[]>(`/api/production/jobs${queryString}`);
    if (id !== seq.current) return;
    if (res.success && Array.isArray(res.data)) {
      setJobs(res.data);
      setError(null);
    } else {
      setError(res.success ? LOAD_JOBS_FAILED : res.message || LOAD_JOBS_FAILED);
    }
    setLoading(false);
  }, [enabled, queryString]);

  useEffect(() => {
    if (!enabled) return;
    reload();
    return subscribeProductionUpdated(() => {
      reload();
    });
  }, [enabled, reload]);

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
  const seq = useRef(0);

  const reload = useCallback(async () => {
    if (!jobNo) return;
    const id = ++seq.current;
    const res = await productionApi<JobDetail>(`/api/production/jobs/${encodeURIComponent(jobNo)}`);
    if (id !== seq.current) return;
    if (res.success && res.data) {
      setDetail(res.data);
      setError(null);
    } else {
      setError(res.success ? LOAD_DETAIL_FAILED : res.message || LOAD_DETAIL_FAILED);
    }
    setLoading(false);
  }, [jobNo]);

  useEffect(() => {
    if (!jobNo) return;
    reload();
    return subscribeProductionUpdated(() => {
      reload();
    });
  }, [jobNo, reload]);

  // ไม่มี jobNo (เช่น params ยังไม่พร้อม/ลิงก์ผิด) → ไม่ค้าง spinner ตลอดไปแบบเดิม
  if (!jobNo) return { detail: null, loading: false, error: MISSING_JOB_NO_MESSAGE, reload };
  return { detail, loading, error, reload };
}

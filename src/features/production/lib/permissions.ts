// สิทธิ์การกระทำต่องานผลิต ตามสถานะ × บทบาท — ใช้ที่เดียวทั้งหน้าวางแผน รายการ และรายละเอียด
// (ซ่อนปุ่มฝั่ง UI เท่านั้น — เซิร์ฟเวอร์ตรวจสิทธิ์และ state machine ซ้ำทุกครั้ง)
//
// state machine ฝั่งเซิร์ฟเวอร์: DRAFT→WAITING/CANCELLED · WAITING→IN_PROGRESS/CANCELLED ·
// IN_PROGRESS→COMPLETED/CANCELLED · COMPLETED→IN_PROGRESS (เปิดผลิตต่อ) · CANCELLED = จบ
//
// หมายเหตุ: เซิร์ฟเวอร์ให้ ADMIN มีสิทธิ์ production.report ด้วย แต่ spec/mockup ให้เฉพาะ APPROVER
// เริ่มผลิต/รายงานผล — UI จึงแสดงเฉพาะ APPROVER (ตรงกับหน้ารายละเอียดเดิม)
import type { ProductionJobStatus } from "@/types/production";

export interface ProductionAllowedActions {
  /** เริ่มผลิต (WAITING → IN_PROGRESS) */
  start: boolean;
  /** รายงานผล (บางส่วน/จบงาน) */
  report: boolean;
  /** แก้ไขงาน (กติกาช่องที่แก้ได้ขึ้นกับสถานะ — ดู AddJobModal) */
  edit: boolean;
  /** ยกเลิกงาน (ต้องระบุเหตุผล) */
  cancel: boolean;
  /** เปิดงานที่จบแล้วกลับมาผลิตต่อ */
  reopen: boolean;
  /** ปรับปรุงยอดผลผลิต */
  adjust: boolean;
  /** ลบได้เฉพาะฉบับร่าง (งานที่ส่งแล้วใช้การยกเลิก) */
  deleteDraft: boolean;
  /** เลือกเพื่อส่งงานผลิต (DRAFT → WAITING) */
  submit: boolean;
}

const NONE: ProductionAllowedActions = {
  start: false,
  report: false,
  edit: false,
  cancel: false,
  reopen: false,
  adjust: false,
  deleteDraft: false,
  submit: false,
};

const EDITABLE: readonly ProductionJobStatus[] = ["DRAFT", "WAITING", "IN_PROGRESS"];
const CANCELLABLE: readonly ProductionJobStatus[] = ["DRAFT", "WAITING", "IN_PROGRESS"];
const ADJUSTABLE: readonly ProductionJobStatus[] = ["IN_PROGRESS", "COMPLETED", "CANCELLED"];

/**
 * ค่าใน `job.allowed_actions` ตาม api-contract.md (CHANGED — ยังไม่มีใน types/production.ts)
 * transfer_remaining ยังไม่มีใน phase 1 จึงไม่ map
 */
const SERVER_ACTION_MAP: Record<string, keyof ProductionAllowedActions> = {
  edit: "edit",
  delete: "deleteDraft",
  submit: "submit",
  start: "start",
  report: "report",
  adjust: "adjust",
  cancel: "cancel",
  reopen: "reopen",
};

/** งานผลิตแบบย่อ — รองรับ `allowed_actions` ที่เซิร์ฟเวอร์จะส่งมา (ถ้ามี) */
export interface ProductionJobActionSource {
  status: ProductionJobStatus | string | null | undefined;
  allowed_actions?: readonly string[] | null;
}

/** แปลง allowed_actions จากเซิร์ฟเวอร์เป็น flags · ค่าที่ไม่รู้จักถูกข้าม */
export function actionsFromServerList(list: readonly string[]): ProductionAllowedActions {
  const out: ProductionAllowedActions = { ...NONE };
  for (const name of list) {
    const flag = SERVER_ACTION_MAP[name];
    if (flag) out[flag] = true;
  }
  return out;
}

/**
 * สิทธิ์การกระทำต่องาน — ถ้างานมี `allowed_actions` (สัญญา API ใหม่) ใช้ค่านั้นเป็นหลัก
 * ไม่เช่นนั้นคำนวณจากสถานะ × บทบาทในเครื่อง (API ปัจจุบัน)
 */
export function getAllowedActions(
  jobOrStatus: ProductionJobActionSource | ProductionJobStatus | string | null | undefined,
  role: string | null | undefined
): ProductionAllowedActions {
  if (jobOrStatus && typeof jobOrStatus === "object" && Array.isArray(jobOrStatus.allowed_actions)) {
    return actionsFromServerList(jobOrStatus.allowed_actions);
  }
  const status = jobOrStatus && typeof jobOrStatus === "object" ? jobOrStatus.status : jobOrStatus;
  if (!status || !role) return { ...NONE };
  const s = status as ProductionJobStatus;
  if (role === "ADMIN") {
    return {
      ...NONE,
      edit: EDITABLE.includes(s),
      cancel: CANCELLABLE.includes(s),
      reopen: s === "COMPLETED",
      adjust: ADJUSTABLE.includes(s),
      deleteDraft: s === "DRAFT",
      submit: s === "DRAFT",
    };
  }
  if (role === "APPROVER") {
    return { ...NONE, start: s === "WAITING", report: s === "IN_PROGRESS" };
  }
  return { ...NONE };
}

/**
 * ปุ่ม "ยกเลิกงาน" บนการ์ดของหน้าวางแผน — ฉบับร่างใช้ "ลบฉบับร่าง" แทน (ไม่มีอะไรต้องเก็บประวัติ)
 * จึงแสดงยกเลิกเฉพาะงานที่ส่งแล้วและยังไม่จบ (รอผลิต/กำลังผลิต) ตาม mockup 01
 */
export function showCancelOnPlanningCard(actions: ProductionAllowedActions): boolean {
  return actions.cancel && !actions.deleteDraft;
}

/** กระดิ่งแจ้งเตือนผลิต (และการ poll แจ้งเตือน) เฉพาะ ADMIN + APPROVER */
export function canViewProductionNotifications(role: string | null | undefined): boolean {
  return role === "ADMIN" || role === "APPROVER";
}

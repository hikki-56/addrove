// ============================================================
// Route Tests — สิทธิ์ฝั่งเซิร์ฟเวอร์ของระบบผลิต (§9)
// ใช้ permission matrix จริง: ADMIN วางแผนได้ / APPROVER เริ่มงาน+รายงานได้ /
// บทบาทอื่น (STAFF, WAREHOUSE_STAFF, PACKER) ห้าม · ไม่ล็อกอิน = 401
// ============================================================

let mockSession: { user?: { id: string; name: string; email: string; role: string } } | null = null;

jest.mock("@/server/auth-session", () => ({
  getAuthSession: jest.fn(async () => mockSession),
}));

jest.mock("@/server/production/production-job.service", () => ({
  listJobs: jest.fn(async () => []),
  createJobs: jest.fn(async () => []),
  submitJobs: jest.fn(async () => ({ submitted: [], skipped: [] })),
  startJob: jest.fn(async () => ({ job_no: "PRD-1" })),
  reportProduction: jest.fn(async () => ({ report: {}, job: {}, replayed: false })),
  cancelJob: jest.fn(async () => ({})),
  reopenJob: jest.fn(async () => ({})),
  adjustProduction: jest.fn(async () => ({ report: {}, job: {}, replayed: false })),
  updateJob: jest.fn(async () => ({})),
  deleteDraft: jest.fn(async () => undefined),
  getJobDetail: jest.fn(async () => null),
  listNotifications: jest.fn(async () => ({ items: [], unread_count: 0 })),
  markNotificationsRead: jest.fn(async () => undefined),
  ProductionError: class ProductionError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: 400 | 404 | 409 = 400) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

jest.mock("@/server/production/production-bom.service", () => ({ listProductionBoms: jest.fn(async () => []) }));
jest.mock("@/server/production/production-material.service", () => ({ listProductionCapacities: jest.fn(async () => []), previewMaterialAvailability: jest.fn(async () => ({})) }));

import { NextRequest } from "next/server";
import type { ProductionJob } from "@/types/production";
import { listJobs, getJobDetail } from "@/server/production/production-job.service";
import { POST as createJobsPOST, GET as jobsGET } from "@/app/api/production/jobs/route";
import { GET as detailGET } from "@/app/api/production/jobs/[job_no]/route";
import { GET as capacitiesGET } from "@/app/api/production/capacities/route";
import { GET as bomsGET, POST as bomsPOST } from "@/app/api/production/boms/route";
import { POST as reportPOST } from "@/app/api/production/jobs/[job_no]/report/route";
import { POST as startPOST } from "@/app/api/production/jobs/[job_no]/start/route";
import { PATCH as notifPATCH } from "@/app/api/production/notifications/route";

function makeRequest(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as Request;
}

const ADMIN = { id: "u1", name: "แอดมิน", email: "admin@x.com", role: "ADMIN" };
const APPROVER = { id: "u2", name: "ผู้ผลิต", email: "ap@x.com", role: "APPROVER" };
const STAFF = { id: "u3", name: "พนักงาน", email: "st@x.com", role: "STAFF" };
const PACKER = { id: "u4", name: "แพ็ค", email: "pk@x.com", role: "PACKER" };

beforeEach(() => {
  mockSession = null;
  jest.clearAllMocks();
});

describe("สิทธิ์ระบบผลิต — บังคับฝั่งเซิร์ฟเวอร์ทุกครั้ง", () => {
  it("BOM และกำลังผลิตต้องล็อกอิน และกำลังผลิต/พรีวิวจำกัดเฉพาะ Admin", async () => {
    const req = () => new NextRequest("http://localhost/api/production/boms");
    expect((await bomsGET(req())).status).toBe(401);
    expect((await capacitiesGET(req())).status).toBe(401);
    mockSession = { user: APPROVER };
    expect((await bomsGET(req())).status).toBe(200);
    expect((await capacitiesGET(req())).status).toBe(403);
    expect((await bomsPOST(req())).status).toBe(403);
    mockSession = { user: ADMIN };
    expect((await capacitiesGET(req())).status).toBe(200);
  });

  it("ผู้อนุมัติไม่เห็นฉบับร่างทั้งรายการและ URL รายละเอียด", async () => {
    const draft = { job_no: "PRD-DRAFT", status: "DRAFT" } as ProductionJob;
    const waiting = { job_no: "PRD-WAITING", status: "WAITING" } as ProductionJob;
    jest.mocked(listJobs).mockResolvedValueOnce([draft, waiting]);
    mockSession = { user: APPROVER };
    const response = await jobsGET(new NextRequest("http://localhost/api/production/jobs"));
    expect((await response.json()).data).toEqual([waiting]);
    jest.mocked(getJobDetail).mockResolvedValueOnce({ job: draft, reports: [], history: [] });
    expect((await detailGET(new NextRequest("http://localhost/x"), { params: Promise.resolve({ job_no: draft.job_no }) })).status).toBe(403);
    mockSession = { user: ADMIN };
    jest.mocked(getJobDetail).mockResolvedValueOnce({ job: draft, reports: [], history: [] });
    expect((await detailGET(new NextRequest("http://localhost/x"), { params: Promise.resolve({ job_no: draft.job_no }) })).status).toBe(200);
  });

  it("ไม่ล็อกอิน → 401 ทุก endpoint", async () => {
    const res1 = await jobsGET(makeRequest("http://localhost/api/production/jobs", "GET") as any);
    expect(res1.status).toBe(401);
    const res2 = await reportPOST(
      makeRequest("http://localhost/api/production/jobs/PRD-1/report", "POST", { good_qty: 1 }) as any,
      { params: Promise.resolve({ job_no: "PRD-1" }) }
    );
    expect(res2.status).toBe(401);
  });

  it("สร้างงาน (POST /jobs) — เฉพาะ ADMIN", async () => {
    mockSession = { user: APPROVER };
    const res = await createJobsPOST(
      makeRequest("http://localhost/api/production/jobs", "POST", { jobs: [] }) as any
    );
    expect(res.status).toBe(403);

    mockSession = { user: STAFF };
    const res2 = await createJobsPOST(
      makeRequest("http://localhost/api/production/jobs", "POST", { jobs: [] }) as any
    );
    expect(res2.status).toBe(403);

    mockSession = { user: ADMIN };
    const res3 = await createJobsPOST(makeRequest("http://localhost/api/production/jobs", "POST", {
      jobs: [{ production_date: "2026-10-07", table_no: 1, product_id: "prod-A1", target_qty: 10, priority: "NORMAL", note: "", location: "" }],
    }) as any);
    expect(res3.status).toBe(201);
  });

  it("รายงานผล (report) และเริ่มผลิต (start) — APPROVER และ ADMIN ทำได้ · STAFF/PACKER ห้าม", async () => {
    const params = { params: Promise.resolve({ job_no: "PRD-1" }) };
    const payload = {
      good_qty: 10,
      defect_qty: 0,
      defect_cause: "",
      note: "",
      photo_url: "",
      report_kind: "PARTIAL",
      close_reason: "",
      idempotency_key: "abcdefgh1234",
    };

    mockSession = { user: STAFF };
    expect(
      (await reportPOST(makeRequest("http://localhost/x", "POST", payload) as any, params)).status
    ).toBe(403);

    mockSession = { user: PACKER };
    expect(
      (await startPOST(makeRequest("http://localhost/x", "POST") as any, params)).status
    ).toBe(403);

    mockSession = { user: APPROVER };
    expect(
      (await reportPOST(makeRequest("http://localhost/x", "POST", payload) as any, params)).status
    ).toBe(200);
    expect(
      (await startPOST(makeRequest("http://localhost/x", "POST") as any, params)).status
    ).toBe(200);
  });

  it("ดูรายการงาน (GET /jobs) — ADMIN/APPROVER ดูได้ · PACKER ห้าม", async () => {
    mockSession = { user: ADMIN };
    expect((await jobsGET(makeRequest("http://localhost/api/production/jobs", "GET") as any)).status).toBe(200);
    mockSession = { user: APPROVER };
    expect((await jobsGET(makeRequest("http://localhost/api/production/jobs", "GET") as any)).status).toBe(200);
    mockSession = { user: PACKER };
    expect((await jobsGET(makeRequest("http://localhost/api/production/jobs", "GET") as any)).status).toBe(403);
  });

  it("mark อ่านแจ้งเตือน — ต้องล็อกอินและมีสิทธิ์ดูงานผลิต", async () => {
    mockSession = { user: STAFF };
    const res = await notifPATCH(
      makeRequest("http://localhost/api/production/notifications", "PATCH", { ids: "all" }) as any
    );
    expect(res.status).toBe(403);
  });
});

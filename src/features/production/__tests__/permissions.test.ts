import {
  getAllowedActions,
  showCancelOnPlanningCard,
  canViewProductionNotifications,
} from "@/features/production/lib/permissions";
import type { ProductionJobStatus } from "@/types/production";

const STATUSES: ProductionJobStatus[] = ["DRAFT", "WAITING", "IN_PROGRESS", "COMPLETED", "CANCELLED"];

function allowed(status: ProductionJobStatus, role: string) {
  const a = getAllowedActions(status, role);
  return Object.entries(a)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .sort();
}

describe("getAllowedActions — ADMIN", () => {
  it.each<[ProductionJobStatus, string[]]>([
    ["DRAFT", ["cancel", "deleteDraft", "edit", "submit"]],
    ["WAITING", ["cancel", "edit"]],
    ["IN_PROGRESS", ["adjust", "cancel", "edit"]],
    ["COMPLETED", ["adjust", "reopen"]],
    ["CANCELLED", ["adjust"]],
  ])("%s → %j", (status, expected) => {
    expect(allowed(status, "ADMIN")).toEqual(expected);
  });

  it("never offers cancel on COMPLETED or CANCELLED jobs", () => {
    expect(getAllowedActions("COMPLETED", "ADMIN").cancel).toBe(false);
    expect(getAllowedActions("CANCELLED", "ADMIN").cancel).toBe(false);
  });

  it("ADMIN does not see start/report (UI rule, server re-checks)", () => {
    for (const s of STATUSES) {
      const a = getAllowedActions(s, "ADMIN");
      expect(a.start).toBe(false);
      expect(a.report).toBe(false);
    }
  });
});

describe("getAllowedActions — APPROVER", () => {
  it.each<[ProductionJobStatus, string[]]>([
    ["DRAFT", []],
    ["WAITING", ["start"]],
    ["IN_PROGRESS", ["report"]],
    ["COMPLETED", []],
    ["CANCELLED", []],
  ])("%s → %j", (status, expected) => {
    expect(allowed(status, "APPROVER")).toEqual(expected);
  });
});

describe("getAllowedActions — other roles / missing input", () => {
  it.each(["STAFF", "VIEWER", "", "admin"])("role %p gets nothing", (role) => {
    for (const s of STATUSES) expect(allowed(s, role)).toEqual([]);
  });

  it("handles missing status/role", () => {
    expect(allowed(undefined as unknown as ProductionJobStatus, "ADMIN")).toEqual([]);
    expect(Object.values(getAllowedActions("WAITING", undefined)).some(Boolean)).toBe(false);
    expect(Object.values(getAllowedActions("UNKNOWN", "ADMIN")).some(Boolean)).toBe(false);
  });
});

describe("showCancelOnPlanningCard", () => {
  it.each<[ProductionJobStatus, boolean]>([
    ["DRAFT", false],
    ["WAITING", true],
    ["IN_PROGRESS", true],
    ["COMPLETED", false],
    ["CANCELLED", false],
  ])("%s → %p", (status, expected) => {
    expect(showCancelOnPlanningCard(getAllowedActions(status, "ADMIN"))).toBe(expected);
  });
});

describe("canViewProductionNotifications", () => {
  it("only ADMIN and APPROVER", () => {
    expect(canViewProductionNotifications("ADMIN")).toBe(true);
    expect(canViewProductionNotifications("APPROVER")).toBe(true);
    for (const r of ["STAFF", "VIEWER", "", undefined, null]) expect(canViewProductionNotifications(r)).toBe(false);
  });
});

describe("getAllowedActions — server allowed_actions (api-contract)", () => {
  it("prefers job.allowed_actions over local status/role rules", () => {
    const a = getAllowedActions(
      { status: "IN_PROGRESS", allowed_actions: ["report", "cancel"] },
      "ADMIN"
    );
    expect(a.report).toBe(true);
    expect(a.cancel).toBe(true);
    expect(a.edit).toBe(false);
    expect(a.adjust).toBe(false);
  });

  it("maps delete → deleteDraft and ignores unknown/phase-2 actions", () => {
    const a = getAllowedActions(
      { status: "DRAFT", allowed_actions: ["edit", "delete", "submit", "transfer_remaining", "bogus"] },
      "ADMIN"
    );
    expect(Object.entries(a).filter(([, v]) => v).map(([k]) => k).sort()).toEqual([
      "deleteDraft",
      "edit",
      "submit",
    ]);
  });

  it("an empty server list means no actions, even for ADMIN", () => {
    expect(Object.values(getAllowedActions({ status: "WAITING", allowed_actions: [] }, "ADMIN")).some(Boolean)).toBe(false);
  });

  it("falls back to local rules when allowed_actions is absent or null", () => {
    expect(getAllowedActions({ status: "WAITING" }, "APPROVER").start).toBe(true);
    expect(getAllowedActions({ status: "COMPLETED", allowed_actions: null }, "ADMIN").reopen).toBe(true);
    expect(getAllowedActions({ status: "WAITING" }, null).start).toBe(false);
  });
});

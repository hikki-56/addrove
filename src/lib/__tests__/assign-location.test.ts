import { canAssignLocation, validateAssignRows, assignAdjustDelta } from "@/lib/assign-location";

describe("assign-location", () => {
  it("allows staff roles and only ty@stockify.com among admins", () => {
    for (const r of ["WAREHOUSE_STAFF", "PACKER", "STAFF", "MANAGER", "APPROVER"]) expect(canAssignLocation(r)).toBe(true);
    expect(canAssignLocation("ADMIN", " TY@stockify.com ")).toBe(true);
    for (const e of ["milk@stockify.com", "ty@stockify.co", "", null, undefined]) expect(canAssignLocation("ADMIN", e)).toBe(false);
    expect(canAssignLocation("VIEWER")).toBe(false);
    expect(canAssignLocation(undefined)).toBe(false);
  });
  it("validates rows without comparing to unassigned stock", () => {
    expect(validateAssignRows([{ to_location_id: "A1", qty: 3 }, { to_location_id: "B2", qty: 2 }])).toEqual([]);
    expect(validateAssignRows([{ to_location_id: "A1", qty: 6 }])).toEqual([]);
    expect(validateAssignRows([{ to_location_id: "a1", qty: 1 }, { to_location_id: "A1", qty: 1 }]).length).toBe(1);
    expect(validateAssignRows([{ to_location_id: "", qty: 0 }]).length).toBe(2);
    expect(validateAssignRows([]).length).toBe(1);
  });
  it("computes ADJUST delta to set location qty to entered count", () => {
    expect(assignAdjustDelta(100, 40)).toBe(60);
    expect(assignAdjustDelta(100, 100)).toBe(0);
    expect(assignAdjustDelta(50, 80)).toBe(-30);
    expect(assignAdjustDelta(10, 0)).toBe(10);
  });
});

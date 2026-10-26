import { canAssignLocation, validateAssignRows } from "@/lib/assign-location";

describe("assign-location", () => {
  it("allows staff roles and only ty@stockify.com among admins", () => {
    for (const r of ["WAREHOUSE_STAFF", "PACKER", "STAFF", "MANAGER", "APPROVER"]) expect(canAssignLocation(r)).toBe(true);
    expect(canAssignLocation("ADMIN", " TY@stockify.com ")).toBe(true);
    for (const e of ["milk@stockify.com", "ty@stockify.co", "", null, undefined]) expect(canAssignLocation("ADMIN", e)).toBe(false);
    expect(canAssignLocation("VIEWER")).toBe(false);
    expect(canAssignLocation(undefined)).toBe(false);
  });
  it("validates rows against available unassigned stock", () => {
    expect(validateAssignRows([{ to_location_id: "A1", qty: 3 }, { to_location_id: "B2", qty: 2 }], 5)).toEqual([]);
    expect(validateAssignRows([{ to_location_id: "A1", qty: 6 }], 5).length).toBe(1);
    expect(validateAssignRows([{ to_location_id: "a1", qty: 1 }, { to_location_id: "A1", qty: 1 }], 5).length).toBe(1);
    expect(validateAssignRows([{ to_location_id: "", qty: 0 }], 5).length).toBe(2);
    expect(validateAssignRows([], 5).length).toBe(1);
  });
});

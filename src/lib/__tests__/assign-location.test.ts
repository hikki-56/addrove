import { canAssignLocation, validateAssignRows, splitAssignQty } from "@/lib/assign-location";

describe("assign-location", () => {
  it("allows staff roles and only ty@stockify.com among admins", () => {
    for (const r of ["WAREHOUSE_STAFF", "PACKER", "STAFF", "MANAGER", "APPROVER"]) expect(canAssignLocation(r)).toBe(true);
    expect(canAssignLocation("ADMIN", " TY@stockify.com ")).toBe(true);
    for (const e of ["milk@stockify.com", "ty@stockify.co", "", null, undefined]) expect(canAssignLocation("ADMIN", e)).toBe(false);
    expect(canAssignLocation("VIEWER")).toBe(false);
    expect(canAssignLocation(undefined)).toBe(false);
  });
  it("validates rows without blocking when total exceeds unassigned stock", () => {
    expect(validateAssignRows([{ to_location_id: "A1", qty: 3 }, { to_location_id: "B2", qty: 2 }])).toEqual([]);
    expect(validateAssignRows([{ to_location_id: "A1", qty: 6 }])).toEqual([]);
    expect(validateAssignRows([{ to_location_id: "a1", qty: 1 }, { to_location_id: "A1", qty: 1 }]).length).toBe(1);
    expect(validateAssignRows([{ to_location_id: "", qty: 0 }]).length).toBe(2);
    expect(validateAssignRows([]).length).toBe(1);
  });
  it("splits move from ไม่ระบุ vs excess ADJUST", () => {
    expect(splitAssignQty(5, 10)).toEqual({ move: 5, adjust: 0 });
    expect(splitAssignQty(10, 3)).toEqual({ move: 3, adjust: 7 });
    expect(splitAssignQty(4, 0)).toEqual({ move: 0, adjust: 4 });
    expect(splitAssignQty(2, -5)).toEqual({ move: 0, adjust: 2 });
  });
});

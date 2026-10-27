import {
  canAssignLocation,
  validateAssignRows,
  assignAdjustDelta,
  buildAssignSnapshot,
} from "@/lib/assign-location";

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
  it("builds warehouse snapshot: entered set, others (incl. ไม่ระบุ) to 0", () => {
    const plan = buildAssignSnapshot(
      [{ to_location_id: "A1", qty: 100 }],
      [
        { location_key: "A1", location_id: "loc-a1", quantity: 40 },
        { location_key: "B2", location_id: "loc-b2", quantity: 30 },
        { location_key: "", location_id: "loc-unassigned", quantity: 25 },
      ]
    );
    const byId = Object.fromEntries(plan.map((p) => [p.location_id, p]));
    expect(byId["loc-a1"]).toMatchObject({ target: 100, delta: 60 });
    expect(byId["loc-b2"]).toMatchObject({ target: 0, delta: -30 });
    expect(byId["loc-unassigned"]).toMatchObject({ target: 0, delta: -25 });
  });
  it("zeros ไม่ระบุ using real location_id, keeps empty location_key", () => {
    const plan = buildAssignSnapshot(
      [{ to_location_id: "1K23-1B", qty: 300 }],
      [
        { location_key: "1K23-1B", location_id: "loc-import-abc", quantity: 0 },
        { location_key: "", location_id: "loc-wh-01-unassigned", quantity: 3480 },
      ]
    );
    const un=plan.find((p) => p.location_id === "loc-wh-01-unassigned");
    expect(un).toMatchObject({ location_key: "", target: 0, current: 3480, delta: -3480 });
    const named=plan.find((p) => p.location_id === "loc-import-abc");
    expect(named).toMatchObject({ location_key: "1K23-1B", target: 300, delta: 300 });
    // writers must use location_id for ไม่ระบุ, never uppercased id as code
    expect(un!.location_id).toBe("loc-wh-01-unassigned");
    expect(un!.location_key).toBe("");
  });
});

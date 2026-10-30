import { getAssignLocationAccess, menuExclusion, ASSIGN_LOCATION_HREF as A, ASSIGN_LOCATION_REQUESTS_HREF as R } from "@/lib/assign-location";

describe("assign-location menu grants", () => {
  it("keeps role defaults when no list / list without these hrefs", () => {
    expect(getAssignLocationAccess("STAFF", "s@x.com", null)).toMatchObject({ assign: true, requests: true, approve: false });
    expect(getAssignLocationAccess("STAFF", "s@x.com", ["/dashboard"])).toMatchObject({ assign: true, requests: true });
    expect(getAssignLocationAccess("VIEWER", "v@x.com", null)).toMatchObject({ assign: false, requests: false, approve: false });
    expect(getAssignLocationAccess("ADMIN", "other@x.com", null)).toMatchObject({ assign: false, requests: false, approve: true });
  });
  it("tick grants access, exclusion removes it", () => {
    expect(getAssignLocationAccess("VIEWER", "v@x.com", [A, R])).toMatchObject({ assign: true, requests: true, approve: true });
    expect(getAssignLocationAccess("ADMIN", "other@x.com", [A])).toMatchObject({ assign: true });
    expect(getAssignLocationAccess("STAFF", "s@x.com", [menuExclusion(A), menuExclusion(R)])).toMatchObject({ assign: false, requests: false, approve: false });
    expect(getAssignLocationAccess("STAFF", "s@x.com", [R])).toMatchObject({ approve: true });
  });
  it("unverified ty admin gets no default", () => {
    expect(getAssignLocationAccess("ADMIN", "ty@stockify.com", null, false).assign).toBe(false);
  });
});
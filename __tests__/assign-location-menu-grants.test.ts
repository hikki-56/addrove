import { getAssignLocationAccess, menuExclusion, ASSIGN_APPROVE_HREF as P, ASSIGN_LOCATION_HREF as A, ASSIGN_LOCATION_REQUESTS_HREF as R } from "@/lib/assign-location";
import { parseMenuHrefs } from "@/lib/menu-visibility";
import { toUserMenuSettings } from "@/server/services/menu-settings.service";
import type { User } from "@/types/models";

describe("assign-location menu grants", () => {
  it("defaults: staff sees own requests only and cannot approve; only ADMIN approves", () => {
    expect(getAssignLocationAccess("STAFF", "s@x.com", null)).toMatchObject({ assign: true, requests: true, approve: false });
    expect(getAssignLocationAccess("STAFF", "s@x.com", ["/dashboard", R])).toMatchObject({ requests: true, approve: false });
    expect(getAssignLocationAccess("VIEWER", "v@x.com", null)).toMatchObject({ assign: false, requests: false, approve: false });
    expect(getAssignLocationAccess("ADMIN", "other@x.com", null)).toMatchObject({ assign: false, approve: true });
    expect(getAssignLocationAccess("ADMIN", "other@x.com", [menuExclusion(R)]).approve).toBe(true);
  });
  it("requests tick does not grant approve; approve tick does (and shows requests menu)", () => {
    expect(getAssignLocationAccess("VIEWER", "v@x.com", [A, R])).toMatchObject({ assign: true, requests: true, approve: false });
    expect(getAssignLocationAccess("STAFF", "s@x.com", [P])).toMatchObject({ approve: true, requests: true });
    expect(getAssignLocationAccess("VIEWER", "v@x.com", [P])).toMatchObject({ approve: true, requests: true, assign: false });
  });
  it("untick removes access", () => {
    expect(getAssignLocationAccess("STAFF", "s@x.com", ["/dashboard"]).approve).toBe(false);
    expect(getAssignLocationAccess("STAFF", "s@x.com", [menuExclusion(A), menuExclusion(R)])).toMatchObject({ assign: false, requests: false, approve: false });
  });
  it("approve href survives parsing and appears in settings", () => {
    expect(parseMenuHrefs([P])).toContain(P);
    const u = { id: "1", email: "s@x.com", full_name: "S", role: "STAFF", active: true, menu_hrefs: [P] } as unknown as User;
    const s = toUserMenuSettings(u);
    expect(s.available_menus.find((m) => m.href === P)?.locked).toBeFalsy();
    expect(s.current_menu_hrefs).toContain(P);
  });
  it("unverified ty admin gets no assign default", () => {
    expect(getAssignLocationAccess("ADMIN", "ty@stockify.com", null, false).assign).toBe(false);
  });
});
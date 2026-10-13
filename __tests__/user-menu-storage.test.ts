import { SheetsUserRepository } from "@/server/repositories/sheets/user.repository";
import { readSheet, updateRow } from "@/server/google-sheets/client";

jest.mock("@/server/google-sheets/client", () => ({
  readSheet: jest.fn(), appendRows: jest.fn(), updateRow: jest.fn(), SHEETS: { USERS: "Users" },
  parseBoolean: (value: string) => value === "TRUE", formatBoolean: (value: boolean) => value ? "TRUE" : "FALSE",
}));
const repository = new SheetsUserRepository();
const row = ["staff", "staff", "hash", "WAREHOUSE_STAFF", "Staff", "User", "staff@stockify.com", "", "TRUE", "", "", "pin-hash", '["wh-1"]'];

beforeEach(() => jest.clearAllMocks());

test("old Sheets rows retain default menu behavior", async () => {
  (readSheet as jest.Mock).mockResolvedValue([[...row]]);
  expect((await repository.findById("staff"))?.menu_hrefs).toBeNull();
  expect(readSheet).toHaveBeenCalledWith("Users", "A2:N");
});

test("an unrelated profile update preserves the saved menu column", async () => {
  (readSheet as jest.Mock).mockResolvedValue([[...row, '["/staff/receive"]']]);
  const updated = await repository.update("staff", { full_name: "New Name" });
  expect(updated?.menu_hrefs).toEqual(["/staff/receive"]);
  expect((updateRow as jest.Mock).mock.calls[0][2][13]).toBe('["/staff/receive"]');
});

test("clearing menus writes [] and resetting writes a blank cell", async () => {
  (readSheet as jest.Mock).mockResolvedValue([[...row, '["/staff/receive"]']]);
  expect((await repository.update("staff", { menu_hrefs: [] }))?.menu_hrefs).toEqual([]);
  expect((updateRow as jest.Mock).mock.calls[0][2][13]).toBe("[]");
  await repository.update("staff", { menu_hrefs: null });
  expect((updateRow as jest.Mock).mock.calls[1][2][13]).toBe("");
});

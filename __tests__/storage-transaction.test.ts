import { withStorageRequest } from "@/server/storage-transaction";
import { withDatabaseTransaction } from "@/server/repositories/postgres/database";

jest.mock("@/server/repositories/storage-driver", () => ({
  getStorageDriver: () => "postgres",
}));
jest.mock("@/server/repositories/postgres/database", () => ({
  withDatabaseTransaction: jest.fn(),
}));

const transaction = jest.mocked(withDatabaseTransaction);
const originalMaintenance = process.env.STORAGE_MAINTENANCE;

beforeEach(() => {
  delete process.env.STORAGE_MAINTENANCE;
  jest.clearAllMocks();
});

afterEach(() => {
  if (originalMaintenance === undefined) delete process.env.STORAGE_MAINTENANCE;
  else process.env.STORAGE_MAINTENANCE = originalMaintenance;
  jest.restoreAllMocks();
});

test("database outages return a login-compatible message without leaking connection details", async () => {
  jest.spyOn(console, "error").mockImplementation(() => {});
  transaction.mockRejectedValueOnce(new Error("private connection details"));
  const handler = jest.fn(async () => Response.json({ success: true }));

  const response = await withStorageRequest(handler)();
  const body = await response.json();

  expect(response.status).toBe(503);
  expect(body.message).toBe("ระบบฐานข้อมูลไม่พร้อมใช้งานชั่วคราว กรุณาลองใหม่อีกครั้ง");
  expect(body.error).toBe("บันทึกข้อมูลไม่สำเร็จ กรุณาลองใหม่");
  expect(JSON.stringify(body)).not.toContain("private connection details");
  expect(handler).not.toHaveBeenCalled();
});

test("invalid credentials retain the handler's 401 response", async () => {
  transaction.mockImplementationOnce(async (action) => action());
  const denied = Response.json({ success: false, message: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" }, { status: 401 });

  expect(await withStorageRequest(async () => denied)()).toBe(denied);
});

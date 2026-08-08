import {
  getAccessibleWarehouseIds,
  hasWarehouseAccess,
} from "@/lib/api-response";
import {
  generateEmployeeQrToken,
  verifyEmployeeQrToken,
} from "@/lib/qr-token";
import { getAuthSecret } from "@/lib/server-secrets";

describe("security helpers", () => {
  const originalAuthSecret = process.env.AUTH_SECRET;
  const originalNextAuthSecret = process.env.NEXTAUTH_SECRET;
  const originalQrSecret = process.env.QR_TOKEN_SECRET;

  afterEach(() => {
    process.env.AUTH_SECRET = originalAuthSecret;
    process.env.NEXTAUTH_SECRET = originalNextAuthSecret;
    process.env.QR_TOKEN_SECRET = originalQrSecret;
  });

  test("warehouse access fails closed and normalizes warehouse IDs", () => {
    expect(hasWarehouseAccess("not-json", "wh-1")).toBe(false);
    expect(hasWarehouseAccess('["wh-01"]', "wh-1")).toBe(true);
    expect(hasWarehouseAccess([], "wh-1")).toBe(false);
    expect(getAccessibleWarehouseIds('["*"]')).toBeNull();
  });

  test("QR token rejects tampering and expired tokens", () => {
    process.env.QR_TOKEN_SECRET = "test-only-qr-secret-at-least-32-characters";
    const token = generateEmployeeQrToken("employee-1", 60);
    expect(verifyEmployeeQrToken(token)?.employee_id).toBe("employee-1");
    expect(verifyEmployeeQrToken(`${token}x`)).toBeNull();
    expect(verifyEmployeeQrToken(generateEmployeeQrToken("employee-1", -1))).toBeNull();
  });

  test("authentication secret has no source-code fallback", () => {
    delete process.env.AUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    expect(() => getAuthSecret()).toThrow(/required/);
  });

  test("malformed warehouse_access rejects permissions and never defaults to wildcard", () => {
    expect(hasWarehouseAccess("invalid-json{[", "wh-1")).toBe(false);
    expect(hasWarehouseAccess("{malformed: true}", "wh-1")).toBe(false);
    expect(hasWarehouseAccess("", "wh-1")).toBe(false);
    expect(getAccessibleWarehouseIds("invalid-json{")).toEqual([]);
    expect(getAccessibleWarehouseIds(undefined)).toEqual([]);
  });

  test("wildcard is only granted on explicit valid wildcard, not on corrupt data", () => {
    expect(getAccessibleWarehouseIds('["*"]')).toBeNull();
    expect(getAccessibleWarehouseIds("*")).toBeNull();
    expect(hasWarehouseAccess('["wh-1"]', "wh-2")).toBe(false);
  });
});


import { NextRequest } from "next/server";
import { POST } from "@/app/api/products/master/route";
import { GET } from "@/app/api/products/route";
import { getAuthSession } from "@/server/auth-session";
import { getRepository } from "@/server/repositories";
import { readSheet } from "@/server/google-sheets/client";
import { createProductWithStock } from "@/server/services/create-product";

jest.mock("@/server/auth-session", () => ({ getAuthSession: jest.fn() }));
jest.mock("@/server/repositories", () => ({ getRepository: jest.fn() }));
jest.mock("@/server/storage-transaction", () => ({ withStorageRequest: (handler: unknown) => handler }));
jest.mock("@/server/services/create-product", () => ({ createProductWithStock: jest.fn() }));
jest.mock("@/server/google-sheets/client", () => ({
  readSheet: jest.fn(), appendRows: jest.fn(), SHEETS: { PRODUCTS: "PRODUCTS" },
  getWarehouseSheetName: () => "โกดัง1",
}));

const products = { create: jest.fn(), findBySku: jest.fn(), findByBarcode: jest.fn(), findAll: jest.fn() };
const input = { sku: "MASTER-NEW", barcode: "8859991234567", product_name: "สินค้าใหม่", category: "ทดสอบ", base_unit: "ชิ้น", minimum_stock: 5 };
const request = (body: unknown = input) => new NextRequest("http://localhost/api/products/master", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(getAuthSession).mockResolvedValue({ user: { id: "admin", role: "ADMIN", warehouse_access: ["*"] }, expires: "2099-01-01" } as never);
  jest.mocked(getRepository).mockReturnValue({ products } as never);
  products.findBySku.mockResolvedValue(null);
  products.findByBarcode.mockResolvedValue(null);
  products.findAll.mockResolvedValue([]);
  products.create.mockImplementation(async data => ({ ...data, product_id: `prod-${data.sku}`, active: true }));
  jest.mocked(readSheet).mockResolvedValue([]);
});

test("anonymous callers cannot create master products", async () => {
  jest.mocked(getAuthSession).mockResolvedValue(null);
  expect((await POST(request())).status).toBe(401);
  expect(getRepository).not.toHaveBeenCalled();
});

test.each(["MANAGER", "APPROVER", "WAREHOUSE_STAFF", "STAFF", "PACKER", "VIEWER"])("%s cannot create master products even through a direct API call", async role => {
  jest.mocked(getAuthSession).mockResolvedValue({ user: { id: "other", role }, expires: "2099-01-01" } as never);
  expect((await POST(request())).status).toBe(403);
  expect(products.create).not.toHaveBeenCalled();
});

test("admin creates a master record without invoking the stock creation workflow", async () => {
  const response = await POST(request({ ...input, sku: " MASTER-NEW ", supplier: "Supplier", units_per_carton: 12 }));
  expect(response.status).toBe(201);
  expect((await response.json()).data.sku).toBe("MASTER-NEW");
  expect(products.create).toHaveBeenCalledWith(expect.objectContaining({ ...input, supplier: "Supplier", units_per_carton: 12, initial_quantity: 0 }));
  expect(products.create.mock.calls[0][0]).not.toHaveProperty("warehouse_id");
  expect(createProductWithStock).not.toHaveBeenCalled();
});

test.each([
  { sku: "   " }, { product_name: "   " }, { category: "   " }, { base_unit: "   " },
  { minimum_stock: -1 }, { units_per_carton: 0 }, { initial_quantity: 10 }, { warehouse_id: "wh-1" },
])("invalid or stock-related fields are rejected: %j", async fields => {
  expect((await POST(request({ ...input, ...fields }))).status).toBe(400);
  expect(products.create).not.toHaveBeenCalled();
});

test("duplicate SKU, barcode, and concurrent unique conflicts cannot overwrite master records", async () => {
  products.findBySku.mockResolvedValueOnce({ sku: input.sku });
  expect((await POST(request())).status).toBe(409);
  products.findByBarcode.mockResolvedValueOnce({ barcode: input.barcode });
  expect((await POST(request())).status).toBe(409);
  expect(products.create).not.toHaveBeenCalled();
  products.create.mockRejectedValueOnce({ code: "23505" });
  expect((await POST(request())).status).toBe(409);
});

test("the all-products list includes catalog-only products at zero stock alongside stocked products", async () => {
  products.findAll.mockResolvedValue([
    { ...input, product_id: "prod-MASTER-NEW" },
    { ...input, sku: "STOCKED", barcode: "STOCKED", product_id: "prod-STOCKED" },
  ]);
  jest.mocked(readSheet).mockImplementation(async sheet => sheet === "โกดัง1" ? [["STOCKED", "STOCKED", "Stocked product", "ทดสอบ", "ชิ้น", "8", "A1", "", ""]] : []);
  const response = await GET(new NextRequest("http://localhost/api/products?search=MASTER-NEW&page=1&limit=10"));
  const json = await response.json();
  expect(response.status).toBe(200);
  expect(json.data.total).toBe(1);
  expect(json.data.items[0]).toMatchObject({ sku: "MASTER-NEW", total_quantity: 0, quantity: 0, minimum_stock: 5, locations_breakdown: [] });
  const stocked = await GET(new NextRequest("http://localhost/api/products?search=STOCKED"));
  expect((await stocked.json()).data).toEqual([expect.objectContaining({ sku: "STOCKED", total_quantity: 8 })]);
});

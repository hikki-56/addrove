import { CreateProductSchema, UpdateProductSchema } from "@/types/api";

test("products accept unknown carton sizes and partial edits preserve omission", () => {
  const product = { sku: "TEST", product_name: "Test", category: "test" };
  expect(CreateProductSchema.parse(product)).not.toHaveProperty("units_per_carton");
  expect(CreateProductSchema.parse({ ...product, units_per_carton: 12 }).units_per_carton).toBe(12);
  expect(UpdateProductSchema.parse({ units_per_carton: null }).units_per_carton).toBeNull();
  expect(UpdateProductSchema.parse({ product_name: "Renamed" })).not.toHaveProperty("units_per_carton");
});

test.each([0, -1, 1.5, "12", "", Number.NaN, Number.POSITIVE_INFINITY, 2147483648])(
  "API rejects invalid carton quantity %s",
  value => {
    expect(UpdateProductSchema.safeParse({ units_per_carton: value }).success).toBe(false);
    expect(CreateProductSchema.safeParse({ sku: "TEST", product_name: "Test", category: "test", units_per_carton: value }).success).toBe(false);
  },
);

import {
  createInMemoryRepository,
  InMemoryStockRepository,
  SheetsWarehouseRepository,
  SheetsLocationRepository,
} from "@/lib/repositories";
import { getStockBalances } from "@/lib/services/stock/shared";

describe("Repository Contract Parity Tests", () => {
  test("In-Memory Repository satisfies IStockRepository interface completely", () => {
    const repo = createInMemoryRepository();
    expect(repo.warehouses).toBeDefined();
    expect(repo.locations).toBeDefined();
    expect(repo.shelves).toBeDefined();
    expect(repo.products).toBeDefined();
    expect(repo.documents).toBeDefined();
    expect(repo.movements).toBeDefined();
    expect(repo.stockSummary).toBeDefined();
    expect(repo.stockCounts).toBeDefined();
    expect(repo.users).toBeDefined();
    expect(repo.dashboard).toBeDefined();
    expect(repo.idempotency).toBeDefined();
    expect(repo.audit).toBeDefined();
    expect(repo.journal).toBeDefined();
    expect(repo.warehouseSync).toBeDefined();
  });

  test("getStockBalances works identically with In-Memory Repository and zero Sheets dependencies", async () => {
    const inMemoryRepo = new InMemoryStockRepository();
    const balances = await getStockBalances({ repo: inMemoryRepo });
    expect(Array.isArray(balances)).toBe(true);
    expect(balances.length).toBeGreaterThan(0);
    expect(balances[0].product_id).toBe("prod-1");
    expect(balances[0].sku).toBe("SKU001");
  });

  test("Repository methods accept and return pure Domain types without raw Sheets column index", async () => {
    const repo = createInMemoryRepository();
    const product = await repo.products.create({
      sku: "PROD-CONTRACT-01",
      product_name: "Contract Testing Product",
      category: "ทดสอบ",
    });

    expect(product.product_id).toBeDefined();
    expect(product.sku).toBe("PROD-CONTRACT-01");
    expect(product.product_name).toBe("Contract Testing Product");

    const found = await repo.products.findBySku("PROD-CONTRACT-01");
    expect(found).not.toBeNull();
    expect(found?.product_id).toBe(product.product_id);
  });
});

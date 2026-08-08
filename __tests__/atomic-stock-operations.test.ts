import { issueStock } from "@/lib/services/stock/issue-stock";
import { receiveStock } from "@/lib/services/stock/receive-stock";
import { completeTransfer, cancelTransfer, createTransfer } from "@/lib/services/stock/transfer-stock";
import { InMemoryStockRepository } from "@/lib/repositories/in-memory/in-memory-stock.repository";

describe("Atomic Stock Operations Concurrency", () => {
  let repo: InMemoryStockRepository;
  let deps: { repo: InMemoryStockRepository };

  beforeEach(async () => {
    repo = new InMemoryStockRepository();
    deps = { repo };
    
    // Seed initial data
    await repo.products.create({ product_name: "Test", sku: "TEST-01", barcode: "TEST-01", category: "Test", active: true });
    
    // Seed initial stock
    const doc = await repo.documents.create({
      document_type: "RECEIVE",
      reference_no: "INIT-01",
      document_date: new Date().toISOString(),
      status: "COMPLETED",
      created_by: "system",
    });
    
    const mov = await repo.movements.batchCreate([{
      document_id: doc.document_id,
      product_id: "prod-1", // ID is hardcoded in InMemoryProductRepository initially
      warehouse_id: "wh-1",
      location_id: "loc-A",
      qty_change: 100,
      movement_type: "RECEIVE_IN",
      idempotency_key: "init",
      created_by: "system",
    }]);
  });

  test("10 concurrent requests with same idempotency key produce only one stock effect", async () => {
    const promises = Array.from({ length: 10 }, () => 
      issueStock(deps, {
        idempotency_key: "concurrent-test-001",
        user_id: "user-1",
        warehouse_id: "wh-1",
        reference_no: "REF-01",
        document_date: new Date().toISOString(),
        lines: [
          { product_id: "prod-1", location_id: "loc-A", qty: 10 }
        ]
      }).catch(err => err)
    );

    const results = await Promise.all(promises);
    const successes = results.filter(r => !(r instanceof Error));
    
    // Exactly one success (or one returned Document from replay)
    // Wait, idempotency returns the cached doc for replays!
    // So all 10 might succeed, but only ONE should actually deduct stock!
    
    const balance = await repo.movements.getBalance("prod-1", "wh-1", "loc-A");
    expect(balance).toBe(90); // 100 - 10
  });

  test("Multiple concurrent completes only add stock once", async () => {
    // Create a transfer first
    const doc = await createTransfer(deps, {
      idempotency_key: "tf-create-001",
      user_id: "user-1",
      from_warehouse_id: "wh-1",
      to_warehouse_id: "wh-2",
      from_location_id: "loc-A",
      to_location_id: "B",
      product_id: "prod-1",
      qty: 20,
      reference_no: "TF-01",
      document_date: new Date().toISOString(),
      moved_by: "tester"
    });

    const promises = Array.from({ length: 5 }, () => 
      completeTransfer(deps, doc.document_id, "B", "user-1").catch(err => err)
    );

    await Promise.all(promises);

    const destBalance = await repo.movements.getBalance("prod-1", "wh-2", "B");
    expect(destBalance).toBe(20);
  });

  test("Multiple concurrent cancels only reverse once", async () => {
    // Create a transfer
    const doc = await createTransfer(deps, {
      idempotency_key: "tf-create-002",
      user_id: "user-1",
      from_warehouse_id: "wh-1",
      to_warehouse_id: "wh-2",
      from_location_id: "loc-A",
      to_location_id: "B",
      product_id: "prod-1",
      qty: 30,
      reference_no: "TF-02",
      document_date: new Date().toISOString(),
      moved_by: "tester"
    });

    const promises = Array.from({ length: 5 }, () => 
      cancelTransfer(deps, doc.document_id, "cancel test", "user-1").catch(err => err)
    );

    await Promise.all(promises);

    const sourceBalance = await repo.movements.getBalance("prod-1", "wh-1", "loc-A");
    // Initial 100 - 30 (create) + 30 (cancel) = 100
    expect(sourceBalance).toBe(100);
    const destBalance = await repo.movements.getBalance("prod-1", "wh-2", "B");
    // 0 + 30 (create) - 30 (cancel) = 0
    expect(destBalance).toBe(0);
  });

  test("Concurrent complete + cancel: only one state transition succeeds", async () => {
    const doc = await createTransfer(deps, {
      idempotency_key: "tf-create-003",
      user_id: "user-1",
      from_warehouse_id: "wh-1",
      to_warehouse_id: "wh-2",
      from_location_id: "loc-A",
      to_location_id: "B",
      product_id: "prod-1",
      qty: 40,
      reference_no: "TF-03",
      document_date: new Date().toISOString(),
      moved_by: "tester"
    });

    const p1 = completeTransfer(deps, doc.document_id, "B", "user-1").catch(e => e);
    const p2 = cancelTransfer(deps, doc.document_id, "cancel", "user-1").catch(e => e);

    const results = await Promise.all([p1, p2]);
    
    const finalDoc = await repo.documents.findById(doc.document_id);
    expect(["COMPLETED", "CANCELLED"]).toContain(finalDoc?.status);

    const sourceBalance = await repo.movements.getBalance("prod-1", "wh-1", "loc-A");
    const destBalance = await repo.movements.getBalance("prod-1", "wh-2", "B");

    if (finalDoc?.status === "COMPLETED") {
      expect(sourceBalance).toBe(60); // 100 - 40
      expect(destBalance).toBe(40);
    } else {
      expect(sourceBalance).toBe(100); // Reversed
      expect(destBalance).toBe(0); // Reversed
    }
  });

  test("Insufficient stock under concurrent issue doesn't go negative", async () => {
    // Only 100 stock available. We try to issue 60, twice, with different idempotency keys.
    const p1 = issueStock(deps, {
      idempotency_key: "issue-insufficient-1",
      user_id: "user-1",
      warehouse_id: "wh-1",
      reference_no: "REF-02",
      document_date: new Date().toISOString(),
      lines: [{ product_id: "prod-1", location_id: "loc-A", qty: 60 }]
    }).catch(e => e);
    
    const p2 = issueStock(deps, {
      idempotency_key: "issue-insufficient-2",
      user_id: "user-1",
      warehouse_id: "wh-1",
      reference_no: "REF-03",
      document_date: new Date().toISOString(),
      lines: [{ product_id: "prod-1", location_id: "loc-A", qty: 60 }]
    }).catch(e => e);

    const [res1, res2] = await Promise.all([p1, p2]);
    
    const isError1 = res1 instanceof Error;
    const isError2 = res2 instanceof Error;
    
    // Exactly one should fail due to insufficient stock
    expect(isError1 !== isError2).toBe(true);

    const balance = await repo.movements.getBalance("prod-1", "wh-1", "loc-A");
    expect(balance).toBe(40); // 100 - 60
  });

  test("Mid-transaction failure leaves journal, no partial state without compensation", async () => {
    // We'll mock the repo.documents.create to fail on purpose
    const originalCreate = repo.documents.create.bind(repo.documents);
    repo.documents.create = async (doc) => {
      throw new Error("Simulated DB failure");
    };

    const p = issueStock(deps, {
      idempotency_key: "fail-test-001",
      user_id: "user-1",
      warehouse_id: "wh-1",
      reference_no: "REF-04",
      document_date: new Date().toISOString(),
      lines: [{ product_id: "prod-1", location_id: "loc-A", qty: 10 }]
    }).catch(e => e);

    const err = await p;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("Simulated DB failure");

    // Check that journal exists and idempotency is marked FAILED
    const idemp = await repo.idempotency.findByKey("fail-test-001");
    expect(idemp?.status).toBe("FAILED");
    expect(idemp?.error_message).toBe("Simulated DB failure");

    // Stock should not be touched
    const balance = await repo.movements.getBalance("prod-1", "wh-1", "loc-A");
    expect(balance).toBe(100);

    // Restore mock
    repo.documents.create = originalCreate;
  });
});

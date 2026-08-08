import {
  getPendingTransferNotifications,
  syncServerTransferNotifications,
} from "@/lib/transfer-notification-utils";

function installBrowserStorage() {
  const values = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };

  (globalThis as any).window = {
    localStorage,
    dispatchEvent: () => true,
  };
  (globalThis as any).localStorage = localStorage;
}

describe("transfer notifications", () => {
  beforeEach(() => {
    installBrowserStorage();
  });

  afterEach(() => {
    delete (globalThis as any).window;
    delete (globalThis as any).localStorage;
  });

  it("keeps a newly synced server assignment visible to the assigned staff member", () => {
    syncServerTransferNotifications([
      {
        document_id: "doc-1",
        document_no: "TRF-0001",
        product_id: "prod-1",
        product_name: "สินค้า A",
        sku: "SKU-1",
        from_warehouse_id: "wh-01",
        from_warehouse_name: "โกดัง1",
        to_warehouse_id: "wh-02",
        to_warehouse_name: "โกดัง2",
        qty: 2,
        moved_by: "สมชาย",
        created_at: "2026-08-05T00:00:00.000Z",
        status: "PENDING",
      },
    ]);

    expect(getPendingTransferNotifications("สมชาย")).toHaveLength(1);
  });
});

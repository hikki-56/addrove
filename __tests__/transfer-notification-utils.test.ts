import {
  getPendingTransferNotifications,
  syncServerTransferNotifications,
  parseTransferMetadata,
} from "@/lib/transfer-notification-utils";
import { detectWarehouseFromLocation, getWarehouseDisplayName } from "@/lib/warehouse-utils";

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

describe("transfer notifications & warehouse detection", () => {
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

  it("parses transfer metadata from escaped JSON or text routes", () => {
    const escapedJson = '"{""from_warehouse_id"":""wh-02"",""to_warehouse_id"":""wh-01"",""sku"":""GG1300"",""qty"":600}"';
    const parsed1 = parseTransferMetadata(escapedJson);
    expect(parsed1.from_warehouse_id).toBe("wh-02");
    expect(parsed1.to_warehouse_id).toBe("wh-01");
    expect(parsed1.sku).toBe("GG1300");
    expect(parsed1.qty).toBe(600);

    const textRoute = "ย้ายสินค้าจาก โกดัง 1 ➔ โกดัง 2 โดย สมชาย";
    const parsed2 = parseTransferMetadata(textRoute);
    expect(parsed2.from_warehouse_id).toBe("wh-01");
    expect(parsed2.to_warehouse_id).toBe("wh-02");
  });

  it("detects warehouse from shelf location codes", () => {
    expect(detectWarehouseFromLocation("1K11-2A")).toBe("wh-01");
    expect(detectWarehouseFromLocation("2K11-2A")).toBe("wh-02");
    expect(detectWarehouseFromLocation("3A-01")).toBe("wh-03");
    expect(detectWarehouseFromLocation("4B-12")).toBe("wh-04");
    expect(detectWarehouseFromLocation("5C-05")).toBe("wh-05");
    expect(detectWarehouseFromLocation("6D-01")).toBe("wh-06");
    expect(detectWarehouseFromLocation("loc-wh-02-A1")).toBe("wh-02");
    expect(detectWarehouseFromLocation("สำนักงานใหญ่")).toBe("wh-06");
  });

  it("formats user-friendly warehouse display names", () => {
    expect(getWarehouseDisplayName("wh-01")).toBe("โกดัง1");
    expect(getWarehouseDisplayName("wh-02")).toBe("โกดัง2");
    expect(getWarehouseDisplayName("wh-06")).toBe("สำนักงานใหญ่");
  });
});

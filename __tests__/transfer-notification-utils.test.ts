import {
  getPendingTransferNotifications,
  syncServerTransferNotifications,
  parseTransferMetadata,
  getInStockSourceLocations,
  updateTransferTaskProgress,
  whenTransferProgressSettled,
  fetchAndSyncTransferNotifications,
  getTransferNotifications,
  isTransferCompleted,
  unmarkTransferCompleted,
} from "@/lib/transfer-notification-utils";
import { detectWarehouseFromLocation, getWarehouseDisplayName } from "@/lib/warehouse-utils";
import type { Product } from "@/types/models";

function installBrowserStorage() {
  const values = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };

  (globalThis as any).window = {
    localStorage,
    sessionStorage: localStorage,
    dispatchEvent: () => true,
  };
  (globalThis as any).localStorage = localStorage;
  (globalThis as any).sessionStorage = localStorage;
}

describe("transfer notifications & warehouse detection", () => {
  beforeEach(() => {
    installBrowserStorage();
  });

  afterEach(() => {
    delete (globalThis as any).window;
    delete (globalThis as any).localStorage;
    delete (globalThis as any).sessionStorage;
  });

  it("syncs a large completion history once without flooding shared UI subscribers", () => {
    const pending = { document_id: "pending-fixture", document_no: "TRF-PENDING", status: "PENDING",
      product_id: "prod-fixture", sku: "SKU-FIXTURE", product_name: "Fixture", created_at: new Date().toISOString() };
    const history = Array.from({ length: 800 }, (_, i) => ({
      ...pending, document_id: `completed-${i}`, document_no: `TRF-${i}`,
      status: ["COMPLETED", "CANCELLED", "REJECTED", "POSTED"][i % 4],
    }));
    const read = jest.spyOn(localStorage, "getItem");
    const write = jest.spyOn(localStorage, "setItem");
    const dispatch = jest.spyOn(window, "dispatchEvent").mockImplementation(() => {
      // Sidebar and Navbar both synchronously read notifications on this event.
      getPendingTransferNotifications();
      getPendingTransferNotifications();
      return true;
    });

    syncServerTransferNotifications([...history, pending]);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(2);
    expect(read.mock.calls.length).toBeLessThanOrEqual(8);
    expect(getPendingTransferNotifications().map((task) => task.id)).toEqual([pending.document_id]);
    expect(isTransferCompleted("COMPLETED-0")).toBe(true);
    expect(isTransferCompleted("completed-1")).toBe(true);
    expect(isTransferCompleted("completed-2")).toBe(true);

    read.mockClear(); write.mockClear(); dispatch.mockClear();
    syncServerTransferNotifications([...history, pending]);
    expect(write).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(read.mock.calls.length).toBeLessThanOrEqual(3);

    // A new completion still removes the task and updates both UI consumers once.
    syncServerTransferNotifications([...history, { ...pending, status: "COMPLETED" }]);
    expect(getPendingTransferNotifications()).toEqual([]);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("reads completion IDs once per notification list and respects rollback and document numbers", () => {
    localStorage.setItem("stockify_completed_transfers", JSON.stringify([" DOC-1 ", "trf-0002"]));
    localStorage.setItem("stockify_transfer_notifications", JSON.stringify([
      { id: "doc-1", doc_no: "TRF-0001", status: "PENDING" },
      { id: "doc-2", doc_no: "TRF-0002", status: "PENDING" },
      { id: "doc-3", doc_no: "TRF-0003", status: "PENDING" },
    ]));
    const read = jest.spyOn(localStorage, "getItem");
    expect(getTransferNotifications().filter((task) => task.status === "COMPLETED")).toHaveLength(2);
    expect(read).toHaveBeenCalledTimes(2);
    expect(getPendingTransferNotifications().map((task) => task.id)).toEqual(["doc-3"]);
    unmarkTransferCompleted("doc-1");
    expect(isTransferCompleted("doc-1")).toBe(false);
    expect(getTransferNotifications().find((task) => task.id === "doc-1")?.status).toBe("WAITING_APPROVAL");
  });

  it("removes posted ledger history and cached legacy references from the picking queue", () => {
    const legacyNote = JSON.stringify({ kind: "LEGACY_IMPORT_REFERENCE" });
    const pending = { document_id: "real-pending", document_no: "TRF-NEW", status: "PENDING",
      product_id: "prod-fixture", sku: "SKU-FIXTURE", product_name: "Fixture", created_at: new Date().toISOString() };
    localStorage.setItem("stockify_transfer_notifications", JSON.stringify([
      { id: "legacy-posted", doc_no: "LEGACY-fixture", status: "PENDING", note: legacyNote },
      { id: "posted-transfer", doc_no: "TRF-OLD", status: "PENDING" },
    ]));
    // The legacy task cached by the previous version is hidden even before polling.
    expect(getTransferNotifications().some((task) => task.id === "legacy-posted")).toBe(false);
    syncServerTransferNotifications([
      { document_id: "legacy-posted", document_no: "LEGACY-fixture", status: "POSTED", note: legacyNote },
      { document_id: "legacy-reference", document_no: "LEGACY-reference", status: "PENDING", note: legacyNote },
      { ...pending, document_id: "posted-transfer", document_no: "TRF-OLD", status: "POSTED" },
      pending,
      { ...pending, document_id: "real-waiting", document_no: "TRF-WAITING", status: "WAITING_APPROVAL" },
    ]);
    expect(getPendingTransferNotifications().map((task) => task.id)).toEqual(["real-pending"]);
    expect(getTransferNotifications().find((task) => task.id === "real-waiting")?.status).toBe("WAITING_APPROVAL");
    expect(isTransferCompleted("posted-transfer")).toBe(true);
    expect(isTransferCompleted("legacy-posted")).toBe(true);
    expect(isTransferCompleted("legacy-reference")).toBe(true);
  });

  it("shares a slow notification request across subscribers and permits refresh after completion", async () => {
    let finishRequest!: (response: Response) => void;
    const pendingResponse = new Promise<Response>((resolve) => {
      finishRequest = resolve;
    });
    const clock = jest.spyOn(Date, "now").mockReturnValue(1000);
    const fetchMock = jest.spyOn(globalThis, "fetch").mockReturnValue(pendingResponse);

    try {
      const first = fetchAndSyncTransferNotifications();
      // Another page subscribes while the original request has been slow for 5s.
      clock.mockReturnValue(6000);
      const second = fetchAndSyncTransferNotifications();
      finishRequest(new Response(JSON.stringify({ success: true, data: [] }), { status: 200 }));
      await Promise.all([first, second]);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true, data: [] }), { status: 200 }));
      await fetchAndSyncTransferNotifications();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      clock.mockRestore();
      fetchMock.mockRestore();
    }
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

  it("keeps the local product info when the server note lost its metadata (progress-only note)", () => {
    // สถานะในเครื่อง: การ์ดที่เคยมีข้อมูลสินค้าครบ (สร้างจากฟอร์มในแอป)
    (globalThis as any).localStorage.setItem(
      "stockify_transfer_notifications",
      JSON.stringify([
        {
          id: "doc-2",
          doc_no: "TRF-0002",
          product_id: "prod-0สถล-020",
          product_name: "2878#JW-สายถักSTL 20นิ้ว",
          sku: "0สถล-020",
          barcode: "11002675",
          from_warehouse_id: "wh-03",
          from_warehouse_name: "โกดัง3",
          to_warehouse_id: "wh-02",
          to_warehouse_name: "โกดัง2",
          qty: 400,
          moved_by: "",
          created_at: "2026-09-04T01:36:34.204Z",
          status: "PENDING",
          current_step: 3,
        },
      ])
    );

    // server ส่งกลับมาแบบ note โดนเขียนทับจนเหลือแค่ข้อมูล progress
    syncServerTransferNotifications([
      {
        document_id: "doc-2",
        document_no: "TRF-0002",
        note: '{"current_step":3,"current_step_text":"กำลังนำเข้าตำแหน่งปลายทาง"}',
        created_at: "2026-09-04T01:36:34.204Z",
        status: "PENDING",
      },
    ]);

    const tasks = getPendingTransferNotifications();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].sku).toBe("0สถล-020");
    expect(tasks[0].barcode).toBe("11002675");
    expect(tasks[0].product_id).toBe("prod-0สถล-020");
    expect(tasks[0].product_name).toBe("2878#JW-สายถักSTL 20นิ้ว");
    // ขั้นตอนงานยังตาม server
    expect(tasks[0].current_step).toBe(3);
  });

  it("does not demote a locally WAITING_APPROVAL task back to PENDING when the server sheet is stale", () => {
    // สถานการณ์จริง: พนักงานกดยืนยันการเบิกสำเร็จ (เครื่อง mark WAITING_APPROVAL แล้ว)
    // แต่แถวในชีตถูก progress PATCH เก่าเขียนทับกลับเป็น PENDING — sync ต้องไม่ดึง
    // รายการออกจากคิวรออนุมัติ (สถานะเดินหน้าได้อย่างเดียว ยกเว้น COMPLETED)
    (globalThis as any).localStorage.setItem(
      "stockify_transfer_notifications",
      JSON.stringify([
        {
          id: "doc-3",
          doc_no: "TRF-0003",
          product_id: "prod-3",
          product_name: "สินค้า C",
          sku: "SKU-3",
          from_warehouse_id: "wh-01",
          from_warehouse_name: "โกดัง1",
          to_warehouse_id: "wh-02",
          to_warehouse_name: "โกดัง2",
          qty: 135,
          moved_by: "พนักงาน",
          created_at: "2026-09-11T02:18:42.660Z",
          status: "WAITING_APPROVAL",
          current_step: 4,
          to_location_id: "2K44-1A",
        },
      ])
    );

    syncServerTransferNotifications([
      {
        document_id: "doc-3",
        document_no: "TRF-0003",
        note: '{"current_step":3}',
        created_at: "2026-09-11T02:18:42.660Z",
        status: "PENDING",
      },
    ]);

    // ต้องยังอยู่ในคิวรออนุมัติ ไม่เด้งกลับไปรายการที่ต้องไปเบิก
    expect(getPendingTransferNotifications()).toHaveLength(0);
    const waiting = JSON.parse(
      (globalThis as any).localStorage.getItem("stockify_transfer_notifications")
    );
    expect(waiting).toHaveLength(1);
    expect(waiting[0].status).toBe("WAITING_APPROVAL");
    expect(waiting[0].current_step).toBe(4);
    expect(waiting[0].to_location_id).toBe("2K44-1A");
  });

  it("recovers sku/barcode from the notification's own note when task fields are empty", () => {
    syncServerTransferNotifications([
      {
        document_id: "doc-3",
        document_no: "TRF-0003",
        // note มี metadata ครบ แต่ server ไม่ได้ส่ง sku/barcode เป็น field ระดับบน
        note: JSON.stringify({
          from_warehouse_id: "wh-03",
          to_warehouse_id: "wh-02",
          product_id: "prod-0สถล-020",
          sku: "0สถล-020",
          barcode: "11002675",
          product_name: "2878#JW-สายถักSTL 20นิ้ว",
          qty: 400,
          original_note: "",
        }),
        created_at: "2026-09-04T01:36:34.204Z",
        status: "PENDING",
      },
    ]);

    const tasks = getPendingTransferNotifications();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].sku).toBe("0สถล-020");
    expect(tasks[0].barcode).toBe("11002675");
    expect(tasks[0].product_name).toBe("2878#JW-สายถักSTL 20นิ้ว");
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

  it("shows only shelves that still have stock and hides already-emptied ones", () => {
    const product: Product = {
      product_id: "prod-1",
      sku: "SKU-1",
      barcode: "100001",
      product_name: "สินค้า A",
      category: "ทั่วไป",
      base_unit: "ชิ้น",
      minimum_stock: 0,
      description: "",
      active: true,
      created_at: "2026-08-05T00:00:00.000Z",
      updated_at: "2026-08-05T00:00:00.000Z",
      locations_breakdown: [
        { warehouse_id: "wh-01", warehouse_name: "โกดัง1", location: "1K11-1A", quantity: 0 },
        { warehouse_id: "wh-01", warehouse_name: "โกดัง1", location: "1K11-2B", quantity: 300 },
        { warehouse_id: "wh-02", warehouse_name: "โกดัง2", location: "2K11-1C", quantity: 999 },
      ],
    };
    const task = {
      sku: "SKU-1",
      product_id: "prod-1",
      barcode: "100001",
      from_warehouse_id: "wh-01",
      from_warehouse_name: "โกดัง1",
    };

    // ชั้นวางที่ถูกเบิกจนหมด (qty 0) ต้องไม่ถูกแสดง
    expect(getInStockSourceLocations(task, [product])).toEqual(["1K11-2B"]);

    // ทุกชั้นวางในโกดังต้นทางหมด → คืนลิสต์ว่าง (ไม่แสดงตำแหน่งหลอก)
    const emptied = { ...product, locations_breakdown: [product.locations_breakdown![0]] };
    expect(getInStockSourceLocations(task, [emptied])).toEqual([]);
  });

  it("returns null so legacy fallback applies when no per-shelf stock data exists", () => {
    const noBreakdown = {
      product_id: "prod-2",
      sku: "SKU-2",
      barcode: "",
      product_name: "สินค้า B",
      category: "ทั่วไป",
      base_unit: "ชิ้น",
      minimum_stock: 0,
      description: "",
      active: true,
      created_at: "2026-08-05T00:00:00.000Z",
      updated_at: "2026-08-05T00:00:00.000Z",
    };
    const task = {
      sku: "SKU-2",
      product_id: "prod-2",
      barcode: "",
      from_warehouse_id: "wh-01",
      from_warehouse_name: "โกดัง1",
    };

    expect(getInStockSourceLocations(task, [noBreakdown as Product])).toBeNull();
    expect(getInStockSourceLocations(task, undefined)).toBeNull();
  });

  it("does not send duplicate progress for the same step", async () => {
    (globalThis as any).localStorage.setItem(
      "stockify_transfer_notifications",
      JSON.stringify([
        {
          id: "doc-progress-1",
          product_id: "prod-1",
          product_name: "สินค้า A",
          sku: "SKU-1",
          from_warehouse_id: "wh-01",
          from_warehouse_name: "โกดัง1",
          to_warehouse_id: "wh-02",
          to_warehouse_name: "โกดัง2",
          qty: 1,
          moved_by: "พนักงาน",
          created_at: "2026-10-10T00:00:00.000Z",
          status: "PENDING",
        },
      ])
    );
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));

    updateTransferTaskProgress("doc-progress-1", 3);
    updateTransferTaskProgress("doc-progress-1", 3);
    await whenTransferProgressSettled("doc-progress-1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      step: 3,
      step_text: "กำลังนำเข้าตำแหน่งปลายทาง",
    });
    fetchMock.mockRestore();
  });

  it("retries an unchanged progress step after a failed sync", async () => {
    (globalThis as any).localStorage.setItem(
      "stockify_transfer_notifications",
      JSON.stringify([
        {
          id: "doc-progress-retry",
          product_id: "prod-1",
          product_name: "สินค้า A",
          sku: "SKU-1",
          from_warehouse_id: "wh-01",
          from_warehouse_name: "โกดัง1",
          to_warehouse_id: "wh-02",
          to_warehouse_name: "โกดัง2",
          qty: 1,
          moved_by: "พนักงาน",
          created_at: "2026-10-10T00:00:00.000Z",
          status: "PENDING",
        },
      ])
    );
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));

    updateTransferTaskProgress("doc-progress-retry", 3);
    await whenTransferProgressSettled("doc-progress-retry");
    updateTransferTaskProgress("doc-progress-retry", 3);
    await whenTransferProgressSettled("doc-progress-retry");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockRestore();
  });
});

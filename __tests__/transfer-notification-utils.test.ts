import {
  getPendingTransferNotifications,
  syncServerTransferNotifications,
  parseTransferMetadata,
  getInStockSourceLocations,
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
});

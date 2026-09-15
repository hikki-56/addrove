import {
  isLogisticUnitId,
  parseLogisticUnitId,
  generateLogisticUnitId,
  logisticUnitBarcodeValue,
} from "@/lib/services/outbound/logistic-unit-id";
import type { IDocumentRepository } from "@/lib/repositories/interfaces";

describe("logistic-unit-id — รหัสกล่อง (abstraction รองรับ SSCC วันหน้า)", () => {
  it("รับรูปแบบภายใน BX-YYYYMMDD-NNNNNN", () => {
    const unit = parseLogisticUnitId("bx-20260914-000123");
    expect(unit).toEqual({ id: "BX-20260914-000123", format: "INTERNAL_BX" });
    expect(isLogisticUnitId("BX-20260914-000123")).toBe(true);
  });

  it("รับ SSCC 18 หลัก (ขึ้นต้น 0-4 ตาม GS1) ล่วงหน้า", () => {
    expect(parseLogisticUnitId("188549110000000001")?.format).toBe("SSCC");
    expect(isLogisticUnitId("008549110000000001")).toBe(true);
    // SSCC นอก extension digit 0-4 ไม่รับ
    expect(isLogisticUnitId("985491100000000001")).toBe(false);
  });

  it("ปฏิเสธรูปแบบอื่น", () => {
    expect(isLogisticUnitId("BOX-01")).toBe(false);
    expect(isLogisticUnitId("BIL-20260914-000001")).toBe(false);
    expect(isLogisticUnitId("")).toBe(false);
    expect(isLogisticUnitId("BX-26-123")).toBe(false);
  });

  it("generateLogisticUnitId ขอเลขจาก Documents repo (กลไกเดิมกันซ้ำ)", async () => {
    const calls: string[] = [];
    const documents = {
      generateDocumentNo: async (type: string) => {
        calls.push(type);
        return "BX-20260914-000001";
      },
    } as unknown as Pick<IDocumentRepository, "generateDocumentNo">;
    const unit = await generateLogisticUnitId(documents);
    expect(unit).toEqual({ id: "BX-20260914-000001", format: "INTERNAL_BX" });
    expect(calls).toEqual(["OUTBOUND_BOX"]);
    expect(logisticUnitBarcodeValue(unit)).toBe("BX-20260914-000001");
  });
});

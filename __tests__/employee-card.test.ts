import {
  employeeCardCode,
  parseEmployeeCardCode,
  EMPLOYEE_CARD_PREFIX,
} from "@/lib/employee-card";

describe("employee-card — บัตรบาร์โค้ดประจำตัวพนักงาน", () => {
  it("สร้างรหัสบัตรจาก user_id (ตัวพิมพ์ใหญ่)", () => {
    expect(employeeCardCode("usr-07")).toBe("EMP-USR-07");
    expect(employeeCardCode("USR-07")).toBe("EMP-USR-07");
    expect(employeeCardCode("  usr-07  ")).toBe("EMP-USR-07");
    expect(EMPLOYEE_CARD_PREFIX).toBe("EMP-");
  });

  it("parse รับทั้งแบบมี prefix และ user_id ตรงๆ", () => {
    expect(parseEmployeeCardCode("EMP-USR-07")).toBe("USR-07");
    expect(parseEmployeeCardCode("emp-usr-07")).toBe("USR-07");
    expect(parseEmployeeCardCode("usr-07")).toBe("USR-07");
    expect(parseEmployeeCardCode("  EMP-USR-07  ")).toBe("USR-07");
  });

  it("parse ปฏิเสธค่าที่ไม่ใช่บัตร (กันเอา QR token / เลขอื่นมาใช้)", () => {
    expect(parseEmployeeCardCode("")).toBeNull();
    // QR token ของระบบ (base64url.hmac ยาวเกิน / มีจุด) ต้องถูกปฏิเสธ
    expect(parseEmployeeCardCode("eyJlbXBsb3llZV9pZCI6InVzci0wNyJ9.aGVsbG8")).toBeNull();
    expect(parseEmployeeCardCode("BX-20260914-000001")).toBeNull(); // บาร์โค้ดกล่อง
    expect(parseEmployeeCardCode("TRF-20260914-000001")).toBeNull();
    expect(parseEmployeeCardCode("ab")).toBeNull(); // สั้นเกิน
    expect(parseEmployeeCardCode("รหัสพนักงาน")).toBeNull(); // ตัวอักษรอื่น
    expect(parseEmployeeCardCode("EMP-")).toBeNull();
  });
});

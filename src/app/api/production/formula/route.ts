import { NextRequest, NextResponse } from "next/server";
import { bomRepository } from "@/lib/repositories/sheets/bom.repository";
import { getAuthSession } from "@/lib/auth-session";
import { unauthorizedResponse, forbiddenResponse } from "@/lib/api-response";

// GET /api/production/formula — รายการสูตร BOM ทั้งหมด (สำหรับหน้าแก้ไขสูตร)
export async function GET(req: NextRequest) {
  const session = await getAuthSession(req);
  if (!session) return unauthorizedResponse();
  if (session.user.role !== "ADMIN") {
    return forbiddenResponse("เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่แก้ไขสูตรการผลิตได้");
  }

  try {
    const formulas = await bomRepository.getAllFormulas();
    // ส่งเฉพาะหัวสูตร + จำนวนวัตถุดิบ (ไม่รวมรายการวัตถุดิบทั้งหมด)
    // เพื่อให้หน้า list โหลดเร็ว — ดึงวัตถุดิบภายหลังเมื่อกดแก้ไขสูตร (GET /api/production/formula/[bomId])
    return NextResponse.json({
      success: true,
      data: formulas.map((f) => ({
        bom_id: f.bom_id,
        fg_sku: f.fg_sku,
        fg_barcode: f.fg_barcode,
        fg_name: f.fg_name,
        fg_unit: f.fg_unit,
        base_qty: f.base_qty,
        updated_at: f.updated_at,
        item_count: f.items.length,
        primary_count: f.items.filter((i) => i.is_primary === 1).length,
      })),
    });
  } catch (error) {
    console.error("[GET /api/production/formula] Error:", error);
    return NextResponse.json(
      { success: false, message: "เกิดข้อผิดพลาดในการดึงข้อมูลสูตรการผลิต" },
      { status: 500 }
    );
  }
}

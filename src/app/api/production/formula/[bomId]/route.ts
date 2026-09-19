import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { bomRepository } from "@/lib/repositories/sheets/bom.repository";
import { getAuthSession } from "@/lib/auth-session";
import { unauthorizedResponse, forbiddenResponse, notFoundResponse, zodErrorResponse } from "@/lib/api-response";

const bomItemSchema = z.object({
  rm_sku: z.string().trim().min(1, "กรุณาระบุรหัสวัตถุดิบ"),
  rm_barcode: z.string().trim().optional().default(""),
  rm_name: z.string().trim().optional().default(""),
  rm_wh: z.string().trim().optional().default("โกดัง2"),
  is_primary: z.union([z.literal(0), z.literal(1)]).optional().default(0),
  rm_qty_required: z.coerce.number().positive("จำนวนที่ใช้ต่อชุดต้องมากกว่า 0"),
  rm_unit: z.string().trim().optional().default("ชิ้น"),
  waste_percentage: z.coerce.number().min(0).max(100).optional().default(0),
  note: z.string().trim().optional().default(""),
});

const updateFormulaSchema = z.object({
  items: z.array(bomItemSchema).min(1, "สูตรต้องมีวัตถุดิบอย่างน้อย 1 รายการ"),
});

// GET /api/production/formula/[bomId] — ดึงสูตรเดี่ยวพร้อมรายการวัตถุดิบ (โหลดตอนกดแก้ไขสูตร)
export async function GET(req: NextRequest, { params }: { params: Promise<{ bomId: string }> }) {
  const session = await getAuthSession(req);
  if (!session) return unauthorizedResponse();
  if (session.user.role !== "ADMIN") {
    return forbiddenResponse("เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่เข้าถึงสูตรการผลิตได้");
  }

  try {
    const { bomId } = await params;
    const all = await bomRepository.getAllFormulas();
    const formula = all.find((f) => f.bom_id === bomId);
    if (!formula) {
      return notFoundResponse(`ไม่พบสูตรการผลิต (BOM) รหัส ${bomId}`);
    }
    return NextResponse.json({ success: true, data: formula });
  } catch (error) {
    console.error("[GET /api/production/formula/[bomId]] Error:", error);
    return NextResponse.json(
      { success: false, message: "เกิดข้อผิดพลาดในการดึงข้อมูลสูตรการผลิต" },
      { status: 500 }
    );
  }
}

// PUT /api/production/formula/[bomId] — บันทึกการแก้ไขวัตถุดิบในสูตร BOM
export async function PUT(req: NextRequest, { params }: { params: Promise<{ bomId: string }> }) {
  const session = await getAuthSession(req);
  if (!session) return unauthorizedResponse();
  if (session.user.role !== "ADMIN") {
    return forbiddenResponse("เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่แก้ไขสูตรการผลิตได้");
  }

  try {
    const { bomId } = await params;

    // ตรวจว่ามีสูตรนี้อยู่จริง
    const all = await bomRepository.getAllFormulas();
    const formula = all.find((f) => f.bom_id === bomId);
    if (!formula) {
      return notFoundResponse(`ไม่พบสูตรการผลิต (BOM) รหัส ${bomId}`);
    }

    const body = await req.json().catch(() => null);
    const parsed = updateFormulaSchema.safeParse(body);
    if (!parsed.success) {
      return zodErrorResponse(parsed.error);
    }

    // ต้องมีตัวหลักอย่างน้อย 1 รายการ ถ้าสูตรเดิมมีการระบุตัวหลักไว้
    const hadPrimary = formula.items.some((it) => it.is_primary === 1);
    if (hadPrimary && !parsed.data.items.some((it) => it.is_primary === 1)) {
      return NextResponse.json(
        { success: false, message: "สูตรนี้ระบุตัวหลักไว้ ต้องเลือกวัตถุดิบตัวหลักอย่างน้อย 1 รายการ" },
        { status: 400 }
      );
    }

    const items = parsed.data.items.map((it) => ({
      rm_sku: it.rm_sku,
      rm_barcode: it.rm_barcode,
      rm_name: it.rm_name || it.rm_sku,
      rm_wh: it.rm_wh,
      is_primary: it.is_primary,
      rm_qty_required: it.rm_qty_required,
      rm_unit: it.rm_unit,
      waste_percentage: it.waste_percentage,
      note: it.note,
    }));

    await bomRepository.updateFormulaItems(bomId, items);

    return NextResponse.json({
      success: true,
      message: `บันทึกสูตรผลิต ${formula.fg_sku} เรียบร้อยแล้ว`,
      data: { bom_id: bomId, fg_sku: formula.fg_sku, items },
    });
  } catch (error) {
    console.error("[PUT /api/production/formula/[bomId]] Error:", error);
    return NextResponse.json(
      { success: false, message: "เกิดข้อผิดพลาดในการบันทึกสูตรการผลิต" },
      { status: 500 }
    );
  }
}

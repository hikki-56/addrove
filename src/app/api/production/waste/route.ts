import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { createActorFromSession } from "@/lib/security";
import { readSheet, SHEETS } from "@/lib/google-sheets/client";
import type { WasteRecord } from "@/types/production";

export async function GET(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    const actor = await createActorFromSession(req, session);
    if (!actor) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    const rows = await readSheet(SHEETS.WASTE_ITEMS, "A2:J").catch(() => [] as string[][]);

    const records: WasteRecord[] = [];
    for (const r of rows) {
      if (!r || !r[0] || !r[4]) continue;
      records.push({
        waste_id: String(r[0]),
        order_no: String(r[1] || ""),
        round_no: Number(r[2]) || 0,
        document_date: String(r[3] || "").slice(0, 10),
        fg_sku: String(r[4]),
        fg_name: String(r[5] || ""),
        qty: Number(r[6]) || 0,
        note: String(r[7] || ""),
        recorded_by_name: String(r[8] || ""),
        created_at: String(r[9] || ""),
      });
    }

    // ใหม่สุดก่อน
    records.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());

    return NextResponse.json({
      success: true,
      data: records,
      total: records.length,
    });
  } catch (error) {
    console.error("[GET /api/production/waste] Error:", error);
    return NextResponse.json(
      { success: false, message: "เกิดข้อผิดพลาดในการดึงรายการของเสีย" },
      { status: 500 }
    );
  }
}

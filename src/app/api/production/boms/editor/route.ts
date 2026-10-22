import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthSession } from "@/server/auth-session";
import { getRepository } from "@/server/repositories";
import { canEditBom, validateBomDraft } from "@/lib/bom-editor";
import { forbiddenResponse, unauthorizedResponse, errorResponse } from "@/server/api-response";
import { withStorageRequest } from "@/server/storage-transaction";
import { parseBody, productionErrorResponse } from "@/server/production/production-route-helpers";
import { listBomFormulasForEditor, updateBomFormula } from "@/server/production/bom-editor.service";

const itemSchema = z.object({
  item_id: z.number().int().positive().optional(),
  sku: z.string().trim().min(1).max(100),
  name: z.string().optional(),
  qty: z.number().positive().finite(),
  unit: z.string().trim().min(1).max(50),
  waste_percentage: z.number().min(0).max(100),
  is_primary: z.union([z.literal(0), z.literal(1)]),
});
const updateSchema = z.object({
  bom_id: z.string().min(1),
  revision: z.string().min(1),
  unit: z.string().trim().min(1).max(50),
  base_qty: z.number().positive().finite(),
  items: z.array(itemSchema).min(1).max(200),
});

/** ตรวจจากบัญชีในฐานข้อมูล (ไม่เชื่อ email ใน token อย่างเดียว) — เหมือน /api/menu-settings */
async function guardBomEditor(req: NextRequest): Promise<NextResponse | null> {
  const session = await getAuthSession(req);
  if (!session?.user?.id) return unauthorizedResponse();
  const actor = await getRepository().users.findById(session.user.id);
  if (!actor?.active || !canEditBom(actor.email)) return forbiddenResponse("เมนูแก้ไขสูตร BOM ใช้ได้เฉพาะบัญชีผู้ดูแลที่กำหนด");
  return null;
}

export async function GET(req: NextRequest) {
  try {
    const denied = await guardBomEditor(req);
    if (denied) return denied;
    return NextResponse.json({ success: true, data: await listBomFormulasForEditor() });
  } catch (error) {
    return productionErrorResponse(error);
  }
}

async function handlePATCH(req: NextRequest) {
  try {
    const denied = await guardBomEditor(req);
    if (denied) return denied;
    const body = await parseBody(req, updateSchema);
    if (!body.ok) return body.response;
    const issues = validateBomDraft(body.data);
    if (issues.length) return errorResponse(issues.join(" · "));
    await updateBomFormula(body.data);
    return NextResponse.json({ success: true, message: "บันทึกสูตรแล้ว" });
  } catch (error) {
    return productionErrorResponse(error);
  }
}

export const PATCH = withStorageRequest(handlePATCH);

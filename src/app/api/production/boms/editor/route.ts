import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/server/auth-session";
import { getRepository } from "@/server/repositories";
import { canAccessBomEditor, validateBomDraft } from "@/lib/bom-editor";
import { parseMenuHrefs } from "@/lib/menu-visibility";
import { forbiddenResponse, unauthorizedResponse, errorResponse } from "@/server/api-response";
import { withStorageRequest } from "@/server/storage-transaction";
import { parseBody, productionErrorResponse } from "@/server/production/production-route-helpers";
import { listBomFormulasForEditor, updateBomFormula } from "@/server/production/bom-editor.service";
import { bomEditorUpdateSchema } from "@/server/production/bom-editor-schemas";

/** ตรวจจากบัญชีในฐานข้อมูล (ไม่เชื่อ email ใน token อย่างเดียว) — เหมือน /api/menu-settings */
async function guardBomEditor(req: NextRequest): Promise<NextResponse | null> {
  const session = await getAuthSession(req);
  if (!session?.user?.id) return unauthorizedResponse();
  const actor = await getRepository().users.findById(session.user.id);
  if (!actor?.active || !canAccessBomEditor(actor.email, parseMenuHrefs(actor.menu_hrefs))) {
    return forbiddenResponse("เมนูแก้ไขสูตร BOM ใช้ได้เฉพาะบัญชีที่กำหนด หรือที่ได้รับเมนูนี้ในตั้งค่าเมนูผู้ใช้");
  }
  return null;
}

export async function GET(req: NextRequest) {
  try {
    const denied = await guardBomEditor(req);
    if (denied) return denied;
    const [formulas, products] = await Promise.all([
      listBomFormulasForEditor(),
      getRepository().products.findAll({ activeOnly: true }),
    ]);
    return NextResponse.json({
      success: true,
      data: formulas,
      products: products.map(({ sku, product_name, barcode, base_unit }) => ({ sku, product_name, barcode, base_unit })),
    });
  } catch (error) {
    return productionErrorResponse(error);
  }
}

async function handlePATCH(req: NextRequest) {
  try {
    const denied = await guardBomEditor(req);
    if (denied) return denied;
    const body = await parseBody(req, bomEditorUpdateSchema);
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

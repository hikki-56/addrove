import { NextRequest } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { createActorFromSession } from "@/lib/security";
import { getRepository } from "@/lib/repositories";
import {
  successResponse,
  unauthorizedResponse,
  forbiddenResponse,
  serverErrorResponse,
  notFoundResponse,
} from "@/lib/api-response";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getAuthSession(req);
    const actor = await createActorFromSession(req, session);
    if (!actor) return unauthorizedResponse();

    // Read-only users must not update task progress
    if (actor.role === "VIEWER") {
      return forbiddenResponse("ผู้ใช้งานแบบดูอย่างเดียวไม่สามารถอัปเดตขั้นตอนงานได้");
    }

    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const step = typeof body.step === "number" ? body.step : parseInt(body.step) || 1;
    const stepText = typeof body.step_text === "string" ? body.step_text : "";

    const repo = getRepository();
    // อ่านแบบสด (ไม่ผ่านแคช 30 วิ) — เดี๋ยวเอา note ไป merge แล้วเขียนกลับชีต
    // ถ้าอ่านข้อมูลเก่า จะเขียนทับ metadata ที่ request อื่นเพิ่งเขียนทิ้ง
    const doc =
      (await repo.documents.findById(id, { forceFresh: true })) ||
      (await repo.documents.findByNo(id, { forceFresh: true }));
    if (!doc) {
      return notFoundResponse("ไม่พบใบย้ายสินค้า");
    }

    let meta: Record<string, any> = {};
    if (doc.note && typeof doc.note === "string" && doc.note.startsWith("{")) {
      try {
        meta = JSON.parse(doc.note);
      } catch {}
    } else if (doc.note && doc.note.trim()) {
      // Legacy plain-text note: keep the original content instead of overwriting it with an empty object
      meta.original_note = doc.note;
    }

    meta.current_step = step;
    if (stepText) meta.current_step_text = stepText;
    meta.last_active_at = new Date().toISOString();
    meta.last_active_user_id = actor.id;

    const updatedNote = JSON.stringify(meta);
    await repo.documents.updateNote(doc.document_id, updatedNote);

    return successResponse({ id: doc.document_id, step, stepText }, "อัปเดตขั้นตอนสำเร็จ");
  } catch (e) {
    return serverErrorResponse(e);
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return PATCH(req, context);
}

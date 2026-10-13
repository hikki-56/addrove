import { withStorageRequest } from "@/server/storage-transaction";
import { NextRequest } from "next/server";
import { getAuthSession } from "@/server/auth-session";
import { createActorFromSession } from "@/server/security";
import { getRepository } from "@/server/repositories";
import {
  successResponse,
  unauthorizedResponse,
  forbiddenResponse,
  serverErrorResponse,
  notFoundResponse,
} from "@/server/api-response";
import { finishStockWorkflowTiming } from "@/server/stock-workflow-timing";
import type { Document } from "@/types/models";

function buildProgressUpdate(
  document: Readonly<Document>,
  step: number,
  stepText: string,
  actorId: string
): Partial<Document> | null {
  if (document.status !== "PENDING") return null;

  let meta: Record<string, unknown> = {};
  if (document.note && document.note.startsWith("{")) {
    try {
      meta = JSON.parse(document.note) as Record<string, unknown>;
    } catch {}
  } else if (document.note?.trim()) {
    meta.original_note = document.note;
  }

  const currentStep = Number(meta.current_step) || 0;
  if (currentStep > step) return null;

  const resolvedStepText =
    stepText ||
    (step === 1
      ? "กำลังสแกนบาร์โค้ดสินค้า"
      : step === 2
        ? "กำลังหยิบสินค้าต้นทาง"
        : step === 3
          ? "กำลังนำเข้าตำแหน่งปลายทาง"
          : "รอดำเนินการ");
  if (currentStep === step && meta.current_step_text === resolvedStepText) return null;

  meta.current_step = step;
  meta.current_step_text = resolvedStepText;
  meta.last_active_at = new Date().toISOString();
  meta.last_active_user_id = actorId;

  return { note: JSON.stringify(meta) };
}

async function handlePATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startedAt = performance.now();
  const finish = (response: Response) =>
    finishStockWorkflowTiming(response, startedAt, {
      operation: "stock-transfer-progress",
      itemCount: 1,
    });

  try {
    const session = await getAuthSession(req);
    const actor = await createActorFromSession(req, session);
    if (!actor) return finish(unauthorizedResponse());

    // Read-only users must not update task progress
    if (actor.role === "VIEWER") {
      return finish(forbiddenResponse("ผู้ใช้งานแบบดูอย่างเดียวไม่สามารถอัปเดตขั้นตอนงานได้"));
    }

    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const step = typeof body.step === "number" ? body.step : parseInt(body.step) || 1;
    const stepText = typeof body.step_text === "string" ? body.step_text : "";

    const repo = getRepository();
    let persisted = false;
    const mutateProgress = (document: Readonly<Document>) => {
      const updates = buildProgressUpdate(document, step, stepText, actor.id);
      persisted = Boolean(updates);
      return updates;
    };

    // Submission no longer waits for progress: a whole-row fallback would reintroduce the race.
    if (!repo.documents.mutateTransferProgress) {
      throw new Error("Configured repository does not support isolated transfer progress");
    }
    const doc = await repo.documents.mutateTransferProgress(id, mutateProgress);

    if (!doc) return finish(notFoundResponse("ไม่พบใบย้ายสินค้า"));

    return finish(
      successResponse(
        { id: doc.document_id, step, stepText, persisted },
        persisted ? "อัปเดตขั้นตอนสำเร็จ" : "ขั้นตอนเป็นข้อมูลล่าสุดอยู่แล้ว"
      )
    );
  } catch (e) {
    return finish(serverErrorResponse(e));
  }
}

async function handlePOST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return PATCH(req, context);
}

export const PATCH = withStorageRequest(handlePATCH);
export const POST = withStorageRequest(handlePOST);

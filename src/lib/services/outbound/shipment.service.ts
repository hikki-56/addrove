import type { Document } from "@/types/models";
import type { IStockRepository } from "@/lib/repositories/interfaces";
import type { Actor } from "@/lib/security/actor";
import {
  findDocumentByIdOrNo,
  listBillDocuments,
  listBoxDocuments,
  listShipmentDocuments,
  mutateBillNote,
  mutateBoxNote,
  mutateShipmentNote,
  parseBillNote,
  parseBoxNote,
  parseShipmentNote,
} from "./outbound-documents";
import {
  assertBillTransition,
  assertBoxTransition,
  assertShipmentTransition,
  billStatusToDocumentStatus,
} from "./outbound-state-machine";

/**
 * Shipment (รอบรถ) — "เลือกบิลก่อน แล้วค่อยสแกนกล่อง"
 *  1. สร้างรอบ: ทะเบียนรถ + เลือกบิล (PACKED / PARTIALLY_SHIPPED)
 *     → ระบบคำนวณ Expected = จำนวนกล่องรวมของบิลที่เลือก
 *  2. Loading: สแกน BX — กล่องที่ไม่อยู่ในรอบ = แดงทันที (scan verification จริง)
 *  3. ปิดรอบ: ครบ → SHIPPED ทั้งรอบ / ขาด → Manager ยืนยันทุกใบที่ขาด
 *     (ROLLOVER กลับคิวรอบถัดไป หรือ CANCELLED พร้อมเหตุผล) —
 *     ห้ามปิดรอบเงียบๆ แล้วถือว่าบิลส่งครบ
 */

export interface ShipmentSummary {
  document_id: string;
  document_no: string;
  shipment_status: import("@/types/models").ShipmentStatus;
  truck_plate: string;
  destination?: string;
  bill_count: number;
  expected_boxes: number;
  loaded_boxes: number;
  created_at: string;
  closed_at?: string;
}

export async function listShipments(repo: IStockRepository): Promise<ShipmentSummary[]> {
  const shipDocs = await listShipmentDocuments(repo);
  const summaries: ShipmentSummary[] = [];
  for (const doc of shipDocs) {
    const note = parseShipmentNote(doc);
    if (!note) continue;
    summaries.push({
      document_id: doc.document_id,
      document_no: doc.document_no,
      shipment_status: note.shipment_status,
      truck_plate: note.truck_plate,
      destination: note.destination,
      bill_count: note.bill_document_ids.length,
      expected_boxes: note.expected_box_ids.length,
      loaded_boxes: note.loaded_box_ids.length,
      created_at: doc.created_at,
      closed_at: note.closed_at,
    });
  }
  summaries.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return summaries;
}

export async function getShipmentDetail(repo: IStockRepository, idOrNo: string) {
  const doc = await findDocumentByIdOrNo(repo, idOrNo);
  if (!doc || doc.document_type !== "SHIPMENT") return null;
  const note = parseShipmentNote(doc);
  if (!note) return null;

  const boxDocs = await listBoxDocuments(repo);
  const boxesOfRound = boxDocs
    .map((b) => ({ doc: b, note: parseBoxNote(b) }))
    .filter(
      (b): b is { doc: Document; note: NonNullable<ReturnType<typeof parseBoxNote>> } =>
        b.note !== null && note.expected_box_ids.includes(b.doc.document_id)
    )
    .map(({ doc: bDoc, note: bNote }) => ({
      box_id: bDoc.document_id,
      box_code: bDoc.document_no,
      box_no: bNote.box_no,
      box_status: bNote.box_status,
      bill_document_no: bNote.bill_document_no,
      total_qty: bNote.items.reduce((s, it) => s + it.qty, 0),
      loaded_at: bNote.loaded_at,
    }))
    .sort((a, b) => (a.bill_document_no === b.bill_document_no ? a.box_no - b.box_no : a.bill_document_no.localeCompare(b.bill_document_no)));

  const billDocs = await listBillDocuments(repo);
  const billsOfRound = note.bill_document_ids.map((id) => {
    const bDoc = billDocs.find((d) => d.document_id === id);
    const bNote = bDoc ? parseBillNote(bDoc) : null;
    return {
      bill_document_no: bDoc?.document_no ?? id,
      express_bill_no: bNote?.express_bill_no ?? "",
      customer: bNote?.customer,
      outbound_status: bNote?.outbound_status ?? "?",
    };
  });

  return {
    doc,
    note,
    bills: billsOfRound,
    boxes: boxesOfRound,
    missing: boxesOfRound.filter((b) => b.box_status !== "LOADED" && b.box_status !== "SHIPPED"),
  };
}

// ---------- สร้างรอบ ----------

export interface CreateShipmentInput {
  truck_plate: string;
  destination?: string;
  bill_ids: string[]; // document_id หรือ document_no ของบิล
}

export async function createShipment(
  repo: IStockRepository,
  input: CreateShipmentInput,
  actor: Actor
): Promise<{ document_no: string; expected_boxes: number; bill_count: number }> {
  if (!input.truck_plate.trim()) throw new Error("กรุณากรอกทะเบียนรถ");

  const billDocs = await listBillDocuments(repo);
  const resolvedBills: Array<{ doc: Document; note: NonNullable<ReturnType<typeof parseBillNote>> }> = [];

  for (const billId of input.bill_ids) {
    const key = String(billId).trim();
    const doc = billDocs.find(
      (d) => d.document_id === key || d.document_no.toUpperCase() === key.toUpperCase()
    );
    if (!doc) throw new Error(`ไม่พบบิล "${billId}"`);
    const note = parseBillNote(doc);
    if (!note) throw new Error(`ข้อมูลบิล ${doc.document_no} ไม่ถูกต้อง`);
    if (note.outbound_status !== "PACKED" && note.outbound_status !== "PARTIALLY_SHIPPED") {
      throw new Error(
        `เลือกได้เฉพาะบิลที่แพ็กแล้ว/ส่งบางส่วน — ${doc.document_no} อยู่สถานะ ${note.outbound_status}`
      );
    }
    resolvedBills.push({ doc, note });
  }

  // รวบรวมกล่องที่จะขึ้นรอบนี้: PACKED → กล่อง CLOSED, PARTIALLY_SHIPPED → กล่อง ROLLOVER
  const boxDocs = await listBoxDocuments(repo);
  const expected: Array<{ doc: Document; note: NonNullable<ReturnType<typeof parseBoxNote>> }> = [];
  for (const { doc: billDoc } of resolvedBills) {
    const eligible = boxDocs
      .map((b) => ({ doc: b, note: parseBoxNote(b) }))
      .filter(
        (b): b is { doc: Document; note: NonNullable<ReturnType<typeof parseBoxNote>> } =>
          b.note !== null && b.note.bill_document_id === billDoc.document_id
      )
      .filter(({ note: bNote }) => bNote.box_status === "CLOSED" || bNote.box_status === "ROLLOVER");
    if (eligible.length === 0) {
      throw new Error(`บิล ${billDoc.document_no} ไม่มีกล่องที่พร้อมขึ้นรถ (ต้องแพ็กให้ครบและปิดกล่องก่อน)`);
    }
    expected.push(...eligible);
  }

  const nowIso = new Date().toISOString();
  const shipmentDoc = await repo.documents.create({
    document_type: "SHIPMENT",
    reference_no: input.truck_plate.trim(),
    document_date: nowIso.slice(0, 10),
    status: "PROCESSING",
    note: JSON.stringify({
      kind: "shipment",
      shipment_status: "OPEN",
      truck_plate: input.truck_plate.trim(),
      destination: input.destination?.trim() || undefined,
      bill_document_ids: resolvedBills.map((b) => b.doc.document_id),
      expected_box_ids: expected.map((b) => b.doc.document_id),
      loaded_box_ids: [],
      created_by: actor.id,
      created_by_name: actor.username,
      created_at: nowIso,
      skip_confirmations: [],
    }),
    created_by: actor.id,
    created_by_name: actor.username,
  });

  // บิล → ASSIGNED_TO_SHIPMENT, กล่องผูกรอบ
  await Promise.all(
    resolvedBills.map(({ doc: billDoc }) =>
      mutateBillNote(repo, billDoc.document_id, (n) => {
        assertBillTransition(n.outbound_status, "ASSIGNED_TO_SHIPMENT");
        n.outbound_status = "ASSIGNED_TO_SHIPMENT";
      }, { alsoStatus: billStatusToDocumentStatus("ASSIGNED_TO_SHIPMENT") })
    )
  );
  await Promise.all(
    expected.map(({ doc: boxDoc }) =>
      mutateBoxNote(repo, boxDoc.document_id, (n) => {
        n.shipment_id = shipmentDoc.document_id;
        n.shipment_no = shipmentDoc.document_no;
      })
    )
  );

  return {
    document_no: shipmentDoc.document_no,
    expected_boxes: expected.length,
    bill_count: resolvedBills.length,
  };
}

// ---------- สแกนกล่องขึ้นรถ ----------

export async function scanBoxIntoShipment(
  repo: IStockRepository,
  shipmentIdOrNo: string,
  boxCode: string,
  actor: Actor
): Promise<{ box_code: string; loaded: number; expected: number; already_loaded?: boolean }> {
  const shipDoc = await findDocumentByIdOrNo(repo, shipmentIdOrNo);
  if (!shipDoc || shipDoc.document_type !== "SHIPMENT") throw new Error("ไม่พบรอบรถนี้");
  const shipNote = parseShipmentNote(shipDoc);
  if (!shipNote) throw new Error("ข้อมูลรอบรถไม่ถูกต้อง");
  if (shipNote.shipment_status !== "OPEN" && shipNote.shipment_status !== "LOADING") {
    throw new Error(`รอบรถนี้${shipNote.shipment_status === "CLOSED" ? "ปิดไปแล้ว" : "ถูกยกเลิก"} — สแกนเพิ่มไม่ได้`);
  }

  const key = String(boxCode).trim().toUpperCase();
  const boxDoc =
    (await repo.documents.findByNo(key, { forceFresh: true })) ??
    (await repo.documents.findById(key, { forceFresh: true }));
  if (!boxDoc || boxDoc.document_type !== "OUTBOUND_BOX") {
    throw new Error(`ไม่พบกล่อง "${boxCode}" — สแกนบาร์โค้ดกล่อง (BX-...)`);
  }

  // scan verification: กล่องต้องอยู่ใน expected ของรอบนี้เท่านั้น
  if (!shipNote.expected_box_ids.includes(boxDoc.document_id)) {
    const belongsTo = parseBoxNote(boxDoc)?.shipment_no;
    throw new Error(
      `กล่องไม่อยู่ในรอบนี้ (${boxDoc.document_no}${belongsTo && belongsTo !== shipDoc.document_no ? ` อยู่ในรอบ ${belongsTo}` : ""})`
    );
  }

  const boxNote = parseBoxNote(boxDoc);
  if (!boxNote) throw new Error("ข้อมูลกล่องไม่ถูกต้อง");

  if (boxNote.box_status === "LOADED" && boxNote.shipment_id === shipDoc.document_id) {
    // idempotent replay (offline queue ส่งซ้ำ) — ตอบสำเร็จโดยไม่นับซ้ำ
    return {
      box_code: boxDoc.document_no,
      loaded: shipNote.loaded_box_ids.length,
      expected: shipNote.expected_box_ids.length,
      already_loaded: true,
    };
  }

  await mutateBoxNote(repo, boxDoc.document_id, (n) => {
    assertBoxTransition(n.box_status, "LOADED");
    n.box_status = "LOADED";
    n.shipment_id = shipDoc.document_id;
    n.shipment_no = shipDoc.document_no;
    n.loaded_at = new Date().toISOString();
    n.loaded_by = actor.username;
  });

  const shipResult = await mutateShipmentNote(repo, shipDoc.document_id, (n) => {
    if (!n.loaded_box_ids.includes(boxDoc.document_id)) {
      n.loaded_box_ids.push(boxDoc.document_id);
    }
    if (n.shipment_status === "OPEN") {
      assertShipmentTransition(n.shipment_status, "LOADING");
      n.shipment_status = "LOADING";
    }
  });

  // บิลของกล่องนี้ → LOADING (ครั้งแรกที่มีกล่องขึ้นรถ)
  await mutateBillNote(repo, boxNote.bill_document_id, (n) => {
    if (n.outbound_status === "ASSIGNED_TO_SHIPMENT") {
      assertBillTransition(n.outbound_status, "LOADING");
      n.outbound_status = "LOADING";
    }
  }).catch(() => {});

  return {
    box_code: boxDoc.document_no,
    loaded: shipResult?.note.loaded_box_ids.length ?? 0,
    expected: shipResult?.note.expected_box_ids.length ?? 0,
  };
}

export async function unloadBox(
  repo: IStockRepository,
  shipmentIdOrNo: string,
  boxCode: string,
  actor: Actor
): Promise<void> {
  const shipDoc = await findDocumentByIdOrNo(repo, shipmentIdOrNo);
  if (!shipDoc || shipDoc.document_type !== "SHIPMENT") throw new Error("ไม่พบรอบรถนี้");
  const shipNote = parseShipmentNote(shipDoc);
  if (!shipNote) throw new Error("ข้อมูลรอบรถไม่ถูกต้อง");
  if (shipNote.shipment_status !== "LOADING") throw new Error("รอบนี้ไม่ได้อยู่ในสถานะกำลังขึ้นรถ");

  const key = String(boxCode).trim().toUpperCase();
  const boxDoc =
    (await repo.documents.findByNo(key, { forceFresh: true })) ??
    (await repo.documents.findById(key, { forceFresh: true }));
  if (!boxDoc || boxDoc.document_type !== "OUTBOUND_BOX") throw new Error(`ไม่พบกล่อง "${boxCode}"`);
  if (!shipNote.loaded_box_ids.includes(boxDoc.document_id)) {
    throw new Error(`กล่อง ${boxDoc.document_no} ไม่ได้อยู่ในรายการที่ขึ้นรถแล้ว`);
  }

  await mutateBoxNote(repo, boxDoc.document_id, (n) => {
    assertBoxTransition(n.box_status, "CLOSED");
    n.box_status = "CLOSED";
    n.loaded_at = undefined;
    n.loaded_by = undefined;
  });
  await mutateShipmentNote(repo, shipDoc.document_id, (n) => {
    n.loaded_box_ids = n.loaded_box_ids.filter((id) => id !== boxDoc.document_id);
  });
  void actor;
}

// ---------- ปิดรอบ ----------

export interface CloseConfirmation {
  box_id: string;
  outcome: "ROLLOVER" | "CANCELLED";
  reason: string;
}

export async function closeShipment(
  repo: IStockRepository,
  shipmentIdOrNo: string,
  confirmations: CloseConfirmation[],
  actor: Actor
): Promise<{
  shipped_boxes: number;
  rollover_boxes: number;
  cancelled_boxes: number;
  bills: Array<{ bill_no: string; outcome: string }>;
}> {
  const shipDoc = await findDocumentByIdOrNo(repo, shipmentIdOrNo);
  if (!shipDoc || shipDoc.document_type !== "SHIPMENT") throw new Error("ไม่พบรอบรถนี้");
  const shipNote = parseShipmentNote(shipDoc);
  if (!shipNote) throw new Error("ข้อมูลรอบรถไม่ถูกต้อง");
  if (shipNote.shipment_status !== "LOADING" && shipNote.shipment_status !== "OPEN") {
    throw new Error(`รอบนี้${shipNote.shipment_status === "CLOSED" ? "ปิดไปแล้ว" : "ถูกยกเลิก"}`);
  }

  const boxDocs = await listBoxDocuments(repo);
  const boxesOfRound = shipNote.expected_box_ids
    .map((id) => boxDocs.find((b) => b.document_id === id))
    .filter((b): b is Document => Boolean(b));

  const loadedIds = new Set(shipNote.loaded_box_ids);
  const missingBoxes = boxesOfRound.filter((b) => !loadedIds.has(b.document_id));

  // ทุกกล่องที่ขาดต้องถูกยืนยันด้วยเหตุผล — ห้ามปิดรอบแบบเงียบ
  const confirmByBoxId = new Map(confirmations.map((c) => [c.box_id, c]));
  const missingIds = missingBoxes.map((b) => b.document_id);
  const unconfirmed = missingIds.filter((id) => !confirmByBoxId.has(id));
  if (unconfirmed.length > 0) {
    const names = unconfirmed
      .map((id) => boxesOfRound.find((b) => b.document_id === id)?.document_no ?? id)
      .join(", ");
    throw new Error(`ยังมีกล่องที่ไม่ได้ขึ้นรถและยังไม่ได้ยืนยัน: ${names} — ต้องเลือก "ไปรอบถัดไป" หรือ "ยกเลิกกล่อง" พร้อมเหตุผลทุกใบ`);
  }
  for (const c of confirmations) {
    if (!c.reason?.trim()) throw new Error("การยืนยันทุกกล่องต้องมีเหตุผล");
  }

  const nowIso = new Date().toISOString();
  const confirmRecords = confirmations.map((c) => {
    const boxDoc = boxesOfRound.find((b) => b.document_id === c.box_id);
    const bNote = boxDoc ? parseBoxNote(boxDoc) : null;
    return {
      box_id: c.box_id,
      box_no: boxDoc?.document_no ?? c.box_id,
      bill_no: bNote?.bill_document_no ?? "",
      action: c.outcome,
      reason: c.reason.trim(),
      confirmed_by: actor.id,
      confirmed_by_name: actor.username,
      confirmed_at: nowIso,
    };
  });

  // 1) กล่องที่ขึ้นรถแล้ว → SHIPPED
  for (const boxDoc of boxesOfRound) {
    if (!loadedIds.has(boxDoc.document_id)) continue;
    await mutateBoxNote(repo, boxDoc.document_id, (n) => {
      assertBoxTransition(n.box_status, "SHIPPED");
      n.box_status = "SHIPPED";
    });
  }

  // 2) กล่องที่ขาด → ตามที่ Manager ยืนยัน
  for (const c of confirmations) {
    await mutateBoxNote(repo, c.box_id, (n) => {
      assertBoxTransition(n.box_status, c.outcome === "ROLLOVER" ? "ROLLOVER" : "CANCELLED");
      n.box_status = c.outcome === "ROLLOVER" ? "ROLLOVER" : "CANCELLED";
      if (c.outcome === "ROLLOVER") {
        n.rollover_count = (n.rollover_count || 0) + 1;
      } else {
        n.cancel_reason = c.reason.trim();
        n.cancelled_by = actor.username;
        n.cancelled_at = nowIso;
      }
      // ROLLOVER ไม่ผูกรอบเดิม — รอถูกเลือกในรอบถัดไป
      if (c.outcome === "ROLLOVER") {
        n.shipment_id = undefined;
        n.shipment_no = undefined;
      }
    });
  }

  // 3) สรุปผลบิลทุกใบในรอบ
  const billDocs = await listBillDocuments(repo);
  const billOutcomes: Array<{ bill_no: string; outcome: string }> = [];
  for (const billId of shipNote.bill_document_ids) {
    const billDoc = billDocs.find((d) => d.document_id === billId);
    if (!billDoc) continue;
    const boxesOfBill = boxesOfRound.filter(
      (b) => parseBoxNote(b)?.bill_document_id === billId
    );
    const shipped = boxesOfBill.filter((b) => loadedIds.has(b.document_id)).length;
    const rollover = boxesOfBill.filter(
      (b) => confirmByBoxId.get(b.document_id)?.outcome === "ROLLOVER"
    ).length;
    const cancelled = boxesOfBill.filter(
      (b) => confirmByBoxId.get(b.document_id)?.outcome === "CANCELLED"
    ).length;

    let outcome: string;
    if (boxesOfBill.length > 0 && shipped === boxesOfBill.length) {
      outcome = "SHIPPED";
    } else if (rollover > 0) {
      outcome = "PARTIALLY_SHIPPED";
    } else if (shipped === 0 && cancelled === boxesOfBill.length) {
      // ทุกกล่องของบิลถูกยกเลิก — ของยังในโกดัง ต้องมีคนตัดสินต่อ
      outcome = "HOLD";
    } else {
      outcome = "PARTIALLY_SHIPPED";
    }

    await mutateBillNote(repo, billId, (n) => {
      assertBillTransition(n.outbound_status, outcome as never, n.held_from);
      n.outbound_status = outcome as never;
      if (outcome === "HOLD") {
        n.held_from = "PACKED";
        n.hold_reason = `ทุกกล่องของบิลถูกยกเลิกในรอบ ${shipDoc.document_no} — ต้องจัดการของ/แพ็กใหม่`;
      }
    }, { alsoStatus: billStatusToDocumentStatus(outcome as never) });
    billOutcomes.push({ bill_no: billDoc.document_no, outcome });
  }

  // 4) ปิดรอบ
  await mutateShipmentNote(repo, shipDoc.document_id, (n) => {
    assertShipmentTransition(n.shipment_status, "CLOSED");
    n.shipment_status = "CLOSED";
    n.closed_at = nowIso;
    n.closed_by = actor.id;
    n.closed_by_name = actor.username;
    n.skip_confirmations = [...n.skip_confirmations, ...confirmRecords];
  }, { alsoStatus: "COMPLETED" });

  return {
    shipped_boxes: loadedIds.size,
    rollover_boxes: confirmations.filter((c) => c.outcome === "ROLLOVER").length,
    cancelled_boxes: confirmations.filter((c) => c.outcome === "CANCELLED").length,
    bills: billOutcomes,
  };
}

// ---------- ยกเลิกรอบ (ก่อนออกรถ) ----------

export async function cancelShipment(
  repo: IStockRepository,
  shipmentIdOrNo: string,
  actor: Actor,
  reason?: string
): Promise<void> {
  const shipDoc = await findDocumentByIdOrNo(repo, shipmentIdOrNo);
  if (!shipDoc || shipDoc.document_type !== "SHIPMENT") throw new Error("ไม่พบรอบรถนี้");
  const shipNote = parseShipmentNote(shipDoc);
  if (!shipNote) throw new Error("ข้อมูลรอบรถไม่ถูกต้อง");
  if (shipNote.shipment_status !== "OPEN" && shipNote.shipment_status !== "LOADING") {
    throw new Error("ยกเลิกได้เฉพาะรอบที่ยังไม่ปิด");
  }

  // กล่องที่ขึ้นรถแล้ว → ถอดกลับ (LOADED → CLOSED)
  for (const boxId of shipNote.loaded_box_ids) {
    await mutateBoxNote(repo, boxId, (n) => {
      assertBoxTransition(n.box_status, "CLOSED");
      n.box_status = "CLOSED";
      n.loaded_at = undefined;
      n.loaded_by = undefined;
    }).catch(() => {});
  }

  // บิลทุกใบกลับไปพร้อมถูกเลือกใหม่
  // บิลที่มีกล่อง rollover ค้าง (เคย PARTIALLY_SHIPPED) กลับไป PARTIALLY_SHIPPED
  // บิลปกติกลับไป PACKED
  const billDocs = await listBillDocuments(repo);
  const boxDocs = await listBoxDocuments(repo);
  for (const billId of shipNote.bill_document_ids) {
    const billDoc = billDocs.find((d) => d.document_id === billId);
    if (!billDoc) continue;
    const hasRollover = boxDocs.some((b) => {
      const n = parseBoxNote(b);
      return n && n.bill_document_id === billId && n.box_status === "ROLLOVER";
    });
    const target = hasRollover ? "PARTIALLY_SHIPPED" : "PACKED";
    await mutateBillNote(repo, billId, (n) => {
      assertBillTransition(n.outbound_status, target, n.held_from);
      n.outbound_status = target;
    }, { alsoStatus: billStatusToDocumentStatus(target) }).catch(() => {});
  }

  await mutateShipmentNote(repo, shipDoc.document_id, (n) => {
    assertShipmentTransition(n.shipment_status, "CANCELLED");
    n.shipment_status = "CANCELLED";
    n.cancel_reason = reason || "";
  }, { alsoStatus: "CANCELLED" });
  void actor;
}

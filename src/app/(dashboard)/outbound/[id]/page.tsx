"use client";

import { SolarBoxClosed } from "@/components/icons";
import { useState, useEffect, useCallback, use } from "react";
import Link from "next/link";
import { outboundApi, type BillDetailData } from "@/client/outbound-client";
import { usePollingWhenVisible } from "@/hooks/use-visibility-polling";

const EXCEPTION_LABELS: Record<string, string> = {
  NOT_FOUND: "📭 หาไม่เจอ",
  INSUFFICIENT: "🔻 จำนวนไม่ครบ",
  DAMAGED: "💥 ของชำรุด",
  BAD_BARCODE: "▤ บาร์โค้ดเสีย",
  OTHER: "❓ อื่นๆ",
};

export default function OutboundBillDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<BillDetailData | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data: d } = await outboundApi.getBill(decodeURIComponent(id));
      setData(d);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "โหลดไม่สำเร็จ");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);
  usePollingWhenVisible(load, 15000);

  const run = useCallback(
    async (fn: () => Promise<string>, confirmText?: string) => {
      if (confirmText && !window.confirm(confirmText)) return;
      setBusy(true);
      setNotice("");
      try {
        const msg = await fn();
        setNotice(msg);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "ทำรายการไม่สำเร็จ");
        await load();
      } finally {
        setBusy(false);
      }
    },
    [load]
  );

  if (error && !data) {
    return (
      <div className="max-w-4xl mx-auto space-y-4">
        <Link href="/outbound" className="text-sm text-m3-grey-600 hover:text-m3-primary-dark">← กลับรายการบิล</Link>
        <div className="bg-[rgba(255,86,48,0.08)] border border-[rgba(255,86,48,0.24)] text-m3-error-dark rounded-xl px-4 py-3 text-sm">{error}</div>
      </div>
    );
  }
  if (!data) return <div className="max-w-4xl mx-auto p-8 text-center text-m3-grey-500">กำลังโหลด…</div>;

  const { doc, note, boxes, availability } = data;
  const status = note.outbound_status;
  const availBySku = new Map(availability.map((a) => [a.sku, a]));
  const pickedDone = note.items.every((it) => it.qty_picked >= it.qty_required);

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <Link href="/outbound" className="text-sm text-m3-grey-600 hover:text-m3-primary-dark">← กลับรายการบิล</Link>

      {error && <div className="bg-[rgba(255,86,48,0.08)] border border-[rgba(255,86,48,0.24)] text-m3-error-dark rounded-xl px-4 py-3 text-sm">{error}</div>}
      {notice && <div className="bg-[rgba(0,167,111,0.08)] border border-[rgba(0,167,111,0.24)] text-m3-primary-dark rounded-xl px-4 py-3 text-sm">{notice}</div>}

      {/* ส่วนหัวบิล */}
      <div className="bg-white rounded-xl border border-[rgba(145,158,171,0.2)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-m3-grey-800">บิล {note.express_bill_no}</h1>
            <p className="text-sm text-m3-grey-600">
              {doc.document_no}
              {note.customer ? ` · ${note.customer}` : ""} · คลัง {note.warehouse_id}
            </p>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold text-m3-primary-dark">{status}</div>
            <div className="text-xs text-m3-grey-500">
              {status === "HOLD" && note.hold_reason ? `เหตุผล: ${note.hold_reason}` : null}
              {status === "CANCELLED" && note.cancel_reason ? `เหตุผล: ${note.cancel_reason}` : null}
            </div>
          </div>
        </div>

        {/* ปุ่ม action ตามสถานะ */}
        <div className="mt-4 flex flex-wrap gap-2">
          {status === "IMPORTED" && (
            <button
              onClick={() => void run(async () => (await outboundApi.billAction(doc.document_no, { action: "activate" })).message, "เปิดงานหยิบบิลนี้?")}
              disabled={busy}
              className="px-4 py-2 rounded-xl bg-m3-primary text-white text-sm font-semibold disabled:opacity-40"
            >
              เปิดงานหยิบ
            </button>
          )}
          {status === "PICKED_WAITING_APPROVAL" && (
            <>
              <button
                onClick={() =>
                  void run(
                    async () => (await outboundApi.approveBill(doc.document_no, { outcome: "APPROVE" })).message,
                    "อนุมัติบิล — ยืนยันจำนวนที่หยิบและตัดสต็อกทันที?"
                  )
                }
                disabled={busy}
                className="px-4 py-2 rounded-xl bg-m3-primary text-white text-sm font-semibold disabled:opacity-40"
              >
                ✓ อนุมัติบิล (ตัดสต็อก)
              </button>
              <button
                onClick={() => {
                  const to = window.confirm("ตกลง = ส่งกลับไปหยิบใหม่\nยกเลิก = ยกเลิกบิล") ? "REPICK" : "CANCEL";
                  void run(async () => (await outboundApi.approveBill(doc.document_no, { outcome: "REJECT", reject_to: to })).message);
                }}
                disabled={busy}
                className="px-4 py-2 rounded-xl border border-[rgba(255,86,48,0.24)] text-m3-error-dark text-sm font-semibold disabled:opacity-40"
              >
                ไม่อนุมัติ
              </button>
            </>
          )}
          {(status === "SHORTAGE" || status === "HOLD") && (
            <>
              <button
                onClick={() =>
                  void run(
                    async () => (await outboundApi.billAction(doc.document_no, { action: "resolve-shortage", outcome: "CONTINUE" })).message,
                    "ให้คนงานหยิบต่อ (รายการที่แจ้งปัญหายังคงรอตัดสิน)?"
                  )
                }
                disabled={busy}
                className="px-4 py-2 rounded-xl bg-m3-primary text-white text-sm font-semibold disabled:opacity-40"
              >
                ▶ ให้หยิบต่อ
              </button>
              <button
                onClick={() =>
                  void run(
                    async () => (await outboundApi.billAction(doc.document_no, { action: "resolve-shortage", outcome: "REDUCE_QTY" })).message,
                    `ยอมรับของไม่ครบ: ลดจำนวนบิลให้เท่ากับที่หยิบได้จริง?\n${note.exceptions.filter((e) => !e.resolved_at).map((e) => `${e.sku}: แจ้ง ${EXCEPTION_LABELS[e.type]}${typeof e.reported_qty === "number" ? ` (ได้จริง ${e.reported_qty})` : ""}`).join("\n")}`
                  )
                }
                disabled={busy}
                className="px-4 py-2 rounded-xl bg-m3-warning text-white text-sm font-semibold disabled:opacity-40"
              >
                ▼ ลดจำนวนตามที่หยิบได้
              </button>
              <button
                onClick={() => void run(async () => (await outboundApi.billAction(doc.document_no, { action: "resolve-shortage", outcome: "CANCEL" })).message, "ยกเลิกบิลนี้และปล่อยการจองสต็อก?")}
                disabled={busy}
                className="px-4 py-2 rounded-xl border border-[rgba(255,86,48,0.24)] text-m3-error-dark text-sm font-semibold disabled:opacity-40"
              >
                ยกเลิกบิล
              </button>
            </>
          )}
          {status === "HOLD" && (
            <button
              onClick={() => void run(async () => (await outboundApi.billAction(doc.document_no, { action: "resume" })).message)}
              disabled={busy}
              className="px-4 py-2 rounded-xl border border-[rgba(145,158,171,0.2)] text-m3-grey-700 text-sm font-semibold disabled:opacity-40"
            >
              ↻ ทำต่อ
            </button>
          )}
          {!["SHIPPED", "CANCELLED", "HOLD"].includes(status) && status !== "PICKED_WAITING_APPROVAL" && (
            <button
              onClick={() => void run(async () => (await outboundApi.billAction(doc.document_no, { action: "hold" })).message)}
              disabled={busy}
              className="px-4 py-2 rounded-xl border border-[rgba(145,158,171,0.2)] text-m3-grey-700 text-sm font-semibold disabled:opacity-40"
            >
              ⏸ พักงาน
            </button>
          )}
          {["IMPORTED", "READY_TO_PICK", "PICKING", "SHORTAGE", "PICKED_WAITING_APPROVAL"].includes(status) && (
            <button
              onClick={() => void run(async () => (await outboundApi.billAction(doc.document_no, { action: "cancel" })).message, "ยกเลิกบิลนี้? การจองสต็อกจะถูกปล่อย")}
              disabled={busy}
              className="px-4 py-2 rounded-xl border border-[rgba(255,86,48,0.24)] text-m3-error-dark text-sm font-semibold disabled:opacity-40"
            >
              ยกเลิกบิล
            </button>
          )}
        </div>
      </div>

      {/* Exceptions */}
      {note.exceptions.length > 0 && (
        <div className="bg-[rgba(255,171,0,0.08)] rounded-xl border border-[rgba(255,171,0,0.24)] p-4">
          <h2 className="font-bold text-m3-warning-dark text-sm mb-2">ปัญหาที่คนงานแจ้ง ({note.exceptions.filter((e) => !e.resolved_at).length} รอตัดสิน)</h2>
          <ul className="space-y-1 text-sm">
            {note.exceptions.map((e, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <span className="tabular-nums font-semibold text-m3-warning-dark">{e.sku}</span>
                <span>{EXCEPTION_LABELS[e.type] ?? e.type}</span>
                {typeof e.reported_qty === "number" && <span className="tabular-nums">(หยิบได้ {e.reported_qty})</span>}
                {e.note && <span className="text-m3-warning-dark">&ldquo;{e.note}&rdquo;</span>}
                <span className="text-xs text-m3-warning-dark">โดย {e.reported_by_name || e.reported_by}</span>
                {e.resolved_at ? (
                  <span className="text-xs text-m3-primary-dark">✓ ตัดสินแล้ว ({e.resolution})</span>
                ) : (
                  <span className="text-xs font-semibold text-m3-error-dark">รอตัดสิน</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* การแบ่งกล่อง Q (จัดให้อัตโนมัติตอนนำเข้า — ใช้อ้างอิงตอนจัดของ) */}
      {note.q_assignments && note.q_assignments.length > 0 && (
        <div className="bg-white rounded-xl border border-[rgba(145,158,171,0.2)] p-4">
          <h2 className="font-bold text-m3-grey-800 text-sm mb-2">
            การแบ่งกล่อง Q ({note.q_assignments.length} กล่อง)
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {note.q_assignments.map((q) => (
              <div key={q.q_code} className="rounded-xl border border-[rgba(0,184,217,0.16)] bg-[rgba(0,184,217,0.08)] px-3 py-2">
                <div className="text-xs font-extrabold text-m3-info-dark mb-1">
                  {q.q_code} <span className="font-normal text-m3-grey-500">· {q.items.length} รายการ</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {q.items.map((it) => {
                    const itDetail = note.items.find((x) => x.sku === it.sku);
                    return (
                      <span key={it.sku} className="px-2 py-0.5 rounded bg-white border border-[rgba(0,184,217,0.16)] text-xs text-m3-grey-700">
                        {itDetail?.product_name || it.sku} ×{it.qty}
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* รายการสินค้า */}
      <div className="bg-white rounded-xl border border-[rgba(145,158,171,0.2)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[rgba(145,158,171,0.2)] flex items-center justify-between">
          <h2 className="font-bold text-m3-grey-800 text-sm">รายการสินค้า ({note.items.length})</h2>
          {note.issue_document_no && (
            <span className="text-xs text-m3-grey-600">ตัดสต็อกแล้ว: <span className="tabular-nums">{note.issue_document_no}</span> โดย {note.approved_by}</span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-m3-grey-100 text-left text-m3-grey-600">
                <th className="px-4 py-2.5 font-medium">ชื่อสินค้า</th>
                <th className="px-4 py-2.5 font-medium">ตำแหน่ง</th>
                <th className="px-4 py-2.5 font-medium text-right">ต้องหยิบ</th>
                <th className="px-4 py-2.5 font-medium text-right">หยิบแล้ว</th>
                <th className="px-4 py-2.5 font-medium">สถานะ</th>
                {availability.length > 0 && <th className="px-4 py-2.5 font-medium text-right">มี/จอง/ว่าง</th>}
              </tr>
            </thead>
            <tbody>
              {note.items.map((it, i) => {
                const av = availBySku.get(it.sku);
                return (
                  <tr key={`${it.sku}-${i}`} className="border-t border-[rgba(145,158,171,0.2)]">
                    <td className="px-4 py-2.5 text-m3-grey-800 font-medium">{it.product_name || it.sku || "-"}</td>
                    <td className="px-4 py-2.5 tabular-nums text-xs text-m3-grey-600">{it.location_id || it.location_hint || "-"}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{it.qty_required.toLocaleString("th-TH")}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{it.qty_picked.toLocaleString("th-TH")}</td>
                    <td className="px-4 py-2.5">
                      {it.status === "PICKED" ? (
                        <span className="text-m3-primary-dark font-semibold">✓ หยิบแล้ว</span>
                      ) : it.status === "PROBLEM" ? (
                        <span className="text-m3-warning-dark font-semibold">มีปัญหา</span>
                      ) : (
                        <span className="text-m3-grey-500">รอหยิบ</span>
                      )}
                    </td>
                    {availability.length > 0 && (
                      <td className="px-4 py-2.5 text-right tabular-nums text-xs">
                        {av ? (
                          <span className={av.short !== undefined && av.short < 0 ? "text-m3-error-dark font-bold" : "text-m3-grey-600"}>
                            {av.on_hand} / {av.reserved} / {av.available}
                          </span>
                        ) : (
                          "-"
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* กล่อง */}
      {boxes.length > 0 && (
        <div className="bg-white rounded-xl border border-[rgba(145,158,171,0.2)] p-4">
          <h2 className="font-bold text-m3-grey-800 text-sm mb-3">กล่อง ({boxes.length})</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {boxes.map((b) => (
              <div key={b.document_id} className="border border-[rgba(145,158,171,0.2)] rounded-xl p-3 text-center">
                <SolarBoxClosed size={28} className="text-m3-grey-500" />
                <div className="tabular-nums text-xs text-m3-grey-600">{b.document_no}</div>
                <div className="font-bold text-m3-grey-800">กล่องที่ {b.box_no} · {b.total_qty} ชิ้น</div>
                <div className="text-xs text-m3-grey-600">{b.box_status}{b.shipment_no ? ` · ${b.shipment_no}` : ""}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ลิงก์ไปหน้างาน */}
      {(status === "READY_TO_PICK" || status === "PICKING" || status === "SHORTAGE") && (
        <Link href="/outbound/pick" className="block bg-m3-primary text-white rounded-xl p-4 text-center font-semibold">
          ไปหน้าหยิบของ
        </Link>
      )}
      {(status === "READY_TO_PACK" || status === "PACKING" || status === "PACKED") && (
        <Link href="/outbound/pack" className="block bg-m3-primary text-white rounded-xl p-4 text-center font-semibold">
          ไปหน้าแพ็กกล่อง
        </Link>
      )}
      {pickedDone && status === "PICKED_WAITING_APPROVAL" && (
        <div className="text-center text-sm text-m3-grey-600">รออนุมัติก่อนแพ็ก</div>
      )}
    </div>
  );
}

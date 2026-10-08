"use client";

import { useEffect, useMemo, useState } from "react";
import { useEscapeKey } from "@/hooks/use-escape-key";
import ProductSearchInput from "@/components/ui/ProductSearchInput";
import type { Product } from "@/types/models";
import type { ProductionJob, ProductionPriority } from "@/types/production";
import { PRODUCTION_TABLES } from "@/types/production";
import { editRuleHint, formatQty } from "./ui";

// Modal เพิ่มงานผลิต (สร้างฉบับร่าง) และแก้ไขงานตามกติกาสถานะ (§6)
// — เลือกสินค้าจากรายการสินค้าจริงในระบบ (ProductSearchInput → /api/products)

export interface AddJobFormValue {
  production_date: string;
  table_no: number;
  product_id: string;
  product_name: string;
  sku: string;
  unit: string;
  target_qty: string;
  priority: ProductionPriority;
  note: string;
  location: string;
  reason: string;
}

interface AddJobModalProps {
  open: boolean;
  mode: "create" | "edit";
  /** โหมดแก้ไข: งานเดิม (ใช้กติกาแก้ตามสถานะ) */
  job?: ProductionJob;
  defaultTable?: number;
  defaultDate?: string;
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (value: AddJobFormValue) => void;
}

const inputClass =
  "w-full rounded-lg border border-[#E8ECEA] bg-slate-50 px-3.5 py-2.5 text-sm font-semibold text-slate-900 focus:bg-white focus:border-[#0F5C3F] focus:ring-2 focus:ring-[#0F5C3F]/20 focus:outline-none";

export default function AddJobModal({
  open,
  mode,
  job,
  defaultTable = 1,
  defaultDate,
  submitting,
  error,
  onClose,
  onSubmit,
}: AddJobModalProps) {
  useEscapeKey(open && !submitting, onClose);

  const [products, setProducts] = useState<Product[]>([]);
  const [form, setForm] = useState<AddJobFormValue>({
    production_date: defaultDate || "",
    table_no: defaultTable,
    product_id: "",
    product_name: "",
    sku: "",
    unit: "ชิ้น",
    target_qty: "",
    priority: "NORMAL",
    note: "",
    location: "",
    reason: "",
  });

  // โหลดรายการสินค้าเมื่อเปิด modal — เฉพาะสินค้าที่มีอยู่จริงในโกดัง 2 (คลังผลิต)
  // (ไม่ใส่ limit — เรียกแบบไม่มี limit จะได้ data เป็น array ตรง ๆ แบบ legacy)
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch("/api/products?active=true&warehouse_id=wh-2", { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => {
        if (cancelled || !json.success) return;
        // รองรับทั้ง data ตรง ๆ และแบบแบ่งหน้า { items: [...] }
        const list = Array.isArray(json.data) ? json.data : Array.isArray(json.data?.items) ? json.data.items : null;
        if (list) setProducts(list as Product[]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open]);

  // รีเซ็ตฟอร์มทุกครั้งที่เปิด
  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && job) {
      setForm({
        production_date: job.production_date,
        table_no: job.table_no,
        product_id: job.product_id,
        product_name: job.product_name,
        sku: job.sku,
        unit: job.unit,
        target_qty: String(job.target_qty),
        priority: job.priority,
        note: job.note || "",
        location: job.location || "",
        reason: "",
      });
    } else {
      setForm({
        production_date: defaultDate || "",
        table_no: defaultTable,
        product_id: "",
        product_name: "",
        sku: "",
        unit: "ชิ้น",
        target_qty: "",
        priority: "NORMAL",
        note: "",
        location: "",
        reason: "",
      });
    }
  }, [open, mode, job, defaultDate, defaultTable]);

  const isEdit = mode === "edit";
  const editStatus = job?.status;
  // กติกา §6: DRAFT แก้ได้ทุกอย่าง · WAITING แก้สินค้า/จำนวน/โต๊ะได้ · IN_PROGRESS แก้เฉพาะเป้าหมาย+หมายเหตุ
  const canEditDate = !isEdit || editStatus === "DRAFT";
  const canEditProduct = !isEdit || editStatus === "DRAFT" || editStatus === "WAITING";
  const canEditPlanFields = !isEdit || editStatus === "DRAFT" || editStatus === "WAITING";
  const canEditTarget = !isEdit || editStatus === "DRAFT" || editStatus === "WAITING" || editStatus === "IN_PROGRESS";
  const needReason = isEdit && (editStatus === "WAITING" || editStatus === "IN_PROGRESS");

  const parsedQty = parseFloat(form.target_qty);
  const qtyInvalid = form.target_qty !== "" && (!Number.isFinite(parsedQty) || parsedQty < 0 || Math.round(parsedQty * 100) !== parsedQty * 100);
  const formError = useMemo(() => {
    if (!form.production_date) return "กรุณาเลือกวันที่ผลิต";
    if (!form.product_id) return "กรุณาเลือกสินค้าจากรายการ";
    if (form.target_qty === "" || !Number.isFinite(parsedQty) || parsedQty <= 0) return "จำนวนเป้าหมายต้องมากกว่า 0";
    if (qtyInvalid) return "จำนวนรับทศนิยมได้ไม่เกิน 2 ตำแหน่ง";
    if (needReason && !form.reason.trim()) return "การแก้ไขงานที่ส่งแล้วต้องระบุเหตุผล";
    return null;
  }, [form.production_date, form.product_id, form.target_qty, parsedQty, qtyInvalid, needReason, form.reason]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div className="absolute inset-0 bg-[#101828]/50 backdrop-blur-[2px]" onClick={() => !submitting && onClose()} />
      <div className="relative flex max-h-[92dvh] w-full flex-col rounded-t-xl border border-[#E8ECEA] bg-white shadow-[0_20px_60px_rgba(16,24,40,0.18)] animate-in fade-in zoom-in-95 duration-150 sm:max-w-lg sm:rounded-xl">
        <div className="border-b border-[#EEF1EF] px-5 py-4">
          <h2 className="text-lg font-bold text-slate-900">{isEdit ? "แก้ไขงานผลิต" : "เพิ่มงานผลิต (ฉบับร่าง)"}</h2>
          {isEdit && job && (
            <p className="mt-0.5 font-mono text-xs font-semibold text-slate-500">
              {job.job_no} · {editRuleHint(job.status)}
            </p>
          )}
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3.5">
              <p className="text-sm font-bold text-rose-800">{error}</p>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-bold text-slate-500">วันที่ผลิต</span>
              <input
                type="date"
                value={form.production_date}
                max="2100-12-31"
                disabled={!canEditDate}
                onChange={(e) => setForm((f) => ({ ...f, production_date: e.target.value }))}
                className={`mt-1 ${inputClass} disabled:bg-slate-100 disabled:text-slate-400`}
              />
            </label>
            <label className="block">
              <span className="text-xs font-bold text-slate-500">โต๊ะผลิต (1–5)</span>
              <select
                value={form.table_no}
                disabled={!canEditPlanFields}
                onChange={(e) => setForm((f) => ({ ...f, table_no: Number(e.target.value) }))}
                className={`mt-1 ${inputClass} disabled:bg-slate-100 disabled:text-slate-400`}
              >
                {PRODUCTION_TABLES.map((t) => (
                  <option key={t} value={t}>โต๊ะ {t}</option>
                ))}
              </select>
            </label>
          </div>

          <div>
            <span className="text-xs font-bold text-slate-500">
              สินค้าที่จะผลิต — เลือกจากสินค้าที่มีอยู่ในโกดัง 2 เท่านั้น
            </span>
            <div className="mt-1">
              {canEditProduct ? (
                <ProductSearchInput
                  products={products}
                  placeholder="พิมพ์บาร์โค้ด / 4 ตัวท้ายบาร์โค้ด / รหัสสินค้า / ชื่อสินค้า..."
                  onSelectProduct={(p) =>
                    setForm((f) => ({
                      ...f,
                      product_id: p.product_id,
                      product_name: p.product_name,
                      sku: p.sku,
                      unit: p.base_unit || "ชิ้น",
                    }))
                  }
                />
              ) : (
                <input
                  disabled
                  value={`${form.product_name} (${form.sku})`}
                  className={`${inputClass} bg-slate-100 text-slate-500`}
                />
              )}
              {form.product_id ? (
                <p className="mt-1 font-mono text-xs font-semibold text-slate-400">
                  {form.product_name} · {form.sku} · หน่วย: {form.unit}
                </p>
              ) : (
                canEditProduct && (
                  <p className="mt-1 text-[11px] font-semibold text-slate-400">
                    ค้นหาได้ทั้งบาร์โค้ดเต็ม · ตัวเลข 4 ตัวท้ายของบาร์โค้ด · รหัสสินค้า (SKU) · ชื่อสินค้า — แสดงเฉพาะสินค้าที่มีในโกดัง 2
                  </p>
                )
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="block truncate text-xs font-bold text-[#06402B]">จำนวนเป้าหมาย</span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={form.target_qty}
                disabled={!canEditTarget}
                onChange={(e) => setForm((f) => ({ ...f, target_qty: e.target.value }))}
                placeholder="0"
                className={`mt-1 w-full rounded-lg border px-3.5 py-2.5 text-center font-mono text-lg font-bold text-[#06402B] focus:outline-none ${
                  qtyInvalid
                    ? "border-[#F04438] bg-[#FEF3F2] focus:ring-2 focus:ring-[#F04438]/20"
                    : "border-[#E8ECEA] bg-slate-50 focus:border-[#0F5C3F] focus:ring-2 focus:ring-[#0F5C3F]/20"
                } disabled:bg-slate-100 disabled:text-slate-400`}
              />
              <p className="mt-1 truncate text-[11px] font-semibold text-slate-400">
                {form.target_qty !== "" && Number.isFinite(parsedQty) && parsedQty > 0
                  ? `= ${formatQty(parsedQty)} ${form.unit} · ยอดสินค้าดี ไม่รวมของเสีย`
                  : "ยอดสินค้าดีที่ต้องการ — ไม่รวมของเสีย"}
              </p>
            </label>
            <label className="block">
              <span className="text-xs font-bold text-slate-500">ลำดับความสำคัญ</span>
              <select
                value={form.priority}
                onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as ProductionPriority }))}
                className={`mt-1 ${inputClass}`}
              >
                <option value="NORMAL">ปกติ</option>
                <option value="URGENT">ด่วน</option>
                <option value="CRITICAL">ด่วนมาก</option>
              </select>
            </label>
          </div>

          <label className="block">
            <span className="text-xs font-bold text-slate-500">หมายเหตุ (ถ้ามี)</span>
            <textarea
              rows={2}
              value={form.note}
              disabled={false}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              placeholder="เช่น เตรียมวัตถุดิบให้ก่อน 10:00"
              className={`mt-1 ${inputClass} resize-none`}
            />
          </label>

          <label className="block">
            <span className="text-xs font-bold text-slate-500">ตำแหน่งเก็บตอนรับเข้าโกดัง 2 (ไม่บังคับ)</span>
            <input
              type="text"
              value={form.location}
              disabled={!canEditPlanFields}
              onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
              placeholder="เช่น 2A-05"
              className={`mt-1 font-mono ${inputClass} disabled:bg-slate-100 disabled:text-slate-400`}
            />
          </label>

          {needReason && (
            <label className="block">
              <span className="text-xs font-bold text-rose-600">เหตุผลการแก้ไข (จะแจ้งไปยังผู้ผลิต)</span>
              <textarea
                rows={2}
                value={form.reason}
                onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                placeholder="เช่น ลูกค้าเพิ่มออเดอร์ ต้องเพิ่มเป้าหมาย"
                className="mt-1 resize-none rounded-lg border border-rose-200 bg-rose-50/50 px-3.5 py-2.5 text-sm font-semibold text-slate-900 focus:border-rose-400 focus:ring-2 focus:ring-rose-400/20 focus:outline-none"
              />
            </label>
          )}
        </div>

        <div className="flex gap-2.5 border-t border-[#EEF1EF] px-5 py-4">
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            className="flex-1 rounded-lg border border-[#E8ECEA] bg-slate-100 py-3 text-sm font-bold text-slate-700 transition-all hover:bg-slate-200 active:scale-95 disabled:opacity-50"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            disabled={!!formError || submitting}
            onClick={() => onSubmit({ ...form, target_qty: form.target_qty })}
            className="flex-[1.4] rounded-lg bg-[#06402B] py-3 text-sm font-bold text-white shadow-lg shadow-[#06402B]/20 transition-all hover:bg-[#0A5C4E] active:scale-[0.98] disabled:opacity-40"
          >
            {submitting ? (
              <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : isEdit ? (
              "บันทึกการแก้ไข"
            ) : (
              "เพิ่มงาน (ฉบับร่าง)"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

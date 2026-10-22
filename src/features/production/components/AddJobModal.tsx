"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import BomPlanFields from "@/features/production/components/BomPlanFields";
import type { ProductionCapacity, ProductionBomSelection } from "@/types/production-bom";
import { useEscapeKey } from "@/hooks/use-escape-key";
import ProductSearchInput from "@/components/ui/ProductSearchInput";
import type { Product } from "@/types/models";
import type { ProductionJob, ProductionPriority } from "@/types/production";
import { PRODUCTION_JOB_STATUS_LABELS, PRODUCTION_TABLES } from "@/types/production";
import { formatQty } from "./ui";
import { parseQtyInput } from "@/features/production/lib/quantity";
import { canEditField } from "@/features/production/lib/job-form";
import { M3Banner, M3Dialog, M3ErrorBanner, M3SubmitLabel, m3Cls } from "@/components/ui/m3";
import { SolarCheckCircle, SolarFactory, SolarFlag } from "@/components/icons";

// Modal เพิ่มงานผลิต (สร้างฉบับร่าง) และแก้ไขงานตามกติกาสถานะ (§6)
// — เลือกเฉพาะสินค้าสำเร็จรูปที่มี BOM เปิดใช้งานและมีรายการวัตถุดิบ

export interface AddJobFormValue {
  bom?: ProductionBomSelection;
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
  const [capacities, setCapacities] = useState<Record<string, ProductionCapacity>>({});
  const [productsError, setProductsError] = useState<string | null>(null);
  const [bomError, setBomError] = useState<string | null>(null);
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

  // จับคู่ทะเบียนสินค้ากับสินค้าปลายทางของ BOM ไม่จำกัดว่าต้องมีสต็อกแล้ว
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setProducts([]);
    setCapacities({});
    setProductsError(null);
    Promise.all([
      fetch("/api/products?active=true&master_only=true", { cache: "no-store" }).then(r => r.json()),
      fetch(`/api/production/capacities${job?.job_no ? `?job_no=${encodeURIComponent(job.job_no)}` : ""}`, { cache: "no-store" }).then(r => r.json()),
    ])
      .then(([json, bomJson]) => {
        if (cancelled) return;
        if (!json.success || !bomJson.success) throw new Error("โหลดสินค้าที่มีสูตรการผลิตไม่สำเร็จ กรุณาปิดและเปิดฟอร์มอีกครั้ง");
        // รองรับทั้ง data ตรง ๆ และแบบแบ่งหน้า { items: [...] }
        const list = Array.isArray(json.data) ? json.data : Array.isArray(json.data?.items) ? json.data.items : null;
        if (!list || !Array.isArray(bomJson.data)) throw new Error("ข้อมูลสินค้าหรือสูตรการผลิตไม่ถูกต้อง กรุณาลองใหม่");
        const rows = bomJson.data as ProductionCapacity[];
        const formulaProducts = new Set(rows.map(f => f.product_id));
        setCapacities(Object.fromEntries(rows.map(c => [c.product_id, c])));
        setProducts((list as Product[]).filter(p => formulaProducts.has(p.product_id)));
      })
      .catch(e => { if (!cancelled) setProductsError(e instanceof Error ? e.message : "โหลดสินค้าที่มีสูตรไม่สำเร็จ"); });
    return () => {
      cancelled = true;
    };
  }, [open, job?.job_no]);

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
        bom: job.material_plan?.selection,
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
  // ช่องที่เซิร์ฟเวอร์ไม่รับในสถานะนั้น → ล็อกไว้ (เดิมแก้ได้แต่ถูกปฏิเสธ/ถูกเพิกเฉย)
  const canEditPriority = !isEdit || canEditField(editStatus, "priority");
  const canEditLocation = !isEdit || canEditField(editStatus, "location");

  // ตรวจจำนวนเป้าหมายแบบนับตำแหน่งทศนิยมจากข้อความ (สูตรเดิม Math.round(v*100) === v*100 ปฏิเสธ 2.3, 1.15)
  const qtyParse = useMemo(() => parseQtyInput(form.target_qty, { allowEmpty: false, allowZero: false }), [form.target_qty]);
  const qtyInvalid = !qtyParse.ok && !qtyParse.empty;
  const changeBom = useCallback((bom: ProductionBomSelection | undefined, unit?: string) => setForm(f => ({ ...f, bom, unit: unit || f.unit })), []);
  const formError = useMemo(() => {
    if (!form.production_date) return "กรุณาเลือกวันที่ผลิต";
    if (productsError) return productsError;
    if (!form.product_id) return "กรุณาเลือกสินค้าจากรายการ";
    if (bomError) return bomError;
    if (!qtyParse.ok) return qtyParse.empty ? "จำนวนเป้าหมายต้องมากกว่า 0" : `จำนวนเป้าหมาย: ${qtyParse.error}`;
    if (needReason && !form.reason.trim()) return "การแก้ไขงานที่ส่งแล้วต้องระบุเหตุผล";
    return null;
  }, [form.production_date, form.product_id, qtyParse, needReason, form.reason, bomError, productsError]);

  if (!open) return null;

  // ปุ่มเลือกแบบแบ่งช่อง (D27): ตัวที่เลือก = เข้ม / ความสำคัญที่เลือก = เหลืองอ่อน
  const segBtn = (selected: boolean, selectedCls = "border-m3-grey-800 bg-m3-grey-800 text-white") =>
    `h-11 min-w-0 flex-1 rounded-lg border text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-48 ${
      selected ? selectedCls : "border-[rgba(145,158,171,0.32)] bg-white text-m3-grey-800 hover:bg-[rgba(145,158,171,0.08)]"
    }`;
  const PRIORITY_OPTIONS: { value: ProductionPriority; label: string; selectedCls: string }[] = [
    { value: "NORMAL", label: "ปกติ", selectedCls: "border-m3-grey-800 bg-m3-grey-800 text-white" },
    { value: "URGENT", label: "ด่วน", selectedCls: "border-m3-warning bg-[rgba(255,171,0,0.16)] text-m3-warning-dark" },
    { value: "CRITICAL", label: "ด่วนมาก", selectedCls: "border-m3-error bg-[rgba(255,86,48,0.12)] text-m3-error-dark" },
  ];

  return (
    <M3Dialog
      title={isEdit ? "แก้ไขงานผลิต" : "เพิ่มงานผลิต (ฉบับร่าง)"}
      subtitle={isEdit && job ? job.job_no : undefined}
      hint={isEdit ? undefined : "เฉพาะผู้ดูแลระบบ (Admin)"}
      icon={<SolarFactory size={26} />}
      widthClass="sm:max-w-[560px]"
      onBackdrop={() => !submitting && onClose()}
      footer={
        <>
          <button type="button" disabled={submitting} onClick={onClose} className={m3Cls.btnCancel}>
            ยกเลิก
          </button>
          <button
            type="button"
            disabled={!!formError || submitting}
            onClick={() => onSubmit({ ...form, target_qty: form.target_qty })}
            className={m3Cls.btnPrimary}
          >
            <M3SubmitLabel submitting={submitting}>{isEdit ? "บันทึกการแก้ไข" : "เพิ่มงาน (ฉบับร่าง)"}</M3SubmitLabel>
          </button>
        </>
      }
    >
      {error && <M3ErrorBanner message={error} />}

      <div>
        <span className={m3Cls.label}>โต๊ะผลิต</span>
        <div className="mt-1.5 flex gap-2" role="group" aria-label="โต๊ะผลิต">
          {PRODUCTION_TABLES.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={form.table_no === t}
              disabled={!canEditPlanFields}
              onClick={() => setForm((f) => ({ ...f, table_no: Number(t) }))}
              className={`font-m3-disp ${segBtn(form.table_no === t)}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <label className="block">
        <span className={m3Cls.label}>วันที่ผลิต</span>
        <input
          type="date"
          value={form.production_date}
          max="2100-12-31"
          disabled={!canEditDate}
          onChange={(e) => setForm((f) => ({ ...f, production_date: e.target.value }))}
          className={`mt-1.5 ${m3Cls.input}`}
        />
      </label>

      <div>
        <span className={m3Cls.label}>สินค้าสำเร็จรูป</span>
        <div className="mt-1.5">
          {canEditProduct ? (
            <ProductSearchInput
              products={products}
              showStock={false}
              renderProductMeta={p => {
                const c = capacities[p.product_id];
                return <span className={`text-right text-xs font-semibold ${c?.quantity === 0 ? "text-m3-error-dark" : c?.quantity != null ? "text-m3-primary-dark" : "text-m3-grey-500"}`}>ผลิตได้ <strong className="font-bold tabular-nums">{c?.quantity == null ? "—" : formatQty(c.quantity)}</strong>{c?.unit ? ` ${c.unit}` : ""}</span>;
              }}
              placeholder="ค้นหาสินค้าสำเร็จรูป / SKU / บาร์โค้ด"
              onSelectProduct={(p) =>
                setForm((f) => ({
                  ...f,
                  product_id: p.product_id,
                  bom: undefined,
                  product_name: p.product_name,
                  sku: p.sku,
                  unit: p.base_unit || "ชิ้น",
                }))
              }
            />
          ) : (
            <input disabled value={`${form.product_name} (${form.sku})`} className={m3Cls.input} />
          )}
          {form.product_id ? (
            <div className="mt-2 inline-flex max-w-full items-center gap-2 rounded-lg bg-[rgba(0,167,111,0.08)] px-3 py-1.5 text-xs">
              <SolarCheckCircle size={16} className="shrink-0 text-m3-primary" />
              <span className="truncate font-semibold text-m3-grey-800">{form.product_name}</span>
              <span className="shrink-0 tabular-nums text-m3-grey-600">
                {form.sku} · หน่วย: {form.unit}
              </span>
            </div>
          ) : null}
        </div>
      </div>

      <BomPlanFields productId={form.product_id} targetQty={Number(form.target_qty)} value={form.bom} savedPlan={job?.material_plan} jobNo={job?.job_no}
        disabled={isEdit && editStatus !== "DRAFT" && editStatus !== "WAITING"} onChange={changeBom} onValidation={setBomError} />

      <label className="block">
        <span className={m3Cls.label}>เป้าหมายสินค้าดี</span>
        <div className="relative mt-1.5">
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={form.target_qty}
            disabled={!canEditTarget}
            onChange={(e) => setForm((f) => ({ ...f, target_qty: e.target.value }))}
            placeholder="0"
            className={`pr-14 font-m3-disp text-lg font-bold tabular-nums ${qtyInvalid ? m3Cls.inputError : m3Cls.input}`}
          />
          <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-sm font-semibold text-m3-grey-500">
            {form.unit}
          </span>
        </div>
        {qtyInvalid && !qtyParse.ok && <p className="mt-1 text-xs font-semibold text-m3-error-dark">{qtyParse.error}</p>}
      </label>

      <div>
        <span className={m3Cls.label}>ลำดับความสำคัญ</span>
        <div className="mt-1.5 flex gap-2" role="group" aria-label="ลำดับความสำคัญ">
          {PRIORITY_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              aria-pressed={form.priority === o.value}
              disabled={!canEditPriority}
              onClick={() => setForm((f) => ({ ...f, priority: o.value }))}
              className={`inline-flex items-center justify-center gap-1.5 ${segBtn(form.priority === o.value, o.selectedCls)}`}
            >
              {o.value !== "NORMAL" && <SolarFlag size={14} />}
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <label className="block">
        <span className={m3Cls.label}>ตำแหน่งเก็บที่เสนอ</span>
        <input
          type="text"
          value={form.location}
          disabled={!canEditLocation}
          onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
          className={`mt-1.5 tabular-nums ${m3Cls.input}`}
        />
      </label>

      <label className="block">
        <span className={m3Cls.label}>หมายเหตุ</span>
        <textarea
          rows={2}
          value={form.note}
          disabled={false}
          onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
          className={`mt-1.5 resize-none ${m3Cls.input}`}
        />
      </label>

      {needReason && (
        <label className="block">
          <span className={m3Cls.label}>
            เหตุผลการแก้ไข <span className="text-m3-error">*</span>
          </span>
          <textarea
            rows={2}
            value={form.reason}
            onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
            className={`mt-1.5 resize-none ${m3Cls.input}`}
          />
        </label>
      )}

      {formError && !error && <p role="alert" className="text-sm font-semibold text-m3-error-dark">{formError}</p>}
    </M3Dialog>
  );
}

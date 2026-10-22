"use client";

import { useEffect, useMemo, useState } from "react";
import { previewProductionBom } from "@/lib/production-bom";
import type { ProductionBomFormula, ProductionBomPreview, ProductionBomSelection, ProductionMaterialPlan } from "@/types/production-bom";

interface Props {
  productId: string;
  targetQty: number;
  value?: ProductionBomSelection;
  savedPlan?: ProductionMaterialPlan;
  jobNo?: string;
  disabled: boolean;
  onChange: (value: ProductionBomSelection | undefined, unit?: string) => void;
  onValidation: (error: string | null) => void;
}

export default function BomPlanFields({ productId, targetQty, value, savedPlan, jobNo, disabled, onChange, onValidation }: Props) {
  const [formulas, setFormulas] = useState<ProductionBomFormula[]>([]);
  const [loadedProductId, setLoadedProductId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [availability, setAvailability] = useState<ProductionBomPreview | null>(null);
  const selected = value?.bom_id;
  useEffect(() => {
    let live = true;
    setError(null);
    setFormulas([]);
    setLoadedProductId(null);
    if (!productId) return;
    fetch(`/api/production/boms?product_id=${encodeURIComponent(productId)}`, { cache: "no-store" })
      .then(r => r.json()).then(json => {
        if (!live) return;
        if (!json.success) throw new Error(json.message || "โหลดสูตรไม่สำเร็จ");
        const rows = json.data as ProductionBomFormula[];
        setFormulas(rows);
        setLoadedProductId(productId);
      }).catch(e => { if (live) { setError(e instanceof Error ? e.message : "โหลดสูตรไม่สำเร็จ"); setLoadedProductId(productId); } });
    return () => { live = false; };
  }, [productId]);
  useEffect(() => {
    if (!disabled && !selected && loadedProductId === productId && formulas.length) {
      const first = formulas[0];
      onChange({ bom_id: first.bom_id, revision: first.revision }, first.unit);
    }
  }, [disabled, selected, loadedProductId, productId, formulas, onChange]);
  const formula = savedPlan && savedPlan.snapshot.product_id === productId && savedPlan.snapshot.bom_id === selected ? savedPlan.snapshot : loadedProductId === productId ? formulas.find(f => f.bom_id === selected) : undefined;
  const preview = useMemo(() => formula ? previewProductionBom(formula, targetQty, value) : null, [formula, targetQty, value]);
  const loading = !!productId && loadedProductId !== productId;
  const validation = !productId ? null : error || (!formula ? loading ? "กำลังดึงวัตถุดิบตามสูตรของสินค้า…" : "สินค้านี้ยังไม่มีสูตรที่เปิดใช้งานและมีวัตถุดิบครบ กรุณาตรวจข้อมูล BOM" : preview?.issues[0] || null);
  useEffect(() => { onValidation(validation); }, [validation, onValidation]);
  useEffect(() => {
    let live = true;
    setAvailability(null);
    if (!productId || !value || !preview || preview.issues.length || disabled) return;
    const timer = setTimeout(() => {
      fetch("/api/production/boms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ product_id: productId, target_qty: targetQty, selection: value, job_no: jobNo }) })
        .then(r => r.json()).then(json => { if (live && json.success) setAvailability(json.data); }).catch(() => {});
    }, 300);
    return () => { live = false; clearTimeout(timer); };
  }, [productId, value, targetQty, jobNo, preview, disabled]);
  if (!productId) return null;
  const factorInput = (unit: string, stockUnit: string, current: number | undefined, change: (n: number | undefined) => void) => (
    <label className="mt-2 block text-xs text-slate-600">1 {unit} =
      <input aria-label={`อัตราแปลง ${unit} เป็น ${stockUnit}`} type="number" min="0.001" step="any" disabled={disabled} value={current ?? ""}
        onChange={e => change(e.target.value === "" ? undefined : Number(e.target.value))} className="mx-2 w-24 rounded border bg-white px-2 py-1" />{stockUnit}
    </label>
  );
  return <section className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
    <p className="text-sm font-bold">วัตถุดิบ · โกดัง 2</p>
    {formula && formulas.length <= 1 && <p className="text-xs text-slate-600">{formula.bom_id}</p>}
    {formulas.length > 1 && <label className="block text-xs font-semibold">สูตร
      <select aria-label="สูตรการผลิต" disabled={disabled} value={selected || ""} onChange={e => { const f = formulas.find(f => f.bom_id === e.target.value); onChange(f ? { bom_id: f.bom_id, revision: f.revision } : undefined, f?.unit); }} className="mt-1 block w-full rounded border bg-white p-2 text-sm">
        {savedPlan && !formulas.some(f => f.bom_id === savedPlan.snapshot.bom_id) && <option value={savedPlan.snapshot.bom_id}>{savedPlan.snapshot.label}</option>}
        {formulas.map(f => <option key={f.bom_id} value={f.bom_id}>{f.label}</option>)}
      </select>
    </label>}
    {formula && <>
      <p className="text-xs">ฐานสูตร {formula.base_qty} {formula.unit}</p>
      {formula.unit !== formula.stock_unit && factorInput(formula.unit, formula.stock_unit, value?.fg_factor, n => onChange({ ...value!, fg_factor: n }, formula.unit))}
      {preview?.materials.map(i => {
        const stock = availability?.materials.find(m => m.item_id === i.item_id);
        return <div key={i.item_id} className="rounded border bg-white p-2 text-sm">
          <p className="font-semibold">{i.sku} · {i.name}</p>
          <p className="text-xs text-slate-500">{!i.role_confirmed ? "ยังไม่ระบุหลัก/รอง" : i.is_primary === 1 ? "ตัวหลัก" : "ตัวรอง"} · ใช้ {i.stock_qty ?? "—"} {i.stock_unit}</p>
          {!formula.items.find(m => m.item_id === i.item_id)?.role_confirmed && <label className="mt-1 block text-xs">หลัก / รอง
            <select disabled={disabled} value={value?.material_roles?.[String(i.item_id)] ?? ""} onChange={e => onChange({ ...value!, material_roles: { ...value?.material_roles, [String(i.item_id)]: Number(e.target.value) as 0 | 1 } }, formula.unit)} className="ml-2 rounded border p-1">
              <option value="" disabled>ระบุประเภท</option><option value="1">ตัวหลัก</option><option value="0">ตัวรอง</option>
            </select>
          </label>}
          {i.unit !== i.stock_unit && factorInput(i.unit, i.stock_unit, value?.material_factors?.[String(i.item_id)], n => {
            const factors = { ...value?.material_factors }; if (n === undefined) delete factors[String(i.item_id)]; else factors[String(i.item_id)] = n;
            onChange({ ...value!, material_factors: factors }, formula.unit);
          })}
          {stock && <p className={stock.shortage ? "text-xs font-bold text-rose-700" : "text-xs text-slate-500"}>พร้อมใช้ {stock.available} {i.stock_unit}{stock.shortage ? ` · ขาด ${stock.shortage}` : ""}</p>}
        </div>;
      })}
      {availability?.main_capacity != null && <p className="text-sm font-bold text-emerald-800">ผลิตได้ {availability.main_capacity} {formula.unit}</p>}
    </>}
    {validation && <p role="alert" className="text-xs font-semibold text-rose-700">{validation}</p>}
  </section>;
}

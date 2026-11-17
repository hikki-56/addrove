"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { previewProductionBom } from "@/lib/production-bom";
import { M3SubmitLabel, m3Cls } from "@/components/ui/m3";
import type { ProductionBomFormula, ProductionBomPreview, ProductionBomSelection, ProductionMaterialPlan, ProductionMaterialStockLocation } from "@/types/production-bom";
import type { BomManagementData } from "@/types/bom-management";
import BomFormulaManager, { type BomManagerAction } from "./BomFormulaManager";
import BomEditStatus from "./BomEditStatus";

interface Props {
  productId: string;
  targetQty: number;
  value?: ProductionBomSelection;
  savedPlan?: ProductionMaterialPlan;
  jobNo?: string;
  disabled: boolean;
  onChange: (value: ProductionBomSelection | undefined, unit?: string) => void;
  onValidation: (error: string | null) => void;
  onFormulasChanged?: () => void;
}

export default function BomPlanFields({ productId, targetQty, value, savedPlan, jobNo, disabled, onChange, onValidation, onFormulasChanged }: Props) {
  const [formulas, setFormulas] = useState<ProductionBomFormula[]>([]);
  const [loadedProductId, setLoadedProductId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [availability, setAvailability] = useState<ProductionBomPreview | null>(null);
  const [sources, setSources] = useState<ProductionMaterialStockLocation[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [sourcesVersion, setSourcesVersion] = useState(0);
  const [savingRoles, setSavingRoles] = useState(false);
  const [rolesError, setRolesError] = useState<string | null>(null);
  const [rolesSaved, setRolesSaved] = useState(false);
  const [savedFormula, setSavedFormula] = useState<ProductionBomFormula | null>(null);
  const [managementAction, setManagementAction] = useState<BomManagerAction | null>(null);
  const managing = managementAction !== null;
  const [managedFormulas, setManagedFormulas] = useState(false);
  const [managementMessage, setManagementMessage] = useState("");
  const saveRequest = useRef<AbortController | null>(null);
  const selected = value?.bom_id;
  useEffect(() => {
    setSavingRoles(false);
    setRolesError(null);
    setRolesSaved(false);
    return () => { saveRequest.current?.abort(); };
  }, [productId, selected]);
  useEffect(() => {
    let live = true;
    setError(null);
    setFormulas([]);
    setLoadedProductId(null);
    setSavedFormula(null);
    setManagementAction(null);
    setManagedFormulas(false);
    setManagementMessage("");
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
  }, [productId, jobNo]);
  useEffect(() => {
    let live = true;
    setSources([]);
    setSourcesError(null);
    setSourcesLoading(!!productId);
    if (!productId) return;
    fetch(`/api/production/material-sources?product_id=${encodeURIComponent(productId)}${jobNo ? `&job_no=${encodeURIComponent(jobNo)}` : ""}`, { cache: "no-store" })
      .then(r => r.json()).then(json => {
        if (!live) return;
        if (!json.success) throw new Error(json.message || "โหลดจุดรับไม่สำเร็จ");
        setSources(json.data);
      }).catch(e => { if (live) setSourcesError(e instanceof Error ? e.message : "โหลดจุดรับไม่สำเร็จ"); })
      .finally(() => { if (live) setSourcesLoading(false); });
    return () => { live = false; };
  }, [productId, jobNo, sourcesVersion]);
  useEffect(() => {
    if (!disabled && !selected && loadedProductId === productId && formulas.length) {
      const first = formulas[0];
      onChange({ bom_id: first.bom_id, revision: first.revision }, first.unit);
    }
  }, [disabled, selected, loadedProductId, productId, formulas, onChange]);
  const formula = savedFormula?.product_id === productId && savedFormula.bom_id === selected ? savedFormula : !managedFormulas && savedPlan && savedPlan.snapshot.product_id === productId && savedPlan.snapshot.bom_id === selected ? savedPlan.snapshot : loadedProductId === productId ? formulas.find(f => f.bom_id === selected) : undefined;
  const preview = useMemo(() => formula ? previewProductionBom(formula, targetQty, value) : null, [formula, targetQty, value]);
  const loading = !!productId && loadedProductId !== productId;
  useEffect(() => {
    if (disabled || loading || sourcesLoading || sourcesError || !formula || !value) return;
    const locations = { ...value.material_locations };
    let changed = false;
    for (const item of formula.items) {
      const matches = sources.filter(l => l.product_id === item.product_id);
      if (!locations[String(item.item_id)] && matches.length === 1) {
        locations[String(item.item_id)] = matches[0].location_id;
        changed = true;
      }
    }
    if (changed) onChange({ ...value, material_locations: locations }, formula.unit);
  }, [disabled, loading, sourcesLoading, sourcesError, formula, value, sources, onChange]);
  const missingSource = !loading && !sourcesLoading && !disabled && formula?.items.find(i => {
    const matches = sources.filter(l => l.product_id === i.product_id);
    const chosen = value?.material_locations?.[String(i.item_id)];
    return chosen ? !matches.some(l => l.location_id === chosen) : matches.length > 1;
  });
  const validation = !productId ? null : managing ? "กรุณาบันทึกหรือยกเลิกการแก้สูตรก่อนเพิ่มงานผลิต" : savingRoles ? "กำลังบันทึกประเภทวัตถุดิบ…" : error || sourcesError || (!formula ? loading ? "กำลังดึงวัตถุดิบตามสูตรของสินค้า…" : "สินค้านี้ยังไม่มีสูตร กดเพิ่มสูตรเพื่อเริ่มต้น" : preview?.issues[0] || (sourcesLoading ? "กำลังโหลดจุดรับ…" : missingSource ? `${missingSource.sku}: เลือกจุดรับวัตถุดิบ` : null));
  useEffect(() => { onValidation(validation); }, [validation, onValidation]);
  useEffect(() => {
    let live = true;
    setAvailability(null);
    if (!productId || !value || !preview || preview.issues.length || disabled || managing) return;
    const timer = setTimeout(() => {
      fetch("/api/production/boms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ product_id: productId, target_qty: targetQty, selection: value, job_no: jobNo }) })
        .then(r => r.json()).then(json => { if (live && json.success) setAvailability(json.data); }).catch(() => {});
    }, 300);
    return () => { live = false; clearTimeout(timer); };
  }, [productId, value, targetQty, jobNo, preview, disabled, managing]);
  const applyManagedFormulas = (data: BomManagementData, bomId?: string) => {
    if (data.product.product_id !== productId) return;
    const rows = data.production_formulas;
    const next = rows.find(f => f.bom_id === bomId) ?? rows[0];
    setFormulas(rows);
    setLoadedProductId(productId);
    setSavedFormula(next ?? null);
    setManagedFormulas(true);
    setAvailability(null);
    setError(null);
    setRolesSaved(false);
    setRolesError(null);
    setManagementAction(null);
    setSourcesVersion(v => v + 1);
    setManagementMessage(bomId ? "บันทึกสูตรเรียบร้อยแล้ว" : "ลบสูตรเรียบร้อยแล้ว");
    onChange(next ? { bom_id: next.bom_id, revision: next.revision } : undefined, next?.unit);
    onFormulasChanged?.();
  };
  const pendingRoles = Object.fromEntries(formula?.items.flatMap(i => {
    const role = value?.material_roles?.[String(i.item_id)];
    return i.role_confirmed === false && role !== undefined ? [[String(i.item_id), role]] : [];
  }) ?? []);
  const saveRoles = async () => {
    if (!formula || !value || savingRoles || disabled || !Object.keys(pendingRoles).length) return;
    const controller = new AbortController();
    saveRequest.current = controller;
    setSavingRoles(true);
    setRolesError(null);
    setRolesSaved(false);
    try {
      const response = await fetch("/api/production/boms", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ product_id: productId, bom_id: formula.bom_id, revision: formula.revision, material_roles: pendingRoles }),
      });
      const json = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok || !json.success) throw new Error(json.message || "บันทึกประเภทวัตถุดิบไม่สำเร็จ");
      const updated = json.data as ProductionBomFormula;
      setFormulas(rows => rows.map(f => f.bom_id === updated.bom_id ? updated : f));
      setSavedFormula(updated);
      const roles = { ...value.material_roles };
      for (const id of Object.keys(pendingRoles)) delete roles[id];
      onChange({ ...value, revision: updated.revision, material_roles: roles }, updated.unit);
      setRolesSaved(true);
    } catch (e) {
      if (!controller.signal.aborted) setRolesError(e instanceof Error ? e.message : "บันทึกประเภทวัตถุดิบไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      if (!controller.signal.aborted) setSavingRoles(false);
    }
  };
  if (!productId) return null;
  const openManager = (action: BomManagerAction) => { setManagementMessage(""); setManagementAction(action); };
  const masterFormula = formulas.some(f => f.bom_id === formula?.bom_id);
  const factorInput = (unit: string, stockUnit: string, current: number | undefined, change: (n: number | undefined) => void) => (
    <label className="mt-2 block text-xs text-m3-grey-600">1 {unit} =
      <input aria-label={`อัตราแปลง ${unit} เป็น ${stockUnit}`} type="number" min="0.001" step="any" disabled={disabled || savingRoles} value={current ?? ""}
        onChange={e => change(e.target.value === "" ? undefined : Number(e.target.value))} className="mx-2 h-9 w-24 px-2 text-right tabular-nums rounded-lg border border-[rgba(145,158,171,0.32)] bg-white text-sm text-m3-grey-800 focus:border-m3-grey-800 focus:ring-1 focus:ring-m3-grey-800 focus:outline-none disabled:bg-m3-grey-100 disabled:text-m3-grey-500" />{stockUnit}
    </label>
  );
  return <section className="space-y-3 rounded-xl bg-m3-grey-100 p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm font-bold">วัตถุดิบ · โกดัง 2</p>
      {!managing && <div className="flex flex-wrap gap-2">
        <button type="button" disabled={disabled || savingRoles || loading} onClick={() => openManager({ type: "new-formula" })} className="m3-btn m3-btn-sm m3-btn-outline">เพิ่มสูตร</button>
        <button type="button" disabled={disabled || savingRoles || !masterFormula} onClick={() => openManager({ type: "edit-formula" })} className="m3-btn m3-btn-sm m3-btn-outline">แก้ไขสูตร</button>
        <button type="button" disabled={disabled || savingRoles || !masterFormula} onClick={() => openManager({ type: "delete-formula" })} className="m3-btn m3-btn-sm text-m3-error-dark">ลบสูตร</button>
      </div>}
    </div>
    {managementAction ? <BomFormulaManager key={productId} productId={productId} initialBomId={selected} initialAction={managementAction} onClose={() => setManagementAction(null)} onChanged={applyManagedFormulas} /> : <>
    {managementMessage && <p role="status" className="text-xs font-semibold text-m3-primary-dark">{managementMessage}</p>}
    {formula && (formulas.some(f => f.bom_id === formula.bom_id)
      ? <BomEditStatus editedAt={formulas.find(f => f.bom_id === formula.bom_id)?.edited_at} />
      : <p className="text-xs text-m3-grey-500">สูตรที่เก็บไว้ในใบงาน</p>)}
    {formulas.length > 1 && <label className="block text-xs font-semibold">สูตร
      <select aria-label="สูตรการผลิต" disabled={disabled} value={selected || ""} onChange={e => { const f = formulas.find(f => f.bom_id === e.target.value); onChange(f ? { bom_id: f.bom_id, revision: f.revision } : undefined, f?.unit); }} className="mt-1.5 block h-11 w-full px-3 rounded-lg border border-[rgba(145,158,171,0.32)] bg-white text-sm text-m3-grey-800 focus:border-m3-grey-800 focus:ring-1 focus:ring-m3-grey-800 focus:outline-none disabled:bg-m3-grey-100 disabled:text-m3-grey-500">
        {!managedFormulas && savedPlan && !formulas.some(f => f.bom_id === savedPlan.snapshot.bom_id) && <option value={savedPlan.snapshot.bom_id}>{savedPlan.snapshot.label}</option>}
        {formulas.map(f => <option key={f.bom_id} value={f.bom_id}>{f.label} · {f.edited_at ? "แก้ไขแล้ว" : "ยังไม่แก้ไข"}</option>)}
      </select>
    </label>}
    {formula && <>
      {formula.base_qty !== 1 && <p className="text-xs">ฐานสูตร {formula.base_qty} {formula.unit}</p>}
      {!formula.items.length && <p className="text-xs font-semibold text-m3-error-dark">มีสูตรแล้ว แต่ยังไม่มีวัตถุดิบ กดเพิ่มวัตถุดิบก่อนสั่งผลิต</p>}
      {formula.unit !== formula.stock_unit && factorInput(formula.unit, formula.stock_unit, value?.fg_factor, n => onChange({ ...value!, fg_factor: n }, formula.unit))}
      {preview?.materials.map(i => {
        const stock = availability?.materials.find(m => m.item_id === i.item_id);
        const pickupLocations = sources.filter(l => l.product_id === i.product_id);
        const pickupId = value?.material_locations?.[String(i.item_id)] || "";
        const solePickup = pickupLocations.length === 1 && (!pickupId || pickupId === pickupLocations[0].location_id);
        return <div key={i.item_id} role="group" aria-label={`วัตถุดิบ ${i.sku}`} className="rounded-lg bg-white px-3 py-2.5 text-sm text-m3-grey-800 shadow-[0_0_0_1px_rgba(145,158,171,0.16)]">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="min-w-0 flex-1 font-semibold">{i.sku} · {i.name}</p>
            {masterFormula && <div className="flex gap-2">
              <button type="button" aria-label={`แก้ไขวัตถุดิบ ${i.sku}`} disabled={disabled || savingRoles} onClick={() => openManager({ type: "edit-material", itemId: i.item_id })} className="m3-btn m3-btn-sm m3-btn-outline">แก้ไข</button>
              <button type="button" aria-label={`ลบวัตถุดิบ ${i.sku}`} disabled={disabled || savingRoles} onClick={() => openManager({ type: "delete-material", itemId: i.item_id })} className="m3-btn m3-btn-sm text-m3-error-dark">ลบ</button>
            </div>}
          </div>
          {!i.product_id && <p className="text-xs font-semibold text-m3-error-dark">ยังจับคู่ทะเบียนวัตถุดิบไม่ได้ กดแก้ไขเพื่อเลือกรหัสที่ถูกต้อง</p>}
          <p className="text-xs text-m3-grey-600">{!i.role_confirmed ? "ยังไม่ระบุหลัก/รอง" : i.is_primary === 1 ? "ตัวหลัก" : "ตัวรอง"} · ใช้ {i.stock_qty ?? "—"} {i.stock_unit}</p>
          {!formula.items.find(m => m.item_id === i.item_id)?.role_confirmed && <label className="mt-1 block text-xs">หลัก / รอง
            <select aria-label={`หลัก / รอง ${i.sku}`} disabled={disabled || savingRoles} value={value?.material_roles?.[String(i.item_id)] ?? ""} onChange={e => { setRolesSaved(false); setRolesError(null); onChange({ ...value!, material_roles: { ...value?.material_roles, [String(i.item_id)]: Number(e.target.value) as 0 | 1 } }, formula.unit); }} className="ml-2 h-9 px-2 rounded-lg border border-[rgba(145,158,171,0.32)] bg-white text-sm text-m3-grey-800 focus:border-m3-grey-800 focus:ring-1 focus:ring-m3-grey-800 focus:outline-none disabled:bg-m3-grey-100 disabled:text-m3-grey-500">
              <option value="" disabled>ระบุประเภท</option><option value="1">ตัวหลัก</option><option value="0">ตัวรอง</option>
            </select>
          </label>}
          {i.product_id && i.unit !== i.stock_unit && factorInput(i.unit, i.stock_unit, value?.material_factors?.[String(i.item_id)], n => {
            const factors = { ...value?.material_factors }; if (n === undefined) delete factors[String(i.item_id)]; else factors[String(i.item_id)] = n;
            onChange({ ...value!, material_factors: factors }, formula.unit);
          })}
          {i.product_id && <div className="mt-2">
            {sourcesLoading ? <p className="text-xs text-m3-grey-500">กำลังโหลดจุดรับ…</p> : sourcesError ? <p className="text-xs text-m3-error-dark">โหลดจุดรับไม่สำเร็จ</p> : solePickup ? <p className="text-sm font-semibold">จุดรับ: {pickupLocations[0].location_code || pickupLocations[0].location_name}</p>
              : pickupLocations.length ? <label className="block text-xs font-semibold">จุดรับวัตถุดิบ
                <select aria-label={`จุดรับวัตถุดิบ ${i.sku}`} disabled={disabled || savingRoles} value={pickupLocations.some(l => l.location_id === pickupId) ? pickupId : ""}
                  onChange={e => onChange({ ...value!, material_locations: { ...value?.material_locations, [String(i.item_id)]: e.target.value } }, formula.unit)} className={`mt-1 h-10 ${m3Cls.input}`}>
                  <option value="" disabled>เลือกจุดรับ</option>
                  {pickupLocations.map(l => <option key={l.location_id} value={l.location_id}>{l.location_code || l.location_name} · พร้อมใช้ {l.available ?? l.quantity} {i.stock_unit}</option>)}
                </select>
              </label> : <p className="text-xs text-m3-grey-500">จุดรับ: ไม่มีสต็อก</p>}
          </div>}
          {stock && <p className={stock.shortage ? "text-xs font-bold text-m3-error-dark" : "text-xs text-m3-grey-600"}>พร้อมใช้ {stock.available} {i.stock_unit}{stock.shortage ? ` · ขาด ${stock.shortage}` : ""}</p>}
        </div>;
      })}
      {masterFormula && <button type="button" disabled={disabled || savingRoles} onClick={() => openManager({ type: "add-material" })} className="m3-btn m3-btn-outline">เพิ่มวัตถุดิบ</button>}
      {Object.keys(pendingRoles).length > 0 && <div className="space-y-1.5">
        <button type="button" disabled={disabled || savingRoles} onClick={saveRoles} className={m3Cls.btnPrimary}>
          <M3SubmitLabel submitting={savingRoles}>บันทึกประเภท</M3SubmitLabel>
        </button>
        <p className="text-xs text-m3-grey-600">บันทึกประเภทหลัก/รองไว้ในสูตรสำหรับการใช้งานครั้งถัดไป</p>
      </div>}
      {rolesSaved && <p role="status" className="text-xs font-semibold text-m3-primary-dark">บันทึกประเภทวัตถุดิบแล้ว</p>}
      {rolesError && <p role="alert" className="text-xs font-semibold text-m3-error-dark">{rolesError}</p>}
      {availability?.main_capacity != null && <p className="text-sm font-bold text-m3-primary-dark">ผลิตได้ {availability.main_capacity} {formula.unit}</p>}
    </>}
    </>}
  </section>;
}

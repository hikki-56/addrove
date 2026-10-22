"use client";

import { useEffect, useMemo, useState } from "react";
import type { ProductionMaterialActual, ProductionMaterialPlan } from "@/types/production-bom";
import { isValidProductionStockQuantity, previewProductionBom } from "@/lib/production-bom";
import MaterialStockLocations from "./MaterialStockLocations";

export interface MaterialReportValue {
  payload: { materials: ProductionMaterialActual[]; receipt_location_id: string; material_reason: string };
  error: string | null;
}

interface Props { plan: ProductionMaterialPlan; good: number; defect: number; disabled: boolean; onChange: (value: MaterialReportValue) => void }
type Edit = { used?: string; scrap?: string; cause?: string };

export default function MaterialReportFields({ plan, good, defect, disabled, onChange }: Props) {
  const [edits, setEdits] = useState<Record<number, Edit>>({});
  const [location, setLocation] = useState("");
  const [reason, setReason] = useState("");
  const [locations, setLocations] = useState<Array<{ location_id: string; location_code: string }>>([]);
  const [locationError, setLocationError] = useState<string | null>(null);
  const preview = useMemo(() => previewProductionBom(plan.snapshot, good + defect, plan.selection, { allowZero: true }), [plan, good, defect]);
  useEffect(() => {
    let live = true;
    fetch("/api/production/locations", { cache: "no-store" }).then(r => r.json()).then(json => {
      if (!live) return;
      if (!json.success) throw new Error(json.message || "โหลดตำแหน่งเก็บไม่สำเร็จ");
      setLocations(json.data);
    }).catch(e => { if (live) setLocationError(e instanceof Error ? e.message : "โหลดตำแหน่งเก็บไม่สำเร็จ"); });
    return () => { live = false; };
  }, []);
  const value = useMemo(() => {
    let error = preview.issues[0] || null;
    const materials = preview.materials.map(i => {
      const expected = good + defect > 0 ? i.stock_qty || 0 : 0;
      const used = edits[i.item_id]?.used ?? String(expected);
      const scrap = edits[i.item_id]?.scrap ?? "0";
      const cause = edits[i.item_id]?.cause || "";
      const usedQty = used.trim() === "" ? NaN : Number(used), scrapQty = scrap.trim() === "" ? NaN : Number(scrap);
      if (!isValidProductionStockQuantity(usedQty, i.stock_unit) || !isValidProductionStockQuantity(scrapQty, i.stock_unit)) error ||= `${i.sku}: จำนวนไม่ถูกต้องตามหน่วย ${i.stock_unit}`;
      if (scrapQty > 0 && !cause.trim()) error ||= `${i.sku}: ต้องระบุสาเหตุวัตถุดิบเสีย`;
      return { item_id: i.item_id, used_qty: usedQty, scrap_qty: scrapQty, scrap_cause: cause.trim() };
    });
    if (good > 0 && !location) error ||= "กรุณาเลือกตำแหน่งเก็บสินค้าดี";
    if (good > 0 && locationError) error ||= locationError;
    const changed = materials.some((m, index) => m.used_qty !== (good + defect > 0 ? preview.materials[index].stock_qty || 0 : 0));
    if (changed && !reason.trim()) error ||= "ยอดใช้จริงต่างจากสูตร ต้องระบุเหตุผล";
    return { payload: { materials, receipt_location_id: location, material_reason: reason.trim() }, error };
  }, [preview, edits, good, defect, location, locationError, reason]);
  useEffect(() => { onChange(value); }, [value, onChange]);
  const edit = (id: number, change: Edit) => setEdits(old => ({ ...old, [id]: { ...old[id], ...change } }));
  return <section className="space-y-3 rounded-lg border border-slate-200 p-3">
    <h3 className="text-sm font-bold">วัตถุดิบใช้จริง · {plan.snapshot.bom_id}</h3>
    {preview.materials.map(i => {
      const expected = good + defect > 0 ? i.stock_qty || 0 : 0;
      return <div key={i.item_id} className="space-y-2 rounded bg-slate-50 p-2 text-xs">
        <p className="font-bold">{i.sku} · {i.name}</p>
        <p>ตามสูตร {expected} {i.stock_unit}</p>
        <MaterialStockLocations locations={plan.stock_locations} productId={i.product_id} unit={i.stock_unit} />
        <div className="grid grid-cols-2 gap-2">
          <label>ใช้ผลิต ({i.stock_unit})<input aria-label={`ใช้ผลิต ${i.sku}`} type="number" min="0" step="any" disabled={disabled} value={edits[i.item_id]?.used ?? String(expected)} onChange={e => edit(i.item_id, { used: e.target.value })} className="mt-1 w-full rounded border p-2" /></label>
          <label>เสียก่อนประกอบ ({i.stock_unit})<input aria-label={`เสียก่อนประกอบ ${i.sku}`} type="number" min="0" step="any" disabled={disabled} value={edits[i.item_id]?.scrap ?? "0"} onChange={e => edit(i.item_id, { scrap: e.target.value })} className="mt-1 w-full rounded border p-2" /></label>
        </div>
        {Number(edits[i.item_id]?.scrap || 0) > 0 && <label className="block">สาเหตุวัตถุดิบเสีย<input disabled={disabled} value={edits[i.item_id]?.cause || ""} onChange={e => edit(i.item_id, { cause: e.target.value })} className="mt-1 w-full rounded border p-2" /></label>}
      </div>;
    })}
    <label className="block text-xs">เหตุผลเมื่อใช้ต่างจากสูตร<input disabled={disabled} value={reason} onChange={e => setReason(e.target.value)} className="mt-1 w-full rounded border p-2" /></label>
    {good > 0 && <label className="block text-sm font-bold">ตำแหน่งเก็บสินค้าดี · โกดัง 2
      <select disabled={disabled} value={location} onChange={e => setLocation(e.target.value)} className="mt-1 w-full rounded border bg-white p-2"><option value="">เลือกตำแหน่งเก็บ</option>{locations.map(l => <option key={l.location_id} value={l.location_id}>{l.location_code}</option>)}</select>
      <span className="mt-1 block text-xs font-normal">รับเข้า {Math.round(good * (preview.fg_factor || 0) * 1000) / 1000} {plan.snapshot.stock_unit}</span>
    </label>}
    {value.error && <p role="alert" className="text-xs font-bold text-rose-700">{value.error}</p>}
  </section>;
}

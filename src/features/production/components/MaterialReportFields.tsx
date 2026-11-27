"use client";

import { useEffect, useMemo, useState } from "react";
import type { ProductionMaterialActual, ProductionMaterialPlan } from "@/types/production-bom";
import type { ReportLocationOption } from "@/features/production/lib/report-locations";
import { isValidProductionStockQuantity, previewProductionBom } from "@/lib/production-bom";
import ReasonSelect from "./ReasonSelect";

export interface MaterialReportValue {
  payload: { materials: ProductionMaterialActual[]; receipt_location_id: string; material_reason: string };
  error: string | null;
}

interface Props { plan: ProductionMaterialPlan; good: number; defect: number; disabled: boolean; onChange: (value: MaterialReportValue) => void; compact?: boolean; dailyClose?: boolean; showErrors?: boolean; locations?: ReportLocationOption[]; locationError?: string | null }
type Edit = { used?: string; scrap?: string; cause?: string };

export default function MaterialReportFields({ plan, good, defect, disabled, onChange, compact = false, dailyClose = false, showErrors = true, locations = [], locationError = null }: Props) {
  const [edits, setEdits] = useState<Record<number, Edit>>({});
  const [location, setLocation] = useState("");
  const [reason, setReason] = useState("");
  const preview = useMemo(() => previewProductionBom(plan.snapshot, good, plan.selection, { allowZero: true }), [plan, good]);
  const value = useMemo(() => {
    let error = preview.issues[0] || null;
    const materials = preview.materials.map(i => {
      const expected = good > 0 ? i.stock_qty || 0 : 0;
      const used = dailyClose ? String(expected) : edits[i.item_id]?.used ?? String(expected);
      const scrap = edits[i.item_id]?.scrap ?? "0";
      const cause = edits[i.item_id]?.cause || "";
      const usedQty = used.trim() === "" ? NaN : Number(used), scrapQty = scrap.trim() === "" ? NaN : Number(scrap);
      if (!isValidProductionStockQuantity(usedQty, i.stock_unit) || !isValidProductionStockQuantity(scrapQty, i.stock_unit)) error ||= `${i.sku}: จำนวนไม่ถูกต้องตามหน่วย ${i.stock_unit}`;
      if (scrapQty > 0 && !cause.trim()) error ||= `เลือกสาเหตุ: ${i.sku}`;
      return { item_id: i.item_id, used_qty: usedQty, scrap_qty: scrapQty, scrap_cause: cause.trim() };
    });
    if (good > 0 && !location) error ||= "กรุณาเลือกที่เก็บสินค้า";
    if (good > 0 && locationError) error ||= locationError;
    if (dailyClose && defect > 0 && !materials.some(m => m.scrap_qty > 0)) error ||= "ใส่จำนวนเสียวัตถุดิบ";
    const changed = materials.some((m, index) => m.used_qty !== (good > 0 ? preview.materials[index].stock_qty || 0 : 0));
    if (changed && !reason.trim()) error ||= "ใช้วัตถุดิบไม่ตรงสูตร กรุณาบอกเหตุผล";
    return { payload: { materials, receipt_location_id: location, material_reason: reason.trim() }, error };
  }, [preview, edits, good, location, locationError, reason, dailyClose, defect]);
  useEffect(() => { onChange(value); }, [value, onChange]);
  const edit = (id: number, change: Edit) => setEdits(old => ({ ...old, [id]: { ...old[id], ...change } }));
  const materialFields = <>
    {preview.materials.map(i => {
      const expected = good > 0 ? i.stock_qty || 0 : 0;
      const sourceId = plan.selection.material_locations?.[String(i.item_id)];
      const source = plan.stock_locations?.find(l => l.product_id === i.product_id && l.location_id === sourceId);
      const pickup = source && <p className="mt-1 text-xs font-semibold text-m3-primary-dark">จุดรับ: {source.location_code || source.location_name}</p>;
      if (dailyClose) return <div key={i.item_id} role="group" aria-label={`วัตถุดิบ ${i.sku}`} className="space-y-2 rounded-xl border border-[rgba(145,158,171,0.2)] bg-white p-3">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{i.name || i.sku}</p><p className="mt-1 text-xs text-m3-grey-500">{i.sku} · ใช้ {expected} {i.stock_unit}</p>{pickup}</div>
          <label className="w-24 shrink-0 text-xs font-semibold">เสีย ({i.stock_unit})
            <input aria-label={`วัตถุดิบเสีย ${i.sku}`} type="number" inputMode="decimal" min="0" step="any" disabled={disabled} value={edits[i.item_id]?.scrap ?? "0"}
              onChange={e => edit(i.item_id, { scrap: e.target.value })} className="mt-1 h-11 w-full rounded-lg border border-[rgba(145,158,171,0.32)] px-2 text-right text-lg font-bold tabular-nums" />
          </label>
        </div>
        {Number(edits[i.item_id]?.scrap || 0) > 0 && <ReasonSelect label="สาเหตุ" ariaLabel={`สาเหตุวัตถุดิบเสีย ${i.sku}`} value={edits[i.item_id]?.cause || ""}
          options={["ชำรุด", "แตก", "ประกอบเสีย"]} disabled={disabled} onChange={cause => edit(i.item_id, { cause })} />}
      </div>;
      return <div key={i.item_id} role="group" aria-label={`วัตถุดิบ ${i.sku}`} className="space-y-3 rounded-xl bg-white p-4 text-xs shadow-[0_0_0_1px_rgba(145,158,171,0.2)]">
        <div><p className="text-sm font-bold text-m3-grey-800">{i.name || i.sku}</p><p className="mt-1 text-m3-grey-500">{i.sku} · {i.is_primary === 1 ? "ตัวหลัก" : "ตัวรอง"}</p>{pickup}</div>
        <div className="grid items-end gap-3 sm:grid-cols-2">
          {dailyClose ? <div className="rounded-lg bg-m3-grey-100 p-3"><p className="text-m3-grey-600">ใช้ผลิตสินค้าดีตามสูตร</p><p className="mt-1 text-lg font-bold tabular-nums">{expected} <span className="text-xs font-normal">{i.stock_unit}</span></p></div>
            : <label>ใช้ได้ ({i.stock_unit})<input aria-label={`ใช้ผลิต ${i.sku}`} type="number" min="0" step="any" disabled={disabled} value={edits[i.item_id]?.used ?? String(expected)} onChange={e => edit(i.item_id, { used: e.target.value })} className="mt-1.5 w-full px-3 py-2 rounded-lg border border-[rgba(145,158,171,0.32)] bg-white text-sm text-m3-grey-800 focus:border-m3-grey-800 focus:ring-1 focus:ring-m3-grey-800 focus:outline-none disabled:bg-m3-grey-100 disabled:text-m3-grey-500" /></label>}
          <label className="font-semibold text-m3-grey-800">เสียเท่าไหร่ ({i.stock_unit})<input aria-label={dailyClose ? `วัตถุดิบเสีย ${i.sku}` : `เสียก่อนประกอบ ${i.sku}`} type="number" min="0" step="any" disabled={disabled} value={edits[i.item_id]?.scrap ?? "0"} onChange={e => edit(i.item_id, { scrap: e.target.value })} className="mt-1.5 h-11 w-full rounded-lg border border-[rgba(145,158,171,0.32)] bg-white px-3 text-right text-lg font-bold tabular-nums text-m3-grey-800 focus:border-m3-grey-800 focus:ring-1 focus:ring-m3-grey-800 focus:outline-none disabled:bg-m3-grey-100 disabled:text-m3-grey-500" /></label>
        </div>
        {(() => { const u = dailyClose ? expected : Number(edits[i.item_id]?.used ?? expected), sc = Number(edits[i.item_id]?.scrap ?? 0); return Number.isFinite(u + sc) ? <p className="text-sm font-bold text-m3-grey-800">รวมตัดสต็อก {Math.round((u + sc) * 1e6) / 1e6} {i.stock_unit} <span className="text-xs font-normal text-m3-grey-500">(ใช้ผลิตสินค้าดี + วัตถุดิบเสีย)</span></p> : null; })()}
        {Number(edits[i.item_id]?.scrap || 0) > 0 && <label className="block">เสียเพราะอะไร<input aria-label={`สาเหตุวัตถุดิบเสีย ${i.sku}`} disabled={disabled} value={edits[i.item_id]?.cause || ""} onChange={e => edit(i.item_id, { cause: e.target.value })} className="mt-1.5 w-full px-3 py-2 rounded-lg border border-[rgba(145,158,171,0.32)] bg-white text-sm text-m3-grey-800 focus:border-m3-grey-800 focus:ring-1 focus:ring-m3-grey-800 focus:outline-none disabled:bg-m3-grey-100 disabled:text-m3-grey-500" /></label>}
      </div>;
    })}
    {!dailyClose && <label className="block text-xs">ถ้าใช้ไม่ตรงสูตร บอกเหตุผล<input disabled={disabled} value={reason} onChange={e => setReason(e.target.value)} className="mt-1.5 w-full px-3 py-2 rounded-lg border border-[rgba(145,158,171,0.32)] bg-white text-sm text-m3-grey-800 focus:border-m3-grey-800 focus:ring-1 focus:ring-m3-grey-800 focus:outline-none disabled:bg-m3-grey-100 disabled:text-m3-grey-500" /></label>}
  </>;
  const locationField = (compact || good > 0) && <label className="block text-sm font-semibold">ผลิตได้จริงเก็บที่
      <select disabled={disabled} value={location} onChange={e => setLocation(e.target.value)} className="mt-1.5 h-10 w-full px-3 tabular-nums rounded-lg border border-[rgba(145,158,171,0.32)] bg-white text-sm text-m3-grey-800 focus:border-m3-grey-800 focus:ring-1 focus:ring-m3-grey-800 focus:outline-none disabled:bg-m3-grey-100 disabled:text-m3-grey-500"><option value="">เลือกที่เก็บ</option>{locations.map(l => <option key={l.location_id} value={l.location_id}>{l.label || l.location_code}</option>)}</select>
    </label>;
  return <section className="space-y-3">
    {compact ? <>
      {locationField}
      {dailyClose ? <div className="space-y-3">
        <h3 className="text-sm font-semibold">วัตถุดิบ</h3>
        {materialFields}
      </div> : <details className="rounded-lg bg-m3-grey-100 p-3">
        <summary className="cursor-pointer text-sm font-bold">วัตถุดิบที่ใช้ · {preview.materials.length} รายการ</summary>
        <div className="mt-3 space-y-3">{materialFields}</div>
      </details>}
    </> : <><h3 className="text-sm font-bold">วัตถุดิบที่ใช้</h3>{materialFields}{locationField}</>}
    {showErrors && value.error && <p role="alert" className="text-xs font-bold text-m3-error-dark">{value.error}</p>}
  </section>;
}

"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { M3Banner, M3Loading, M3SubmitLabel, m3Cls } from "@/components/ui/m3";
import { validateBomDraft, type BomEditorFormula, type BomEditorInput, type BomEditorItem } from "@/lib/bom-editor";
import type { BomManagementData } from "@/types/bom-management";
import BomEditStatus from "./BomEditStatus";

export type BomManagerAction = { type: "edit-formula" | "new-formula" | "delete-formula" | "add-material" }
  | { type: "edit-material" | "delete-material"; itemId: number };

interface Props {
  productId: string;
  initialBomId?: string;
  initialAction: BomManagerAction;
  onClose: () => void;
  onChanged: (data: BomManagementData, bomId?: string) => void;
}

interface DraftItem extends Omit<BomEditorItem, "qty" | "waste_percentage"> { key: string; qty: string; waste_percentage: string }
interface Draft { bom_id?: string; revision?: string; unit: string; base_qty: string; items: DraftItem[] }
let itemSequence = 0;
const newItem = (): DraftItem => ({ key: `new-${++itemSequence}`, sku: "", name: "", qty: "1", unit: "ชิ้น", waste_percentage: "0", is_primary: 1 });
const draftOf = (f: BomEditorFormula): Draft => ({ bom_id: f.bom_id, revision: f.revision, unit: f.unit, base_qty: String(f.base_qty),
  items: f.items.map(i => ({ ...i, key: `item-${i.item_id}`, qty: String(i.qty), waste_percentage: String(i.waste_percentage) })) });

export default function BomFormulaManager({ productId, initialBomId, initialAction, onClose, onChanged }: Props) {
  const [data, setData] = useState<BomManagementData | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [editingBase, setEditingBase] = useState(false);
  const [reload, setReload] = useState(0);
  const request = useRef<AbortController | null>(null);
  const listId = useId();

  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setErrors([]);
    fetch(`/api/production/boms/manage?product_id=${encodeURIComponent(productId)}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const json = await response.json();
        if (!response.ok || !json.success) throw new Error(json.message || "โหลดสูตรไม่สำเร็จ");
        if (controller.signal.aborted) return;
        const current = json.data as BomManagementData;
        setData(current);
        const selected = initialAction.type === "new-formula" ? undefined : current.formulas.find(f => f.bom_id === initialBomId) ?? current.formulas[0];
        const next = selected ? draftOf(selected) : { unit: current.product.base_unit, base_qty: "1", items: [newItem()] };
        if (selected && initialAction.type === "add-material") next.items.push(newItem());
        setDraft(next);
        setEditingBase(!selected || initialAction.type === "edit-formula");
        setConfirmDelete(!!selected && initialAction.type === "delete-formula");
        setEditingKey(!selected || initialAction.type === "add-material" ? next.items.at(-1)?.key ?? null
          : initialAction.type === "edit-material" ? next.items.find(i => i.item_id === initialAction.itemId)?.key ?? null : null);
        setDeletingKey(initialAction.type === "delete-material" ? next.items.find(i => i.item_id === initialAction.itemId)?.key ?? null : null);
      })
      .catch(error => { if (!controller.signal.aborted) setErrors([error instanceof Error ? error.message : "โหลดสูตรไม่สำเร็จ"]); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); request.current?.abort(); };
  }, [productId, initialBomId, initialAction, reload]);

  const options = useMemo(() => data?.materials.map(p => <option key={p.product_id} value={p.sku} label={`${p.product_name} · ${p.barcode}`} />), [data]);
  const patchItem = (key: string, patch: Partial<DraftItem>) => setDraft(current => current && ({ ...current, items: current.items.map(i => i.key === key ? { ...i, ...patch } : i) }));
  const changeSku = (key: string, value: string) => {
    const query = value.trim().toLowerCase();
    const product = data?.materials.find(p => p.sku.toLowerCase() === query) ?? data?.materials.find(p => p.barcode && p.barcode.toLowerCase() === query);
    patchItem(key, product ? { sku: product.sku, name: product.product_name, unit: product.base_unit } : { sku: value, name: "" });
  };
  const choose = (id: string) => {
    if (!data) return;
    const formula = data.formulas.find(f => f.bom_id === id);
    const next = formula ? draftOf(formula) : { unit: data.product.base_unit, base_qty: "1", items: [newItem()] };
    setDraft(next);
    setEditingKey(formula ? null : next.items[0].key);
    setDeletingKey(null);
    setEditingBase(!formula);
    setErrors([]);
    setConfirmDelete(false);
  };

  const submit = async (remove = false) => {
    if (!draft || busy || !data) return;
    const input: BomEditorInput = {
      bom_id: draft.bom_id ?? "new", revision: draft.revision ?? "new", unit: draft.unit, base_qty: Number(draft.base_qty),
      items: draft.items.map(i => ({ ...(i.item_id ? { item_id: i.item_id } : {}), sku: i.sku.trim(), qty: i.qty.trim() ? Number(i.qty) : NaN,
        unit: i.unit, waste_percentage: i.waste_percentage.trim() ? Number(i.waste_percentage) : 0, is_primary: i.is_primary })),
    };
    const issues = remove ? [] : validateBomDraft(input);
    setErrors(issues);
    if (issues.length) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    try {
      const response = await fetch("/api/production/boms/manage", {
        method: remove ? "DELETE" : draft.bom_id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify(remove ? { product_id: productId, bom_id: draft.bom_id, revision: draft.revision } : { product_id: productId, ...input }),
      });
      const json = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok || !json.success) throw new Error(json.message || "บันทึกสูตรไม่สำเร็จ");
      if (json.data.product.product_id !== data.product.product_id) throw new Error("ข้อมูลสินค้าเปลี่ยน กรุณาเปิดจัดการสูตรใหม่");
      onChanged(json.data, json.bom_id);
    } catch (error) {
      if (!controller.signal.aborted) setErrors([error instanceof Error ? error.message : "บันทึกสูตรไม่สำเร็จ"]);
    } finally { if (!controller.signal.aborted) setBusy(false); }
  };

  return <section aria-label="จัดการสูตร BOM" className="space-y-4 rounded-xl border border-[rgba(145,158,171,0.24)] bg-white p-3 sm:p-4">
    <div className="flex items-start justify-between gap-3">
      <div><h3 className="text-sm font-bold">จัดการสูตร BOM</h3><p className="mt-1 text-xs text-m3-grey-600">ใช้เป็นสูตรกลางสำหรับงานผลิตถัดไป</p></div>
      <button type="button" disabled={busy} onClick={onClose} className="m3-btn m3-btn-sm m3-btn-outline">ปิดการจัดการสูตร</button>
    </div>
    {loading ? <M3Loading label="กำลังโหลดสูตร…" /> : data && draft && <>
      <p className="text-xs font-semibold">{data.product.sku} · {data.product.product_name}</p>
      {draft.bom_id ? <BomEditStatus editedAt={data.formulas.find(f => f.bom_id === draft.bom_id)?.edited_at} /> : <p className="text-xs text-m3-grey-500">สูตรใหม่ · ยังไม่ได้บันทึก</p>}
      <label className="block text-xs font-semibold">สูตรที่ต้องการจัดการ
        <select aria-label="สูตรที่ต้องการจัดการ" disabled={busy} value={draft.bom_id ?? ""} onChange={e => choose(e.target.value)} className={`mt-1 ${m3Cls.input}`}>
          {data.formulas.map(f => <option key={f.bom_id} value={f.bom_id}>{f.bom_id} · {f.items.length} วัตถุดิบ · {f.edited_at ? "แก้ไขแล้ว" : "ยังไม่แก้ไข"}</option>)}
          <option value="">สูตรใหม่</option>
        </select>
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => choose("")} className="m3-btn m3-btn-sm m3-btn-outline">เพิ่มสูตรใหม่</button>
        {draft.bom_id && <button type="button" disabled={busy} onClick={() => setEditingBase(v => !v)} className="m3-btn m3-btn-sm m3-btn-outline">แก้ไขฐานสูตร</button>}
        {draft.bom_id && <button type="button" disabled={busy} onClick={() => setConfirmDelete(true)} className="m3-btn m3-btn-sm text-m3-error-dark">ลบสูตร</button>}
      </div>
      {confirmDelete ? <M3Banner tone="warning">
        <p className="font-semibold">ลบสูตร {draft.bom_id} ใช่ไหม?</p>
        <p className="mt-1 text-xs">สูตรนี้จะไม่แสดงให้เลือกสำหรับงานใหม่ ใบงานเดิมยังเก็บสูตรที่ใช้อยู่ไว้</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => void submit(true)} className={m3Cls.btnDanger}><M3SubmitLabel submitting={busy}>ยืนยันลบสูตร</M3SubmitLabel></button>
          <button type="button" disabled={busy} onClick={() => setConfirmDelete(false)} className={m3Cls.btnCancel}>กลับไปแก้ไข</button>
        </div>
      </M3Banner> : <>
        {editingBase ? <div className="grid grid-cols-2 gap-3">
          <label className="text-xs font-semibold">จำนวนฐานของสูตร<input aria-label="จำนวนฐานของสูตรที่จัดการ" inputMode="decimal" disabled={busy} value={draft.base_qty} onChange={e => setDraft({ ...draft, base_qty: e.target.value })} className={`mt-1 ${m3Cls.input}`} /></label>
          <label className="text-xs font-semibold">หน่วยสินค้าสำเร็จรูป<input aria-label="หน่วยสินค้าของสูตรที่จัดการ" disabled={busy} value={draft.unit} onChange={e => setDraft({ ...draft, unit: e.target.value })} className={`mt-1 ${m3Cls.input}`} /></label>
        </div> : <p className="text-xs text-m3-grey-600">ฐานสูตร {draft.base_qty} {draft.unit}</p>}
        <datalist id={listId}>{options}</datalist>
        <div className="space-y-3">
          {draft.items.map((item, index) => <fieldset key={item.key} aria-label={`วัตถุดิบในสูตร ${index + 1}`} className="space-y-2 rounded-lg bg-white px-3 py-2.5 text-sm text-m3-grey-800 shadow-[0_0_0_1px_rgba(145,158,171,0.16)]">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1"><p className="font-semibold">{item.sku ? `${item.sku} · ${item.name || "ยังไม่พบชื่อในทะเบียน"}` : "วัตถุดิบใหม่"}</p>
                <p className="text-xs text-m3-grey-600">{item.is_primary === 1 ? "ตัวหลัก" : "ตัวรอง"} · ใช้ {item.qty} {item.unit} ต่อฐานสูตร{Number(item.waste_percentage) > 0 ? ` · สูญเสีย ${item.waste_percentage}%` : ""}</p>
              </div>
              <div className="flex gap-2">
                <button type="button" aria-label={`แก้ไขวัตถุดิบ ${item.sku || index + 1}`} disabled={busy} onClick={() => { setEditingKey(item.key); setDeletingKey(null); }} className="m3-btn m3-btn-sm m3-btn-outline">แก้ไข</button>
                <button type="button" aria-label={`ลบวัตถุดิบ ${item.sku || index + 1}`} disabled={busy} onClick={() => setDeletingKey(item.key)} className="m3-btn m3-btn-sm text-m3-error-dark">ลบ</button>
              </div>
            </div>
            {deletingKey === item.key && <div className="space-y-2 rounded-lg bg-m3-grey-100 p-3">
              <p className="text-xs font-semibold">ลบวัตถุดิบนี้ออกจากสูตรใช่ไหม? กดบันทึกสูตรเพื่อยืนยันการเปลี่ยนแปลง</p>
              <div className="flex gap-2"><button type="button" disabled={busy} onClick={() => { setDraft({ ...draft, items: draft.items.filter(i => i.key !== item.key) }); setDeletingKey(null); }} className="m3-btn m3-btn-sm text-m3-error-dark">ยืนยันลบวัตถุดิบ</button>
                <button type="button" disabled={busy} onClick={() => setDeletingKey(null)} className="m3-btn m3-btn-sm m3-btn-outline">ยกเลิก</button></div>
            </div>}
            {editingKey === item.key && <>
            <input aria-label="รหัสวัตถุดิบในสูตร" list={listId} autoComplete="off" placeholder="พิมพ์ SKU ชื่อ หรือบาร์โค้ด" disabled={busy} value={item.sku} onChange={e => changeSku(item.key, e.target.value)} className={m3Cls.input} />
            <p className="text-xs text-m3-grey-600">{item.name || "เลือกสินค้าจากรายการแนะนำ"}</p>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs">จำนวนใช้ต่อฐานสูตร<input inputMode="decimal" disabled={busy} value={item.qty} onChange={e => patchItem(item.key, { qty: e.target.value })} className={`mt-1 ${m3Cls.input}`} /></label>
              <label className="text-xs">หน่วยวัตถุดิบ<input disabled={busy} value={item.unit} onChange={e => patchItem(item.key, { unit: e.target.value })} className={`mt-1 ${m3Cls.input}`} /></label>
              <label className="text-xs">สูญเสีย %<input inputMode="decimal" disabled={busy} value={item.waste_percentage} onChange={e => patchItem(item.key, { waste_percentage: e.target.value })} className={`mt-1 ${m3Cls.input}`} /></label>
              <label className="text-xs">หลัก / รอง<select disabled={busy} value={item.is_primary} onChange={e => patchItem(item.key, { is_primary: e.target.value === "1" ? 1 : 0 })} className={`mt-1 ${m3Cls.input}`}><option value={1}>ตัวหลัก</option><option value={0}>ตัวรอง</option></select></label>
            </div>
            <button type="button" disabled={busy} onClick={() => setEditingKey(null)} className="m3-btn m3-btn-sm m3-btn-outline">เสร็จสิ้น</button>
            </>}
          </fieldset>)}
        </div>
        <button type="button" disabled={busy} onClick={() => { const item = newItem(); setDraft({ ...draft, items: [...draft.items, item] }); setEditingKey(item.key); setDeletingKey(null); }} className="m3-btn m3-btn-outline">เพิ่มวัตถุดิบ</button>
        <div className="flex justify-end gap-2">
          <button type="button" disabled={busy} onClick={onClose} className={m3Cls.btnCancel}>ยกเลิกแก้สูตร</button>
          <button type="button" disabled={busy} onClick={() => void submit()} className={m3Cls.btnPrimary}><M3SubmitLabel submitting={busy}>{draft.bom_id ? "บันทึกสูตร" : "บันทึกสูตรใหม่"}</M3SubmitLabel></button>
        </div>
      </>}
    </>}
    {!!errors.length && <M3Banner tone="error"><ul className="list-disc pl-4">{errors.map(error => <li key={error}>{error}</li>)}</ul><button type="button" disabled={busy || loading} onClick={() => setReload(n => n + 1)} className="mt-2 text-xs font-bold underline">โหลดสูตรล่าสุด</button></M3Banner>}
  </section>;
}

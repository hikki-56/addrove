"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTabAuth } from "@/context/TabAuthContext";
import { M3Banner, M3Empty, M3ErrorState, M3Field, M3IconCircle, M3Loading, m3Cls } from "@/components/ui/m3";
import { SolarAddLine, SolarCloseCircle, SolarDangerCircle, SolarMagnifier, SolarPen } from "@/components/icons";
import { canEditBom, filterBomFormulas, validateBomDraft, type BomEditorFormula, type BomEditorItem } from "@/lib/bom-editor";

// แก้ไขสูตร BOM — เฉพาะบัญชี BOM_EDITOR_EMAIL (เซิร์ฟเวอร์ตรวจซ้ำที่ /api/production/boms/editor)
interface DraftItem extends Omit<BomEditorItem, "qty" | "waste_percentage"> { key: string; qty: string; waste_percentage: string }
interface Draft { unit: string; base_qty: string; items: DraftItem[] }

let keySeq = 0;
const toDraft = (f: BomEditorFormula): Draft => ({
  unit: f.unit,
  base_qty: String(f.base_qty),
  items: f.items.map((i) => ({ ...i, key: `i${i.item_id ?? ++keySeq}`, qty: String(i.qty), waste_percentage: String(i.waste_percentage) })),
});

export default function BomFormulaEditorPage() {
  const { user, status } = useTabAuth();
  const allowed = canEditBom(user?.email);
  const [formulas, setFormulas] = useState<BomEditorFormula[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const res = await fetch("/api/production/boms/editor", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.message || "โหลดสูตรไม่สำเร็จ");
      setFormulas(json.data);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "โหลดสูตรไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (allowed) void load(); }, [allowed, load]);

  const visible = useMemo(() => filterBomFormulas(formulas, search), [formulas, search]);
  const selected = formulas.find((f) => f.bom_id === selectedId);

  const choose = (f: BomEditorFormula) => {
    setSelectedId(f.bom_id);
    setDraft(toDraft(f));
    setErrors([]);
    setMessage("");
  };

  const patchItem = (key: string, patch: Partial<DraftItem>) =>
    setDraft((d) => d && { ...d, items: d.items.map((i) => (i.key === key ? { ...i, ...patch } : i)) });

  const save = async () => {
    if (!selected || !draft) return;
    const input = {
      bom_id: selected.bom_id,
      revision: selected.revision,
      unit: draft.unit,
      base_qty: Number(draft.base_qty),
      items: draft.items.map(({ item_id, sku, unit, is_primary, qty, waste_percentage }) => ({
        ...(item_id === undefined ? {} : { item_id }), sku: sku.trim(), unit, is_primary,
        qty: qty.trim() === "" ? NaN : Number(qty), waste_percentage: waste_percentage.trim() === "" ? 0 : Number(waste_percentage),
      })),
    };
    const issues = validateBomDraft(input);
    setErrors(issues);
    setMessage("");
    if (issues.length) return;
    setSaving(true);
    try {
      const res = await fetch("/api/production/boms/editor", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.message || "บันทึกไม่สำเร็จ");
      setMessage("บันทึกสูตรเรียบร้อยแล้ว");
      await load();
      setSelectedId("");
      setDraft(null);
    } catch (err) {
      setErrors([err instanceof Error ? err.message : "บันทึกไม่สำเร็จ"]);
    } finally {
      setSaving(false);
    }
  };

  if (status === "loading") return <M3Loading label="กำลังตรวจสอบสิทธิ์…" />;
  if (!allowed) {
    return (
      <div className="w-full max-w-full pb-8">
        <h1 className="sr-only">แก้ไขสูตร BOM</h1>
        <div className="m3-card flex flex-col items-center px-6 py-16 text-center">
          <M3IconCircle tone="error"><SolarDangerCircle size={26} /></M3IconCircle>
          <p className="mt-4 text-lg font-bold text-m3-grey-800">403 · ไม่มีสิทธิ์เข้าถึง</p>
          <p className="mt-1 text-sm text-m3-grey-600">หน้านี้ใช้ได้เฉพาะบัญชีผู้ดูแลสูตรการผลิตเท่านั้น</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-full pb-10">
      <h1 className="mb-5 text-2xl font-bold text-m3-grey-800">แก้ไขสูตร BOM</h1>
      {message && <M3Banner tone="success" className="mb-4">{message}</M3Banner>}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <section className="m3-card flex min-h-0 flex-col p-4">
          <M3Field label="ค้นหาสูตร">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-m3-grey-500"><SolarMagnifier size={18} /></span>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="รหัสสูตร, SKU, ชื่อสินค้า หรือวัตถุดิบ" className={`${m3Cls.input} pl-9`} />
          </M3Field>
          <p className="mt-3 text-xs text-m3-grey-500">ทั้งหมด {formulas.length} สูตร · แสดง {visible.length}</p>
          <div className="mt-2 max-h-[65vh] overflow-y-auto">
            {loading ? <M3Loading label="กำลังโหลดสูตร…" /> : loadError ? (
              <M3ErrorState title={loadError} onRetry={() => void load()} />
            ) : visible.length === 0 ? <M3Empty title="ไม่พบสูตรที่ค้นหา" /> : visible.map((f) => (
              <button key={f.bom_id} type="button" onClick={() => choose(f)}
                className={`mb-1 w-full rounded-lg px-3 py-2.5 text-left transition-colors ${f.bom_id === selectedId ? "bg-[rgba(0,167,111,0.08)] text-m3-primary" : "hover:bg-[rgba(145,158,171,0.08)]"}`}>
                <div className="truncate text-sm font-semibold">{f.name}</div>
                <div className="truncate text-xs text-m3-grey-500">{f.bom_id} · {f.sku} · วัตถุดิบ {f.items.length} รายการ</div>
              </button>
            ))}
          </div>
        </section>

        <section className="m3-card p-4 sm:p-6">
          {!selected || !draft ? (
            <M3Empty title="เลือกสูตรทางซ้ายเพื่อแก้ไข" icon={<SolarPen size={28} />} />
          ) : (
            <div className="space-y-5">
              <div>
                <p className="text-lg font-bold text-m3-grey-800">{selected.name}</p>
                <p className="text-sm text-m3-grey-600">สูตร {selected.bom_id} · SKU {selected.sku}</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <M3Field label="จำนวนฐานของสูตร">
                  <input inputMode="decimal" value={draft.base_qty} onChange={(e) => setDraft({ ...draft, base_qty: e.target.value })} className={m3Cls.input} />
                </M3Field>
                <M3Field label="หน่วยสินค้าสำเร็จรูป">
                  <input value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} className={m3Cls.input} />
                </M3Field>
              </div>
              <div className="overflow-x-auto">
                <table className="m3-table min-w-[720px]">
                  <thead><tr><th>รหัสวัตถุดิบ (SKU)</th><th>ชื่อ</th><th>จำนวนใช้</th><th>หน่วย</th><th>สูญเสีย %</th><th>ประเภท</th><th /></tr></thead>
                  <tbody>
                    {draft.items.map((i) => (
                      <tr key={i.key}>
                        <td><input aria-label="รหัสวัตถุดิบ" value={i.sku} onChange={(e) => patchItem(i.key, { sku: e.target.value, name: undefined })} className={m3Cls.input} /></td>
                        <td className="text-sm text-m3-grey-600">{i.name || <span className="text-m3-grey-500">ระบบจะดึงชื่อจาก SKU</span>}</td>
                        <td><input aria-label="จำนวนใช้" inputMode="decimal" value={i.qty} onChange={(e) => patchItem(i.key, { qty: e.target.value })} className={`${m3Cls.input} w-24`} /></td>
                        <td><input aria-label="หน่วย" value={i.unit} onChange={(e) => patchItem(i.key, { unit: e.target.value })} className={`${m3Cls.input} w-24`} /></td>
                        <td><input aria-label="สูญเสีย %" inputMode="decimal" value={i.waste_percentage} onChange={(e) => patchItem(i.key, { waste_percentage: e.target.value })} className={`${m3Cls.input} w-20`} /></td>
                        <td>
                          <select aria-label="ประเภท" value={i.is_primary} onChange={(e) => patchItem(i.key, { is_primary: e.target.value === "1" ? 1 : 0 })} className={`${m3Cls.input} w-28`}>
                            <option value={1}>ตัวหลัก</option><option value={0}>ตัวรอง</option>
                          </select>
                        </td>
                        <td>
                          <button type="button" aria-label="ลบบรรทัด" title="ลบบรรทัด" onClick={() => setDraft({ ...draft, items: draft.items.filter((x) => x.key !== i.key) })} className="m3-btn m3-btn-sm text-m3-error hover:bg-[rgba(255,86,48,0.08)]">
                            <SolarCloseCircle size={18} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button type="button" className="m3-btn m3-btn-outline" onClick={() => setDraft({ ...draft, items: [...draft.items, { key: `n${++keySeq}`, sku: "", qty: "", unit: "ชิ้น", waste_percentage: "0", is_primary: 1 }] })}>
                <SolarAddLine size={18} /> เพิ่มวัตถุดิบ
              </button>
              {errors.length > 0 && (
                <M3Banner tone="error"><ul className="list-disc pl-4">{errors.map((e) => <li key={e}>{e}</li>)}</ul></M3Banner>
              )}
              <div className="flex justify-end gap-3">
                <button type="button" className={m3Cls.btnCancel} onClick={() => { setDraft(toDraft(selected)); setErrors([]); }} disabled={saving}>คืนค่าเดิม</button>
                <button type="button" className={m3Cls.btnPrimary} onClick={() => void save()} disabled={saving}>{saving ? "กำลังบันทึก…" : "บันทึกสูตร"}</button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

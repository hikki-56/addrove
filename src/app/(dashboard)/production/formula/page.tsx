"use client";

import { useCallback, useEffect, useState } from "react";

interface FormulaItem {
  rm_sku: string;
  rm_barcode: string;
  rm_name: string;
  rm_wh: string;
  is_primary: number;
  rm_qty_required: number;
  rm_unit: string;
  waste_percentage: number;
  note: string;
}

interface FormulaRow {
  bom_id: string;
  fg_sku: string;
  fg_barcode: string;
  fg_name: string;
  fg_unit: string;
  base_qty: number;
  updated_at: string;
  item_count: number;
  primary_count: number;
}

// แถวร่างสำหรับแก้ไข — เก็บตัวเลขเป็น string เพื่อพิมพ์ใน input ได้ลื่น
interface DraftItem {
  rm_sku: string;
  rm_barcode: string;
  rm_name: string;
  rm_wh: string;
  is_primary: number;
  rm_qty_required: string;
  rm_unit: string;
  waste_percentage: string;
  note: string;
}

function toDraft(it: FormulaItem): DraftItem {
  return {
    rm_sku: it.rm_sku || "",
    rm_barcode: it.rm_barcode || "",
    rm_name: it.rm_name || "",
    rm_wh: it.rm_wh || "โกดัง2",
    is_primary: it.is_primary === 1 ? 1 : 0,
    rm_qty_required: String(it.rm_qty_required ?? 1),
    rm_unit: it.rm_unit || "ชิ้น",
    waste_percentage: String(it.waste_percentage ?? 0),
    note: it.note || "",
  };
}

const emptyDraft = (): DraftItem => ({
  rm_sku: "",
  rm_barcode: "",
  rm_name: "",
  rm_wh: "โกดัง2",
  is_primary: 0,
  rm_qty_required: "1",
  rm_unit: "ชิ้น",
  waste_percentage: "0",
  note: "",
});

export default function FormulaManagementPage() {
  const [formulas, setFormulas] = useState<FormulaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Pagination — pageSize = 0 คือแสดงทั้งหมด (ALL)
  const [pageSize, setPageSize] = useState<number>(10);
  const [page, setPage] = useState(1);

  const [editing, setEditing] = useState<FormulaRow | null>(null);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [draftItems, setDraftItems] = useState<DraftItem[]>([]);
  const [saving, setSaving] = useState(false);
  // error ของการบันทึกสูตร — แสดงใน footer ของโมดัล (errorBanner หลังโมดัล z-50 ผู้ใช้มองไม่เห็น)
  const [saveError, setSaveError] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const fetchFormulas = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/production/formula");
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setFormulas(json.data);
      } else {
        setErrorBanner(json.message || "ดึงรายการสูตรไม่สำเร็จ");
      }
    } catch {
      setErrorBanner("เกิดข้อผิดพลาดในการเชื่อมต่อ กรุณาลองใหม่");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFormulas();
  }, [fetchFormulas]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage((prev) => (prev === msg ? null : prev)), 3000);
  };

  // กดแก้ไขสูตร → ค่อยดึงรายการวัตถุดิบของสูตรนั้นจาก server (โหลดแบบ lazy)
  const loadFormulaItems = useCallback(async (f: FormulaRow): Promise<DraftItem[]> => {
    const res = await fetch(`/api/production/formula/${encodeURIComponent(f.bom_id)}`);
    const json = await res.json();
    if (!json.success || !json.data?.items) {
      throw new Error(json.message || "ดึงรายการวัตถุดิบไม่สำเร็จ");
    }
    return (json.data.items as FormulaItem[]).map(toDraft);
  }, []);

  const openEditor = async (f: FormulaRow) => {
    setErrorBanner(null);
    setItemsError(null);
    setSaveError(null);
    setEditing(f);
    setDraftItems([]);
    setItemsLoading(true);
    try {
      const drafts = await loadFormulaItems(f);
      setDraftItems(drafts);
    } catch (e) {
      setItemsError(e instanceof Error ? e.message : "ดึงรายการวัตถุดิบไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setItemsLoading(false);
    }
  };

  const retryLoadItems = async () => {
    if (!editing) return;
    setItemsError(null);
    setItemsLoading(true);
    try {
      const drafts = await loadFormulaItems(editing);
      setDraftItems(drafts);
    } catch (e) {
      setItemsError(e instanceof Error ? e.message : "ดึงรายการวัตถุดิบไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setItemsLoading(false);
    }
  };

  const closeEditor = () => {
    setEditing(null);
    setDraftItems([]);
    setSaveError(null);
  };

  const updateDraft = (idx: number, patch: Partial<DraftItem>) => {
    setDraftItems((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  };

  const removeDraft = (idx: number) => {
    setDraftItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const addDraft = () => {
    setDraftItems((prev) => [...prev, emptyDraft()]);
  };

  const handleSave = async () => {
    if (!editing) return;
    setSaveError(null);

    if (draftItems.length === 0) {
      setSaveError("สูตรต้องมีวัตถุดิบอย่างน้อย 1 รายการ");
      return;
    }
    const seenSku = new Set<string>();
    for (let i = 0; i < draftItems.length; i++) {
      const d = draftItems[i];
      const skuKey = d.rm_sku.trim().toLowerCase();
      if (!skuKey) {
        setSaveError(`วัตถุดิบรายการที่ ${i + 1}: กรุณาระบุรหัสวัตถุดิบ`);
        return;
      }
      if (seenSku.has(skuKey)) {
        setSaveError(`รหัสวัตถุดิบ "${d.rm_sku}" ซ้ำกัน (รายการที่ ${i + 1}) — หนึ่งสูตรควรมีรหัสวัตถุดิบละ 1 แถว`);
        return;
      }
      seenSku.add(skuKey);
      const qty = Number(d.rm_qty_required);
      if (!qty || qty <= 0) {
        setSaveError(`วัตถุดิบรายการที่ ${i + 1} (${d.rm_sku}): จำนวนต่อชุดต้องมากกว่า 0`);
        return;
      }
    }

    setSaving(true);
    try {
      const storedToken =
        typeof window !== "undefined"
          ? sessionStorage.getItem("stockify_tab_token") || localStorage.getItem("stockify_tab_token")
          : null;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (storedToken) {
        headers["x-tab-token"] = storedToken;
        headers["Authorization"] = `Bearer ${storedToken}`;
      }

      const res = await fetch(`/api/production/formula/${encodeURIComponent(editing.bom_id)}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          items: draftItems.map((d) => ({
            rm_sku: d.rm_sku.trim(),
            rm_barcode: d.rm_barcode.trim(),
            rm_name: d.rm_name.trim() || d.rm_sku.trim(),
            rm_wh: d.rm_wh.trim() || "โกดัง2",
            is_primary: d.is_primary === 1 ? 1 : 0,
            rm_qty_required: Number(d.rm_qty_required),
            rm_unit: d.rm_unit.trim() || "ชิ้น",
            waste_percentage: Number(d.waste_percentage) || 0,
            note: d.note.trim(),
          })),
        }),
      });

      const json = await res.json();
      if (json.success) {
        closeEditor();
        showToast(json.message || "บันทึกสูตรเรียบร้อยแล้ว");
        await fetchFormulas();
      } else {
        setSaveError(json.message || "บันทึกไม่สำเร็จ");
      }
    } catch {
      setSaveError("เกิดข้อผิดพลาดในการเชื่อมต่อ กรุณาลองใหม่");
    } finally {
      setSaving(false);
    }
  };

  const filtered = formulas.filter(
    (f) =>
      f.fg_sku.toLowerCase().includes(search.toLowerCase()) ||
      f.fg_name.toLowerCase().includes(search.toLowerCase()) ||
      (f.fg_barcode || "").includes(search)
  );

  // คำนวณการแบ่งหน้า (pageSize = 0 → แสดงทั้งหมด)
  const total = filtered.length;
  const pageCount = pageSize === 0 ? 1 : Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount);
  const paged = pageSize === 0 ? filtered : filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const rangeStart = total === 0 ? 0 : (safePage - 1) * (pageSize || total) + 1;
  const rangeEnd = pageSize === 0 ? total : Math.min(safePage * pageSize, total);

  const inputCls =
    "w-full bg-white border border-[#D5DDD9] rounded-lg px-2.5 py-2 text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-[#0F5C3F]";

  return (
    <div className="w-full max-w-full space-y-5 pb-16">
      {/* แบนเนอร์แจ้งเตือน — อยู่ใน flow ของหน้า (ดันเนื้อหา ไม่ลอยทับตัวหนังสืออื่น) */}
      {toastMessage && (
        <div className="bg-[#06402B] text-white px-4 py-3 rounded-xl shadow-md flex items-center gap-3 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="w-6 h-6 rounded-full bg-[#0F5C3F] border border-white/30 text-white flex items-center justify-center text-xs font-bold shrink-0">
            ✓
          </div>
          <span className="text-sm font-semibold flex-1">{toastMessage}</span>
          <button
            onClick={() => setToastMessage(null)}
            className="text-slate-300 hover:text-white text-xs cursor-pointer font-bold p-1"
          >
            ✕
          </button>
        </div>
      )}

      {/* Header */}
      <div className="bg-white rounded-2xl p-4 sm:p-5 border border-[#E8ECEA] shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="text-xl">🧪</span>
          <div>
            <h1 className="text-base sm:text-lg font-extrabold text-slate-900">แก้ไขสูตรการผลิต (BOM)</h1>
            <p className="text-sm text-slate-500">เลือกสินค้าแล้วกดแก้ไขสูตรเพื่อปรับวัตถุดิบในสูตรได้</p>
          </div>
        </div>
        <button
          type="button"
          onClick={fetchFormulas}
          aria-label="รีเฟรชข้อมูล"
          title="รีเฟรชข้อมูล"
          className="p-2.5 text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all cursor-pointer border border-[#E8ECEA] active:scale-95 self-start sm:self-auto"
        >
          <svg className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      {/* Error Banner */}
      {errorBanner && (
        <div className="rounded-xl bg-rose-50 border border-rose-200 p-4 flex items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-2.5 text-rose-800">
            <span className="text-lg">⚠️</span>
            <p className="text-sm font-bold">{errorBanner}</p>
          </div>
          <button
            onClick={() => setErrorBanner(null)}
            className="text-rose-700 hover:text-rose-900 text-xs font-bold px-2.5 py-1 rounded-lg hover:bg-rose-100 cursor-pointer transition-colors"
          >
            ปิด
          </button>
        </div>
      )}

      {/* Search */}
      <div className="relative w-full sm:max-w-md">
        <input
          type="text"
          placeholder="ค้นหารหัสสินค้า, ชื่อสินค้า หรือบาร์โค้ด..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="w-full pl-11 pr-4 py-2.5 sm:py-3 bg-white border border-[#E8ECEA] rounded-xl text-sm font-semibold text-slate-900 placeholder:text-slate-500 focus:outline-hidden focus:ring-2 focus:ring-[#0F5C3F] shadow-2xs"
        />
        <svg className="w-5 h-5 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>

      {/* Formula List */}
      {loading ? (
        <div className="py-20 text-center bg-white rounded-2xl border border-[#E8ECEA] shadow-xs">
          <div className="w-8 h-8 border-3 border-[#0F5C3F] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-slate-600 mt-3 font-semibold">กำลังโหลดรายการสูตรการผลิต...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl p-16 text-center border border-[#E8ECEA] bg-white shadow-xs">
          <p className="text-slate-700 text-base font-bold">ไม่พบรายการสูตรที่ตรงกับคำค้นหา</p>
          <p className="text-slate-500 text-sm mt-1">ลองเปลี่ยนคำค้นหา หรือกดรีเฟรชข้อมูลใหม่อีกครั้ง</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-[#E8ECEA] shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm min-w-[860px]">
              <thead>
                <tr className="border-b border-[#EEF1EF] bg-slate-50/70 text-slate-500 font-bold">
                  <th className="py-3 px-4">รหัสสินค้า</th>
                  <th className="py-3 px-4">บาร์โค้ด</th>
                  <th className="py-3 px-4">ชื่อสินค้า</th>
                  <th className="py-3 px-4 text-center">จำนวนวัตถุดิบ</th>
                  <th className="py-3 px-4 text-center">แก้ไขสูตร</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EEF1EF]">
                {paged.map((f) => (
                  <tr key={f.bom_id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <span className="font-mono font-bold text-slate-900">{f.fg_sku}</span>
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {f.fg_barcode ? (
                        <span className="font-mono text-xs font-medium text-slate-500">{f.fg_barcode}</span>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-slate-900 truncate max-w-[280px]" title={f.fg_name}>
                        {f.fg_name}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        หน่วย: {f.fg_unit} · ตัวหลัก {f.primary_count} รายการ
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <span className="text-[#052B1F] bg-[#DFEDE6] border border-[#8FB3A3] px-2.5 py-0.5 rounded-lg text-sm font-bold font-mono">
                        {f.item_count} รายการ
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <button
                        type="button"
                        onClick={() => openEditor(f)}
                        className="h-9 px-4 rounded-lg bg-[#06402B] hover:bg-[#053425] text-white font-bold text-xs flex items-center justify-center gap-1.5 mx-auto transition-all cursor-pointer active:scale-95 whitespace-nowrap shadow-md shadow-[#06402B]/20"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                        <span>แก้ไขสูตร</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Pagination Footer */}
          <div className="p-3.5 border-t border-[#EEF1EF] flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
              <span>แสดง</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                className="bg-white border border-[#D5DDD9] rounded-lg px-2 py-1.5 text-xs font-bold text-slate-800 cursor-pointer focus:outline-hidden focus:ring-2 focus:ring-[#0F5C3F]"
                aria-label="จำนวนรายการต่อหน้า"
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={30}>30</option>
                <option value={50}>50</option>
                <option value={0}>ALL</option>
              </select>
              <span>รายการ/หน้า</span>
              <span className="ml-1 text-slate-400">
                ({rangeStart}–{rangeEnd} จาก {total} สูตร)
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage <= 1}
                className="px-3 py-1.5 rounded-lg bg-white border border-[#D5DDD9] text-slate-700 hover:bg-slate-100 font-bold text-xs transition-all cursor-pointer disabled:opacity-40 disabled:pointer-events-none flex items-center gap-1"
              >
                ‹ ก่อนหน้า
              </button>
              <span className="px-2 text-xs font-bold text-slate-600 font-mono">
                หน้า {safePage} / {pageCount}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                disabled={safePage >= pageCount}
                className="px-3 py-1.5 rounded-lg bg-white border border-[#D5DDD9] text-slate-700 hover:bg-slate-100 font-bold text-xs transition-all cursor-pointer disabled:opacity-40 disabled:pointer-events-none flex items-center gap-1"
              >
                ถัดไป ›
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs" onClick={saving ? undefined : closeEditor} />

          <div className="relative w-full max-w-5xl max-h-[92dvh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden z-10 animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-[#E8ECEA] flex items-center justify-between bg-slate-50 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <span className="px-2.5 py-1 rounded bg-[#DFEDE6] text-[#04231A] font-mono font-bold text-sm shrink-0">
                  {editing.fg_sku}
                </span>
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-slate-900 truncate">{editing.fg_name}</h3>
                  <p className="text-xs text-slate-500">
                    BOM: {editing.bom_id} · หน่วยสินค้า: {editing.fg_unit}
                  </p>
                </div>
              </div>
              <button
                onClick={closeEditor}
                disabled={saving}
                className="w-10 h-10 rounded-xl bg-white border border-[#E8ECEA] text-slate-600 hover:text-slate-900 hover:bg-slate-100 flex items-center justify-center font-bold transition-all cursor-pointer disabled:opacity-40 shrink-0"
                aria-label="ปิด"
              >
                ✕
              </button>
            </div>

            {/* Items Editor */}
            <div className="flex-1 overflow-y-auto p-5">
              {itemsLoading ? (
                <div className="py-16 text-center">
                  <div className="w-8 h-8 border-3 border-[#0F5C3F] border-t-transparent rounded-full animate-spin mx-auto" />
                  <p className="text-sm text-slate-600 mt-3 font-semibold">กำลังดึงรายการวัตถุดิบ...</p>
                </div>
              ) : itemsError ? (
                <div className="py-12 text-center space-y-3">
                  <span className="text-3xl block">⚠️</span>
                  <p className="text-sm font-bold text-rose-700">{itemsError}</p>
                  <button
                    type="button"
                    onClick={retryLoadItems}
                    className="px-4 py-2 rounded-xl bg-[#06402B] hover:bg-[#053425] text-white font-bold text-sm transition-all cursor-pointer active:scale-95"
                  >
                    ลองใหม่อีกครั้ง
                  </button>
                </div>
              ) : (
                <>
              <div className="overflow-x-auto rounded-2xl border border-[#E8ECEA] bg-white">
                <table className="w-full text-left text-sm min-w-[1180px]">
                  <thead>
                    <tr className="bg-slate-100 text-slate-600 font-bold border-b border-[#E8ECEA]">
                      <th className="py-2.5 px-2 w-[96px] text-center">ประเภท</th>
                      <th className="py-2.5 px-2 min-w-[150px]">รหัสวัตถุดิบ</th>
                      <th className="py-2.5 px-2 min-w-[140px]">บาร์โค้ด</th>
                      <th className="py-2.5 px-2 min-w-[220px]">ชื่อวัตถุดิบ</th>
                      <th className="py-2.5 px-2 w-[100px] text-right">จำนวน/ชุด</th>
                      <th className="py-2.5 px-2 w-[96px]">หน่วย</th>
                      <th className="py-2.5 px-2 w-[88px] text-right">% เสีย</th>
                      <th className="py-2.5 px-2 min-w-[140px]">หมายเหตุ</th>
                      <th className="py-2.5 px-2 w-12"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EEF1EF]">
                    {draftItems.map((d, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/50">
                        <td className="py-2 px-2 text-center">
                          <select
                            value={d.is_primary}
                            onChange={(e) => updateDraft(idx, { is_primary: Number(e.target.value) === 1 ? 1 : 0 })}
                            className={`w-full rounded-lg px-1.5 py-2 text-xs font-bold border cursor-pointer focus:outline-hidden focus:ring-2 focus:ring-[#0F5C3F] ${
                              d.is_primary === 1
                                ? "bg-emerald-100 text-emerald-900 border-emerald-300"
                                : "bg-slate-100 text-slate-600 border-slate-200"
                            }`}
                          >
                            <option value={1}>หลัก</option>
                            <option value={0}>รอง</option>
                          </select>
                        </td>
                        <td className="py-2 px-2">
                          <input
                            type="text"
                            value={d.rm_sku}
                            onChange={(e) => updateDraft(idx, { rm_sku: e.target.value })}
                            placeholder="รหัส SKU"
                            title={d.rm_sku}
                            className={`${inputCls} font-mono font-semibold`}
                          />
                        </td>
                        <td className="py-2 px-2">
                          <input
                            type="text"
                            value={d.rm_barcode}
                            onChange={(e) => updateDraft(idx, { rm_barcode: e.target.value })}
                            placeholder="บาร์โค้ด"
                            title={d.rm_barcode}
                            className={`${inputCls} font-mono text-xs`}
                          />
                        </td>
                        <td className="py-2 px-2">
                          <input
                            type="text"
                            value={d.rm_name}
                            onChange={(e) => updateDraft(idx, { rm_name: e.target.value })}
                            placeholder="ชื่อวัตถุดิบ"
                            title={d.rm_name}
                            className={inputCls}
                          />
                        </td>
                        <td className="py-2 px-2">
                          <input
                            type="number"
                            min={0}
                            step="any"
                            value={d.rm_qty_required}
                            onChange={(e) => updateDraft(idx, { rm_qty_required: e.target.value })}
                            onContextMenu={(e) => e.preventDefault()}
                            className={`${inputCls} text-right font-mono font-bold`}
                          />
                        </td>
                        <td className="py-2 px-2">
                          <input
                            type="text"
                            value={d.rm_unit}
                            onChange={(e) => updateDraft(idx, { rm_unit: e.target.value })}
                            placeholder="ชิ้น"
                            className={inputCls}
                          />
                        </td>
                        <td className="py-2 px-2">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={d.waste_percentage}
                            onChange={(e) => updateDraft(idx, { waste_percentage: e.target.value })}
                            onContextMenu={(e) => e.preventDefault()}
                            className={`${inputCls} text-right font-mono`}
                          />
                        </td>
                        <td className="py-2 px-2">
                          <input
                            type="text"
                            value={d.note}
                            onChange={(e) => updateDraft(idx, { note: e.target.value })}
                            placeholder="-"
                            className={inputCls}
                          />
                        </td>
                        <td className="py-2 px-2 text-center">
                          <button
                            type="button"
                            onClick={() => removeDraft(idx)}
                            title="ลบวัตถุดิบนี้"
                            className="w-8 h-8 rounded-lg text-rose-600 hover:text-rose-700 hover:bg-rose-50 border border-transparent hover:border-rose-200 flex items-center justify-center font-bold transition-all cursor-pointer"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <button
                type="button"
                onClick={addDraft}
                className="mt-3 px-4 py-2.5 rounded-xl bg-[#EAF2EE] hover:bg-[#DFEDE6] text-[#052B1F] font-bold text-sm flex items-center gap-1.5 transition-all cursor-pointer border border-[#8FB3A3] active:scale-95"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                เพิ่มวัตถุดิบ
              </button>
                </>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-4 border-t border-[#E8ECEA] bg-slate-50 flex flex-wrap items-center justify-between gap-3 shrink-0">
              {saveError && (
                <div className="w-full p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm font-bold flex items-center gap-2">
                  <span className="shrink-0">⚠️</span>
                  <span>{saveError}</span>
                </div>
              )}
              <p className="text-xs text-slate-500 font-semibold">
                การแก้ไขจะมีผลกับการคำนวณจำนวนที่ผลิตได้ทันทีหลังบันทึก
              </p>
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={closeEditor}
                  disabled={saving}
                  className="px-5 py-3 rounded-xl bg-white border border-[#D5DDD9] text-slate-700 hover:bg-slate-100 font-bold text-sm transition-all cursor-pointer disabled:opacity-40"
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || itemsLoading}
                  className="px-6 py-3 rounded-xl bg-[#06402B] hover:bg-[#053425] text-white font-bold text-sm flex items-center gap-2 transition-all cursor-pointer active:scale-95 disabled:opacity-50 shadow-lg shadow-[#06402B]/20"
                >
                  {saving ? (
                    <>
                      <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      <span>กำลังบันทึก...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span>บันทึกสูตร</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

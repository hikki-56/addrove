"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import Link from "next/link";
import { tabTokenHeader } from "@/lib/outbound-client";

/**
 * นำเข้าบิลจากไฟล์ Express — 3 ขั้น stateless (ส่งไฟล์ใหม่ทุกขั้น):
 *   1) เลือกไฟล์ .xlsx/.csv → analyze (ระบบแนะนำ sheet/หัวตา/คอลัมน์)
 *   2) ปรับ mapping → preview (เห็นบิล + สถานะ match สินค้า + บิลซ้ำ)
 *   3) เลือกคลัง + ยืนยัน → commit (สร้างเอกสาร BIL)
 * ระบบจำ mapping ล่าสุดไว้ใน localStorage ใช้ซ้ำได้ทันทีกับไฟล์รูปแบบเดิม
 */

const MAPPING_STORAGE_KEY = "stockify_outbound_column_mapping_v1";
const WAREHOUSE_STORAGE_KEY = "stockify_outbound_warehouse_v1";

interface SheetAnalysis {
  name: string;
  totalRows: number;
  suggestedHeaderRow: number;
  headers: string[];
  sampleRows: string[][];
}

interface Mapping {
  bill_no: string;
  sku: string;
  qty: string;
  product_name: string;
  location: string;
  customer: string;
  date: string;
}

interface PreviewItem {
  sku: string;
  qty: number;
  product_name?: string;
  matched: boolean;
  product?: { sku: string; product_name: string; barcode?: string };
}

interface PreviewBill {
  express_bill_no: string;
  customer?: string;
  date?: string;
  items: PreviewItem[];
  total_qty: number;
  unmatched_count: number;
  duplicate_of?: string;
  q_assignments?: Array<{ q_code: string; items: Array<{ sku: string; qty: number }> }>;
}

/** ข้อมูลหัวเอกสาร + รายการสินค้าที่ดึงได้จาก PDF ของ Express */
interface PdfDoc {
  fileName: string;
  doc_no?: string;
  iv_no?: string;
  express_bill_no: string;
  customer?: string;
  date?: string;
  items: Array<{ no: number; sku: string; product_name?: string; qty: number }>;
}

const FIELDS: Array<{ key: keyof Mapping; label: string; required: boolean; hint: string }> = [
  { key: "bill_no", label: "เลขที่บิล *", required: true, hint: "เลขที่เอกสาร/ใบสั่งขายจาก Express" },
  { key: "sku", label: "รหัสสินค้า *", required: true, hint: "ต้องตรงกับ SKU หรือบาร์โค้ดในระบบ" },
  { key: "qty", label: "จำนวน *", required: true, hint: "จำนวนที่ต้องหยิบ" },
  { key: "product_name", label: "ชื่อสินค้า", required: false, hint: "ไว้อ้างอิง (ไม่บังคับ)" },
  { key: "location", label: "ตำแหน่ง", required: false, hint: "ถ้าไฟล์ระบุตำแหน่งมาเอง" },
  { key: "customer", label: "ลูกค้า", required: false, hint: "แสดงบนบิล/สติกเกอร์" },
  { key: "date", label: "วันที่เอกสาร", required: false, hint: "วันที่บิล" },
];

async function postImport(formData: FormData): Promise<{ data: unknown; message: string }> {
  const res = await fetch("/api/outbound/import", {
    method: "POST",
    headers: tabTokenHeader(),
    body: formData,
  });
  const json = await res.json().catch(() => ({ success: false, message: "ตอบกลับไม่ใช่ JSON" }));
  if (!res.ok || json?.success === false) throw new Error(json?.message || `ผิดพลาด (${res.status})`);
  return { data: json.data, message: json.message || "สำเร็จ" };
}

export default function OutboundUploadPage() {
  const fileRef = useRef<File | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [sheets, setSheets] = useState<SheetAnalysis[]>([]);
  const [sheet, setSheet] = useState("");
  const [headerRow, setHeaderRow] = useState(1);
  const [mapping, setMapping] = useState<Mapping>({
    bill_no: "", sku: "", qty: "", product_name: "", location: "", customer: "", date: "",
  });
  const [mappingLoadedFromStorage, setMappingLoadedFromStorage] = useState(false);

  const [warehouses, setWarehouses] = useState<Array<{ warehouse_id: string; warehouse_name: string }>>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [previewBills, setPreviewBills] = useState<PreviewBill[]>([]);
  // การแบ่งกล่อง Q อัตโนมัติ — กล่องละไม่เกิน N รายการ (รายการบิลเดียวกันอยู่ด้วยกันเสมอ)
  const [autoQ, setAutoQ] = useState(true);
  const [maxPerQ, setMaxPerQ] = useState(5);
  const [pdfDoc, setPdfDoc] = useState<PdfDoc | null>(null);

  // โหลดรายชื่อคลังและตั้งค่าเริ่มต้นตั้งแต่โหลดหน้า
  useEffect(() => {
    (async () => {
      try {
        const savedWh = localStorage.getItem(WAREHOUSE_STORAGE_KEY) || "";
        const wres = await fetch("/api/warehouses", { cache: "no-store", headers: tabTokenHeader() });
        const wjson = await wres.json();
        const list = (wjson?.data?.warehouses ?? wjson?.data ?? []) as Array<{ warehouse_id: string; warehouse_name: string }>;
        if (Array.isArray(list) && list.length > 0) {
          setWarehouses(list);
          setWarehouseId((prev) => prev || list.find((w) => w.warehouse_id === savedWh)?.warehouse_id || list[0].warehouse_id);
        }
      } catch {}
    })();
  }, []);

  const headers = sheets.find((s) => s.name === sheet)?.headers ?? [];

  // ---------- ขั้น 1: analyze ----------
  const handleFile = useCallback(async (file: File) => {
    setBusy(true);
    setError("");
    setNotice("");
    setMappingLoadedFromStorage(false);
    fileRef.current = file;
    try {
      const fd = new FormData();
      fd.append("mode", "analyze");
      fd.append("file", file);
      const { data } = await postImport(fd);
      const result = data as {
        fileName: string;
        kind?: "pdf";
        doc_no?: string;
        iv_no?: string;
        express_bill_no?: string;
        customer?: string;
        date?: string;
        items?: PdfDoc["items"];
        sheets: SheetAnalysis[];
        suggestedSheet: string | null;
        suggestedMapping: Mapping | null;
      };
      setPdfDoc(null);
      const isPdf = result.kind === "pdf";
      if (isPdf && result.express_bill_no) {
        setPdfDoc({
          fileName: result.fileName,
          doc_no: result.doc_no,
          iv_no: result.iv_no,
          express_bill_no: result.express_bill_no,
          customer: result.customer,
          date: result.date,
          items: result.items ?? [],
        });
        setNotice(
          `อ่านเอกสาร Express สำเร็จ: ${result.express_bill_no}${result.doc_no && result.doc_no !== result.express_bill_no ? ` (${result.doc_no})` : ""}` +
            `${result.customer ? ` · ${result.customer}` : ""}${result.date ? ` · ${result.date}` : ""}`
        );
      }
      setSheets(result.sheets);
      const chosen = result.sheets.find((s) => s.name === result.suggestedSheet) ?? result.sheets[0];
      setSheet(chosen?.name ?? "");
      setHeaderRow(chosen?.suggestedHeaderRow ?? 1);

      // ใช้ mapping ที่จำไว้ถ้าหัวตาตรงกัน ไม่งั้นใช้ที่ระบบแนะนำ (PDF มีคอลัมน์ตายตัวจาก parser — ไม่ต้องจำ)
      let initialMapping: Mapping | null = null;
      if (!isPdf) {
        try {
          const saved = JSON.parse(localStorage.getItem(MAPPING_STORAGE_KEY) || "null") as Mapping | null;
          if (saved && result.sheets.some((s) => s.headers.includes(saved.bill_no) && s.headers.includes(saved.sku) && s.headers.includes(saved.qty))) {
            initialMapping = saved;
            setMappingLoadedFromStorage(true);
            setNotice("ใช้การจับคู่คอลัมน์ที่จำไว้จากครั้งก่อน");
          }
        } catch {}
      }
      if (!initialMapping) {
        initialMapping = {
          bill_no: result.suggestedMapping?.bill_no ?? "",
          sku: result.suggestedMapping?.sku ?? "",
          qty: result.suggestedMapping?.qty ?? "",
          product_name: result.suggestedMapping?.product_name ?? "",
          location: result.suggestedMapping?.location ?? "",
          customer: result.suggestedMapping?.customer ?? "",
          date: result.suggestedMapping?.date ?? "",
        };
      }
      setMapping(initialMapping);

      // โหลดรายชื่อคลัง
      if (warehouses.length === 0) {
        try {
          const savedWh = localStorage.getItem(WAREHOUSE_STORAGE_KEY) || "";
          const wres = await fetch("/api/warehouses", { cache: "no-store", headers: tabTokenHeader() });
          const wjson = await wres.json();
          const list = (wjson?.data?.warehouses ?? wjson?.data ?? []) as Array<{ warehouse_id: string; warehouse_name: string }>;
          if (Array.isArray(list) && list.length > 0) {
            setWarehouses(list);
            setWarehouseId(list.find((w) => w.warehouse_id === savedWh)?.warehouse_id ?? list[0].warehouse_id);
          }
        } catch {}
      }
      setStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : "อ่านไฟล์ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }, [warehouses.length]);

  // ---------- ขั้น 2: preview ----------
  const handlePreview = useCallback(async () => {
    if (!fileRef.current) return;
    setBusy(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("mode", "preview");
      fd.append("file", fileRef.current);
      fd.append("sheet", sheet);
      fd.append("header_row", String(headerRow));
      fd.append("mapping", JSON.stringify(mapping));
      fd.append("auto_assign_q", String(autoQ));
      fd.append("max_items_per_q", String(maxPerQ));
      const { data } = await postImport(fd);
      setPreviewBills((data as { bills: PreviewBill[] }).bills);
      localStorage.setItem(MAPPING_STORAGE_KEY, JSON.stringify(mapping));
      setStep(3);
    } catch (e) {
      setError(e instanceof Error ? e.message : "อ่านไฟล์ตามการจับคู่ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }, [sheet, headerRow, mapping, autoQ, maxPerQ]);

  // ---------- ขั้น 3: commit ----------
  const handleCommit = useCallback(async (skipUnmatched: boolean) => {
    if (!fileRef.current || !warehouseId) return;
    setBusy(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("mode", "commit");
      fd.append("file", fileRef.current);
      fd.append("sheet", sheet);
      fd.append("header_row", String(headerRow));
      fd.append("mapping", JSON.stringify(mapping));
      fd.append("warehouse_id", warehouseId);
      fd.append("skip_unmatched", String(skipUnmatched));
      fd.append("auto_assign_q", String(autoQ));
      fd.append("max_items_per_q", String(maxPerQ));
      const { message } = await postImport(fd);
      localStorage.setItem(WAREHOUSE_STORAGE_KEY, warehouseId);
      setNotice(message);
      // กลับไปเริ่มไฟล์ใหม่ได้เลย
      setStep(1);
      fileRef.current = null;
      setPreviewBills([]);
      setPdfDoc(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "นำเข้าไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }, [sheet, headerRow, mapping, warehouseId, autoQ, maxPerQ]);

  const totalUnmatched = previewBills.reduce((s, b) => s + b.unmatched_count, 0);
  const duplicates = previewBills.filter((b) => b.duplicate_of);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#06402B]">นำเข้าบิลจากไฟล์ Express</h1>
        </div>
        <Link href="/outbound" className="text-sm text-slate-500 hover:text-[#06402B]">← กลับรายการบิล</Link>
      </div>

      {/* ตัวชี้ขั้นตอน */}
      <div className="flex items-center gap-2 text-sm">
        {["เลือกไฟล์", pdfDoc ? "ข้อมูลจากเอกสาร" : "จับคู่คอลัมน์", "ตรวจและนำเข้า"].map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <span className={`w-7 h-7 rounded-full flex items-center justify-center font-bold ${step > i ? "bg-[#06402B] text-white" : "bg-slate-100 text-slate-400"}`}>
              {i + 1}
            </span>
            <span className={step > i ? "font-semibold text-slate-800" : "text-slate-400"}>{label}</span>
            {i < 2 && <span className="w-8 h-px bg-slate-200" />}
          </div>
        ))}
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">{error}</div>}
      {notice && <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl px-4 py-3 text-sm">{notice}</div>}

      {/* ขั้น 1: ไฟล์ */}
      {step === 1 && (
        <div className="bg-white rounded-2xl border border-[#E8ECEA] p-8">
          <label className="block border-2 border-dashed border-[#C9DFD4] rounded-2xl p-10 text-center cursor-pointer hover:border-[#06402B] transition-colors">
            <input
              type="file"
              accept=".xlsx,.xls,.csv,.txt,.pdf"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
              }}
            />
            <div className="text-5xl mb-3">📄</div>
            <div className="font-semibold text-slate-700">เลือกไฟล์ที่ export จาก Express</div>
            {busy && <div className="text-sm text-slate-400 mt-1">กำลังอ่านไฟล์…</div>}
          </label>
        </div>
      )}

      {/* ขั้น 2 (PDF): แสดงข้อมูลที่ดึงได้จากเอกสาร */}
      {step === 2 && pdfDoc && (
        <div className="bg-white rounded-2xl border border-[#E8ECEA] overflow-hidden">
          {/* หัวเอกสาร */}
          <div className="px-6 py-5 border-b border-[#E8ECEA] bg-[#F7F9F8]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold tracking-wide text-[#06402B]/60 uppercase">ใบสั่งขาย / ใบส่งของ (Express)</div>
                <div className="mt-1 text-2xl font-bold text-[#06402B] font-mono">{pdfDoc.express_bill_no}</div>
                {pdfDoc.doc_no && pdfDoc.doc_no !== pdfDoc.express_bill_no && (
                  <div className="text-sm text-slate-500 mt-0.5">เลขที่เอกสาร {pdfDoc.doc_no}</div>
                )}
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <div className="text-xs text-slate-400">ลูกค้า</div>
                <div className="text-sm font-semibold text-slate-800">{pdfDoc.customer || "—"}</div>
              </div>
              <div>
                <div className="text-xs text-slate-400">วันที่เอกสาร</div>
                <div className="text-sm font-semibold text-slate-800 tabular-nums">{pdfDoc.date || "—"}</div>
              </div>
              <div>
                <div className="text-xs text-slate-400">จำนวนรายการ</div>
                <div className="text-sm font-semibold text-slate-800 tabular-nums">{pdfDoc.items.length} รายการ</div>
              </div>
              <div>
                <div className="text-xs text-slate-400">รวมทั้งหมด</div>
                <div className="text-sm font-semibold text-slate-800 tabular-nums">
                  {pdfDoc.items.reduce((s, it) => s + it.qty, 0).toLocaleString("th-TH")} ชิ้น
                </div>
              </div>
            </div>
          </div>

          {/* รายการสินค้าตามเอกสาร */}
          <div className="p-6 space-y-4">
            <div className="text-sm font-semibold text-slate-700">รายการสินค้า (ตามเอกสาร)</div>
            <div className="overflow-x-auto rounded-xl border border-[#E8ECEA]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#F7F9F8] text-left text-xs text-slate-500">
                    <th className="px-3 py-2 w-12">ลำดับ</th>
                    <th className="px-3 py-2">ชื่อสินค้า</th>
                    <th className="px-3 py-2 text-right w-20">จำนวน</th>
                  </tr>
                </thead>
                <tbody>
                  {pdfDoc.items.map((it) => {
                    const displayName =
                      it.product_name && it.sku && !it.product_name.includes(it.sku)
                        ? `${it.sku} ${it.product_name}`
                        : it.product_name || it.sku;
                    return (
                      <tr key={it.no} className="border-t border-[#E8ECEA]">
                        <td className="px-3 py-2 text-slate-400 tabular-nums">{it.no}</td>
                        <td className="px-3 py-2 text-slate-800 font-medium">{displayName}</td>
                        <td className="px-3 py-2 text-right font-semibold text-slate-800 tabular-nums">{it.qty.toLocaleString("th-TH")}</td>
                      </tr>
                    );
                  })}
                  {pdfDoc.items.length === 0 && (
                    <tr className="border-t border-[#E8ECEA]">
                      <td colSpan={3} className="px-3 py-6 text-center text-red-600 text-sm">
                        ไม่พบรายการสินค้าในเอกสาร — ลองส่งไฟล์ตัวอย่างให้ทีมพัฒนาเพิ่มรูปแบบ
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => void handlePreview()}
                disabled={busy || pdfDoc.items.length === 0}
                className="px-5 py-2.5 rounded-xl bg-[#06402B] text-white font-semibold disabled:opacity-40 hover:bg-[#0A5C3E] transition-colors"
              >
                {busy ? "กำลังตรวจ…" : "ตรวจสอบตัวอย่างบิล →"}
              </button>
              <button onClick={() => setStep(1)} className="px-4 py-2.5 rounded-xl border border-[#E8ECEA] text-slate-600">เลือกไฟล์ใหม่</button>
            </div>
          </div>
        </div>
      )}

      {/* ขั้น 2 (Excel/CSV): mapping */}
      {step === 2 && !pdfDoc && (
        <div className="bg-white rounded-2xl border border-[#E8ECEA] p-6 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">ชีต</label>
              <select
                value={sheet}
                onChange={(e) => {
                  setSheet(e.target.value);
                  const s = sheets.find((x) => x.name === e.target.value);
                  if (s) setHeaderRow(s.suggestedHeaderRow);
                }}
                className="w-full border border-[#E8ECEA] rounded-xl px-3 py-2.5 bg-white"
              >
                {sheets.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name} ({s.totalRows} แถว)
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">แถวหัวตา (แถวที่)</label>
              <input
                type="number"
                min={1}
                max={50}
                value={headerRow}
                onChange={(e) => setHeaderRow(Number(e.target.value) || 1)}
                className="w-full border border-[#E8ECEA] rounded-xl px-3 py-2.5 bg-white tabular-nums"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {FIELDS.map((f) => (
              <div key={f.key}>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  {f.label}
                  {mappingLoadedFromStorage && mapping[f.key] && <span className="ml-1 text-[#06402B]">(จำไว้แล้ว)</span>}
                </label>
                <select
                  value={mapping[f.key]}
                  onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))}
                  className={`w-full border rounded-xl px-3 py-2 bg-white text-sm ${f.required && !mapping[f.key] ? "border-red-300" : "border-[#E8ECEA]"}`}
                >
                  <option value="">— ไม่ใช้ —</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>{h || "(ไม่มีชื่อ)"}</option>
                  ))}
                </select>
                <div className="text-xs text-slate-400 mt-0.5">{f.hint}</div>
              </div>
            ))}
          </div>

          {/* ตัวอย่างข้อมูล */}
          {sheet && (
            <div className="overflow-x-auto rounded-xl border border-[#E8ECEA]">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-[#F7F9F8]">
                    <th className="px-2 py-2 text-left text-slate-400">#</th>
                    {headers.map((h, i) => (
                      <th key={i} className="px-2 py-2 text-left text-slate-600 whitespace-nowrap">{h || `คอลัมน์ ${i + 1}`}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(sheets.find((s) => s.name === sheet)?.sampleRows ?? []).slice(0, 4).map((row, ri) => (
                    <tr key={ri} className="border-t border-[#E8ECEA]">
                      <td className="px-2 py-1.5 text-slate-300">{ri + 1}</td>
                      {headers.map((_, ci) => (
                        <td key={ci} className="px-2 py-1.5 text-slate-600 whitespace-nowrap max-w-[160px] truncate">{row[ci] ?? ""}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => void handlePreview()}
              disabled={busy || !mapping.bill_no || !mapping.sku || !mapping.qty}
              className="px-5 py-2.5 rounded-xl bg-[#06402B] text-white font-semibold disabled:opacity-40 hover:bg-[#0A5C3E] transition-colors"
            >
              {busy ? "กำลังตรวจ…" : "ตรวจสอบตัวอย่างบิล →"}
            </button>
            <button onClick={() => setStep(1)} className="px-4 py-2.5 rounded-xl border border-[#E8ECEA] text-slate-600">เลือกไฟล์ใหม่</button>
          </div>
        </div>
      )}

      {/* ขั้น 3: preview + commit */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-[#E8ECEA] p-5 space-y-4">
            {(totalUnmatched > 0 || duplicates.length > 0) && (
              <div className="flex flex-wrap gap-4 text-sm">
                {totalUnmatched > 0 && (
                  <span className="text-orange-600 font-semibold">สินค้า match ไม่ได้ {totalUnmatched} รายการ</span>
                )}
                {duplicates.length > 0 && (
                  <span className="text-red-600 font-semibold">นำเข้าไปแล้ว {duplicates.length} บิล (จะข้าม)</span>
                )}
              </div>
            )}

            {/* ตัวเลือกการแบ่งกล่อง Q อัตโนมัติ */}
            <div className="rounded-xl border border-sky-100 bg-sky-50/50 p-3.5 flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={autoQ}
                  onChange={(e) => {
                    setAutoQ(e.target.checked);
                    if (step === 3) void handlePreview(); // คำนวณการแบ่ง Q ใหม่
                  }}
                  className="w-4 h-4 accent-sky-600 cursor-pointer"
                />
                <span className="text-sm font-semibold text-slate-700">📦 จัดแบ่งกล่อง Q อัตโนมัติ</span>
              </label>
              {autoQ && (
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  กล่องละไม่เกิน
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={maxPerQ}
                    onChange={(e) => setMaxPerQ(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                    onBlur={() => {
                      if (step === 3) void handlePreview();
                    }}
                    className="w-16 px-2 py-1.5 rounded-lg bg-white border border-[#E8ECEA] text-center font-bold tabular-nums"
                  />
                  รายการ
                </label>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => void handleCommit(false)}
                disabled={busy || !warehouseId || totalUnmatched > 0 || previewBills.length === duplicates.length}
                className="px-5 py-2.5 rounded-xl bg-[#06402B] text-white font-semibold disabled:opacity-40 hover:bg-[#0A5C3E] transition-colors"
              >
                {busy ? "กำลังนำเข้า…" : "ยืนยันนำเข้า"}
              </button>
              {totalUnmatched > 0 && (
                <button
                  onClick={() => void handleCommit(true)}
                  disabled={busy || !warehouseId || previewBills.length === duplicates.length}
                  className="px-4 py-2.5 rounded-xl bg-amber-500 text-white font-semibold disabled:opacity-40"
                >
                  นำเข้าเฉพาะบิลที่ครบ (ข้ามที่มีสินค้า match ไม่ได้)
                </button>
              )}
              <button onClick={() => setStep(2)} className="px-4 py-2.5 rounded-xl border border-[#E8ECEA] text-slate-600">{pdfDoc ? "ย้อนกลับดูเอกสาร" : "แก้การจับคู่"}</button>
            </div>
          </div>

          <div className="space-y-3">
            {previewBills.map((b) => (
              <div key={b.express_bill_no} className={`bg-white rounded-2xl border p-4 ${b.duplicate_of ? "border-red-200 opacity-70" : b.unmatched_count > 0 ? "border-orange-200" : "border-[#E8ECEA]"}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-bold text-slate-800">{b.express_bill_no}</span>
                    {b.customer && <span className="ml-2 text-sm text-slate-500">{b.customer}</span>}
                  </div>
                  <div className="text-sm">
                    {b.duplicate_of ? (
                      <span className="text-red-600 font-semibold">นำเข้าไปแล้ว ({b.duplicate_of})</span>
                    ) : (
                      <span className="text-slate-600 tabular-nums">{b.items.length} รายการ · {b.total_qty.toLocaleString("th-TH")} ชิ้น</span>
                    )}
                  </div>
                </div>
                {/* แถบรายการเฉพาะกรณีไม่มีการแบ่ง Q (ถ้าแบ่ง Q แล้วดูในการ์ด Q แทน — ไม่ต้องแสดงซ้ำ) */}
                {((!(autoQ && b.q_assignments && b.q_assignments.length > 0)) || b.unmatched_count > 0) && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {b.items.map((it) => (
                      <span
                        key={it.sku}
                        className={`px-2 py-1 rounded-lg text-xs ${it.matched ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700 line-through"}`}
                        title={it.product?.product_name || it.product_name || (it.matched ? "" : "ไม่พบสินค้านี้ในระบบ")}
                      >
                        {it.product?.product_name || it.product_name || it.sku} ×{it.qty}
                      </span>
                    ))}
                  </div>
                )}

                {/* การแบ่งกล่อง Q — รายการของบิลนี้ถูกจัดกลุ่มลงกล่องล่วงหน้า */}
                {autoQ && b.q_assignments && b.q_assignments.length > 0 && (
                  <div className="mt-3 space-y-1.5">
                    <div className="text-xs font-bold text-sky-800">การแบ่งกล่อง Q ({b.q_assignments.length} กล่อง)</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {b.q_assignments.map((q) => (
                        <div key={q.q_code} className="rounded-xl border border-sky-100 bg-sky-50/60 px-2.5 py-2">
                          <div className="text-xs font-extrabold text-sky-800 mb-1">
                            📦 {q.q_code} <span className="font-normal text-slate-400">· {q.items.length} รายการ</span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {q.items.map((it) => {
                              const itDetail = b.items.find((x) => x.sku === it.sku);
                              return (
                                <span key={it.sku} className="px-1.5 py-0.5 rounded bg-white border border-sky-100 text-xs text-slate-700">
                                  {itDetail?.product?.product_name || itDetail?.product_name || it.sku} ×{it.qty}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

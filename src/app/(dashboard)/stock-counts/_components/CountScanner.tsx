"use client";

import { useRef, useState } from "react";
import { v4 as uuid } from "uuid";
import { feedbackError, feedbackSuccess, prepareFeedbackAudio } from "@/client/feedback";
import BarcodeScanInput from "@/components/scanner/BarcodeScanInput";
import CameraBarcodeScannerModal from "@/components/ui/CameraBarcodeScannerModal";
import Link from "next/link";
import { SolarQrCode, SolarMapPoint } from "@/components/icons";
import type { CountEntry, ScannedCountProduct } from "@/types/count-round";
import { errorText, getCount, sendCount } from "@/app/(dashboard)/stock-counts/_lib/count-client";

interface Claim { shelf: string; previous: CountEntry | null }

export default function CountScanner({ warehouse, round }: { warehouse: string; round: string }) {
  const [product, setProduct] = useState<ScannedCountProduct>();
  const [claim, setClaim] = useState<Claim>();
  const [code, setCode] = useState("");
  const [qty, setQty] = useState("");
  const [mode, setMode] = useState<"add" | "set" | "">("");
  const [camera, setCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const processing = useRef(false);
  const request = useRef("");
  const lastBody = useRef("");
  function reset() {
    setProduct(undefined); setClaim(undefined); setCode(""); setQty(""); setMode(""); setError("");
  }
  function back() {
    if (!claim) { reset(); return; }
    setCode("");
    setClaim(undefined);
    setQty("");
    setMode("");
    setError("");
  }
  async function scan(raw: string, sound = false) {
    if (processing.current || claim) return;
    processing.current = true;
    setCamera(false); setBusy(true); setError(""); setNotice("");
    try {
      if (!product) setProduct(await getCount<ScannedCountProduct>({ warehouse, product: raw }));
      else {
        const next = await sendCount<Claim>({ action: "claim", warehouse, round, product: product.product_id, shelf: raw });
        setClaim(next); setMode(next.previous ? "" : "set");
      }
      setCode("");
      if (sound) feedbackSuccess();
    } catch (e) {
      setError(errorText(e));
      if (sound) feedbackError();
    } finally { processing.current = false; setBusy(false); }
  }
  async function save() {
    if (!product || !claim || !mode || !qty.trim() || processing.current) return;
    processing.current = true;
    setBusy(true); setError("");
    try {
      const body = { action: "save", warehouse, round, product: product.product_id, shelf: claim.shelf,
        previous: claim.previous?.request_id ?? null, mode, quantity: Number(qty) };
      const signature = JSON.stringify(body);
      if (signature !== lastBody.current) { request.current = uuid(); lastBody.current = signature; }
      const saved = await sendCount<CountEntry>({ ...body, request: request.current });
      setNotice(`บันทึกแล้ว · ${saved.sku} · ชั้น ${saved.shelf_code} · ${saved.quantity} ${saved.base_unit}`);
      reset();
    } catch (e) { setError(errorText(e)); } finally { processing.current = false; setBusy(false); }
  }
  const step = claim ? 3 : product ? 2 : 1;
  const barcode = product?.barcode?.trim();
  return <section className="m3-card min-w-0 space-y-4 p-4 sm:p-6">
    <header>
      <div aria-hidden="true" className="mb-4 grid grid-cols-3 gap-1.5">
        {[1, 2, 3].map(n => <span key={n} className={`h-1 rounded-full ${n <= step ? "bg-m3-primary" : "bg-m3-grey-200"}`} />)}
      </div>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-m3-grey-800">{claim ? "กรอกจำนวนที่นับได้" : <label htmlFor="count-scan">{product ? "สแกนชั้นวาง" : "สแกนสินค้า"}</label>}</h2>
        <span aria-label={`ขั้นที่ ${step} จาก 3`} className="shrink-0 text-sm font-semibold tabular-nums text-m3-grey-600">{step} / 3</span>
      </div>
    </header>
    {product && <div className="rounded-xl border border-m3-grey-200">
      <div className="space-y-1 rounded-t-xl bg-m3-grey-100 px-4 py-3">
        <strong className="block break-words text-base leading-snug">{product.product_name}</strong>
        <p className="break-all text-sm text-m3-grey-600">{product.sku} · {product.base_unit}</p>
      </div>
      {barcode ? <p aria-label="เลขบาร์โค้ดสินค้า" className="break-all px-3 py-4 text-center font-mono text-3xl font-bold leading-tight tabular-nums text-m3-grey-800 sm:text-4xl">{barcode}</p>
        : <p className="p-3 text-center text-sm text-m3-grey-600">ไม่มีบาร์โค้ด</p>}
      {claim && <p className="flex items-center gap-2 border-t border-m3-grey-200 px-4 py-2 text-sm font-semibold">
        <SolarMapPoint size={18} /> ชั้น {claim.shelf}</p>}
    </div>}
    {!claim ? <>
      <BarcodeScanInput id="count-scan" value={code} onChange={setCode} isProcessing={busy}
        className="[&_input]:text-base" placeholder={product ? "พิมพ์หรือสแกนรหัสชั้น" : "พิมพ์หรือสแกนรหัสสินค้า"} onScanSubmit={scan} />
      <div className="grid grid-cols-2 gap-2">
        <button className="m3-btn m3-btn-dark min-h-12" disabled={busy} onClick={() => { prepareFeedbackAudio(); setCamera(true); }}>
          <SolarQrCode size={20} /> เปิดกล้องสแกน</button>
        <button className="m3-btn m3-btn-outline min-h-12" disabled={busy || !code.trim()} onClick={() => scan(code)}>ใช้รหัสนี้</button>
      </div>
      <CameraBarcodeScannerModal isOpen={camera} onClose={() => setCamera(false)} onScan={scan} feedbackHandledByCaller />
    </> : <form onSubmit={e => { e.preventDefault(); void save(); }} className="space-y-4">
      {claim.previous && <fieldset className="space-y-2">
        <legend>ชั้นนี้เคยนับไว้ <strong>{claim.previous.quantity} {product?.base_unit}</strong></legend>
        {(["add", "set"] as const).map(value => <label key={value} className="mr-4 inline-flex min-h-11 items-center gap-2">
          <input type="radio" name="count-mode" required disabled={busy} checked={mode === value} onChange={() => setMode(value)} />
          {value === "add" ? "เพิ่มจากเดิม" : "แก้ยอดเดิม"}</label>)}
      </fieldset>}
      <label className="grid gap-1 font-semibold">{mode === "add" ? "จำนวนที่เพิ่ม" : "จำนวนที่นับได้"} ({product?.base_unit})
        <input autoFocus required type="number" inputMode="decimal" min="0" max="99999999999.999" step="0.001"
          className="w-full rounded-xl border p-3 text-2xl" value={qty} disabled={busy} onChange={e => setQty(e.target.value)} />
      </label>
      <button className="m3-btn m3-btn-dark min-h-12 w-full" disabled={busy || !mode || !qty.trim()}>บันทึกจำนวน</button>
    </form>}
    {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>}
    {notice && <p role="status" className="rounded-lg bg-m3-primary-lighter/50 px-3 py-2 text-sm font-semibold text-m3-primary-darker">{notice}</p>}
    {product
      ? <button type="button" className="m3-btn m3-btn-outline min-h-11 w-full" disabled={busy} onClick={back}>ย้อนกลับ</button>
      : <Link className="m3-btn m3-btn-outline min-h-11 w-full" href="/dashboard">กลับหน้าหลัก</Link>}
  </section>;
}

"use client";

import { useRef, useState } from "react";
import { v4 as uuid } from "uuid";
import { feedbackError, feedbackSuccess, prepareFeedbackAudio } from "@/client/feedback";
import BarcodeScanInput from "@/components/scanner/BarcodeScanInput";
import CameraBarcodeScannerModal from "@/components/ui/CameraBarcodeScannerModal";
import Link from "next/link";
import { SolarQrCode } from "@/components/icons";
import type { CountEntry, ScannedCountProduct } from "@/types/count-round";
import { errorText, getCount, sendCount } from "@/app/(dashboard)/stock-counts/_lib/count-client";

export default function CountScanner({ warehouse, round }: { warehouse: string; round: string }) {
  const [product, setProduct] = useState<ScannedCountProduct>();
  const [code, setCode] = useState("");
  const [qty, setQty] = useState("1");
  const [camera, setCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const processing = useRef(false);
  const pending = useRef<{ signature: string; request: string } | null>(null);
  const scanInput = useRef<HTMLInputElement>(null);
  function reset() {
    setProduct(undefined); setCode(""); setQty("1"); setError("");
    pending.current = null;
  }
  async function scan(raw: string, sound = false) {
    if (processing.current) return;
    processing.current = true;
    setCamera(false); setBusy(true); setError(""); setNotice("");
    try {
      if (!product) setProduct(await getCount<ScannedCountProduct>({ warehouse, product: raw }));
      else {
        const quantity = Number(qty);
        if (!qty.trim() || !Number.isFinite(quantity) || quantity < 0 || quantity > 99999999999.999 ||
          quantity !== Number(quantity.toFixed(3))) {
          throw new Error("กรอกจำนวนตั้งแต่ 0 ขึ้นไป ทศนิยมได้ไม่เกิน 3 ตำแหน่ง");
        }
        const body = { action: "scan", warehouse, round, product: product.product_id, shelf: raw.trim(), quantity };
        const signature = JSON.stringify(body);
        if (pending.current?.signature !== signature) pending.current = { signature, request: uuid() };
        const saved = await sendCount<CountEntry>({ ...body, request: pending.current.request });
        setNotice(`นับแล้ว · ${saved.sku} · ชั้น ${saved.shelf_code} · รวม ${saved.quantity} ${saved.base_unit}`);
        reset();
      }
      setCode("");
      if (sound) feedbackSuccess();
    } catch (e) {
      setError(errorText(e));
      if (sound) feedbackError();
    } finally { processing.current = false; setBusy(false); }
  }
  const step = product ? 2 : 1;
  const barcode = product?.barcode?.trim();
  return <section className="m3-card min-w-0 space-y-4 p-4 sm:p-6">
    <header>
      <div aria-hidden="true" className="mb-4 grid grid-cols-2 gap-1.5">
        {[1, 2].map(n => <span key={n} className={`h-1 rounded-full ${n <= step ? "bg-m3-primary" : "bg-m3-grey-200"}`} />)}
      </div>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-m3-grey-800"><label htmlFor="count-scan">{product ? "สแกนชั้นเพื่อนับ" : "สแกนสินค้า"}</label></h2>
        <span aria-label={`ขั้นที่ ${step} จาก 2`} className="shrink-0 text-sm font-semibold tabular-nums text-m3-grey-600">{step} / 2</span>
      </div>
    </header>
    {product && <div className="rounded-xl border border-m3-grey-200">
      <div className="space-y-1 rounded-t-xl bg-m3-grey-100 px-4 py-3">
        <strong className="block break-words text-base leading-snug">{product.product_name}</strong>
        <p className="break-all text-sm text-m3-grey-600">{product.sku} · {product.base_unit}</p>
      </div>
      {barcode ? <p aria-label="เลขบาร์โค้ดสินค้า" className="break-all px-3 py-4 text-center font-mono text-3xl font-bold leading-tight tabular-nums text-m3-grey-800 sm:text-4xl">{barcode}</p>
        : <p className="p-3 text-center text-sm text-m3-grey-600">ไม่มีบาร์โค้ด</p>}
    </div>}
    {product && <label className="grid gap-1 font-semibold">จำนวนที่นับ ({product.base_unit})
      <input type="number" inputMode="decimal" min="0" max="99999999999.999" step="0.001"
        className="w-full rounded-xl border p-3 text-2xl" value={qty} disabled={busy}
        onFocus={e => e.currentTarget.select()} onChange={e => setQty(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); scanInput.current?.focus(); } }} />
    </label>}
    <BarcodeScanInput inputRef={scanInput} id="count-scan" value={code} onChange={setCode} isProcessing={busy}
      className="[&_input]:text-base" placeholder={product ? "พิมพ์หรือสแกนรหัสชั้น" : "พิมพ์หรือสแกนรหัสสินค้า"} onScanSubmit={scan} />
    <div className="grid grid-cols-2 gap-2">
      <button className="m3-btn m3-btn-dark min-h-12" disabled={busy} onClick={() => { prepareFeedbackAudio(); setCamera(true); }}>
        <SolarQrCode size={20} /> เปิดกล้องสแกน</button>
      <button className="m3-btn m3-btn-outline min-h-12" disabled={busy || !code.trim()} onClick={() => scan(code)}>{product ? "นับที่ชั้นนี้" : "ใช้รหัสนี้"}</button>
    </div>
    <CameraBarcodeScannerModal isOpen={camera} onClose={() => setCamera(false)} onScan={scan} feedbackHandledByCaller />
    {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>}
    {notice && <p role="status" className="rounded-lg bg-m3-primary-lighter/50 px-3 py-2 text-sm font-semibold text-m3-primary-darker">{notice}</p>}
    {product
      ? <button type="button" className="m3-btn m3-btn-outline min-h-11 w-full" disabled={busy} onClick={reset}>ย้อนกลับ</button>
      : <Link className="m3-btn m3-btn-outline min-h-11 w-full" href="/dashboard">กลับหน้าหลัก</Link>}
  </section>;
}

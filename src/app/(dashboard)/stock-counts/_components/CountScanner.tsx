"use client";

import { useRef, useState } from "react";
import { v4 as uuid } from "uuid";
import { feedbackError, feedbackSuccess } from "@/client/feedback";
import BarcodeScanInput from "@/components/scanner/BarcodeScanInput";
import CameraBarcodeScannerModal from "@/components/ui/CameraBarcodeScannerModal";
import Link from "next/link";
import type { ScannedCountProduct } from "@/types/count-round";
import { errorText, getCount, sendCount } from "@/app/(dashboard)/stock-counts/_lib/count-client";
import { formatSavedNotice } from "@/app/(dashboard)/stock-counts/_lib/count-ui";
import { getCountPositions } from "@/lib/stock-count-positions";

export default function CountScanner({ warehouse }: { warehouse: string }) {
  const [product, setProduct] = useState<ScannedCountProduct>();
  const [shelf, setShelf] = useState("");
  const [code, setCode] = useState("");
  const [qty, setQty] = useState("");
  const [camera, setCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const processing = useRef(false);
  const pending = useRef<{ signature: string; request: string } | null>(null);
  const scanInput = useRef<HTMLInputElement>(null);

  const step = !product ? 1 : !shelf ? 2 : 3;
  const positions = step === 2 ? getCountPositions(warehouse) : undefined;

  function resetAll() {
    setProduct(undefined);
    setShelf("");
    setCode("");
    setQty("");
    setError("");
    pending.current = null;
  }

  function goBack() {
    if (step === 3) {
      setShelf("");
      setQty("");
      setError("");
      pending.current = null;
      return;
    }
    if (step === 2) {
      setProduct(undefined);
      setCode("");
      setError("");
    }
  }

  async function scan(raw: string, sound = false) {
    if (processing.current || step === 3) return;
    processing.current = true;
    setCamera(false); setBusy(true); setError(""); setNotice("");
    try {
      if (!product) {
        setProduct(await getCount<ScannedCountProduct>({ warehouse, product: raw }));
      } else {
        setShelf(await getCount<string>({ warehouse, location: raw.trim() }));
        setQty("");
      }
      setCode("");
      if (sound) feedbackSuccess();
    } catch (e) {
      setError(errorText(e));
      if (sound) feedbackError();
    } finally { processing.current = false; setBusy(false); }
  }

  async function save() {
    if (!product || !shelf || processing.current) return;
    const quantity = Number(qty);
    if (!qty.trim() || !Number.isFinite(quantity) || quantity < 0 || quantity > 99999999999.999 ||
      quantity !== Number(quantity.toFixed(3))) {
      setError("กรอกจำนวนตั้งแต่ 0 ขึ้นไป ทศนิยมได้ไม่เกิน 3 ตำแหน่ง");
      return;
    }
    processing.current = true;
    setBusy(true); setError("");
    try {
      const body = {
        action: "submit", warehouse, product: product.product_id, shelf,
        quantity,
      };
      const signature = JSON.stringify(body);
      if (pending.current?.signature !== signature) pending.current = { signature, request: uuid() };
      await sendCount({ ...body, request: pending.current.request });
      setNotice(formatSavedNotice({ ...product, shelf_code: shelf, quantity }));
      resetAll();
    } catch (e) {
      setError(errorText(e));
    } finally { processing.current = false; setBusy(false); }
  }

  const barcode = product?.barcode?.trim();
  const unit = product?.base_unit ?? "";
  return <section className="overflow-hidden rounded-2xl bg-white shadow-m3-card">
    <div className="space-y-4 p-4 sm:p-6">
      <header>
        <div aria-hidden="true" className="mb-4 grid grid-cols-3 gap-1.5">
          {[1, 2, 3].map(n => <span key={n} className={`h-1 rounded ${n <= step ? "bg-m3-primary" : "bg-m3-grey-200"}`} />)}
        </div>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-bold text-m3-grey-800">
            {step === 1 ? <label htmlFor="count-scan">สแกนสินค้า</label>
              : positions ? <label htmlFor="count-position">เลือกตำแหน่งที่ตรวจนับ</label>
              : step === 2 ? <label htmlFor="count-scan">สแกนตำแหน่ง</label>
              : "กรอกจำนวนที่นับได้"}
          </h2>
          <span aria-label={`ขั้นที่ ${step} จาก 3`} className="shrink-0 text-sm font-semibold tabular-nums text-m3-grey-600">{step} / 3</span>
        </div>
      </header>

      {notice && step === 1 && (
        <p role="status" className="flex items-center gap-2 rounded-xl bg-[rgba(0,167,111,.12)] px-3 py-2.5 text-[13px] font-bold text-[#007867]">
          <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center rounded-full bg-m3-primary text-[11px] text-white">✓</span>
          <span className="min-w-0 break-words">{notice}</span>
        </p>
      )}

      {product && (
        <div className="overflow-hidden rounded-xl bg-m3-grey-100">
          <div className="space-y-1 px-4 py-3">
            <strong className="block break-words text-base leading-snug text-m3-grey-800">{product.product_name}</strong>
            <p className="break-all text-sm text-m3-grey-600">{product.sku} · {product.base_unit}</p>
          </div>
          <div className="bg-white">
            {barcode
              ? <p aria-label="เลขบาร์โค้ดสินค้า" className="break-all px-3 py-4 text-center font-mono text-[28px] font-bold leading-tight tabular-nums text-m3-grey-800 sm:text-4xl">{barcode}</p>
              : <p className="p-3 text-center text-sm text-m3-grey-600">ไม่มีบาร์โค้ด</p>}
            {shelf && (
              <p className="flex items-center gap-1.5 border-t border-m3-grey-200 px-4 py-2.5 text-sm font-semibold text-m3-grey-800">
                <svg aria-hidden="true" className="size-4 shrink-0 text-m3-primary" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z" />
                </svg>
                ตำแหน่ง {shelf}
              </p>
            )}
          </div>
        </div>
      )}

      {positions && (
        <select id="count-position" value="" disabled={busy} onChange={e => void scan(e.target.value)}
          className="min-h-12 w-full rounded-xl border border-m3-grey-300 bg-white px-3 text-base">
          <option value="" disabled>เลือกห้องและชั้น</option>
          {positions.map(position => <option key={position} value={position}>{position}</option>)}
        </select>
      )}
      {step < 3 && !positions && (
        <>
          <BarcodeScanInput
            inputRef={scanInput}
            id="count-scan"
            value={code}
            onChange={setCode}
            isProcessing={busy}
            placeholder={step === 2 ? "พิมพ์หรือสแกนรหัสตำแหน่ง" : "พิมพ์หรือสแกนรหัสสินค้า"}
            onScanSubmit={scan}
            onOpenScannerModal={() => setCamera(true)}
            isScannerOpen={camera}
          />
          <button type="button" className="m3-btn m3-btn-outline min-h-12 w-full sm:min-h-12" disabled={busy || !code.trim()} onClick={() => scan(code)}>
            ใช้รหัสนี้
          </button>
        </>
      )}

      {step === 3 && product && (
        <div className="space-y-3">
          <label className="grid gap-1.5 text-sm font-semibold text-m3-grey-800">จำนวนที่นับได้ ({unit})
            <input type="number" inputMode="decimal" min="0" max="99999999999.999" step="0.001"
              className="h-14 w-full rounded-lg border border-[rgba(145,158,171,.32)] bg-white px-3 text-2xl font-semibold tabular-nums text-m3-grey-800 outline-none focus:border-m3-grey-800 focus:ring-1 focus:ring-m3-grey-800"
              value={qty} disabled={busy}
              onFocus={e => e.currentTarget.select()} onChange={e => setQty(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void save(); } }} />
          </label>
          <button type="button" className="m3-btn m3-btn-dark min-h-[52px] w-full sm:min-h-12" disabled={busy || !qty.trim()} onClick={() => void save()}>
            ยืนยัน
          </button>
        </div>
      )}

      <CameraBarcodeScannerModal isOpen={camera} onClose={() => setCamera(false)} onScan={scan} feedbackHandledByCaller />
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>}

      {step === 1
        ? <Link className="m3-btn m3-btn-outline min-h-12 w-full sm:min-h-12" href="/dashboard">กลับหน้าหลัก</Link>
        : <button type="button" className="m3-btn m3-btn-outline min-h-12 w-full sm:min-h-12" disabled={busy} onClick={goBack}>ย้อนกลับ</button>}
    </div>
  </section>;
}

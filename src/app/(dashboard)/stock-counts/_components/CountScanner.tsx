"use client";

import { useRef, useState } from "react";
import { v4 as uuid } from "uuid";
import { feedbackError, feedbackSuccess } from "@/client/feedback";
import BarcodeScanInput from "@/components/scanner/BarcodeScanInput";
import CameraBarcodeScannerModal from "@/components/ui/CameraBarcodeScannerModal";
import type { CountEntry, CountProduct } from "@/types/count-round";
import { errorText, getCount, sendCount } from "@/app/(dashboard)/stock-counts/_lib/count-client";

interface Claim { shelf: string; previous: CountEntry | null }

export default function CountScanner({ warehouse, round, refresh }: { warehouse: string; round: string; refresh: () => void }) {
  const [product, setProduct] = useState<CountProduct>();
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
  async function scan(raw: string, sound = false) {
    if (processing.current || claim) return;
    processing.current = true;
    setCamera(false); setBusy(true); setError(""); setNotice("");
    try {
      if (!product) setProduct(await getCount<CountProduct>({ warehouse, product: raw }));
      else {
        const next = await sendCount<Claim>({ action: "claim", warehouse, round, product: product.product_id, shelf: raw });
        setClaim(next); setMode(next.previous ? "" : "set"); refresh();
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
      reset(); refresh();
    } catch (e) { setError(errorText(e)); } finally { processing.current = false; setBusy(false); }
  }
  return <section className="m3-card space-y-4 p-5 sm:p-6">
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-xl font-bold">{claim ? "กรอกจำนวนที่นับได้" : <label htmlFor="count-scan">{product ? "สแกนชั้นวาง" : "สแกนสินค้า"}</label>}</h2>
      <span className="text-sm text-m3-grey-600">ขั้นที่ {claim ? 3 : product ? 2 : 1} / 3</span>
    </div>
    {product && <div className="rounded-xl bg-m3-grey-100 p-3"><strong>{product.product_name}</strong>
      <p className="text-sm">{product.sku} · หน่วย {product.base_unit}{claim && ` · ชั้น ${claim.shelf}`}</p></div>}
    {!claim ? <>
      <BarcodeScanInput id="count-scan" value={code} onChange={setCode} isProcessing={busy}
        placeholder={product ? "สแกนหรือพิมพ์รหัสชั้น" : "สแกนบาร์โค้ดหรือพิมพ์ SKU"} onScanSubmit={scan}
        isScannerOpen={camera} onOpenScannerModal={() => setCamera(true)} />
      <CameraBarcodeScannerModal isOpen={camera} onClose={() => setCamera(false)} onScan={scan} feedbackHandledByCaller />
      {code.trim() && <button className="m3-btn m3-btn-outline" disabled={busy} onClick={() => scan(code)}>ใช้รหัสนี้</button>}
    </> : <form onSubmit={e => { e.preventDefault(); void save(); }} className="space-y-4">
      {claim.previous && <fieldset className="space-y-2">
        <legend>ชั้นนี้เคยนับไว้ <strong>{claim.previous.quantity} {product?.base_unit}</strong></legend>
        {(["add", "set"] as const).map(value => <label key={value} className="mr-4 inline-flex items-center gap-2">
          <input type="radio" name="count-mode" required disabled={busy} checked={mode === value} onChange={() => setMode(value)} />
          {value === "add" ? "เพิ่มจากเดิม" : "แก้ยอดเดิม"}</label>)}
      </fieldset>}
      <label className="grid gap-1 font-semibold">{mode === "add" ? "จำนวนที่เพิ่ม" : "จำนวนที่นับได้"} ({product?.base_unit})
        <input autoFocus required type="number" inputMode="decimal" min="0" max="99999999999.999" step="0.001"
          className="w-full rounded-xl border p-3 text-2xl" value={qty} disabled={busy} onChange={e => setQty(e.target.value)} />
      </label>
      <button className="m3-btn m3-btn-primary w-full" disabled={busy || !mode || !qty.trim()}>บันทึกจำนวน</button>
    </form>}
    {product && <button className="m3-btn m3-btn-outline" disabled={busy} onClick={reset}>สแกนใหม่</button>}
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {notice && <p role="status" className="font-semibold text-m3-primary">{notice}</p>}
  </section>;
}

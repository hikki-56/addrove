"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { matchesOfficeSearch } from "@/lib/office";
import type { OfficeProduct } from "@/types/office";
import { OfficeError, OfficeProductIdentity, OfficeSearch, officeNumber, officeRequest } from "@/features/office/components/OfficeUi";
import "@/features/office/components/office.css";

const endpoint = "/api/office/stock-cuts";
type Selection = { product: OfficeProduct; quantity: string };

export default function OfficeStockCutsPage() {
  const [products, setProducts] = useState<OfficeProduct[]>([]);
  const [selections, setSelections] = useState<Selection[]>([]);
  const [search, setSearch] = useState("");
  const [note, setNote] = useState("");
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState("");
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const request = useRef({ signature: "", key: "" });

  useEffect(() => {
    const controller = new AbortController();
    officeRequest<OfficeProduct[]>(endpoint, { signal: controller.signal })
      .then(rows => { if (!controller.signal.aborted) setProducts(rows); })
      .catch((err: Error) => { if (!controller.signal.aborted) setLoadError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [version]);

  function refresh() {
    setLoading(true);
    setLoadError("");
    setVersion(current => current + 1);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current || !selections.length) return;
    const lines = selections.map(({ product, quantity }) => ({ product_id: product.product_id, quantity: Number(quantity) }));
    const payload = { lines, note: note.trim() };
    const signature = JSON.stringify(payload);
    if (signature !== request.current.signature) request.current = { signature, key: crypto.randomUUID() };
    sending.current = true;
    setBusy(true);
    setError("");
    setReceipt("");
    try {
      const doc = await officeRequest<{ document_no: string }>(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, idempotency_key: request.current.key }),
      });
      setReceipt(`ตัดสต็อกแล้ว ${lines.length} รายการ · เอกสาร ${doc.document_no}`);
      setSelections([]);
      setNote("");
      setSearch("");
      request.current = { signature: "", key: "" };
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ตัดสต็อกไม่สำเร็จ กรุณาลองอีกครั้ง");
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  const selectedIds = new Set(selections.map(row => row.product.product_id));
  const available = products.filter(product => !selectedIds.has(product.product_id) && matchesOfficeSearch(product, search));
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-m3-primary-dark">ตัดสต็อกสำนักงานใหญ่</h1>
        <p className="mt-1 text-sm text-m3-grey-600">เลือกสินค้าบาร์โค้ด 13 หลักจากคลังสำนักงานใหญ่</p>
      </header>
      {receipt && <p role="status" className="rounded-xl bg-green-50 p-4 text-green-800">{receipt}</p>}
      {loadError && <OfficeError message={loadError} retry={refresh} />}
      <form onSubmit={submit}>
        <fieldset disabled={busy || loading || Boolean(loadError)} className="space-y-5">
          <section className="rounded-2xl bg-white p-4 shadow-sm sm:p-6">
            <h2 className="mb-3 font-bold">เลือกสินค้า</h2>
            <OfficeSearch value={search} onChange={setSearch} />
            <ul className="mt-3 max-h-72 divide-y divide-m3-grey-200 overflow-y-auto">
              {available.map(product => <li key={product.product_id}>
                <button type="button" className="flex w-full flex-wrap items-center justify-between gap-2 py-3 text-left"
                  aria-label={`เพิ่ม ${product.product_name} ${product.barcode}`}
                  onClick={() => setSelections(rows => [...rows, { product, quantity: String(Math.min(1, product.quantity)) }])}>
                  <OfficeProductIdentity item={product} search={search} />
                  <span className="text-sm">คงเหลือ {officeNumber(product.quantity)} {product.base_unit} <b className="ml-2">+ เพิ่ม</b></span>
                </button>
              </li>)}
            </ul>
            {(loading || (!available.length && !loadError)) && <p className="py-3 text-sm text-m3-grey-600">
              {loading ? "กำลังโหลดยอดคงเหลือ…" : "ไม่มีสินค้าที่ตรงกับเงื่อนไขให้เลือกเพิ่ม"}
            </p>}
          </section>
          <section className="space-y-4 rounded-2xl bg-white p-4 shadow-sm sm:p-6">
            <h2 className="font-bold">รายการที่จะตัดสต็อก ({selections.length})</h2>
            {selections.map(({ product, quantity }) => <div key={product.product_id} className="flex flex-wrap items-center justify-between gap-3 border-b border-m3-grey-200 pb-3">
              <OfficeProductIdentity item={product} />
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <label>จำนวน <input type="number" inputMode="decimal" min="0.001" max={product.quantity} step="0.001" required
                  aria-label={`จำนวน ${product.product_name}`} value={quantity}
                  className="w-20 rounded-lg border border-m3-grey-300 px-2 py-1.5"
                  onChange={event => {
                    const value = event.target.value;
                    setSelections(rows => rows.map(row => row.product.product_id === product.product_id ? { ...row, quantity: value } : row));
                  }} /> {product.base_unit}</label>
                <button type="button" aria-label={`ลบ ${product.product_name}`} className="px-2 py-1.5 text-red-700"
                  onClick={() => setSelections(rows => rows.filter(row => row.product.product_id !== product.product_id))}>ลบ</button>
              </div>
            </div>)}
            <label className="block text-sm font-semibold">หมายเหตุ (ถ้ามี)
              <textarea value={note} onChange={event => setNote(event.target.value)} maxLength={500} rows={2}
                className="mt-2 block w-full rounded-xl border border-m3-grey-300 p-3 font-normal" />
            </label>
            {error && <OfficeError message={error} />}
            <button type="submit" disabled={!selections.length || busy} className="office-button office-button-dark disabled:opacity-50">
              {busy ? "กำลังบันทึก…" : "ยืนยันตัดสต็อก"}
            </button>
          </section>
        </fieldset>
      </form>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import type { OfficeProduct } from "@/types/office";
import { matchesOfficeSearch } from "@/lib/office";
import CameraBarcodeScannerModal from "@/components/ui/CameraBarcodeScannerModal";
import { SolarBox } from "@/components/icons";
import { OfficeDialog, OfficeError, OfficeLocationBadge, OfficeProductIdentity, OfficeSearch, officeNumber, officeRequest } from "./OfficeUi";
import "./office.css";

// Preserve all 13 digits. The shared BarcodeSvg intentionally converts values
// to the app's older eight-digit format, which does not apply to office stock.
function FullOfficeBarcode({ value }: { value: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (ref.current) JsBarcode(ref.current, value, { format: "CODE128", width: 1.5, height: 60, displayValue: true, margin: 8, fontSize: 16 });
  }, [value]);
  return <svg ref={ref} role="img" aria-label={`บาร์โค้ด ${value}`} />;
}

export default function OfficeProductsWorkspace() {
  const [products, setProducts] = useState<OfficeProduct[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [scanner, setScanner] = useState(false);
  const [selected, setSelected] = useState<OfficeProduct | null>(null);
  const [reload, setReload] = useState(0);
  const refresh = useCallback(() => setReload((n) => n + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    officeRequest<OfficeProduct[]>("/api/office?view=products", { signal: controller.signal })
      .then(setProducts).catch((err: Error) => { if (!controller.signal.aborted) setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload]);
  useEffect(() => {
    window.addEventListener("stockify-office-updated", refresh);
    window.addEventListener("focus", refresh);
    return () => { window.removeEventListener("stockify-office-updated", refresh); window.removeEventListener("focus", refresh); };
  }, [refresh]);
  const results = products.filter((product) => matchesOfficeSearch(product, query));
  return <div className="office-workspace"><section className="office-panel office-products-panel" aria-busy={loading}>
    <div className="office-products-heading"><h2>สินค้าออฟฟิศ</h2><span className="office-count">{products.length}</span></div>
    <OfficeSearch value={query} onChange={setQuery} onScan={() => setScanner(true)} />
    {error && <div style={{ marginTop: 16 }}><OfficeError message={error} retry={refresh} /></div>}
    {loading ? <div className="office-empty" role="status">กำลังโหลดสินค้าออฟฟิศ…</div> : <><div className="office-mobile-result-count" aria-live="polite">{results.length} รายการ</div>{results.length ? <div className="office-products-grid">{results.map((item) => <button type="button" className="office-stock-card" key={`${item.product_id}-${item.location_id}`} onClick={() => setSelected(item)} aria-label={`${item.product_name} ตำแหน่ง ${item.location_code} คงเหลือ ${officeNumber(item.quantity)} ${item.base_unit}`}><div className="office-stock-top"><OfficeLocationBadge code={item.location_code} /><div className="office-stock-quantity"><strong>{officeNumber(item.quantity)}</strong><small>{item.base_unit}</small></div></div><OfficeProductIdentity item={item} search={query} /></button>)}</div> : !error && <div className="office-empty"><SolarBox size={56} /><strong>{query ? "ไม่พบสินค้าที่ค้นหา" : "ยังไม่มีสินค้าออฟฟิศ"}</strong><span>{query ? "ลองค้นหาด้วยรหัส ชื่อ บาร์โค้ด หรือเลขท้าย 4 หลัก" : "สินค้าในออฟฟิศที่มีบาร์โค้ด 13 หลักจะแสดงที่นี่"}</span></div>}</>}
    <CameraBarcodeScannerModal isOpen={scanner} onClose={() => setScanner(false)} onScan={(code) => { setQuery(code.trim()); setScanner(false); }} />
    <OfficeDialog open={!!selected} onClose={() => setSelected(null)} title={selected?.sku || "รายละเอียดสินค้า"}>{selected && <><OfficeProductIdentity item={selected} /><div className="office-detail-location"><div><div className="office-caption" style={{ marginBottom: 8 }}>ตำแหน่ง</div><OfficeLocationBadge code={selected.location_code} /></div><div className="office-stock-quantity"><div className="office-caption">คงเหลือ</div><strong>{officeNumber(selected.quantity)}</strong><small>{selected.base_unit}</small></div></div><div className="office-detail-barcode"><div className="office-caption" style={{ marginBottom: 12 }}>บาร์โค้ด</div><FullOfficeBarcode value={selected.barcode} /></div></>}</OfficeDialog>
  </section></div>;
}

"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Location } from "@/types/models";
import type { OfficeProduct, OfficeSetup } from "@/types/office";
import { matchesOfficeSearch } from "@/lib/office";
import { SolarArrowRight, SolarBuildings, SolarMapPoint, SolarBox, SolarCheckCircle } from "@/components/icons";
import { OfficeDialog, OfficeError, OfficeProductIdentity, OfficeQuantity, OfficeSearch, OfficeShopIcon, officeNumber, officeRequest } from "./OfficeUi";
import OfficeTransferHistory from "./OfficeTransferHistory";
import "./office.css";

interface CartLine extends OfficeProduct { key: string; available: number }

function LocationField({ value, onChange, locations, label = "ตำแหน่งออฟฟิศ" }: { value: string; onChange: (value: string) => void; locations: Location[]; label?: string }) {
  const id = useId();
  return <div className="office-field office-location-field"><label htmlFor={id}>ตำแหน่ง</label><SolarMapPoint size={20} /><input id={id} aria-label={label} list={`${id}-locations`} placeholder="เช่น OF-A-01" value={value} maxLength={100} autoComplete="off" onChange={(e) => onChange(e.target.value.toUpperCase())} /><datalist id={`${id}-locations`}>{locations.map((l) => <option key={l.location_id} value={l.location_code} />)}</datalist></div>;
}

export default function OfficeTransferWorkspace() {
  const [tab, setTab] = useState("form");
  const [setup, setSetup] = useState<OfficeSetup | null>(null);
  const [warehouseId, setWarehouseId] = useState("");
  const [products, setProducts] = useState<OfficeProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [productsLoading, setProductsLoading] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<OfficeProduct | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [location, setLocation] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [mobilePicker, setMobilePicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState("");
  const sending = useRef(false);
  const requestKey = useRef({ signature: "", key: "" });

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    officeRequest<OfficeSetup>("/api/office?view=setup", { signal: controller.signal }).then((data) => {
      setSetup(data);
      setWarehouseId((current) => data.warehouses.some((w) => w.warehouse_id === current) ? current : data.warehouses[0]?.warehouse_id || "");
    }).catch((err: Error) => { if (!controller.signal.aborted) setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload]);

  useEffect(() => {
    if (!warehouseId) return;
    const controller = new AbortController();
    setProductsLoading(true);
    setProducts([]);
    officeRequest<OfficeProduct[]>(`/api/office?view=products&warehouse_id=${encodeURIComponent(warehouseId)}`, { signal: controller.signal })
      .then(setProducts).catch((err: Error) => { if (!controller.signal.aborted) setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setProductsLoading(false); });
    return () => controller.abort();
  }, [warehouseId, reload]);

  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => setSuccess(""), 6000);
    return () => clearTimeout(timer);
  }, [success]);

  const total = lines.reduce((sum, line) => sum + (Number.isFinite(line.quantity) ? line.quantity : 0), 0);
  const locations = setup?.locations || [];
  const results = products.filter((item) => matchesOfficeSearch(item, query));
  const remainingFor = (item: OfficeProduct, except?: string) => item.quantity - lines.filter((line) => line.product_id === item.product_id && line.key !== except).reduce((sum, line) => sum + (line.quantity || 0), 0);

  function selectProduct(item: OfficeProduct) {
    setSelected(item);
    setQuery(item.product_name);
    setQuantity(1);
    setPickerOpen(false);
  }

  function clearComposer() {
    setSelected(null); setQuery(""); setQuantity(1); setLocation(""); setPickerOpen(false);
  }

  function addLine() {
    if (!selected) { setError("กรุณาเลือกสินค้า"); return; }
    if (!location.trim()) { setError("กรุณาระบุตำแหน่งที่เก็บในออฟฟิศ"); return; }
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > remainingFor(selected)) { setError("จำนวนที่เบิกต้องมากกว่า 0 และไม่เกินสต็อกต้นทางที่เหลือ"); return; }
    setLines((current) => [...current, { ...selected, key: crypto.randomUUID(), quantity, available: selected.quantity, location_code: location.trim().toUpperCase() }]);
    setError(""); clearComposer(); setMobilePicker(false);
  }

  async function submit() {
    if (sending.current || !lines.length) return;
    if (lines.some((line) => !line.location_code.trim() || !Number.isFinite(line.quantity) || line.quantity <= 0)) { setError("กรุณาตรวจสอบจำนวนและตำแหน่งของทุกรายการ"); return; }
    for (const product of products) {
      if (remainingFor(product) < 0) { setError(`${product.product_name}: จำนวนรวมเกินสต็อกต้นทาง`); return; }
    }
    const payload = { from_warehouse_id: warehouseId, lines: lines.map((line) => ({ product_id: line.product_id, quantity: line.quantity, location_code: line.location_code.trim() })) };
    const signature = JSON.stringify(payload);
    if (requestKey.current.signature !== signature) requestKey.current = { signature, key: crypto.randomUUID() };
    sending.current = true; setBusy(true); setError("");
    try {
      await officeRequest("/api/office", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, idempotency_key: requestKey.current.key }) });
      setSuccess(`เบิกแล้ว ${lines.length} รายการ · ${officeNumber(total)} ชิ้น → ออฟฟิศ`);
      setLines([]); clearComposer(); requestKey.current = { signature: "", key: "" }; setReload((n) => n + 1);
      window.dispatchEvent(new Event("stockify-office-updated"));
    } catch (err) { setError(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ กรุณาลองใหม่"); }
    finally { sending.current = false; setBusy(false); }
  }

  const productOptions = <>{productsLoading ? <div className="office-empty" role="status">กำลังโหลดสินค้า…</div> : !results.length ? <div className="office-empty">ไม่พบสินค้าบาร์โค้ด 13 หลักที่มีสต็อก</div> : results.map((item) => <button type="button" key={item.product_id} className="office-product-option" disabled={remainingFor(item) <= 0} onClick={() => selectProduct(item)}><OfficeProductIdentity item={item} /><span className="office-option-quantity">{officeNumber(Math.max(0, remainingFor(item)))} <small>{item.base_unit}</small></span></button>)}</>;

  return <div className="office-workspace">
    <div className="office-tabs" role="tablist" aria-label="เบิกไปออฟฟิศ"><button id="office-form-tab" role="tab" aria-controls="office-form" aria-selected={tab === "form"} onClick={() => setTab("form")}>เบิกไปออฟฟิศ</button><button id="office-history-tab" role="tab" aria-controls="office-history" aria-selected={tab === "history"} onClick={() => setTab("history")}>ประวัติ</button></div>
    {tab === "history" ? <div id="office-history" role="tabpanel" aria-labelledby="office-history-tab"><OfficeTransferHistory warehouses={setup?.warehouses || []} /></div> : <div id="office-form" role="tabpanel" aria-labelledby="office-form-tab">
      {error && <OfficeError message={error} retry={() => { setError(""); setReload((n) => n + 1); }} />}
      {!loading && !setup?.office && <OfficeError message="ยังไม่มีออฟฟิศที่เปิดใช้งาน กรุณาตรวจสอบข้อมูลคลังสินค้า" />}
      <fieldset disabled={busy || loading || !setup?.office} className="office-panel office-form-panel" aria-busy={busy || loading}>
        <div className="office-route"><div className="office-field office-source"><label htmlFor="office-source">โกดังต้นทาง</label><SolarBuildings size={22} /><select id="office-source" value={warehouseId} onChange={(e) => { setWarehouseId(e.target.value); setLines([]); clearComposer(); setError(""); }}><option value="" disabled>{loading ? "กำลังโหลด…" : "เลือกโกดัง"}</option>{setup?.warehouses.map((wh) => <option key={wh.warehouse_id} value={wh.warehouse_id}>{wh.warehouse_name}</option>)}</select></div><SolarArrowRight className="office-route-arrow" size={24} /><div className="office-field office-destination"><label>ปลายทาง</label><OfficeShopIcon className="office-shop-icon" /><span>ออฟฟิศ</span><svg className="office-lock" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-label="ปลายทางคงที่"><path opacity=".5" d="M5 10h14v11H5z" /><path d="M7 10V7a5 5 0 0 1 10 0v3h-2V7a3 3 0 0 0-6 0v3H7Zm4 4h2v4h-2z" /></svg></div></div>
        <div className="office-composer"><div className="office-picker" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setPickerOpen(false); }} onKeyDown={(e) => { if (e.key === "Escape") setPickerOpen(false); }}><div onFocus={() => { if (!selected) setPickerOpen(true); }}><OfficeSearch value={query} onChange={(value) => { setQuery(value); setSelected(null); setPickerOpen(true); }} placeholder="ค้นหาสินค้า / รหัส / บาร์โค้ด" /></div>{pickerOpen && <div className="office-dropdown"><div className="office-dropdown-heading"><span>บาร์โค้ด 13 หลัก</span><span>{results.length} รายการ</span></div>{productOptions}</div>}</div><OfficeQuantity value={quantity} max={selected ? remainingFor(selected) : undefined} onChange={setQuantity} /><LocationField value={location} onChange={setLocation} locations={locations} /><button type="button" className="office-button office-button-dark" disabled={!selected || productsLoading} onClick={addLine}>เพิ่ม</button></div>
        <div className="office-section-heading"><h2>รายการเบิก <span className="office-section-summary">{lines.length > 0 && `(${lines.length} รายการ / ${officeNumber(total)} ชิ้น)`}</span></h2>{lines.length > 0 && <button type="button" className="office-button office-button-text office-clear-all" onClick={() => setLines([])}>ล้างทั้งหมด</button>}</div>
        {lines.length === 0 ? <div className="office-empty"><SolarBox size={52} /><span>{loading ? "กำลังโหลด…" : "ยังไม่มีรายการ"}</span></div> : lines.map((line) => <div key={line.key} className="office-cart-row"><OfficeProductIdentity item={line}><span className="office-available"> · มี {officeNumber(line.available)} {line.base_unit}</span></OfficeProductIdentity><div className="office-cart-controls"><OfficeQuantity value={line.quantity} label={`จำนวน ${line.sku}`} max={line.available - lines.filter((l) => l.product_id === line.product_id && l.key !== line.key).reduce((sum, l) => sum + (l.quantity || 0), 0)} onChange={(value) => setLines((current) => current.map((l) => l.key === line.key ? { ...l, quantity: value } : l))} /><LocationField value={line.location_code} label={`ตำแหน่งออฟฟิศ ${line.sku}`} locations={locations} onChange={(value) => setLines((current) => current.map((l) => l.key === line.key ? { ...l, location_code: value } : l))} /><button type="button" className="office-button office-button-text" aria-label={`ลบ ${line.sku}`} onClick={() => setLines((current) => current.filter((l) => l.key !== line.key))}>ลบ</button></div><div className="office-mobile-available">มี {officeNumber(line.available)} {line.base_unit}</div></div>)}
        <button type="button" className="office-mobile-add" onClick={() => { clearComposer(); setMobilePicker(true); }}><span>+</span>เพิ่มสินค้า</button>
        <div className="office-form-actions"><button type="button" className="office-button office-button-outline" onClick={() => { setLines([]); clearComposer(); setError(""); }}>ล้าง</button><button type="button" className="office-button office-button-dark" disabled={!lines.length || busy || productsLoading} onClick={submit}>{busy ? "กำลังบันทึก…" : `ยืนยันเบิก${lines.length ? ` (${lines.length} รายการ / ${officeNumber(total)} ชิ้น)` : ""}`}</button></div>
      </fieldset>
      <OfficeDialog open={mobilePicker} onClose={() => setMobilePicker(false)} title="เลือกสินค้า"><div className="office-caption" style={{ marginBottom: 12 }}>บาร์โค้ด 13 หลัก</div><OfficeSearch value={query} onChange={(value) => { setQuery(value); setSelected(null); }} placeholder="ค้นหาสินค้า / รหัส / บาร์โค้ด" />{!selected && <div className="office-picker-sheet-list">{productOptions}</div>}{selected && <><div style={{ marginTop: 20 }}><OfficeProductIdentity item={selected} /></div><div className="office-picker-sheet-controls"><OfficeQuantity value={quantity} max={remainingFor(selected)} onChange={setQuantity} /><LocationField value={location} onChange={setLocation} locations={locations} /></div>{error && <OfficeError message={error} />}<button type="button" className="office-button office-button-dark office-picker-sheet-add" onClick={addLine}>เพิ่มสินค้า</button></>}</OfficeDialog>
    </div>}
    {success && <div className="office-success" role="status"><SolarCheckCircle size={24} />{success}</div>}
  </div>;
}

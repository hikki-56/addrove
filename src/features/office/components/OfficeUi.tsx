"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { SolarBox, SolarMapPoint, SolarClose } from "@/components/icons";
import type { OfficeProduct } from "@/types/office";

export { OfficeShopIcon } from "@/components/icons/OfficeShopIcon";

export const officeNumber = (value: number) => value.toLocaleString("th-TH", { maximumFractionDigits: 3 });

export async function officeRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...options });
  const body = await response.json();
  if (!response.ok || !body.success) throw new Error(body.message || "โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่");
  return body.data as T;
}

export function OfficeLocationBadge({ code }: { code: string }) {
  return <span className="office-location-badge"><SolarMapPoint size={20} />{code || "ไม่ระบุ"}</span>;
}

export function OfficeProductIdentity({ item, children, search = "" }: { item: Pick<OfficeProduct, "sku" | "barcode" | "product_name">; children?: ReactNode; search?: string }) {
  const highlight = /^\d{4}$/.test(search.trim()) && item.barcode.endsWith(search.trim());
  return <div className="office-identity"><span className="office-product-icon"><SolarBox size={24} /></span><div className="office-product-copy"><div className="office-product-name">{item.product_name}</div><div className="office-caption">{item.sku} · <span className="office-barcode">{highlight ? <>{item.barcode.slice(0, -4)}<mark style={{ background: "rgba(0,167,111,.16)", color: "#007867", borderRadius: 4, padding: "1px 4px", fontWeight: 700 }}>{item.barcode.slice(-4)}</mark></> : item.barcode}</span>{children}</div></div></div>;
}

export function OfficeSearch({ value, onChange, onScan, placeholder = "รหัส / ชื่อ / บาร์โค้ด / 4 ตัวท้าย" }: { value: string; onChange: (value: string) => void; onScan?: () => void; placeholder?: string }) {
  return <div className="office-search"><svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="7.5" /><path d="m16 16 6 6" /></svg><input type="search" aria-label={placeholder} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />{value && <button type="button" aria-label="ล้างคำค้นหา" onClick={() => onChange("")}><SolarClose size={18} /></button>}{onScan && <button type="button" aria-label="สแกนบาร์โค้ด" onClick={onScan}><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><rect x="3" y="2" width="18" height="20" rx="4" /><path d="M8 6H7v2m9-2h1v2M8 18H7v-2m9 2h1v-2M3 12h18" /></svg></button>}</div>;
}

export function OfficeQuantity({ value, onChange, max, label = "จำนวนที่เบิก" }: { value: number; onChange: (value: number) => void; max?: number; label?: string }) {
  return <div className="office-quantity"><button type="button" aria-label={`ลด${label}`} disabled={value <= 1} onClick={() => onChange(Math.max(1, value - 1))}>−</button><input aria-label={label} type="number" inputMode="decimal" min="0.001" step="0.001" max={max} value={Number.isNaN(value) ? "" : value} onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value))} /><button type="button" aria-label={`เพิ่ม${label}`} disabled={max !== undefined && value >= max} onClick={() => onChange(Math.min(max ?? Infinity, (value || 0) + 1))}>+</button></div>;
}

export function OfficeDialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal();
    if (!open && ref.current?.open) ref.current?.close();
  }, [open]);
  return <dialog ref={ref} className="office-dialog" onCancel={onClose} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}><div className="office-dialog-inner"><div className="office-dialog-heading"><h2>{title}</h2><button type="button" aria-label="ปิด" onClick={onClose}><SolarClose /></button></div>{children}</div></dialog>;
}

export function OfficeError({ message, retry }: { message: string; retry?: () => void }) {
  return <div className="office-error" role="alert">{message}{retry && <button type="button" onClick={retry}>ลองใหม่</button>}</div>;
}

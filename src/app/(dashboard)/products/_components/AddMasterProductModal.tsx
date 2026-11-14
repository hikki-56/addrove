"use client";

import { useState, type FormEvent } from "react";
import { CreateMasterProductSchema } from "@/types/api";
import type { Product } from "@/types/models";
import { useEscapeKey } from "@/hooks/use-escape-key";
import { M3Dialog, M3ErrorBanner, M3SubmitLabel, m3Cls } from "@/components/ui/m3";
import { SolarBox } from "@/components/icons/solar";

const fields = [
  { name: "sku", label: "รหัสสินค้า (SKU)", required: true, maxLength: 50 },
  { name: "barcode", label: "บาร์โค้ด", maxLength: 50 },
  { name: "product_name", label: "ชื่อสินค้า", required: true, maxLength: 200 },
  { name: "category", label: "หมวดหมู่", required: true, maxLength: 100 },
  { name: "base_unit", label: "หน่วยนับ", required: true, maxLength: 20, defaultValue: "ชิ้น" },
  { name: "supplier", label: "ผู้จัดจำหน่าย", maxLength: 200 },
] as const;

export default function AddMasterProductModal({ onClose, onSaved }: { onClose: () => void; onSaved: (product: Product) => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEscapeKey(!submitting, onClose);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    const form = new FormData(event.currentTarget);
    const cartonSize = String(form.get("units_per_carton") || "").trim();
    const parsed = CreateMasterProductSchema.safeParse({
      ...Object.fromEntries(fields.map(field => [field.name, String(form.get(field.name) || "").trim()])),
      minimum_stock: Number(form.get("minimum_stock") || 0),
      ...(cartonSize ? { units_per_carton: Number(cartonSize) } : {}),
      description: String(form.get("description") || "").trim(),
    });
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/products/master", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data),
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.errors?.[0]?.message || json.message || "เพิ่มสินค้าไม่สำเร็จ");
      onSaved(json.data as Product);
    } catch (e) {
      setError(e instanceof Error ? e.message : "เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setSubmitting(false);
    }
  };

  return <M3Dialog title="เพิ่มสินค้าในทะเบียน" hint="บันทึกข้อมูลสินค้าโดยไม่เพิ่มยอดสต็อก" icon={<SolarBox size={26} />} widthClass="sm:max-w-[560px]"
    onBackdrop={() => { if (!submitting) onClose(); }} footer={<>
      <button type="button" disabled={submitting} onClick={onClose} className={m3Cls.btnCancel}>ยกเลิก</button>
      <button type="submit" form="add-master-product" disabled={submitting} className={m3Cls.btnPrimary}>
        <M3SubmitLabel submitting={submitting}>บันทึกสินค้าในทะเบียน</M3SubmitLabel>
      </button>
    </>}>
    {error && <M3ErrorBanner message={error} />}
    <form id="add-master-product" onSubmit={submit}>
      <fieldset disabled={submitting} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {fields.map(field => <label key={field.name} className={`block ${field.name === "product_name" ? "sm:col-span-2" : ""}`}>
          <span className={m3Cls.label}>{field.label}{"required" in field && field.required ? " *" : ""}</span>
          <input name={field.name} required={"required" in field && field.required} maxLength={field.maxLength}
            defaultValue={"defaultValue" in field ? field.defaultValue : undefined} autoFocus={field.name === "sku"} className={`mt-1.5 ${m3Cls.input}`} />
        </label>)}
        <label className="block"><span className={m3Cls.label}>จำนวนแจ้งเตือนขั้นต่ำ</span>
          <input name="minimum_stock" type="number" min="0" step="any" defaultValue="0" className={`mt-1.5 ${m3Cls.input}`} />
        </label>
        <label className="block"><span className={m3Cls.label}>จำนวนบรรจุต่อลัง</span>
          <input name="units_per_carton" type="number" min="1" step="1" max="2147483647" placeholder="ไม่ระบุ" className={`mt-1.5 ${m3Cls.input}`} />
        </label>
        <label className="block sm:col-span-2"><span className={m3Cls.label}>รายละเอียดเพิ่มเติม</span>
          <textarea name="description" maxLength={500} rows={2} className={`mt-1.5 ${m3Cls.input}`} />
        </label>
      </fieldset>
    </form>
  </M3Dialog>;
}

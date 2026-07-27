"use client";
import { useEffect, useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { IssueDocumentSchema, type IssueDocumentInput } from "@/types/api";
import type { Warehouse, Location, Product } from "@/types/models";
import { v4 as uuidv4 } from "uuid";

export default function IssuePage() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [stockBalances, setStockBalances] = useState<Record<string, number>>({});
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const defaultWarehouses = [
    { warehouse_id: "wh-1", warehouse_name: "โกดัง 1" },
    { warehouse_id: "wh-2", warehouse_name: "โกดัง 2" },
    { warehouse_id: "wh-3", warehouse_name: "โกดัง 3" },
    { warehouse_id: "wh-4", warehouse_name: "โกดัง 4" },
    { warehouse_id: "wh-5", warehouse_name: "โกดัง 5" },
  ];

  const wh1Locations: Location[] = [
    { location_id: "loc-14A1", warehouse_id: "wh-1", zone: "A", aisle: "14", rack: "1", shelf: "1", bin: "1", location_code: "14A1", description: "ตำแหน่ง 14A1", active: true, created_at: "", updated_at: "" },
    { location_id: "loc-14B1", warehouse_id: "wh-1", zone: "B", aisle: "14", rack: "1", shelf: "1", bin: "1", location_code: "14B1", description: "ตำแหน่ง 14B1", active: true, created_at: "", updated_at: "" },
    { location_id: "loc-15A1", warehouse_id: "wh-1", zone: "A", aisle: "15", rack: "1", shelf: "1", bin: "1", location_code: "15A1", description: "ตำแหน่ง 15A1", active: true, created_at: "", updated_at: "" },
    { location_id: "loc-15B1", warehouse_id: "wh-1", zone: "B", aisle: "15", rack: "1", shelf: "1", bin: "1", location_code: "15B1", description: "ตำแหน่ง 15B1", active: true, created_at: "", updated_at: "" },
    { location_id: "loc-16A1", warehouse_id: "wh-1", zone: "A", aisle: "16", rack: "1", shelf: "1", bin: "1", location_code: "16A1", description: "ตำแหน่ง 16A1", active: true, created_at: "", updated_at: "" },
    { location_id: "loc-16B1", warehouse_id: "wh-1", zone: "B", aisle: "16", rack: "1", shelf: "1", bin: "1", location_code: "16B1", description: "ตำแหน่ง 16B1", active: true, created_at: "", updated_at: "" },
    { location_id: "loc-17A1", warehouse_id: "wh-1", zone: "A", aisle: "17", rack: "1", shelf: "1", bin: "1", location_code: "17A1", description: "ตำแหน่ง 17A1", active: true, created_at: "", updated_at: "" },
    { location_id: "loc-17B1", warehouse_id: "wh-1", zone: "B", aisle: "17", rack: "1", shelf: "1", bin: "1", location_code: "17B1", description: "ตำแหน่ง 17B1", active: true, created_at: "", updated_at: "" },
  ];

  const { register, control, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } =
    useForm({
      resolver: zodResolver(IssueDocumentSchema),
      defaultValues: {
        warehouse_id: "",
        document_date: new Date().toISOString().slice(0, 10),
        idempotency_key: uuidv4(),
        lines: [{ product_id: "", location_id: "", qty: 1 }],
      },
    });

  const { fields, append, remove } = useFieldArray({ control, name: "lines" });
  const watchWarehouse = watch("warehouse_id");
  const watchLines = watch("lines");

  useEffect(() => {
    Promise.all([
      fetch("/api/warehouses").then(r => r.json()),
      fetch("/api/products?active=true").then(r => r.json()),
    ]).then(([w, p]) => {
      if (w.success && w.data.length > 0) setWarehouses(w.data);
      else setWarehouses(defaultWarehouses as Warehouse[]);
      if (p.success) setProducts(p.data);
    });
  }, []);

  useEffect(() => {
    if (watchWarehouse) {
      if (watchWarehouse === "wh-1" || watchWarehouse.includes("wh-1")) {
        setLocations(wh1Locations);
      } else {
        fetch(`/api/locations?warehouse_id=${watchWarehouse}`)
          .then(r => r.json())
          .then(d => {
            if (d.success && d.data.length > 0) setLocations(d.data.filter((l: Location) => l.active));
            else setLocations(wh1Locations);
          });
      }

      fetch(`/api/stock?warehouse_id=${watchWarehouse}`)
        .then(r => r.json())
        .then(d => {
          if (d.success) {
            const map: Record<string, number> = {};
            d.data.forEach((b: { product_id: string; by_warehouse: { by_location: { location_id: string; quantity: number }[] }[] }) => {
              b.by_warehouse.forEach(w => {
                w.by_location.forEach(loc => {
                  map[`${b.product_id}:${loc.location_id}`] = loc.quantity;
                });
              });
            });
            setStockBalances(map);
          }
        });
    }
  }, [watchWarehouse]);

  const onSubmit = async (data: IssueDocumentInput) => {
    setError("");
    const res = await fetch("/api/movements/issue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, lines: data.lines.map(l => ({ ...l, qty: Number(l.qty) })) }),
    });
    const json = await res.json();
    if (json.success) {
      setSubmitted(true);
    } else {
      setError(json.message);
    }
  };

  if (submitted) return (
    <div className="max-w-2xl mx-auto">
      <div className="glass-card rounded-2xl p-10 text-center border border-emerald-900/30">
        <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
        </div>
        <h2 className="text-xl font-bold text-white mb-2">บันทึกรายการเบิกสินค้าสำเร็จ</h2>
        <p className="text-gray-400 mb-6">ตัดสต็อกเรียบร้อยแล้ว</p>
        <button onClick={() => { setSubmitted(false); setValue("idempotency_key", uuidv4()); setValue("lines", [{ product_id: "", location_id: "", qty: 1 }]); }}
          className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition-all shadow-md shadow-emerald-600/30">
          เบิกรายการใหม่
        </button>
      </div>
    </div>
  );

  const displayWarehouses = warehouses.length > 0 ? warehouses : defaultWarehouses;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">เบิกสินค้าออก</h1>
        <p className="text-gray-400 text-sm mt-1">บันทึกรายการเบิกสินค้าออกจากคลัง</p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {error && <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">{error}</div>}

        <div className="glass-card rounded-2xl p-5 space-y-4 border border-emerald-900/30">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">ข้อมูลเอกสาร</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-300 mb-1.5">โกดัง *</label>
              <select {...register("warehouse_id")} className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-emerald-900/30 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm font-medium">
                <option value="" className="bg-[#080d0a] text-white">เลือกโกดัง</option>
                {displayWarehouses.map((w, idx) => (
                  <option key={`${w.warehouse_id || 'wh'}-${idx}`} value={w.warehouse_id} className="bg-[#080d0a] text-white">
                    {w.warehouse_name}
                  </option>
                ))}
              </select>
              {errors.warehouse_id && <p className="mt-1 text-xs text-red-400">{errors.warehouse_id.message}</p>}
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-1.5">วันที่ *</label>
              <input type="date" {...register("document_date")} className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-emerald-900/30 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm" />
              {errors.document_date && <p className="mt-1 text-xs text-red-400">{errors.document_date.message}</p>}
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-1.5">รหัสสินค้า</label>
              <input {...register("reference_no")} placeholder="กรอกรหัสสินค้า" className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-emerald-900/30 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm" />
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-1.5">เอเจนต์ซี</label>
              <input {...register("note")} placeholder="กรอกชื่อเอเจนต์ซี" className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-emerald-900/30 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm" />
            </div>
          </div>
        </div>

        <div className="glass-card rounded-2xl p-5 space-y-3 border border-emerald-900/30">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">รายการสินค้าที่จะเบิก</h2>
            <button type="button" onClick={() => append({ product_id: "", location_id: "", qty: 1 })}
              className="flex items-center gap-1.5 text-sm text-emerald-400 hover:text-emerald-300 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              เพิ่มรายการ
            </button>
          </div>
          {fields.map((field, i) => {
            const pid = watchLines[i]?.product_id;
            const lid = watchLines[i]?.location_id;
            const bal = pid && lid ? stockBalances[`${pid}:${lid}`] ?? 0 : null;
            return (
              <div key={field.id} className="p-3 rounded-xl bg-white/5 border border-emerald-900/20 space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-7 gap-2 items-end">
                  <div className="sm:col-span-3">
                    <label className="block text-xs text-gray-400 mb-1">สินค้า</label>
                    <select {...register(`lines.${i}.product_id`)} className="w-full px-2.5 py-2 rounded-xl bg-white/5 border border-emerald-900/30 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm">
                      <option value="" className="bg-[#080d0a] text-white">เลือกสินค้า</option>
                      {products.map((p, idx) => (
                        <option key={`${p.product_id || 'prod'}-${p.sku || idx}-${idx}`} value={p.product_id} className="bg-[#080d0a] text-white">
                          {p.product_name} ({p.sku})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs text-gray-400 mb-1">ตำแหน่ง</label>
                    <select {...register(`lines.${i}.location_id`)} className="w-full px-2.5 py-2 rounded-xl bg-white/5 border border-emerald-900/30 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm">
                      <option value="" className="bg-[#080d0a] text-white">เลือกตำแหน่ง</option>
                      {locations.map((l, idx) => (
                        <option key={`${l.location_id || 'loc'}-${l.location_code || idx}-${idx}`} value={l.location_id} className="bg-[#080d0a] text-white">
                          {l.location_code}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-1">
                    <label className="block text-xs text-gray-400 mb-1">จำนวน</label>
                    <input type="number" min="1" max={bal ?? undefined} {...register(`lines.${i}.qty`, { valueAsNumber: true })} className="w-full px-2.5 py-2 rounded-xl bg-white/5 border border-emerald-900/30 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm" />
                  </div>
                  <div className="sm:col-span-1">
                    <button type="button" onClick={() => remove(i)} disabled={fields.length === 1}
                      className="w-full p-2 rounded-xl text-red-400 hover:bg-red-500/10 disabled:opacity-30 transition-colors">
                      <svg className="w-4 h-4 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  </div>
                </div>
                {bal !== null && (
                  <p className={`text-xs px-1 ${bal <= 0 ? 'text-red-400' : 'text-gray-400'}`}>
                    ยอดคงเหลือ: <span className="font-medium text-emerald-400">{bal.toLocaleString()}</span>
                  </p>
                )}
              </div>
            );
          })}
        </div>
        <button type="submit" disabled={isSubmitting} id="issue-submit"
          className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold transition-all shadow-lg shadow-emerald-600/30">
          {isSubmitting ? 'กำลังบันทึก...' : 'ยืนยันเบิกสินค้า'}
        </button>
      </form>
    </div>
  );
}

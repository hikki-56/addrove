"use client";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { MoveDocumentSchema, type MoveDocumentInput } from "@/types/api";
import type { Warehouse, Location, Product } from "@/types/models";
import { v4 as uuidv4 } from "uuid";

export default function MovePage() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [sourceBalance, setSourceBalance] = useState<number | null>(null);

  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } =
    useForm({
      resolver: zodResolver(MoveDocumentSchema),
      defaultValues: {
        warehouse_id: "", product_id: "", from_location_id: "", to_location_id: "",
        qty: 1, document_date: new Date().toISOString().slice(0, 10), idempotency_key: uuidv4(),
      },
    });

  const watchWarehouse = watch("warehouse_id");
  const watchProduct = watch("product_id");
  const watchFromLocation = watch("from_location_id");

  useEffect(() => {
    Promise.all([
      fetch("/api/warehouses").then(r => r.json()),
      fetch("/api/products?active=true").then(r => r.json()),
    ]).then(([w, p]) => {
      if (w.success) setWarehouses(w.data);
      if (p.success) setProducts(p.data);
    });
  }, []);

  useEffect(() => {
    if (watchWarehouse) {
      fetch(`/api/locations?warehouse_id=${watchWarehouse}`)
        .then(r => r.json())
        .then(d => { if (d.success) setLocations(d.data.filter((l: Location) => l.active)); });
    }
  }, [watchWarehouse]);

  useEffect(() => {
    if (watchWarehouse && watchProduct && watchFromLocation) {
      fetch(`/api/stock?warehouse_id=${watchWarehouse}`)
        .then(r => r.json())
        .then(d => {
          if (d.success) {
            const product = d.data.find((b: { product_id: string }) => b.product_id === watchProduct);
            const loc = product?.by_warehouse
              .flatMap((w: { by_location: { location_id: string; quantity: number }[] }) => w.by_location)
              .find((l: { location_id: string }) => l.location_id === watchFromLocation);
            setSourceBalance(loc?.quantity ?? 0);
          }
        });
    }
  }, [watchWarehouse, watchProduct, watchFromLocation]);

  const onSubmit = async (data: MoveDocumentInput) => {
    setError("");
    const res = await fetch("/api/movements/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, qty: Number(data.qty) }),
    });
    const json = await res.json();
    if (json.success) setSubmitted(true);
    else setError(json.message);
  };

  if (submitted) return (
    <div className="max-w-2xl mx-auto">
      <div className="glass-card rounded-2xl p-10 text-center border border-emerald-900/30">
        <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
        </div>
        <h2 className="text-xl font-bold text-white mb-2">ย้ายตำแหน่งสำเร็จ</h2>
        <button onClick={() => { setSubmitted(false); setValue("idempotency_key", uuidv4()); setSourceBalance(null); }}
          className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition-all shadow-md shadow-emerald-600/30">
          ย้ายอีกครั้ง
        </button>
      </div>
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">ย้ายตำแหน่งสินค้า</h1>
        <p className="text-gray-400 text-sm mt-1">ย้ายสินค้าภายในโกดังเดียวกัน</p>
      </div>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {error && <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">{error}</div>}
        <div className="glass-card rounded-2xl p-5 space-y-4 border border-emerald-900/30">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-300 mb-1.5">โกดัง *</label>
              <select {...register("warehouse_id")} className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-emerald-900/30 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm font-medium">
                <option value="" className="bg-[#080d0a] text-white">เลือกโกดัง</option>
                {warehouses.filter(w => w.active).map(w => <option key={w.warehouse_id} value={w.warehouse_id} className="bg-[#080d0a] text-white">{w.warehouse_name}</option>)}
              </select>
              {errors.warehouse_id && <p className="mt-1 text-xs text-red-400">{errors.warehouse_id.message}</p>}
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-1.5">วันที่ *</label>
              <input type="date" {...register("document_date")} className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-emerald-900/30 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-1.5">สินค้า *</label>
            <select {...register("product_id")} className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-emerald-900/30 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm">
              <option value="" className="bg-[#080d0a] text-white">เลือกสินค้า</option>
              {products.map(p => <option key={p.product_id} value={p.product_id} className="bg-[#080d0a] text-white">{p.product_name} ({p.sku})</option>)}
            </select>
            {errors.product_id && <p className="mt-1 text-xs text-red-400">{errors.product_id.message}</p>}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-300 mb-1.5">ตำแหน่งต้นทาง *</label>
              <select {...register("from_location_id")} className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-emerald-900/30 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm">
                <option value="" className="bg-[#080d0a] text-white">เลือกตำแหน่ง</option>
                {locations.map(l => <option key={l.location_id} value={l.location_id} className="bg-[#080d0a] text-white">{l.location_code}</option>)}
              </select>
              {sourceBalance !== null && <p className="mt-1 text-xs text-gray-500">ยอดคงเหลือ: <span className={sourceBalance <= 0 ? 'text-red-400' : 'text-emerald-400'}>{sourceBalance.toLocaleString()}</span></p>}
              {errors.from_location_id && <p className="mt-1 text-xs text-red-400">{errors.from_location_id.message}</p>}
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-1.5">ตำแหน่งปลายทาง *</label>
              <select {...register("to_location_id")} className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-emerald-900/30 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm">
                <option value="" className="bg-[#080d0a] text-white">เลือกตำแหน่ง</option>
                {locations.map(l => <option key={l.location_id} value={l.location_id} className="bg-[#080d0a] text-white">{l.location_code}</option>)}
              </select>
              {errors.to_location_id && <p className="mt-1 text-xs text-red-400">{errors.to_location_id.message}</p>}
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-1.5">จำนวน *</label>
            <input type="number" min="1" max={sourceBalance ?? undefined} {...register("qty", { valueAsNumber: true })} className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-emerald-900/30 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm" />
            {errors.qty && <p className="mt-1 text-xs text-red-400">{errors.qty.message}</p>}
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-1.5">หมายเหตุ</label>
            <input {...register("note")} className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-emerald-900/30 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm" />
          </div>
        </div>
        <button type="submit" disabled={isSubmitting} id="move-submit"
          className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold transition-all shadow-lg shadow-emerald-600/30">
          {isSubmitting ? 'กำลังบันทึก...' : 'ยืนยันย้ายตำแหน่ง'}
        </button>
      </form>
    </div>
  );
}

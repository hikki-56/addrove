"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CreateProductSchema, type CreateProductInput } from "@/types/api";
import CustomSelect from "@/components/ui/CustomSelect";
import type { Warehouse } from "@/types/models";

export default function NewProductPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);

  const defaultWarehouses = [
    { warehouse_id: "wh-1", warehouse_name: "โกดัง 1" },
    { warehouse_id: "wh-2", warehouse_name: "โกดัง 2" },
    { warehouse_id: "wh-3", warehouse_name: "โกดัง 3" },
    { warehouse_id: "wh-4", warehouse_name: "โกดัง 4" },
    { warehouse_id: "wh-5", warehouse_name: "โกดัง 5" },
  ];

  useEffect(() => {
    fetch("/api/warehouses")
      .then((r) => r.json())
      .then((d) => {
        if (d.success && Array.isArray(d.data) && d.data.length > 0) {
          setWarehouses(d.data);
        } else {
          setWarehouses(defaultWarehouses as Warehouse[]);
        }
      })
      .catch(() => setWarehouses(defaultWarehouses as Warehouse[]));
  }, []);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(CreateProductSchema),
    defaultValues: {
      warehouse_id: "wh-1",
      minimum_stock: 0,
      initial_quantity: 0,
    },
  });

  const watchWarehouse = watch("warehouse_id");

  const onSubmit = async (data: CreateProductInput) => {
    setError("");
    try {
      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          minimum_stock: Number(data.minimum_stock || 0),
          initial_quantity: Number(data.initial_quantity || 0),
        }),
      });
      const json = await res.json();
      if (json.success) {
        router.push("/products");
      } else {
        setError(json.message || "เกิดข้อผิดพลาดในการบันทึกสินค้า");
      }
    } catch {
      setError("เกิดข้อผิดพลาดในการเชื่อมต่อระบบ");
    }
  };

  const displayWarehouses = warehouses.length > 0 ? warehouses : defaultWarehouses;
  const warehouseOptions = displayWarehouses.map((w) => ({
    value: w.warehouse_id,
    label: w.warehouse_name,
  }));

  return (
    <div className="max-w-2xl mx-auto space-y-6 w-full max-w-full">
      <div>
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-slate-400 hover:text-white text-xs mb-3 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          ย้อนกลับ
        </button>
        <h1 className="text-xl font-bold text-slate-100 tracking-tight">เพิ่มสินค้าใหม่เข้าคลัง</h1>
        <p className="text-slate-500 text-sm mt-0.5">ระบุรายละเอียดสินค้าและเลือกโกดังจัดเก็บ</p>
      </div>

      <div className="glass-card rounded-xl p-5 sm:p-6 w-full max-w-full">
        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm flex items-center gap-2 font-medium">
            <svg className="w-5 h-5 flex-shrink-0 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit as any)} className="space-y-4 w-full max-w-full">
          {/* Warehouse Selection */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">จัดเก็บเข้าโกดัง *</label>
            <CustomSelect
              value={watchWarehouse || "wh-1"}
              onChange={(val) => setValue("warehouse_id", val, { shouldValidate: true })}
              options={warehouseOptions}
              placeholder="เลือกโกดัง"
              error={errors.warehouse_id?.message}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">รหัสสินค้า (SKU) *</label>
              <input
                {...register("sku")}
                placeholder="เช่น PROD-001"
                className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.09] text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500/50 text-sm font-mono transition-all"
              />
              {errors.sku && <p className="mt-1 text-xs text-red-400">{errors.sku.message}</p>}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">บาร์โค้ด (Barcode)</label>
              <input
                {...register("barcode")}
                placeholder="เช่น 885000000001"
                className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.09] text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500/50 text-sm font-mono transition-all"
              />
              {errors.barcode && <p className="mt-1 text-xs text-red-400">{errors.barcode.message}</p>}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">ชื่อสินค้า *</label>
            <input
              {...register("product_name")}
              placeholder="กรอกชื่อสินค้าภาษาไทย"
              className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.09] text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500/50 text-sm font-medium transition-all"
            />
            {errors.product_name && <p className="mt-1 text-xs text-red-400">{errors.product_name.message}</p>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">หมวดหมู่สินค้า *</label>
              <input
                {...register("category")}
                placeholder="เช่น เครื่องดื่ม / ของใช้"
                className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.09] text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500/50 text-sm transition-all"
              />
              {errors.category && <p className="mt-1 text-xs text-red-400">{errors.category.message}</p>}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">หน่วยนับ *</label>
              <input
                {...register("base_unit")}
                placeholder="เช่น ชิ้น / กล่อง / แพ็ก"
                className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.09] text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500/50 text-sm transition-all"
              />
              {errors.base_unit && <p className="mt-1 text-xs text-red-400">{errors.base_unit.message}</p>}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">จำนวนสินค้าเริ่มต้นในโกดัง</label>
              <input
                type="number"
                min="0"
                {...register("initial_quantity", { valueAsNumber: true })}
                placeholder="0"
                className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.09] text-slate-100 focus:outline-none focus:border-indigo-500/50 text-sm font-mono transition-all"
              />
              {errors.initial_quantity && <p className="mt-1 text-xs text-red-400">{errors.initial_quantity.message}</p>}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">จำนวนแจ้งเตือนขั้นต่ำ (Min Stock)</label>
              <input
                type="number"
                min="0"
                {...register("minimum_stock", { valueAsNumber: true })}
                placeholder="0"
                className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.09] text-slate-100 focus:outline-none focus:border-indigo-500/50 text-sm font-mono transition-all"
              />
              {errors.minimum_stock && <p className="mt-1 text-xs text-red-400">{errors.minimum_stock.message}</p>}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">รายละเอียดเพิ่มเติม / หมายเหตุ</label>
            <textarea
              {...register("description")}
              rows={3}
              placeholder="กรอกรายละเอียดสินค้า เช่น เอเจนต์ซี ผู้ส่งมอบ หรือข้อความบันทึก"
              className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.09] text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500/50 text-sm resize-none transition-all"
            />
          </div>

          <div className="flex gap-3 pt-3">
            <button
              type="button"
              onClick={() => router.back()}
              className="flex-1 py-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 font-medium transition-all text-sm"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              id="submit-new-product"
              className="flex-1 py-2.5 rounded-xl btn-primary disabled:opacity-50 text-white font-semibold transition-all text-sm cursor-pointer"
            >
              {isSubmitting ? "กำลังบันทึก..." : "บันทึกสินค้าเข้าคลัง"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

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
    { warehouse_id: "wh-6", warehouse_name: "สำนักงานใหญ่" },
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
        setError(json.message || "กรุณาตรวจสอบข้อมูล เกิดข้อผิดพลาดในการบันทึกสินค้า");
      }
    } catch {
      setError("กรุณาลองใหม่อีกครั้ง เกิดข้อผิดพลาดในการเชื่อมต่อระบบ");
    }
  };

  const displayWarehouses = warehouses.length > 0 ? warehouses : defaultWarehouses;
  const warehouseOptions = displayWarehouses.map((w) => ({
    value: w.warehouse_id,
    label: w.warehouse_name,
  }));

  return (
    <div className="max-w-2xl mx-auto space-y-6 w-full">
      <div>
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-slate-500 hover:text-slate-900 text-xs sm:text-sm font-semibold mb-3 transition-colors cursor-pointer"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          ย้อนกลับ
        </button>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">เพิ่มสินค้าใหม่เข้าคลัง</h1>
        <p className="text-slate-500 text-xs sm:text-sm mt-0.5">ระบุรายละเอียดสินค้าและเลือกโกดังจัดเก็บ</p>
      </div>

      <div className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200 shadow-xs w-full">
        {error && (
          <div className="mb-4 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs sm:text-sm flex items-center gap-2 font-medium">
            <svg className="w-5 h-5 flex-shrink-0 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit as any)} className="space-y-4 w-full">
          {/* Warehouse Selection */}
          <div>
            <div className="block text-xs font-semibold text-slate-700 mb-1.5">จัดเก็บเข้าโกดัง *</div>
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
              <label htmlFor="prod-sku" className="block text-xs font-semibold text-slate-700 mb-1.5">รหัสสินค้า (SKU) *</label>
              <input
                id="prod-sku"
                {...register("sku")}
                placeholder="เช่น PROD-001"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 text-xs sm:text-sm font-mono font-bold transition-all"
              />
              {errors.sku && <p className="mt-1 text-xs text-rose-600 font-medium">{errors.sku.message}</p>}
            </div>

            <div>
              <label htmlFor="prod-barcode" className="block text-xs font-semibold text-slate-700 mb-1.5">บาร์โค้ด (Barcode)</label>
              <input
                id="prod-barcode"
                {...register("barcode")}
                placeholder="เช่น 885000000001"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 text-xs sm:text-sm font-mono font-bold transition-all"
              />
              {errors.barcode && <p className="mt-1 text-xs text-rose-600 font-medium">{errors.barcode.message}</p>}
            </div>
          </div>

          <div>
            <label htmlFor="prod-name" className="block text-xs font-semibold text-slate-700 mb-1.5">ชื่อสินค้า *</label>
            <input
              id="prod-name"
              {...register("product_name")}
              placeholder="กรอกชื่อสินค้าภาษาไทย"
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 text-xs sm:text-sm font-medium transition-all"
            />
            {errors.product_name && <p className="mt-1 text-xs text-rose-600 font-medium">{errors.product_name.message}</p>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="prod-category" className="block text-xs font-semibold text-slate-700 mb-1.5">หมวดหมู่สินค้า *</label>
              <input
                id="prod-category"
                {...register("category")}
                placeholder="เช่น เครื่องดื่ม / ของใช้"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 text-xs sm:text-sm transition-all"
              />
              {errors.category && <p className="mt-1 text-xs text-rose-600 font-medium">{errors.category.message}</p>}
            </div>

            <div>
              <label htmlFor="prod-base-unit" className="block text-xs font-semibold text-slate-700 mb-1.5">หน่วยนับ *</label>
              <input
                id="prod-base-unit"
                {...register("base_unit")}
                placeholder="เช่น ชิ้น / กล่อง / แพ็ก"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 text-xs sm:text-sm transition-all"
              />
              {errors.base_unit && <p className="mt-1 text-xs text-rose-600 font-medium">{errors.base_unit.message}</p>}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="prod-initial-qty" className="block text-xs font-semibold text-slate-700 mb-1.5">จำนวนสินค้าเริ่มต้นในโกดัง</label>
              <input
                id="prod-initial-qty"
                type="number"
                min="0"
                {...register("initial_quantity", { valueAsNumber: true })}
                placeholder="0"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 focus:outline-none focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 text-xs sm:text-sm font-mono transition-all"
              />
              {/* Form quantity validation message (formatted with toLocaleString where applicable) */}
              {errors.initial_quantity && <p className="mt-1 text-xs text-rose-600 font-medium">{errors.initial_quantity.message}</p>}
            </div>

            <div>
              <label htmlFor="prod-min-stock" className="block text-xs font-semibold text-slate-700 mb-1.5">จำนวนแจ้งเตือนขั้นต่ำ (Min Stock)</label>
              <input
                id="prod-min-stock"
                type="number"
                min="0"
                {...register("minimum_stock", { valueAsNumber: true })}
                placeholder="0"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 focus:outline-none focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 text-xs sm:text-sm font-mono transition-all"
              />
              {errors.minimum_stock && <p className="mt-1 text-xs text-rose-600 font-medium">{errors.minimum_stock.message}</p>}
            </div>
          </div>

          <div>
            <label htmlFor="prod-desc" className="block text-xs font-semibold text-slate-700 mb-1.5">รายละเอียดเพิ่มเติม / หมายเหตุ</label>
            <textarea
              id="prod-desc"
              {...register("description")}
              rows={3}
              placeholder="กรอกรายละเอียดสินค้า เช่น เอเจนต์ซี ผู้ส่งมอบ หรือข้อความบันทึก"
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 text-xs sm:text-sm resize-none transition-all"
            />
          </div>

          <div className="flex gap-3 pt-3">
            <button
              type="button"
              onClick={() => router.back()}
              className="flex-1 py-2.5 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold transition-all text-xs sm:text-sm cursor-pointer active:scale-95"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              id="submit-new-product"
              className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold transition-all text-xs sm:text-sm cursor-pointer shadow-md shadow-indigo-600/20 active:scale-95"
            >
              {isSubmitting ? "กำลังบันทึก..." : "บันทึกสินค้าเข้าคลัง"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

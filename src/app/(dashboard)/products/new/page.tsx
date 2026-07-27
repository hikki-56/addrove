"use client";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CreateProductSchema, type CreateProductInput } from "@/types/api";
import { useState } from "react";

export default function NewProductPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(CreateProductSchema),
    defaultValues: { minimum_stock: 0 },
  });

  const onSubmit = async (data: CreateProductInput) => {
    setError("");
    const res = await fetch("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, minimum_stock: Number(data.minimum_stock) }),
    });
    const json = await res.json();
    if (json.success) {
      router.push("/products");
    } else {
      setError(json.message);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <button onClick={() => router.back()} className="flex items-center gap-2 text-gray-400 hover:text-white text-sm mb-4 transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          กลับ
        </button>
        <h1 className="text-2xl font-bold text-white">เพิ่มสินค้าใหม่</h1>
      </div>

      <div className="glass-card rounded-2xl p-6 border border-emerald-900/30">
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">{error}</div>
        )}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">รหัสสินค้า *</label>
              <input {...register("sku")} placeholder="PROD-001" className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-emerald-900/30 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm" />
              {errors.sku && <p className="mt-1 text-xs text-red-400">{errors.sku.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Barcode *</label>
              <input {...register("barcode")} placeholder="1234567890123" className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-emerald-900/30 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm" />
              {errors.barcode && <p className="mt-1 text-xs text-red-400">{errors.barcode.message}</p>}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">ชื่อสินค้า *</label>
            <input {...register("product_name")} placeholder="ชื่อสินค้าภาษาไทย" className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-emerald-900/30 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm" />
            {errors.product_name && <p className="mt-1 text-xs text-red-400">{errors.product_name.message}</p>}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">หมวดหมู่ *</label>
              <input {...register("category")} placeholder="สินค้าอุปโภคบริโภค" className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-emerald-900/30 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm" />
              {errors.category && <p className="mt-1 text-xs text-red-400">{errors.category.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">หน่วยนับ *</label>
              <input {...register("base_unit")} placeholder="ชิ้น / กล่อง / แพ็ก" className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-emerald-900/30 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm" />
              {errors.base_unit && <p className="mt-1 text-xs text-red-400">{errors.base_unit.message}</p>}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">จำนวนขั้นต่ำ</label>
            <input type="number" {...register("minimum_stock", { valueAsNumber: true })} placeholder="0" className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-emerald-900/30 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm" />
            {errors.minimum_stock && <p className="mt-1 text-xs text-red-400">{errors.minimum_stock.message}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">รายละเอียดเพิ่มเติม</label>
            <textarea {...register("description")} rows={3} placeholder="รายละเอียดสินค้า" className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-emerald-900/30 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm resize-none" />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => router.back()}
              className="flex-1 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 font-medium transition-all text-sm">
              ยกเลิก
            </button>
            <button type="submit" disabled={isSubmitting}
              className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold transition-all text-sm shadow-lg shadow-emerald-600/30">
              {isSubmitting ? 'กำลังบันทึก...' : 'บันทึกสินค้า'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

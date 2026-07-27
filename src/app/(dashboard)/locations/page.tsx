"use client";
import { useEffect, useState } from "react";
import type { Location, Warehouse } from "@/types/models";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CreateLocationSchema, type CreateLocationInput } from "@/types/api";

export default function LocationsPage() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedWh, setSelectedWh] = useState("");
  const [error, setError] = useState("");

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } =
    useForm({
      resolver: zodResolver(CreateLocationSchema),
    });

  const load = () => {
    setLoading(true);
    const url = selectedWh ? `/api/locations?warehouse_id=${selectedWh}` : "/api/locations";
    fetch(url)
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setLocations(d.data);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetch("/api/warehouses")
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setWarehouses(d.data);
      });
  }, []);

  useEffect(() => {
    load();
  }, [selectedWh]);

  const onSubmit = async (data: CreateLocationInput) => {
    setError("");
    const res = await fetch("/api/locations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (json.success) {
      setShowForm(false);
      reset();
      load();
    } else {
      setError(json.message);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">จัดการตำแหน่งจัดเก็บ (Location)</h1>
          <p className="text-gray-400 text-sm mt-1">
            โครงสร้าง Zone - Aisle - Rack - Shelf - Bin
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-all shadow-lg shadow-emerald-600/30"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          เพิ่มตำแหน่งจัดเก็บ
        </button>
      </div>

      {showForm && (
        <div className="glass-card rounded-xl p-5 fade-in">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">
            สร้างตำแหน่งจัดเก็บใหม่
          </h2>
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
              {error}
            </div>
          )}
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <label className="block text-sm text-gray-300 mb-1.5">โกดัง *</label>
              <select
                {...register("warehouse_id")}
                className="w-full px-3 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 text-sm"
              >
                <option value="">เลือกโกดัง</option>
                {warehouses.map((w) => (
                  <option key={w.warehouse_id} value={w.warehouse_id}>
                    {w.warehouse_name} ({w.warehouse_code})
                  </option>
                ))}
              </select>
              {errors.warehouse_id && (
                <p className="mt-1 text-xs text-red-400">{errors.warehouse_id.message}</p>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Zone (โซน) *</label>
                <input
                  {...register("zone")}
                  placeholder="A"
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 text-sm"
                />
                {errors.zone && <p className="mt-1 text-xs text-red-400">{errors.zone.message}</p>}
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Aisle (ช่องทางเดิน) *</label>
                <input
                  {...register("aisle")}
                  placeholder="01"
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 text-sm"
                />
                {errors.aisle && <p className="mt-1 text-xs text-red-400">{errors.aisle.message}</p>}
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Rack (ชั้นวาง) *</label>
                <input
                  {...register("rack")}
                  placeholder="01"
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 text-sm"
                />
                {errors.rack && <p className="mt-1 text-xs text-red-400">{errors.rack.message}</p>}
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Shelf (ระดับชั้น) *</label>
                <input
                  {...register("shelf")}
                  placeholder="01"
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 text-sm"
                />
                {errors.shelf && <p className="mt-1 text-xs text-red-400">{errors.shelf.message}</p>}
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Bin (กล่อง/ช่อง) *</label>
                <input
                  {...register("bin")}
                  placeholder="01"
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 text-sm"
                />
                {errors.bin && <p className="mt-1 text-xs text-red-400">{errors.bin.message}</p>}
              </div>
            </div>

            <div>
              <label className="block text-sm text-gray-300 mb-1.5">คำอธิบายเพิ่มเติม</label>
              <input
                {...register("description")}
                placeholder="เช่น แถวหน้าใกล้ทางออก"
                className="w-full px-3 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 text-sm"
              />
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="flex-1 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 text-sm font-medium transition-all"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-all shadow-lg shadow-emerald-600/30 disabled:opacity-50"
              >
                {isSubmitting ? "กำลังบันทึก..." : "บันทึกตำแหน่ง"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filter warehouse */}
      <div className="flex items-center gap-3">
        <select
          value={selectedWh}
          onChange={(e) => setSelectedWh(e.target.value)}
          className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-gray-300 text-sm focus:outline-none"
        >
          <option value="">ทุกโกดัง</option>
          {warehouses.map((w) => (
            <option key={w.warehouse_id} value={w.warehouse_id}>
              {w.warehouse_name}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">กำลังโหลด...</div>
      ) : (
        <div className="glass-card rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-xs text-gray-500 uppercase tracking-wider bg-white/3">
                  <th className="text-left px-6 py-3">Location Code</th>
                  <th className="text-left px-6 py-3">Zone</th>
                  <th className="text-left px-6 py-3">Aisle</th>
                  <th className="text-left px-6 py-3">Rack</th>
                  <th className="text-left px-6 py-3">Shelf</th>
                  <th className="text-left px-6 py-3">Bin</th>
                  <th className="text-left px-6 py-3">คำอธิบาย</th>
                  <th className="text-left px-6 py-3">สถานะ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {locations.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-10 text-gray-500">
                      ไม่พบตำแหน่งจัดเก็บ
                    </td>
                  </tr>
                ) : (
                  locations.map((loc) => (
                    <tr key={loc.location_id} className="hover:bg-white/3 transition-colors">
                      <td className="px-6 py-3 font-mono text-sm text-emerald-400 font-semibold">
                        {loc.location_code}
                      </td>
                      <td className="px-6 py-3 text-sm text-gray-300">{loc.zone}</td>
                      <td className="px-6 py-3 text-sm text-gray-300">{loc.aisle}</td>
                      <td className="px-6 py-3 text-sm text-gray-300">{loc.rack}</td>
                      <td className="px-6 py-3 text-sm text-gray-300">{loc.shelf}</td>
                      <td className="px-6 py-3 text-sm text-gray-300">{loc.bin}</td>
                      <td className="px-6 py-3 text-sm text-gray-400">{loc.description || "-"}</td>
                      <td className="px-6 py-3">
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full border ${
                            loc.active ? "badge-normal" : "badge-out"
                          }`}
                        >
                          {loc.active ? "ใช้งาน" : "ปิดใช้งาน"}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

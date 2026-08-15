"use client";
import { useEffect, useState } from "react";
import type { Location, Warehouse, Shelf } from "@/types/models";
import { getDefaultLocationsForWarehouse, getDefaultShelvesForLocation } from "@/lib/warehouse-utils";

export default function LocationsPage() {
  const [activeTab, setActiveTab] = useState<"locations" | "shelves">("locations");
  const [locations, setLocations] = useState<Location[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [loading, setLoading] = useState(true);
  const [showLocationForm, setShowLocationForm] = useState(false);
  const [showShelfForm, setShowShelfForm] = useState(false);
  const [selectedWh, setSelectedWh] = useState("");
  const [selectedLoc, setSelectedLoc] = useState("");
  const [error, setError] = useState("");

  // Location Form State
  const [locWhId, setLocWhId] = useState("");
  const [locCode, setLocCode] = useState("");
  const [locName, setLocName] = useState("");
  const [locDesc, setLocDesc] = useState("");
  const [submittingLoc, setSubmittingLoc] = useState(false);

  // Shelf Form State
  const [shelfLocId, setShelfLocId] = useState("");
  const [shelfCode, setShelfCode] = useState("");
  const [shelfName, setShelfName] = useState("");
  const [shelfLevel, setShelfLevel] = useState("1");
  const [submittingShelf, setSubmittingShelf] = useState(false);

  const loadWarehouses = async () => {
    try {
      const res = await fetch("/api/warehouses");
      const d = await res.json();
      if (d.success) setWarehouses(d.data || []);
    } catch (e) {
      console.error(e);
    }
  };

  const loadLocations = async () => {
    setLoading(true);
    try {
      const url = selectedWh ? `/api/locations?warehouse_id=${selectedWh}` : "/api/locations";
      const res = await fetch(url);
      const d = await res.json();
      if (d.success) {
        const fetched = d.data || [];
        if (fetched.length === 0 && selectedWh) {
          setLocations(getDefaultLocationsForWarehouse(selectedWh));
        } else {
          setLocations(fetched);
        }
      }
    } catch (e) {
      console.error(e);
      if (selectedWh) setLocations(getDefaultLocationsForWarehouse(selectedWh));
    } finally {
      setLoading(false);
    }
  };

  const loadShelves = async () => {
    setLoading(true);
    try {
      const url = selectedLoc ? `/api/shelves?location_id=${selectedLoc}` : "/api/shelves";
      const res = await fetch(url);
      const d = await res.json();
      if (d.success) {
        const fetched = d.data || [];
        if (fetched.length === 0 && selectedLoc) {
          setShelves(getDefaultShelvesForLocation(selectedLoc));
        } else {
          setShelves(fetched);
        }
      }
    } catch (e) {
      console.error(e);
      if (selectedLoc) setShelves(getDefaultShelvesForLocation(selectedLoc));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWarehouses();
  }, []);

  useEffect(() => {
    if (activeTab === "locations") {
      loadLocations();
    } else {
      loadShelves();
      if (locations.length === 0) loadLocations();
    }
  }, [activeTab, selectedWh, selectedLoc]);

  const handleCreateLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!locWhId) return setError("กรุณาเลือกโกดัง");
    if (!locCode) return setError("กรุณากรอกรหัสตำแหน่ง");
    setError("");
    setSubmittingLoc(true);

    try {
      const res = await fetch("/api/locations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          warehouse_id: locWhId,
          location_code: locCode,
          location_name: locName || locCode,
          description: locDesc,
        }),
      });
      const d = await res.json();
      if (d.success) {
        setShowLocationForm(false);
        setLocCode("");
        setLocName("");
        setLocDesc("");
        loadLocations();
      } else {
        setError(d.message || "เกิดข้อผิดพลาด");
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmittingLoc(false);
    }
  };

  const handleCreateShelf = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shelfLocId) return setError("กรุณาเลือกตำแหน่งจัดเก็บ");
    if (!shelfCode) return setError("กรุณากรอกรหัสชั้น");
    if (!shelfName) return setError("กรุณากรอกชื่อชั้น");
    setError("");
    setSubmittingShelf(true);

    try {
      const res = await fetch("/api/shelves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          location_id: shelfLocId,
          shelf_code: shelfCode,
          shelf_name: shelfName,
          shelf_level: shelfLevel,
        }),
      });
      const d = await res.json();
      if (d.success) {
        setShowShelfForm(false);
        setShelfCode("");
        setShelfName("");
        setShelfLevel("1");
        loadShelves();
      } else {
        setError(d.message || "เกิดข้อผิดพลาด");
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmittingShelf(false);
    }
  };

  const getWarehouseName = (whId: string) => {
    const wh = warehouses.find((w) => w.warehouse_id === whId);
    return wh ? `${wh.warehouse_name} (${wh.warehouse_code})` : whId;
  };

  const getLocationCodeName = (locId: string) => {
    const loc = locations.find((l) => l.location_id === locId);
    return loc ? `${loc.location_name || loc.location_code} (${loc.location_code})` : locId;
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-100 tracking-tight">
            ผังคลังสินค้าและตำแหน่งจัดเก็บ (Locations & Shelves)
          </h1>
          <p className="text-slate-500 text-sm mt-0.5">
            ความสัมพันธ์ 3 ระดับ: โกดัง (Warehouses) ➔ ตำแหน่ง (Locations) ➔ ชั้นวาง (Shelves)
          </p>
        </div>
        <div className="flex items-center gap-2">
          {activeTab === "locations" ? (
            <button
              onClick={() => {
                setError("");
                setShowLocationForm(!showLocationForm);
              }}
              className="btn-primary flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-semibold cursor-pointer"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              เพิ่มตำแหน่งจัดเก็บ (Location)
            </button>
          ) : (
            <button
              onClick={() => {
                setError("");
                setShowShelfForm(!showShelfForm);
              }}
              className="btn-primary flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-semibold cursor-pointer"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              เพิ่มชั้นวางสินค้า (Shelf)
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/[0.08] gap-6 text-sm font-semibold">
        <button
          onClick={() => setActiveTab("locations")}
          className={`pb-3 border-b-2 transition-colors cursor-pointer ${
            activeTab === "locations"
              ? "border-indigo-500 text-indigo-400"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          📍 1. ตำแหน่งจัดเก็บ (Locations) [{locations.length}]
        </button>
        <button
          onClick={() => setActiveTab("shelves")}
          className={`pb-3 border-b-2 transition-colors cursor-pointer ${
            activeTab === "shelves"
              ? "border-indigo-500 text-indigo-400"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          📦 2. ชั้นวางสินค้า (Shelves) [{shelves.length}]
        </button>
      </div>

      {/* Location Create Form */}
      {showLocationForm && activeTab === "locations" && (
        <div className="glass-card rounded-xl p-5 fade-in">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">
            สร้างตำแหน่งจัดเก็บใหม่ (Location)
          </h2>
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
              {error}
            </div>
          )}
          <form onSubmit={handleCreateLocation} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">โกดัง (Warehouse) *</label>
                <select
                  value={locWhId}
                  onChange={(e) => setLocWhId(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.09] text-slate-100 focus:outline-none focus:border-indigo-500/50 text-sm font-medium"
                >
                  <option value="" className="bg-[#111118] text-white">เลือกโกดัง</option>
                  {warehouses.map((w) => (
                    <option key={w.warehouse_id} value={w.warehouse_id} className="bg-[#111118] text-white">
                      {w.warehouse_name} ({w.warehouse_code})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">รหัสตำแหน่ง (Location Code) *</label>
                <input
                  value={locCode}
                  onChange={(e) => setLocCode(e.target.value)}
                  placeholder="เช่น LOC-A01"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.09] text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500/50 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">ชื่อตำแหน่ง (Location Name)</label>
                <input
                  value={locName}
                  onChange={(e) => setLocName(e.target.value)}
                  placeholder="เช่น โซน A ล็อค 1"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.09] text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500/50 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">รายละเอียด</label>
              <input
                value={locDesc}
                onChange={(e) => setLocDesc(e.target.value)}
                placeholder="คำอธิบายตำแหน่ง เช่น แถวหน้าติดประตู"
                className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.09] text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500/50 text-sm"
              />
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowLocationForm(false)}
                className="flex-1 py-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 text-sm font-medium transition-all"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={submittingLoc}
                className="flex-1 py-2.5 rounded-xl btn-primary text-white text-sm font-semibold transition-all disabled:opacity-50 cursor-pointer"
              >
                {submittingLoc ? "กำลังบันทึก..." : "บันทึกตำแหน่ง"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Shelf Create Form */}
      {showShelfForm && activeTab === "shelves" && (
        <div className="glass-card rounded-xl p-5 fade-in">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">
            สร้างชั้นวางสินค้าใหม่ (Shelf)
          </h2>
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
              {error}
            </div>
          )}
          <form onSubmit={handleCreateShelf} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">ตำแหน่งจัดเก็บ (Location) *</label>
                <select
                  value={shelfLocId}
                  onChange={(e) => setShelfLocId(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.09] text-slate-100 focus:outline-none focus:border-indigo-500/50 text-sm font-medium"
                >
                  <option value="" className="bg-[#111118] text-white">เลือกตำแหน่ง</option>
                  {locations.map((l, idx) => (
                    <option key={`loc-form-opt-${l.location_id || l.location_code || idx}-${idx}`} value={l.location_id} className="bg-[#111118] text-white">
                      {l.location_name || l.location_code} ({getWarehouseName(l.warehouse_id)})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">รหัสชั้น (Shelf Code) *</label>
                <input
                  value={shelfCode}
                  onChange={(e) => setShelfCode(e.target.value)}
                  placeholder="เช่น SH-A1-01"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.09] text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500/50 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">ชื่อชั้น (Shelf Name) *</label>
                <input
                  value={shelfName}
                  onChange={(e) => setShelfName(e.target.value)}
                  placeholder="เช่น ชั้นบนสุด A1"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.09] text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500/50 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">ระดับชั้น (Level)</label>
                <input
                  value={shelfLevel}
                  onChange={(e) => setShelfLevel(e.target.value)}
                  placeholder="1, 2, 3..."
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.09] text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500/50 text-sm font-mono"
                />
              </div>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowShelfForm(false)}
                className="flex-1 py-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 text-sm font-medium transition-all"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={submittingShelf}
                className="flex-1 py-2.5 rounded-xl btn-primary text-white text-sm font-semibold transition-all disabled:opacity-50 cursor-pointer"
              >
                {submittingShelf ? "กำลังบันทึก..." : "บันทึกชั้นวาง"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filters */}
      {activeTab === "locations" ? (
        <div className="flex items-center gap-3">
          <select
            value={selectedWh}
            onChange={(e) => setSelectedWh(e.target.value)}
            className="px-3.5 py-2 rounded-xl bg-white/[0.04] border border-white/[0.09] text-slate-300 text-sm font-medium focus:outline-none focus:border-indigo-500/50 cursor-pointer"
          >
            <option value="" className="bg-[#111118] text-white">ทุกโกดัง</option>
            {warehouses.map((w) => (
              <option key={w.warehouse_id} value={w.warehouse_id} className="bg-[#111118] text-white">
                {w.warehouse_name} ({w.warehouse_code})
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <select
            value={selectedLoc}
            onChange={(e) => setSelectedLoc(e.target.value)}
            className="px-3.5 py-2 rounded-xl bg-white/[0.04] border border-white/[0.09] text-slate-300 text-sm font-medium focus:outline-none focus:border-indigo-500/50 cursor-pointer"
          >
            <option value="" className="bg-[#111118] text-white">ทุกตำแหน่งจัดเก็บ</option>
            {locations.map((l, idx) => (
              <option key={`opt-loc-${l.location_id || l.location_code || idx}-${l.warehouse_id || 'wh'}-${idx}`} value={l.location_id} className="bg-[#111118] text-white">
                {l.location_name || l.location_code} ({l.location_code})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Table Content */}
      {loading ? (
        <div className="text-center py-12 text-slate-500 text-sm">กำลังโหลดข้อมูล...</div>
      ) : activeTab === "locations" ? (
        <div className="glass-card rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/[0.08]">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">รหัสตำแหน่ง</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">ชื่อตำแหน่ง</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">โกดังที่สังกัด</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">รายละเอียด</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">สถานะ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {locations.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-10 text-slate-500 text-sm">
                      ไม่พบตำแหน่งจัดเก็บ
                    </td>
                  </tr>
                ) : (
                  locations.map((loc, idx) => (
                    <tr key={`tr-loc-${loc.location_id || loc.location_code || idx}-${loc.warehouse_id || 'wh'}-${idx}`} className="hover:bg-white/[0.03] transition-colors">
                      <td className="px-5 py-3.5 font-mono text-xs font-bold text-indigo-400">
                        {loc.location_code}
                      </td>
                      <td className="px-5 py-3.5 text-xs text-slate-200 font-medium">
                        {loc.location_name || loc.location_code}
                      </td>
                      <td className="px-5 py-3.5 text-xs text-slate-400">
                        {getWarehouseName(loc.warehouse_id)}
                      </td>
                      <td className="px-5 py-3.5 text-xs text-slate-500">
                        {loc.description || "-"}
                      </td>
                      <td className="px-5 py-3.5">
                        <span
                          className={`text-[11px] px-2 py-0.5 rounded-full border ${
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
      ) : (
        <div className="glass-card rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/[0.08]">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">รหัสชั้นวาง</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">ชื่อชั้นวาง</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">ตำแหน่งที่สังกัด</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">ระดับชั้น</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">สถานะ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {shelves.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-10 text-slate-500 text-sm">
                      ไม่พบชั้นวางสินค้า
                    </td>
                  </tr>
                ) : (
                  shelves.map((s, idx) => (
                    <tr key={`tr-shelf-${s.shelf_id || s.shelf_code || idx}-${s.location_id || 'loc'}-${idx}`} className="hover:bg-white/[0.03] transition-colors">
                      <td className="px-5 py-3.5 font-mono text-xs font-bold text-indigo-400">
                        {s.shelf_code}
                      </td>
                      <td className="px-5 py-3.5 text-xs text-slate-200 font-medium">
                        {s.shelf_name}
                      </td>
                      <td className="px-5 py-3.5 text-xs text-slate-400">
                        {getLocationCodeName(s.location_id)}
                      </td>
                      <td className="px-5 py-3.5 text-xs text-slate-300 font-mono">
                        ระดับ {s.shelf_level || "1"}
                      </td>
                      <td className="px-5 py-3.5">
                        <span
                          className={`text-[11px] px-2 py-0.5 rounded-full border ${
                            s.active ? "badge-normal" : "badge-out"
                          }`}
                        >
                          {s.active ? "ใช้งาน" : "ปิดใช้งาน"}
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

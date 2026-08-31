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
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            ผังคลังสินค้าและตำแหน่งจัดเก็บ (Locations & Shelves)
          </h1>
          <p className="text-slate-500 text-xs sm:text-sm mt-0.5">
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
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs sm:text-sm shadow-md shadow-indigo-600/20 cursor-pointer active:scale-95 transition-all"
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
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs sm:text-sm shadow-md shadow-indigo-600/20 cursor-pointer active:scale-95 transition-all"
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
      <div className="flex border-b border-slate-200 gap-6 text-xs sm:text-sm font-bold">
        <button
          onClick={() => setActiveTab("locations")}
          className={`pb-3 border-b-2 transition-colors cursor-pointer ${
            activeTab === "locations"
              ? "border-indigo-600 text-indigo-600"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          📍 1. ตำแหน่งจัดเก็บ (Locations) [{locations.length}]
        </button>
        <button
          onClick={() => setActiveTab("shelves")}
          className={`pb-3 border-b-2 transition-colors cursor-pointer ${
            activeTab === "shelves"
              ? "border-indigo-600 text-indigo-600"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          📦 2. ชั้นวางสินค้า (Shelves) [{shelves.length}]
        </button>
      </div>

      {/* Location Create Form */}
      {showLocationForm && activeTab === "locations" && (
        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs">
          <h2 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-4">
            สร้างตำแหน่งจัดเก็บใหม่ (Location)
          </h2>
          {error && (
            <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs sm:text-sm font-medium">
              {error}
            </div>
          )}
          <form onSubmit={handleCreateLocation} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label htmlFor="loc-warehouse" className="block text-xs font-semibold text-slate-700 mb-1.5">โกดัง (Warehouse) *</label>
                <select
                  id="loc-warehouse"
                  value={locWhId}
                  onChange={(e) => setLocWhId(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 focus:outline-none focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 text-xs sm:text-sm font-semibold cursor-pointer"
                >
                  <option value="">เลือกโกดัง</option>
                  {warehouses.map((w) => (
                    <option key={w.warehouse_id} value={w.warehouse_id}>
                      {w.warehouse_name} ({w.warehouse_code})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="loc-code" className="block text-xs font-semibold text-slate-700 mb-1.5">รหัสตำแหน่ง (Location Code) *</label>
                <input
                  id="loc-code"
                  value={locCode}
                  onChange={(e) => setLocCode(e.target.value)}
                  placeholder="เช่น LOC-A01"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 text-xs sm:text-sm font-mono font-bold"
                />
              </div>
              <div>
                <label htmlFor="loc-name" className="block text-xs font-semibold text-slate-700 mb-1.5">ชื่อตำแหน่ง (Location Name)</label>
                <input
                  id="loc-name"
                  value={locName}
                  onChange={(e) => setLocName(e.target.value)}
                  placeholder="เช่น โซน A ล็อค 1"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 text-xs sm:text-sm"
                />
              </div>
            </div>

            <div>
              <label htmlFor="loc-desc" className="block text-xs font-semibold text-slate-700 mb-1.5">รายละเอียด</label>
              <input
                id="loc-desc"
                value={locDesc}
                onChange={(e) => setLocDesc(e.target.value)}
                placeholder="คำอธิบายตำแหน่ง เช่น แถวหน้าติดประตู"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 text-xs sm:text-sm"
              />
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowLocationForm(false)}
                className="flex-1 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs sm:text-sm font-semibold transition-all cursor-pointer active:scale-95"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={submittingLoc}
                className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs sm:text-sm font-bold shadow-md shadow-indigo-600/20 transition-all disabled:opacity-50 cursor-pointer active:scale-95"
              >
                {submittingLoc ? "กำลังบันทึก..." : "บันทึกตำแหน่ง"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Shelf Create Form */}
      {showShelfForm && activeTab === "shelves" && (
        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs">
          <h2 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-4">
            สร้างชั้นวางสินค้าใหม่ (Shelf)
          </h2>
          {error && (
            <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs sm:text-sm font-medium">
              {error}
            </div>
          )}
          <form onSubmit={handleCreateShelf} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <label htmlFor="shelf-loc" className="block text-xs font-semibold text-slate-700 mb-1.5">ตำแหน่งจัดเก็บ (Location) *</label>
                <select
                  id="shelf-loc"
                  value={shelfLocId}
                  onChange={(e) => setShelfLocId(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 focus:outline-none focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 text-xs sm:text-sm font-semibold cursor-pointer"
                >
                  <option value="">เลือกตำแหน่ง</option>
                  {locations.map((l, idx) => (
                    <option key={`loc-form-opt-${l.location_id || l.location_code || idx}-${idx}`} value={l.location_id}>
                      {l.location_name || l.location_code} ({getWarehouseName(l.warehouse_id)})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="shelf-code" className="block text-xs font-semibold text-slate-700 mb-1.5">รหัสชั้น (Shelf Code) *</label>
                <input
                  id="shelf-code"
                  value={shelfCode}
                  onChange={(e) => setShelfCode(e.target.value)}
                  placeholder="เช่น SH-A1-01"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 text-xs sm:text-sm font-mono font-bold"
                />
              </div>
              <div>
                <label htmlFor="shelf-name" className="block text-xs font-semibold text-slate-700 mb-1.5">ชื่อชั้น (Shelf Name) *</label>
                <input
                  id="shelf-name"
                  value={shelfName}
                  onChange={(e) => setShelfName(e.target.value)}
                  placeholder="เช่น ชั้นบนสุด A1"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 text-xs sm:text-sm font-medium"
                />
              </div>
              <div>
                <label htmlFor="shelf-level" className="block text-xs font-semibold text-slate-700 mb-1.5">ระดับชั้น (Level)</label>
                <input
                  id="shelf-level"
                  value={shelfLevel}
                  onChange={(e) => setShelfLevel(e.target.value)}
                  placeholder="1, 2, 3..."
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 text-xs sm:text-sm font-mono"
                />
              </div>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowShelfForm(false)}
                className="flex-1 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs sm:text-sm font-semibold transition-all cursor-pointer active:scale-95"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={submittingShelf}
                className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs sm:text-sm font-bold shadow-md shadow-indigo-600/20 transition-all disabled:opacity-50 cursor-pointer active:scale-95"
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
            className="px-3.5 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-800 text-xs sm:text-sm font-semibold focus:outline-none focus:border-indigo-500 cursor-pointer shadow-xs"
          >
            <option value="">ทุกโกดัง</option>
            {warehouses.map((w) => (
              <option key={w.warehouse_id} value={w.warehouse_id}>
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
            className="px-3.5 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-800 text-xs sm:text-sm font-semibold focus:outline-none focus:border-indigo-500 cursor-pointer shadow-xs"
          >
            <option value="">ทุกตำแหน่งจัดเก็บ</option>
            {locations.map((l, idx) => (
              <option key={`opt-loc-${l.location_id || l.location_code || idx}-${l.warehouse_id || 'wh'}-${idx}`} value={l.location_id}>
                {l.location_name || l.location_code} ({l.location_code})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Table Content */}
      {loading ? (
        <div className="text-center py-12 text-slate-500 text-sm font-medium">กำลังโหลดข้อมูล...</div>
      ) : activeTab === "locations" ? (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 text-slate-500 border-b border-slate-200">
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider">รหัสตำแหน่ง</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider">ชื่อตำแหน่ง</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider">โกดังที่สังกัด</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider">รายละเอียด</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider">สถานะ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs sm:text-sm">
                {locations.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-10 text-slate-500 text-sm">
                      ไม่พบตำแหน่งจัดเก็บ
                    </td>
                  </tr>
                ) : (
                  locations.map((loc, idx) => (
                    <tr key={`tr-loc-${loc.location_id || loc.location_code || idx}-${loc.warehouse_id || 'wh'}-${idx}`} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-5 py-3.5 font-mono text-xs font-bold text-indigo-600">
                        {loc.location_code}
                      </td>
                      <td className="px-5 py-3.5 text-xs sm:text-sm text-slate-900 font-bold">
                        {loc.location_name || loc.location_code}
                      </td>
                      <td className="px-5 py-3.5 text-xs text-slate-600">
                        {getWarehouseName(loc.warehouse_id)}
                      </td>
                      <td className="px-5 py-3.5 text-xs text-slate-500">
                        {loc.description || "-"}
                      </td>
                      <td className="px-5 py-3.5">
                        <span
                          className={`text-xs px-2.5 py-0.5 rounded-full font-bold border ${
                            loc.active
                              ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                              : "bg-slate-100 text-slate-600 border-slate-200"
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
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 text-slate-500 border-b border-slate-200">
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider">รหัสชั้นวาง</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider">ชื่อชั้นวาง</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider">ตำแหน่งที่สังกัด</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider">ระดับชั้น</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider">สถานะ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs sm:text-sm">
                {shelves.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-10 text-slate-500 text-sm">
                      ไม่พบชั้นวางสินค้า
                    </td>
                  </tr>
                ) : (
                  shelves.map((s, idx) => (
                    <tr key={`tr-shelf-${s.shelf_id || s.shelf_code || idx}-${s.location_id || 'loc'}-${idx}`} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-5 py-3.5 font-mono text-xs font-bold text-indigo-600">
                        {s.shelf_code}
                      </td>
                      <td className="px-5 py-3.5 text-xs sm:text-sm text-slate-900 font-bold">
                        {s.shelf_name}
                      </td>
                      <td className="px-5 py-3.5 text-xs text-slate-600">
                        {getLocationCodeName(s.location_id)}
                      </td>
                      <td className="px-5 py-3.5 text-xs text-slate-700 font-mono">
                        ระดับ {s.shelf_level || "1"}
                      </td>
                      <td className="px-5 py-3.5">
                        <span
                          className={`text-xs px-2.5 py-0.5 rounded-full font-bold border ${
                            s.active
                              ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                              : "bg-slate-100 text-slate-600 border-slate-200"
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

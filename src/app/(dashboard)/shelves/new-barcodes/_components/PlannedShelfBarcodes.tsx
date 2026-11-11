"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import BarcodeSvg from "@/components/ui/BarcodeSvg";
import { SolarMagnifier, SolarPrinter, SolarRefresh, SolarTagBarcode } from "@/components/icons";
import { generateShelfBarcodeStickerDataUrl } from "@/lib/barcode-utils";
import { filterPlannedLocations, PLANNED_SHELF_SIDE_NAMES, type PlannedLocationFilters } from "@/lib/planned-locations";
import type { PlannedLocation } from "@/types/planned-location";
import PlannedShelfPrintPreview from "./PlannedShelfPrintPreview";
import ShelfLetterLabels from "./ShelfLetterLabels";
import "./planned-shelf-barcodes.css";

const initialFilters: PlannedLocationFilters = { warehouse: "", buildingFloor: "", shelfLevel: "", side: "", search: "" };

export default function PlannedShelfBarcodes() {
  const [locations, setLocations] = useState<PlannedLocation[]>([]);
  const [filters, setFilters] = useState(initialFilters);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [printing, setPrinting] = useState<PlannedLocation[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const selectAll = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    fetch("/api/planned-locations", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const json = await response.json();
        if (!response.ok || !json.success || !Array.isArray(json.data)) throw new Error(json.message || "โหลดตำแหน่งชุดใหม่ไม่สำเร็จ");
        setLocations(json.data); setSelected(new Set());
      })
      .catch((reason: Error) => { if (!controller.signal.aborted) setError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload]);

  const warehouses = useMemo(() => [...new Map(locations.map((location) => [location.warehouse_id, {
    id: location.warehouse_id, name: location.warehouse_name, prefix: location.warehouse_prefix,
  }])).values()], [locations]);
  const warehouseLocations = locations.filter((location) => !filters.warehouse || location.warehouse_id === filters.warehouse);
  const buildingFloors = [...new Set(warehouseLocations.map((location) => location.building_floor).filter((floor) => floor !== null))].sort((a, b) => a - b);
  const shelfLevels = [...new Set(warehouseLocations.map((location) => location.shelf_level))].sort((a, b) => a - b);
  const filtered = filterPlannedLocations(locations, filters);
  const selectedVisible = filtered.filter((location) => selected.has(location.planned_location_id)).length;
  const allVisibleSelected = filtered.length > 0 && selectedVisible === filtered.length;
  const printItems = selected.size ? locations.filter((location) => selected.has(location.planned_location_id)) : filtered;
  const blocks = new Set(filtered.map((location) => `${location.warehouse_id}:${location.block_number}`)).size;

  useEffect(() => {
    if (selectAll.current) selectAll.current.indeterminate = selectedVisible > 0 && !allVisibleSelected;
  }, [selectedVisible, allVisibleSelected]);

  function setFilter(key: keyof PlannedLocationFilters, value: string) {
    setFilters((current) => key === "warehouse" ? { ...current, warehouse: value, buildingFloor: "", shelfLevel: "", side: "" }
      : { ...current, [key]: value });
  }

  function toggleOne(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function download(location: PlannedLocation) {
    const url = generateShelfBarcodeStickerDataUrl(location.location_code);
    if (!url) { setError("สร้างภาพบาร์โค้ดไม่สำเร็จ กรุณาลองใหม่"); return; }
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `shelf-${location.location_code}.png`;
    anchor.click();
  }

  return (
    <div className="planned-shelf-workspace" aria-busy={loading}>
      <section className="planned-shelf-panel planned-shelf-controls">
        <div className="planned-shelf-heading">
          <div>
            <div className="planned-shelf-title"><SolarTagBarcode size={24} /><h2>บาร์โค้ดชั้นวางสินค้าใหม่</h2><span className="planned-shelf-badge">เตรียมใช้งาน</span></div>
            <p>ป้ายตำแหน่งชุดใหม่ แยกตามโกดัง ล็อก ฝั่ง และชั้นวาง</p>
          </div>
          <div className="planned-shelf-actions">
            <button type="button" className="m3-btn m3-btn-outline" disabled={loading} aria-label="โหลดตำแหน่งใหม่" onClick={() => setReload((n) => n + 1)}><SolarRefresh size={18} />โหลดใหม่</button>
            <button type="button" className="m3-btn m3-btn-primary" disabled={loading || !!error || !printItems.length} onClick={() => setPrinting([...printItems])}><SolarPrinter size={18} />{selected.size ? `พิมพ์ที่เลือก (${printItems.length})` : `พิมพ์ตามตัวกรอง (${printItems.length})`}</button>
          </div>
        </div>
        <div className="planned-shelf-filters">
          <label>โกดัง / ออฟฟิศ<select value={filters.warehouse} onChange={(event) => setFilter("warehouse", event.target.value)}><option value="">ทุกโกดัง / ออฟฟิศ</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name} ({warehouse.prefix})</option>)}</select></label>
          <label>ชั้นอาคาร<select value={filters.buildingFloor} onChange={(event) => setFilter("buildingFloor", event.target.value)}><option value="">ทุกชั้นอาคาร</option>{buildingFloors.map((floor) => <option key={floor} value={floor}>ชั้นอาคาร {floor}</option>)}</select></label>
          <label>ฝั่ง<select value={filters.side} onChange={(event) => setFilter("side", event.target.value)}><option value="">ทุกฝั่ง</option>{Object.entries(PLANNED_SHELF_SIDE_NAMES).map(([side, name]) => <option key={side} value={side}>{side} — {name}</option>)}</select></label>
          <label>ชั้นวาง<select value={filters.shelfLevel} onChange={(event) => setFilter("shelfLevel", event.target.value)}><option value="">ทุกชั้นวาง</option>{shelfLevels.map((level) => <option key={level} value={level}>L{level} — ชั้นที่ {level}</option>)}</select></label>
          <label className="planned-shelf-search-label">ค้นหารหัส / เลขล็อก<div className="planned-shelf-search"><SolarMagnifier size={20} /><input type="search" placeholder="เช่น K6-22-AL1 หรือ 22" value={filters.search} onChange={(event) => setFilter("search", event.target.value)} /></div></label>
        </div>
        <div className="planned-shelf-summary">
          <div><strong>{filtered.length.toLocaleString("th-TH")}</strong> ตำแหน่ง · <strong>{blocks}</strong> ล็อก <span>เลือกไว้ {selected.size} ตำแหน่ง</span></div>
          <div className="planned-shelf-summary-actions">
            <button type="button" onClick={() => setFilters(initialFilters)}>ล้างตัวกรอง</button>
            {selected.size > 0 && <button type="button" onClick={() => setSelected(new Set())}>ล้างการเลือก</button>}
          </div>
        </div>
      </section>

      <ShelfLetterLabels />
      {error && <div className="planned-shelf-error" role="alert"><span>{error}</span><button type="button" onClick={() => setReload((n) => n + 1)}>ลองใหม่</button></div>}
      {loading ? <div className="planned-shelf-empty" role="status">กำลังโหลดตำแหน่งชั้นวางชุดใหม่…</div>
        : !error && !filtered.length ? <div className="planned-shelf-panel planned-shelf-empty"><SolarTagBarcode size={44} /><h3>{locations.length ? "ไม่พบตำแหน่งที่ค้นหา" : "ยังไม่มีตำแหน่งชั้นวางชุดใหม่"}</h3><p>{locations.length ? "ลองเปลี่ยนตัวกรองหรือคำค้นหา" : "รายการที่เตรียมไว้จะแสดงในหน้านี้"}</p></div>
          : !error && <>
            <label className="planned-shelf-select-all"><input ref={selectAll} type="checkbox" checked={allVisibleSelected} onChange={() => setSelected((current) => {
              const next = new Set(current);
              for (const location of filtered) {
                if (allVisibleSelected) next.delete(location.planned_location_id); else next.add(location.planned_location_id);
              }
              return next;
            })} />เลือกที่แสดงทั้งหมด ({filtered.length})</label>
            <div className="planned-shelf-grid">
              {filtered.map((location) => (
                <article key={location.planned_location_id} className={`planned-shelf-card${selected.has(location.planned_location_id) ? " is-selected" : ""}`}>
                  <div className="planned-shelf-card-top"><label><input type="checkbox" checked={selected.has(location.planned_location_id)} onChange={() => toggleOne(location.planned_location_id)} aria-label={`เลือก ${location.location_code}`} /><span>{location.warehouse_name}</span></label>{location.building_floor !== null && <span>ชั้นอาคาร {location.building_floor}</span>}</div>
                  <h3>{location.location_code}</h3>
                  <div className="planned-shelf-barcode"><BarcodeSvg value={location.location_code} width={2} height={66} showText={false} disableZoom className="w-full border-0 bg-white p-0 shadow-none" /></div>
                  <button type="button" className="planned-shelf-download" onClick={() => download(location)} aria-label={`ดาวน์โหลดป้าย ${location.location_code}`}>ดาวน์โหลด PNG</button>
                </article>
              ))}
            </div>
          </>}
      <div className="planned-shelf-footer"><span>ป้ายชุดใหม่สำหรับเตรียมตำแหน่งสินค้า</span><Link href="/shelves/qr">บาร์โค้ดชั้นวางเดิม</Link></div>
      {printing && <PlannedShelfPrintPreview locations={printing} onClose={() => setPrinting(null)} />}
    </div>
  );
}

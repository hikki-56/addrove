"use client";

import React, { useState } from "react";
import type { Product } from "@/types/models";
import { SolarBuildings, SolarMapPoint } from "@/components/icons/solar";

// แถวขยายในหน้า "สินค้าทั้งหมด": ยอดต่อโกดัง + ตำแหน่ง (ชั้น/ช่อง) ที่สินค้าอยู่ พร้อมจำนวน
// ข้อมูลมาจาก locations_breakdown ที่ /api/products ส่งมากับรายการอยู่แล้ว (ไม่ต้องโหลดเพิ่ม)

export interface WarehouseLocationGroup {
  key: string;
  name: string;
  qty: number;
  locations: { code: string; qty: number }[];
}

const NO_LOCATION = new Set(["", "-"]);

/** จัดกลุ่มตามโกดัง → ตำแหน่ง เรียงจำนวนมาก→น้อย (ตำแหน่งว่าง/"-" รวมเป็น "ไม่ระบุตำแหน่ง" ไว้ท้ายสุด) */
export function groupLocationsByWarehouse(breakdown: Product["locations_breakdown"]): WarehouseLocationGroup[] {
  const groups = new Map<string, WarehouseLocationGroup & { map: Map<string, number> }>();
  for (const e of breakdown ?? []) {
    const key = e.warehouse_id || e.warehouse_name;
    const qty = Number(e.quantity) || 0;
    const g = groups.get(key) ?? { key, name: e.warehouse_name || e.warehouse_id, qty: 0, locations: [], map: new Map() };
    const code = NO_LOCATION.has((e.location || "").trim()) ? "" : e.location.trim();
    g.qty += qty;
    g.map.set(code, (g.map.get(code) ?? 0) + qty);
    groups.set(key, g);
  }
  return Array.from(groups.values())
    .map(({ map, ...g }) => ({
      ...g,
      locations: Array.from(map, ([code, qty]) => ({ code, qty })).sort(
        (a, b) => Number(a.code === "") - Number(b.code === "") || b.qty - a.qty || a.code.localeCompare(b.code)
      ),
    }))
    .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name, "th"));
}

const VISIBLE = 6;

function WarehouseGroup({ group, unit }: { group: WarehouseLocationGroup; unit: string }) {
  const [showAll, setShowAll] = useState(false);
  const hidden = group.locations.length - VISIBLE;
  const shown = showAll || hidden <= 0 ? group.locations : group.locations.slice(0, VISIBLE);
  return (
    <li className="rounded-xl bg-m3-grey-100 p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-1.5 text-sm font-bold text-m3-grey-800">
          <SolarBuildings size={16} className="shrink-0 text-m3-primary-dark" />
          <span className="truncate">{group.name}</span>
        </span>
        <span className="shrink-0 text-sm text-m3-grey-600">
          <b className="tabular-nums text-m3-primary-darker">{group.qty.toLocaleString()}</b> {unit}
        </span>
      </div>
      <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={`ตำแหน่งใน ${group.name}`}>
        {shown.map((l) => (
          <li
            key={l.code || "__none"}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1 text-xs shadow-[0_0_0_1px_rgba(145,158,171,0.2)]"
          >
            <SolarMapPoint size={14} className="shrink-0 text-m3-grey-500" />
            {l.code ? (
              <span className="font-bold tabular-nums text-m3-grey-800">{l.code}</span>
            ) : (
              <span className="font-medium text-m3-grey-500">ไม่ระบุตำแหน่ง</span>
            )}
            <span className="tabular-nums font-bold text-m3-primary-darker">{l.qty.toLocaleString()}</span>
            <span className="text-m3-grey-600">{unit}</span>
          </li>
        ))}
        {hidden > 0 && (
          <li>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowAll((v) => !v);
              }}
              aria-expanded={showAll}
              className="m3-btn m3-btn-sm m3-btn-text h-7 px-2 text-xs"
            >
              {showAll ? "ย่อ" : `+${hidden} ตำแหน่ง`}
            </button>
          </li>
        )}
      </ul>
    </li>
  );
}

export default function ProductLocationBreakdown({ product }: { product: Product }) {
  const groups = groupLocationsByWarehouse(product.locations_breakdown);
  const unit = product.base_unit || "ชิ้น";
  return (
    <div className="rounded-xl border border-[rgba(0,167,111,0.24)] bg-white p-3 sm:p-3.5" onClick={(e) => e.stopPropagation()}>
      <p className="mb-2 text-xs font-bold text-m3-grey-700">อยู่ในโกดัง / ตำแหน่ง</p>
      {groups.length === 0 ? (
        <p className="rounded-lg bg-m3-grey-100 px-3 py-4 text-center text-xs font-medium text-m3-grey-600">ยังไม่มีข้อมูลโกดังหรือตำแหน่งของสินค้านี้</p>
      ) : (
        <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          {groups.map((g) => (
            <WarehouseGroup key={g.key} group={g} unit={unit} />
          ))}
        </ul>
      )}
    </div>
  );
}

"use client";

import React from "react";
import { DEFAULT_WAREHOUSES } from "@/hooks/use-warehouse-data";
import { normalizeWarehouseId } from "@/lib/warehouse-utils";

export interface WarehouseTabsProps {
  activeWarehouseId: string;
  onSelectWarehouse: (warehouseId: string) => void;
  warehouses?: { warehouse_id: string; warehouse_name: string }[];
  className?: string;
  disabled?: boolean;
}

export default function WarehouseTabs({
  activeWarehouseId,
  onSelectWarehouse,
  warehouses = DEFAULT_WAREHOUSES,
  className = "",
  disabled = false,
}: WarehouseTabsProps) {
  const normalizedActive = normalizeWarehouseId(activeWarehouseId);

  return (
    <div className={`flex flex-wrap items-center gap-2 p-1.5 bg-slate-900/60 border border-slate-800/80 rounded-2xl backdrop-blur-md ${className}`}>
      {warehouses.map((wh) => {
        const normId = normalizeWarehouseId(wh.warehouse_id);
        const isActive = normId === normalizedActive;

        return (
          <button
            key={wh.warehouse_id}
            type="button"
            disabled={disabled}
            onClick={() => onSelectWarehouse(normId)}
            className={`flex-1 min-w-[90px] py-2.5 px-4 rounded-xl text-sm font-medium transition-all duration-200 flex items-center justify-center gap-2 ${
              isActive
                ? "bg-[#06402B] text-white shadow-[0_1px_2px_rgba(16,24,40,0.10)] font-semibold"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
            } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer active:scale-95"}`}
          >
            <span className={`w-2 h-2 rounded-full ${isActive ? "bg-[#8FB3A3] animate-pulse" : "bg-slate-600"}`} />
            {wh.warehouse_name}
          </button>
        );
      })}
    </div>
  );
}

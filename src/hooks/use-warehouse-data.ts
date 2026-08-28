"use client";

import { useEffect, useState, useCallback } from "react";
import type { Warehouse, Location, Product } from "@/types/models";
import {
  getActiveWarehouse,
  setActiveWarehouse,
  getWarehouseName,
  getDefaultLocationsForWarehouse,
  normalizeWarehouseId,
} from "@/lib/warehouse-utils";

export const DEFAULT_WAREHOUSES: { warehouse_id: string; warehouse_name: string }[] = [
  { warehouse_id: "wh-01", warehouse_name: "โกดัง1" },
  { warehouse_id: "wh-02", warehouse_name: "โกดัง2" },
  { warehouse_id: "wh-03", warehouse_name: "โกดัง3" },
  { warehouse_id: "wh-04", warehouse_name: "โกดัง4" },
  { warehouse_id: "wh-05", warehouse_name: "โกดัง5" },
  { warehouse_id: "wh-06", warehouse_name: "สำนักงานใหญ่" },
];

export interface UseWarehouseDataOptions {
  initialWarehouseId?: string;
  autoFetch?: boolean;
}

export function useWarehouseData(options: UseWarehouseDataOptions = {}) {
  const { initialWarehouseId, autoFetch = true } = options;

  const [activeWhId, setActiveWhIdState] = useState<string>(() => {
    if (initialWarehouseId) return getActiveWarehouse(initialWarehouseId);
    if (typeof window !== "undefined") {
      const urlParams = new URLSearchParams(window.location.search);
      const paramWh = urlParams.get("warehouse_id") || urlParams.get("wh");
      return getActiveWarehouse(paramWh);
    }
    return "wh-01";
  });

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const changeActiveWarehouse = useCallback((newWhId: string) => {
    const normalized = normalizeWarehouseId(newWhId);
    setActiveWhIdState(normalized);
    setActiveWarehouse(normalized);

    // URL คือเจ้าของความจริงตาม getActiveWarehouse() — ต้องอัปเดตด้วย
    // ไม่งั้นค่าเดิมใน URL จะย้อนสถานะกลับ
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (url.searchParams.has("warehouse_id") || url.searchParams.has("wh")) {
        url.searchParams.delete("wh");
        url.searchParams.set("warehouse_id", normalized);
        window.history.replaceState(null, "", url.toString());
      }
      // บอกส่วนอื่นทันที ไม่ต้องรอ poll 5 วินาที
      window.dispatchEvent(new CustomEvent("stockify-warehouse-changed", { detail: { warehouseId: normalized } }));
    }
  }, []);

  // Listen to warehouse change events from other components/hooks
  useEffect(() => {
    const handleWhChanged = (e: Event) => {
      const customEvent = e as CustomEvent<{ warehouseId?: string }>;
      const wh = customEvent.detail?.warehouseId;
      if (wh) {
        setActiveWhIdState(normalizeWarehouseId(wh));
      }
    };
    window.addEventListener("stockify-warehouse-changed", handleWhChanged);
    return () => {
      window.removeEventListener("stockify-warehouse-changed", handleWhChanged);
    };
  }, []);

  const refreshData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const now = Date.now();
      const [whRes, locRes, prodRes] = await Promise.all([
        fetch(`/api/warehouses?_t=${now}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : { data: [] })),
        fetch(`/api/locations?_t=${now}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : { data: [] })),
        fetch(`/api/products?warehouse_id=${encodeURIComponent(activeWhId)}&_t=${now}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : { data: [] })),
      ]);

      const fetchedWarehouses: Warehouse[] = whRes.data || [];
      const fetchedLocations: Location[] = locRes.data || [];
      const fetchedProducts: Product[] = Array.isArray(prodRes.data) ? prodRes.data : prodRes.data?.items || [];

      setWarehouses(fetchedWarehouses.length > 0 ? fetchedWarehouses : (DEFAULT_WAREHOUSES as unknown as Warehouse[]));
      setLocations(fetchedLocations);
      setProducts(fetchedProducts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาดในการโหลดข้อมูล");
    } finally {
      setLoading(false);
    }
  }, [activeWhId]);

  useEffect(() => {
    let mounted = true;
    if (autoFetch) {
      void (async () => {
        if (!mounted) return;
        await refreshData();
      })();
    }
    return () => {
      mounted = false;
    };
  }, [autoFetch, refreshData]);

  // Derived location list for the currently active warehouse
  const activeLocations = locations.filter((loc) => {
    const wh = normalizeWarehouseId(loc.warehouse_id);
    return wh === activeWhId || wh === normalizeWarehouseId(activeWhId);
  });

  const fallbackLocations: Location[] = activeLocations.length > 0
    ? activeLocations
    : getDefaultLocationsForWarehouse(activeWhId);

  return {
    activeWhId,
    setActiveWhId: changeActiveWarehouse,
    warehouses,
    locations: fallbackLocations,
    allLocations: locations,
    products,
    setProducts,
    setLocations,
    loading,
    error,
    refreshData,
    getWarehouseName,
    normalizeWarehouseId,
  };
}

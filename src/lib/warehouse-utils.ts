import type { Location } from "@/types/models";

const ACTIVE_WH_KEY = "stockify_active_warehouse";

/**
 * Normalizes any warehouse identifier into the canonical warehouse_id format (wh-01..wh-05).
 * Supports: wh-01, wh-1, wh01, wh1, โกดัง1, โกดัง 1, and plain digit 1-5.
 */
export function normalizeWarehouseId(val: string | null | undefined): string {
  if (!val) return "wh-01";
  let str = String(val).trim().toLowerCase();

  // 1. Extract from URL query string
  if (str.includes("warehouse_id=") || str.includes("wh=")) {
    try {
      const match =
        str.match(/[?&](?:warehouse_id|wh)=([^&]+)/) ||
        str.match(/(?:warehouse_id|wh)=([^&]+)/);
      if (match && match[1]) {
        str = decodeURIComponent(match[1]).trim().toLowerCase();
      }
    } catch {}
  }

  // 2. Already canonical: wh-01..wh-05
  if (/^wh-0[1-5]$/.test(str)) return str;

  // 3. Legacy wh-1..wh-5 → wh-01..wh-05
  if (/^wh-[1-5]$/.test(str)) return `wh-0${str.slice(-1)}`;

  // 4. wh01..wh05 or wh1..wh5
  const whNum = str.match(/^wh0?([1-5])$/);
  if (whNum) return `wh-0${whNum[1]}`;

  // 5. Thai format: "โกดัง1".."โกดัง5" or "โกดัง 1".."โกดัง 5"
  const thaiNum = str.match(/โกดัง\s*([1-5])/);
  if (thaiNum) return `wh-0${thaiNum[1]}`;

  // 6. Standalone digit 1-5
  if (/^[1-5]$/.test(str)) return `wh-0${str}`;

  return "wh-01";
}

/**
 * Saves the active warehouse ID to localStorage and sessionStorage.
 */
export function setActiveWarehouse(whId: string): string {
  const normalized = normalizeWarehouseId(whId);
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(ACTIVE_WH_KEY, normalized);
      sessionStorage.setItem(ACTIVE_WH_KEY, normalized);
    } catch {
      // Ignore storage errors (e.g. incognito restriction)
    }
  }
  return normalized;
}

/**
 * Gets the current active warehouse ID.
 * Priority: 1. Explicit whParam -> 2. window.location.search -> 3. localStorage/sessionStorage -> 4. Default "wh-01"
 * The URL is ALWAYS the source of truth when present — localStorage is only a fallback.
 */
export function getActiveWarehouse(whParam?: string | null): string {
  // 1. Explicit parameter provided (e.g. from useSearchParams or a redirect)
  if (whParam && whParam.trim().length > 0) {
    return setActiveWarehouse(whParam);
  }

  // 2. Read from window.location.search directly (always accurate on client)
  if (typeof window !== "undefined") {
    try {
      const search = window.location.search;
      if (search && (search.includes("warehouse_id=") || search.includes("wh="))) {
        const params = new URLSearchParams(search);
        const urlWh = params.get("warehouse_id") || params.get("wh");
        if (urlWh && urlWh.trim().length > 0) {
          // URL param found — this is authoritative, update storage and return
          return setActiveWarehouse(urlWh);
        }
      }

      // 3. No URL param — fall back to sessionStorage then localStorage
      const stored =
        sessionStorage.getItem(ACTIVE_WH_KEY) ||
        localStorage.getItem(ACTIVE_WH_KEY);
      if (stored) {
        return normalizeWarehouseId(stored);
      }
    } catch {
      // Fallback
    }
  }

  return "wh-01";
}


/**
 * Returns user-friendly Thai display name for a warehouse ID.
 */
export function getWarehouseName(whId: string): string {
  const normalized = normalizeWarehouseId(whId);
  const names: Record<string, string> = {
    "wh-01": "โกดัง1",
    "wh-02": "โกดัง2",
    "wh-03": "โกดัง3",
    "wh-04": "โกดัง4",
    "wh-05": "โกดัง5",
  };
  return names[normalized] || "โกดัง1";
}

/**
 * Generates default fallback locations for a warehouse.
 * Used only when no real locations exist in the database.
 */
export function getDefaultLocationsForWarehouse(whId: string): Location[] {
  const normalized = normalizeWarehouseId(whId);
  const whNum = normalized.replace(/^wh-0?/, "");
  const whCode = `WH${whNum}`;

  return [
    {
      location_id: `loc-${normalized}-A1`,
      warehouse_id: normalized,
      location_code: `${whCode}-A01`,
      location_name: `${whCode}-A01`,
      description: `ตำแหน่ง A01 (${getWarehouseName(normalized)})`,
      active: true,
      created_at: "",
      updated_at: "",
    },
    {
      location_id: `loc-${normalized}-A2`,
      warehouse_id: normalized,
      location_code: `${whCode}-A02`,
      location_name: `${whCode}-A02`,
      description: `ตำแหน่ง A02 (${getWarehouseName(normalized)})`,
      active: true,
      created_at: "",
      updated_at: "",
    },
    {
      location_id: `loc-${normalized}-B1`,
      warehouse_id: normalized,
      location_code: `${whCode}-B01`,
      location_name: `${whCode}-B01`,
      description: `ตำแหน่ง B01 (${getWarehouseName(normalized)})`,
      active: true,
      created_at: "",
      updated_at: "",
    },
  ];
}

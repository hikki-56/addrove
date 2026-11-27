"use client";

import { useEffect, useState } from "react";
import type { ReportLocationOption } from "@/features/production/lib/report-locations";

export function useProductionReportLocations() {
  const [receipt, setReceipt] = useState<ReportLocationOption[]>([]);
  const [leftover, setLeftover] = useState<ReportLocationOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/production/locations", { cache: "no-store" }).then((r) => r.json()).then((json) => {
      if (!live) return;
      if (!json.success) throw new Error(json.message || "โหลดตำแหน่งเก็บไม่สำเร็จ");
      setReceipt(Array.isArray(json.data) ? json.data : []);
      setLeftover(Array.isArray(json.leftover_locations) ? json.leftover_locations : []);
    }).catch((e) => { if (live) setError(e instanceof Error ? e.message : "โหลดตำแหน่งเก็บไม่สำเร็จ"); });
    return () => { live = false; };
  }, []);
  return { receipt, leftover, error };
}

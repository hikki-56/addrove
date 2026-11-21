"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePollingWhenVisible } from "@/hooks/use-visibility-polling";
import type { RoundReport } from "@/types/count-round";
import { dateLabel, downloadRound, errorText, getCount, sendCount } from "@/app/(dashboard)/stock-counts/_lib/count-client";
import { SolarRefresh } from "@/components/icons";
import { groupCountEntriesByShelf } from "@/app/(dashboard)/stock-counts/_lib/count-ui";

interface Props {
  warehouse: string;
  warehouseName: string;
  round: string;
  userId: string;
  canCloseAll: boolean;
  canCount: boolean;
  listedOpen: boolean;
  onClosed: () => void;
}

export default function RoundWorkspace({ warehouse, warehouseName, round, userId, canCount, canCloseAll, listedOpen, onClosed }: Props) {
  const [report, setReport] = useState<RoundReport>();
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const version = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++version.current;
    try {
      const data = await getCount<RoundReport>({ warehouse, round });
      if (current === version.current) { setReport(data); setLoadError(""); }
    } catch (e) { if (current === version.current) setLoadError(errorText(e)); }
  }, [warehouse, round]);
  usePollingWhenVisible(refresh, 60000);
  useEffect(() => {
    if (listedOpen && report?.round.closed_at) onClosed();
  }, [listedOpen, report?.round.closed_at, onClosed]);

  async function act(action: "close" | "export") {
    if (action === "close" && !window.confirm("จบรอบตรวจนับของทุกคนในโกดังนี้และดาวน์โหลด Excel?")) return;
    setBusy(true); setError("");
    try {
      if (action === "close") await sendCount({ action, warehouse, round });
      await downloadRound(await getCount<RoundReport>({ warehouse, round }), warehouseName);
    } catch (e) { setError(errorText(e)); } finally { await refresh(); setBusy(false); }
  }
  const open = report && !report.round.closed_at;
  const groups = report ? groupCountEntriesByShelf(report.entries) : [];
  const canClose = !!(open && canCount && (canCloseAll || report.round.opened_by === userId));

  return <>
    {loadError && <p role="alert">{loadError} <button className="m3-btn m3-btn-outline" onClick={refresh}>โหลดใหม่</button></p>}
    {!report && !loadError && <p role="status">กำลังโหลดข้อมูลรอบ…</p>}
    {report && (
      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <section className="min-w-0 overflow-hidden rounded-2xl bg-white shadow-m3-card">
          <header className="flex items-baseline justify-between gap-3 px-5 py-4">
            <h2 className="text-lg font-bold text-m3-grey-800">ชั้นที่นับ</h2>
            <span className="text-sm font-medium text-m3-grey-600">{groups.length} ชั้น</span>
          </header>
          {groups.length ? (
            <ul>
              {groups.map((group, i) => (
                <li key={group.shelf_code} className={`flex items-baseline justify-between gap-3 px-5 py-3 ${i > 0 ? "border-t border-dashed border-m3-grey-200" : ""}`}>
                  <div className="min-w-0">
                    <p className="font-bold text-m3-grey-800">{group.shelf_code}</p>
                    <p className="truncate text-sm text-m3-grey-600">{group.counter_name}</p>
                  </div>
                  <span className="shrink-0 text-xs font-medium tabular-nums text-m3-grey-600">{group.entries.length} รายการ</span>
                </li>
              ))}
            </ul>
          ) : <p className="px-5 pb-5 text-sm text-m3-grey-600">ยังไม่มีชั้นที่บันทึก</p>}
        </section>

        <section className="min-w-0 overflow-hidden rounded-2xl bg-white shadow-m3-card">
          <header className="flex flex-wrap items-center gap-2 px-4 py-4 sm:gap-3 sm:px-5">
            <h2 className="min-w-0 flex-1 text-lg font-bold text-m3-grey-800">ผลตรวจนับ <span className="ml-1 text-sm font-medium text-m3-grey-600">{report.entries.length} รายการ</span></h2>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
              <div className="flex items-center gap-2">
                <button className="m3-btn m3-btn-outline min-h-11 min-w-11 shrink-0" aria-label="โหลดล่าสุด" title="โหลดล่าสุด" disabled={busy} onClick={refresh}><SolarRefresh size={18} /></button>
                <button className="m3-btn m3-btn-outline min-h-11 min-w-0 flex-1 sm:flex-none" disabled={busy} onClick={() => act("export")}>ดาวน์โหลด Excel</button>
              </div>
              {canClose && <button className="m3-btn m3-btn-dark min-h-[52px] w-full sm:min-h-11 sm:w-auto" disabled={busy} onClick={() => act("close")}>จบรอบและดาวน์โหลด Excel</button>}
            </div>
          </header>
          {report.entries.length ? (
            <div className="max-h-[32rem] overflow-y-auto px-5 pb-2">
              {groups.map(group => (
                <div key={group.shelf_code} className="mb-1">
                  <h3 className="hidden pt-2 text-sm font-bold text-m3-grey-600 lg:block">ชั้น {group.shelf_code}</h3>
                  <ul className="divide-y divide-m3-grey-200">
                    {group.entries.map(row => (
                      <li key={row.request_id} className="flex items-start justify-between gap-3 py-3 text-sm">
                        <div className="min-w-0 flex-1">
                          <strong className="block break-words text-m3-grey-800">{row.product_name}</strong>
                          <p className="mt-0.5 break-words text-m3-grey-600">
                            <span className="lg:hidden">ชั้น {row.shelf_code} · </span>
                            {row.sku}
                            <span className="hidden lg:inline"> · {row.counter_name} · {dateLabel(row.counted_at)}</span>
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-base font-semibold tabular-nums text-m3-primary-dark">{row.quantity}</p>
                          <p className="text-xs text-m3-grey-600">{row.base_unit}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : <p className="px-5 pb-5 text-sm text-m3-grey-600">ยังไม่มีรายการที่บันทึก</p>}
          {(report.round.closed_at || error) && (
            <div className="space-y-1 border-t border-m3-grey-200 px-4 py-3 sm:px-5">
              {report.round.closed_at && <p className="text-sm text-m3-grey-600">จบรอบเมื่อ {dateLabel(report.round.closed_at)}</p>}
              {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            </div>
          )}
        </section>
      </div>
    )}
  </>;
}

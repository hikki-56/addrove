"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePollingWhenVisible } from "@/hooks/use-visibility-polling";
import type { RoundReport } from "@/types/count-round";
import { dateLabel, downloadRound, errorText, getCount, sendCount } from "@/app/(dashboard)/stock-counts/_lib/count-client";
import { SolarRefresh } from "@/components/icons";

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

  async function act(action: "finish" | "close" | "export", shelf?: string) {
    if (action === "close" && !window.confirm("จบรอบตรวจนับของทุกคนในโกดังนี้และดาวน์โหลด Excel?")) return;
    setBusy(true); setError("");
    try {
      if (action !== "export") await sendCount({ action, warehouse, round, shelf });
      if (action !== "finish") await downloadRound(await getCount<RoundReport>({ warehouse, round }), warehouseName);
    } catch (e) { setError(errorText(e)); } finally { await refresh(); setBusy(false); }
  }
  const open = report && !report.round.closed_at;
  return <>
    {loadError && <p role="alert">{loadError} <button className="m3-btn m3-btn-outline" onClick={refresh}>โหลดใหม่</button></p>}
    {!report && !loadError && <p role="status">กำลังโหลดข้อมูลรอบ…</p>}
    {report && <section className="m3-card min-w-0 space-y-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold">ผลตรวจนับ <span className="ml-1 text-sm font-medium text-m3-grey-600">{report.entries.length} รายการ</span></h2>
        <button className="m3-btn m3-btn-outline min-h-11 min-w-11" aria-label="โหลดล่าสุด" title="โหลดล่าสุด" disabled={busy} onClick={refresh}><SolarRefresh size={18} /></button>
      </header>
      {report.shelves.length > 0 && <ul className="divide-y divide-m3-grey-200">
        {report.shelves.map(s => <li key={s.shelf_code} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
          <span><strong>{s.shelf_code}</strong> · {s.counter_name} · {s.finished_at ? "นับเสร็จแล้ว" : s.occupied ? "กำลังนับ" : "หมดเวลาจอง"}</span>
          {open && canCount && !s.finished_at && s.counted_by === userId && <button className="m3-btn m3-btn-outline min-h-11" disabled={busy}
            onClick={() => act("finish", s.shelf_code)}>นับชั้นนี้เสร็จ</button>}
        </li>)}
      </ul>}
      {report.entries.length ? <ul className="max-h-96 divide-y divide-m3-grey-200 overflow-y-auto">
        {report.entries.map(row => <li key={row.request_id} className="space-y-1 py-3 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <strong className="min-w-0 flex-1 break-words">{row.product_name}</strong>
            <span className="font-semibold tabular-nums text-m3-primary-dark">{row.quantity} {row.base_unit}</span>
          </div>
          <p className="break-words text-m3-grey-600">{row.sku} · ชั้น {row.shelf_code}</p>
          <p className="break-words text-xs text-m3-grey-600">{row.counter_name} · {dateLabel(row.counted_at)}</p>
        </li>)}
      </ul> : <p className="py-2 text-sm text-m3-grey-600">ยังไม่มีรายการที่บันทึก</p>}
      <div className="grid gap-2 border-t border-m3-grey-200 pt-4">
        <button className="m3-btn m3-btn-outline min-h-11" disabled={busy} onClick={() => act("export")}>ดาวน์โหลด Excel</button>
        {open && canCount && (canCloseAll || report.round.opened_by === userId) && <button className="m3-btn m3-btn-dark min-h-11"
          disabled={busy || report.shelves.some(s => s.occupied)} onClick={() => act("close")}>จบรอบและดาวน์โหลด Excel</button>}
      </div>
      {report.round.closed_at && <p>จบรอบเมื่อ {dateLabel(report.round.closed_at)}</p>}
      {error && <p role="alert" className="text-red-700">{error}</p>}
    </section>}
  </>;
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePollingWhenVisible } from "@/hooks/use-visibility-polling";
import type { RoundReport } from "@/types/count-round";
import { dateLabel, downloadRound, errorText, getCount, sendCount } from "@/app/(dashboard)/stock-counts/_lib/count-client";
import CountScanner from "./CountScanner";

interface Props {
  warehouse: string;
  warehouseName: string;
  round: string;
  userId: string;
  canCloseAll: boolean;
  listedOpen: boolean;
  onClosed: () => void;
}

export default function RoundWorkspace({ warehouse, warehouseName, round, userId, canCloseAll, listedOpen, onClosed }: Props) {
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
    {open && <CountScanner warehouse={warehouse} round={round} refresh={refresh} />}
    {report && <section className="m3-card space-y-4 p-5 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold">ผลตรวจนับ · {report.entries.length} รายการ</h2>
        <button className="m3-btn m3-btn-outline" disabled={busy} onClick={refresh}>โหลดล่าสุด</button>
      </header>
      {report.shelves.length > 0 && <ul className="divide-y divide-m3-grey-200">
        {report.shelves.map(s => <li key={s.shelf_code} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
          <span><strong>{s.shelf_code}</strong> · {s.counter_name} · {s.finished_at ? "นับเสร็จแล้ว" : s.occupied ? "กำลังนับ" : "หมดเวลาจอง"}</span>
          {open && !s.finished_at && s.counted_by === userId && <button className="m3-btn m3-btn-outline m3-btn-sm" disabled={busy}
            onClick={() => act("finish", s.shelf_code)}>นับชั้นนี้เสร็จ</button>}
        </li>)}
      </ul>}
      {report.entries.length ? <div className="max-h-96 overflow-auto"><table className="w-full text-left text-sm">
        <thead className="sticky top-0 bg-white"><tr>{["ชั้น", "สินค้า", "จำนวน", "ผู้ตรวจนับ"].map(col => <th key={col} className="p-2">{col}</th>)}</tr></thead>
        <tbody>{report.entries.map(row => <tr key={row.request_id} className="border-t border-m3-grey-200">
          <td className="p-2">{row.shelf_code}</td><td className="p-2">{row.product_name}<div className="text-xs text-m3-grey-600">{row.sku}</div></td>
          <td className="whitespace-nowrap p-2 font-semibold">{row.quantity} {row.base_unit}</td>
          <td className="p-2">{row.counter_name}<div className="text-xs text-m3-grey-600">{dateLabel(row.counted_at)}</div></td>
        </tr>)}</tbody></table></div> : <p className="text-m3-grey-600">ยังไม่มีรายการที่บันทึก</p>}
      <div className="flex flex-wrap gap-2">
        <button className="m3-btn m3-btn-outline" disabled={busy} onClick={() => act("export")}>ดาวน์โหลด Excel</button>
        {open && (canCloseAll || report.round.opened_by === userId) && <button className="m3-btn m3-btn-dark"
          disabled={busy || report.shelves.some(s => s.occupied)} onClick={() => act("close")}>จบรอบและดาวน์โหลด Excel</button>}
      </div>
      {report.round.closed_at && <p>จบรอบเมื่อ {dateLabel(report.round.closed_at)}</p>}
      {error && <p role="alert" className="text-red-700">{error}</p>}
    </section>}
  </>;
}

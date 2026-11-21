"use client";

import { useCallback, useRef, useState } from "react";
import { usePollingWhenVisible } from "@/hooks/use-visibility-polling";
import type { CountReportEntry } from "@/types/count-round";
import { countReportColumns, downloadCounts, errorText, getCount } from "@/app/(dashboard)/stock-counts/_lib/count-client";
import { SolarRefresh } from "@/components/icons";

type Props = { warehouse: string; warehouseName: string };

export default function RoundWorkspace(props: Props) {
  const [date, setDate] = useState(() => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Bangkok" }));
  return <section className="space-y-4 rounded-2xl bg-white p-4 shadow-m3-card sm:p-6">
    <h2 className="text-xl font-bold">ผลตรวจนับสต็อก</h2>
    <label className="grid w-fit gap-1 text-sm font-semibold">วันที่บันทึก
      <input type="date" value={date} onChange={e => setDate(e.target.value)} className="min-h-11 rounded-xl border border-m3-grey-300 px-3" />
    </label>
    {date && <CountResults key={date} {...props} date={date} />}
  </section>;
}

function CountResults({ warehouse, warehouseName, date }: Props & { date: string }) {
  const [entries, setEntries] = useState<CountReportEntry[]>();
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const version = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++version.current;
    try {
      const rows = await getCount<CountReportEntry[]>({ warehouse, date });
      if (current === version.current) { setEntries(rows); setError(""); }
    } catch (e) { if (current === version.current) setError(errorText(e)); }
  }, [warehouse, date]);
  usePollingWhenVisible(refresh, 60000);

  async function download() {
    if (!entries?.length) return;
    setExporting(true);
    try {
      await downloadCounts(entries, warehouseName, date);
    } catch (e) { setError(errorText(e)); }
    finally { setExporting(false); }
  }

  return <>
    <div className="flex flex-wrap items-center gap-2">
      <button className="m3-btn m3-btn-outline min-h-11" onClick={refresh} aria-label="โหลดล่าสุด"><SolarRefresh size={18} /></button>
      <button className="m3-btn m3-btn-dark min-h-11" disabled={!entries?.length || exporting} onClick={download}>ดาวน์โหลด Excel</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {!entries && !error && <p role="status">กำลังโหลดผลตรวจนับ…</p>}
    {entries && <div className="overflow-x-auto rounded-xl border border-m3-grey-200">
      <table aria-label="ผลตรวจนับสต็อก" className="w-full text-left text-sm">
        <thead className="bg-m3-grey-100 text-m3-grey-800">
          <tr>{countReportColumns.map(column => <th key={column.label} scope="col" className="whitespace-nowrap px-3 py-3">{column.label}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-m3-grey-200">
          {entries.map(row => <tr key={row.request_id}>
            {countReportColumns.map(column => <td key={column.label} className="px-3 py-3 align-top tabular-nums">{column.value(row, warehouseName)}</td>)}
          </tr>)}
          {entries.length === 0 && <tr><td colSpan={countReportColumns.length} className="p-4 text-center text-m3-grey-600">ยังไม่มีรายการตรวจนับของวันที่เลือก</td></tr>}
        </tbody>
      </table>
    </div>}
  </>;
}

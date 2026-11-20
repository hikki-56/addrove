"use client";

import { useCallback, useEffect, useState } from "react";
import { v4 as uuid } from "uuid";
import type { CountRound } from "@/types/count-round";
import { dateLabel, errorText, getCount, sendCount } from "./_lib/count-client";
import RoundWorkspace from "./_components/RoundWorkspace";

interface WarehouseOption { warehouse_id: string; warehouse_name: string }
interface Access { warehouses: WarehouseOption[]; userId: string; canCloseAll: boolean }

export default function StockCountsPage() {
  const [access, setAccess] = useState<Access>();
  const [warehouse, setWarehouse] = useState("");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    getCount<Access>({}, controller.signal).then(data => {
      setAccess(data);
      setWarehouse(data.warehouses[0]?.warehouse_id ?? "");
      setError("");
    }).catch(e => { if (!controller.signal.aborted) setError(errorText(e)); });
    return () => controller.abort();
  }, [attempt]);
  const selected = access?.warehouses.find(w => w.warehouse_id === warehouse);
  return <div className="mx-auto w-full min-w-0 max-w-5xl space-y-4 pb-4 sm:space-y-5">
    <h1 className="sr-only text-3xl font-bold text-m3-grey-800 md:not-sr-only">ตรวจนับสต็อก</h1>
    {error && <p role="alert">{error} <button className="m3-btn m3-btn-outline" onClick={() => setAttempt(n => n + 1)}>ลองใหม่</button></p>}
    {!access && !error && <p role="status">กำลังโหลดโกดัง…</p>}
    {access && !selected && <p>ไม่มีโกดังที่ได้รับสิทธิ์ตรวจนับ</p>}
    {access && selected && <WarehouseRounds key={warehouse} warehouse={selected} access={access} changeWarehouse={setWarehouse} />}
  </div>;
}

function WarehouseRounds({ warehouse, access, changeWarehouse }: {
  warehouse: WarehouseOption; access: Access; changeWarehouse: (id: string) => void;
}) {
  const id = warehouse.warehouse_id;
  const [rounds, setRounds] = useState<CountRound[]>();
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const reloadRounds = useCallback(() => setAttempt(n => n + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    getCount<CountRound[]>({ warehouse: id }, controller.signal).then(rows => {
      setRounds(rows);
      setSelected(previous => rows.some(r => r.round_id === previous) ? previous : rows[0]?.round_id ?? "");
      setError("");
    }).catch(e => { if (!controller.signal.aborted) setError(errorText(e)); });
    return () => controller.abort();
  }, [id, attempt]);

  async function start() {
    setBusy(true);
    try {
      const round = await sendCount<CountRound>({ action: "start", warehouse: id, round: uuid() });
      setRounds(prev => [round, ...(prev ?? []).filter(r => r.round_id !== round.round_id)]);
      setSelected(round.round_id);
      setError("");
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  return <>
    <section className="grid min-w-0 grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-end gap-2 sm:gap-3">
      <label className="grid min-w-0 gap-1 text-sm font-semibold text-m3-grey-600">โกดังที่ตรวจนับ
        <select className="min-h-12 w-full min-w-0 rounded-xl border border-m3-grey-300 bg-white px-2 text-base text-m3-grey-800 sm:px-3"
          value={id} onChange={e => changeWarehouse(e.target.value)}>
          {access.warehouses.map(w => <option key={w.warehouse_id} value={w.warehouse_id}>{w.warehouse_name}</option>)}
        </select>
      </label>
      {rounds?.length ? <label className="grid min-w-0 gap-1 text-sm font-semibold text-m3-grey-600">รอบตรวจนับ
        <select value={selected} className="min-h-12 w-full min-w-0 truncate rounded-xl border border-m3-grey-300 bg-white px-2 text-base text-m3-grey-800 sm:px-3" onChange={e => setSelected(e.target.value)}>
          {rounds.map(r => <option key={r.round_id} value={r.round_id}>{r.closed_at ? "จบแล้ว" : "กำลังนับ"} · {dateLabel(r.opened_at)}</option>)}
        </select>
      </label> : !rounds && !error && <p role="status" className="p-2 text-sm">กำลังโหลดรอบ…</p>}
      {rounds && !rounds.some(r => !r.closed_at) && <button className={`m3-btn m3-btn-dark min-h-12 ${rounds.length ? "col-span-2 sm:justify-self-end" : ""}`} disabled={busy} onClick={start}>เริ่มรอบตรวจนับ</button>}
      {error && <p role="alert" className="col-span-2">{error} <button className="m3-btn m3-btn-outline" onClick={() => setAttempt(n => n + 1)}>ลองใหม่</button></p>}
    </section>
    {selected && <RoundWorkspace key={selected} round={selected} warehouse={id} warehouseName={warehouse.warehouse_name}
      userId={access.userId} canCloseAll={access.canCloseAll} listedOpen={rounds?.find(r => r.round_id === selected)?.closed_at === null}
      onClosed={reloadRounds} />}
  </>;
}

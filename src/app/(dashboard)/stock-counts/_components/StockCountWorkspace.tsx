"use client";

import { useCallback, useEffect, useState } from "react";
import { v4 as uuid } from "uuid";
import type { CountRound } from "@/types/count-round";
import { dateLabel, errorText, getCount, sendCount } from "@/app/(dashboard)/stock-counts/_lib/count-client";
import Link from "next/link";
import CountScanner from "./CountScanner";
import RoundWorkspace from "./RoundWorkspace";

interface WarehouseOption { warehouse_id: string; warehouse_name: string }
interface Access { warehouses: WarehouseOption[]; userId: string; canCount: boolean; canCloseAll: boolean }
type View = "scan" | "results";

export default function StockCountWorkspace({ view }: { view: View }) {
  const [access, setAccess] = useState<Access>();
  const [warehouse, setWarehouse] = useState("");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    getCount<Access>({}, controller.signal).then(data => {
      setAccess(data);
      const remembered = sessionStorage.getItem(`stock-count-warehouse:${data.userId}`);
      setWarehouse(data.warehouses.find(w => w.warehouse_id === remembered)?.warehouse_id ?? data.warehouses[0]?.warehouse_id ?? "");
      setError("");
    }).catch(e => { if (!controller.signal.aborted) setError(errorText(e)); });
    return () => controller.abort();
  }, [attempt]);
  const selected = access?.warehouses.find(w => w.warehouse_id === warehouse);
  return <div className="mx-auto w-full min-w-0 max-w-5xl space-y-4 pb-4 sm:space-y-5">
    <h1 className="sr-only text-3xl font-bold text-m3-grey-800 md:not-sr-only">{view === "scan" ? "ตรวจนับสต็อก" : "ผลตรวจนับสต็อก"}</h1>
    {error && <p role="alert">{error} <button className="m3-btn m3-btn-outline" onClick={() => setAttempt(n => n + 1)}>ลองใหม่</button></p>}
    {!access && !error && <p role="status">กำลังโหลดโกดัง…</p>}
    {access && !selected && <p>ไม่มีโกดังที่ได้รับสิทธิ์ตรวจนับ</p>}
    {access && selected && <WarehouseRounds key={warehouse} view={view} warehouse={selected} access={access} changeWarehouse={id => {
      sessionStorage.setItem(`stock-count-warehouse:${access.userId}`, id);
      setWarehouse(id);
    }} />}
  </div>;
}

function WarehouseRounds({ warehouse, access, changeWarehouse, view }: {
  warehouse: WarehouseOption; access: Access; changeWarehouse: (id: string) => void; view: View;
}) {
  const id = warehouse.warehouse_id;
  const selectionKey = `stock-count-round:${access.userId}:${id}`;
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
      const remembered = sessionStorage.getItem(selectionKey);
      setSelected(previous => rows.find(r => r.round_id === previous)?.round_id ??
        (view === "results" ? rows.find(r => r.round_id === remembered)?.round_id : undefined) ?? rows[0]?.round_id ?? "");
      setError("");
    }).catch(e => { if (!controller.signal.aborted) setError(errorText(e)); });
    return () => controller.abort();
  }, [id, attempt, selectionKey, view]);
  useEffect(() => {
    if (view !== "scan") return;
    const refresh = () => { if (!document.hidden) reloadRounds(); };
    const timer = window.setInterval(refresh, 60000);
    document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [view, reloadRounds]);

  async function start() {
    setBusy(true);
    try {
      const round = await sendCount<CountRound>({ action: "start", warehouse: id, round: uuid() });
      setRounds(prev => [round, ...(prev ?? []).filter(r => r.round_id !== round.round_id)]);
      setSelected(round.round_id);
      sessionStorage.setItem(selectionKey, round.round_id);
      setError("");
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  const active = rounds?.find(r => !r.closed_at);
  return <>
    <section className="grid min-w-0 grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-end gap-2 sm:gap-3">
      <label className="grid min-w-0 gap-1 text-sm font-semibold text-m3-grey-600">โกดังที่ตรวจนับ
        <select className="min-h-12 w-full min-w-0 rounded-xl border border-m3-grey-300 bg-white px-2 text-base text-m3-grey-800 sm:px-3"
          value={id} onChange={e => changeWarehouse(e.target.value)}>
          {access.warehouses.map(w => <option key={w.warehouse_id} value={w.warehouse_id}>{w.warehouse_name}</option>)}
        </select>
      </label>
      {view === "results" && rounds?.length ? <label className="grid min-w-0 gap-1 text-sm font-semibold text-m3-grey-600">รอบตรวจนับ
        <select value={selected} className="min-h-12 w-full min-w-0 truncate rounded-xl border border-m3-grey-300 bg-white px-2 text-base text-m3-grey-800 sm:px-3" onChange={e => {
          setSelected(e.target.value); sessionStorage.setItem(selectionKey, e.target.value);
        }}>
          {rounds.map(r => <option key={r.round_id} value={r.round_id}>{r.closed_at ? "จบแล้ว" : "กำลังนับ"} · {dateLabel(r.opened_at)}</option>)}
        </select>
      </label> : !rounds && !error && <p role="status" className="p-2 text-sm">กำลังโหลดรอบ…</p>}
      {view === "scan" && rounds && !active && access.canCount && <button className="m3-btn m3-btn-dark min-h-12" disabled={busy} onClick={start}>เริ่มรอบตรวจนับ</button>}
      {view === "scan" && !!rounds?.length && <Link href="/stock-counts/results" onClick={() => sessionStorage.setItem(selectionKey, (active ?? rounds[0]).round_id)}
        className={`m3-btn m3-btn-outline min-h-12 ${!active ? "col-span-2" : ""}`}>ดูผลตรวจนับ</Link>}
      {error && <p role="alert" className="col-span-2">{error} <button className="m3-btn m3-btn-outline" onClick={() => setAttempt(n => n + 1)}>ลองใหม่</button></p>}
    </section>
    {view === "scan" && access.canCount && active && <div className="mx-auto w-full max-w-2xl"><CountScanner key={active.round_id} warehouse={id} round={active.round_id} /></div>}
    {view === "scan" && !access.canCount && <p role="alert">บัญชีนี้ดูผลตรวจนับได้เท่านั้น</p>}
    {view === "scan" && (!active || !access.canCount) && <Link href="/dashboard" className="m3-btn m3-btn-outline min-h-11">กลับหน้าหลัก</Link>}
    {view === "results" && rounds?.length === 0 && <p>ยังไม่มีรอบตรวจนับในโกดังนี้</p>}
    {view === "results" && selected && <RoundWorkspace key={selected} round={selected} warehouse={id} warehouseName={warehouse.warehouse_name}
      userId={access.userId} canCloseAll={access.canCloseAll} listedOpen={rounds?.find(r => r.round_id === selected)?.closed_at === null}
      canCount={access.canCount} onClosed={reloadRounds} />}
    {view === "results" && <Link href={access.canCount ? "/stock-counts" : "/dashboard"} className="m3-btn m3-btn-outline min-h-11">
      {access.canCount ? "กลับไปตรวจนับ" : "กลับหน้าหลัก"}</Link>}
  </>;
}

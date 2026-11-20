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

function ClipboardCheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M21 15.9983V9.99826C21 7.16983 21 5.75562 20.1213 4.87694C19.3529 4.10856 18.175 4.01211 16 4H8C5.82497 4.01211 4.64706 4.10856 3.87868 4.87694C3 5.75562 3 7.16983 3 9.99826V15.9983C3 18.8267 3 20.2409 3.87868 21.1196C4.75736 21.9983 6.17157 21.9983 9 21.9983H15C17.8284 21.9983 19.2426 21.9983 20.1213 21.1196C21 20.2409 21 18.8267 21 15.9983Z" opacity=".5" />
      <path d="M14.4883 10.4521C14.791 10.1696 15.2652 10.1857 15.5479 10.4883C15.8304 10.791 15.8143 11.2652 15.5117 11.5479L11.2256 15.5479C10.9374 15.8168 10.4903 15.8168 10.2021 15.5479L8.48828 13.9482C8.18548 13.6656 8.16953 13.1915 8.45215 12.8887C8.73475 12.5859 9.2089 12.569 9.51172 12.8516L10.7139 13.9736L14.4883 10.4521Z" />
      <path d="M14.5 2C15.3284 2 16 2.67157 16 3.5V4.5C16 5.32843 15.3284 6 14.5 6H9.5C8.67157 6 8 5.32843 8 4.5V3.5C8 2.67157 8.67157 2 9.5 2H14.5Z" />
    </svg>
  );
}

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
    <header className="hidden md:block">
      <h1 className="text-3xl font-bold text-m3-grey-800">{view === "scan" ? "ตรวจนับสต็อก" : "ผลตรวจนับสต็อก"}</h1>
      <p className="mt-1 text-sm text-m3-grey-600">การตรวจนับ</p>
    </header>
    <h1 className="sr-only">{view === "scan" ? "ตรวจนับสต็อก" : "ผลตรวจนับสต็อก"}</h1>
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
  const selectClass = "min-h-12 w-full min-w-0 rounded-xl border border-[rgba(145,158,171,.32)] bg-white px-3 text-base text-m3-grey-800";

  return <>
    <section className="rounded-2xl bg-white p-4 shadow-m3-card sm:px-5">
      <div className={`grid min-w-0 items-end gap-3 ${view === "results" ? "sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto]" : "sm:grid-cols-[minmax(0,1fr)_auto]"}`}>
        <label className="grid min-w-0 gap-1 text-sm font-semibold text-m3-grey-600">โกดังที่ตรวจนับ
          <select className={selectClass} value={id} onChange={e => changeWarehouse(e.target.value)}>
            {access.warehouses.map(w => <option key={w.warehouse_id} value={w.warehouse_id}>{w.warehouse_name}</option>)}
          </select>
        </label>
        {view === "results" && rounds?.length ? <label className="grid min-w-0 gap-1 text-sm font-semibold text-m3-grey-600">รอบตรวจนับ
          <select value={selected} className={`${selectClass} truncate`} onChange={e => {
            setSelected(e.target.value); sessionStorage.setItem(selectionKey, e.target.value);
          }}>
            {rounds.map(r => <option key={r.round_id} value={r.round_id}>{r.closed_at ? "จบแล้ว" : "กำลังนับ"} · {dateLabel(r.opened_at)}</option>)}
          </select>
        </label> : view === "results" && !rounds && !error ? <p role="status" className="text-sm">กำลังโหลดรอบ…</p> : null}
        {view === "scan" && active && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="rounded-lg bg-[rgba(0,184,217,.16)] px-2.5 py-1 text-xs font-bold text-[#006C9C]">กำลังนับ · {dateLabel(active.opened_at)}</span>
            {!!rounds?.length && <Link href="/stock-counts/results" onClick={() => sessionStorage.setItem(selectionKey, active.round_id)}
              className="m3-btn m3-btn-outline min-h-11">ดูผลตรวจนับ</Link>}
          </div>
        )}
        {view === "results" && access.canCount && (
          <Link href="/stock-counts" className="m3-btn m3-btn-outline hidden min-h-11 sm:inline-flex">กลับไปตรวจนับ</Link>
        )}
      </div>
      {error && <p role="alert" className="mt-3">{error} <button className="m3-btn m3-btn-outline" onClick={() => setAttempt(n => n + 1)}>ลองใหม่</button></p>}
    </section>

    {view === "scan" && !rounds && !error && <p role="status">กำลังโหลดรอบ…</p>}
    {view === "scan" && access.canCount && active && <div className="mx-auto w-full max-w-2xl"><CountScanner key={active.round_id} warehouse={id} round={active.round_id} /></div>}
    {view === "scan" && !access.canCount && <p role="alert">บัญชีนี้ดูผลตรวจนับได้เท่านั้น</p>}

    {view === "scan" && rounds && !active && (
      <div className="flex min-h-[min(28rem,calc(100dvh-16rem))] flex-col rounded-2xl bg-white p-5 shadow-m3-card sm:min-h-0 sm:px-8 sm:py-6">
        <div className="flex flex-1 flex-col items-center justify-center px-4 py-10 text-center sm:py-12">
          <div className="flex size-[72px] items-center justify-center rounded-[20px] bg-[rgba(0,167,111,.08)] text-m3-primary">
            <ClipboardCheckIcon className="size-9" />
          </div>
          <h2 className="mt-4 text-lg font-bold text-m3-grey-800">ยังไม่มีรอบที่กำลังนับ</h2>
          <p className="mt-1 text-[13px] text-m3-grey-600">{warehouse.warehouse_name}</p>
        </div>
        <div className="mx-auto grid w-full max-w-[360px] gap-2.5">
          {access.canCount && <button className="m3-btn m3-btn-dark min-h-[52px] sm:min-h-12" disabled={busy} onClick={start}>เริ่มรอบตรวจนับ</button>}
          {!!rounds.length && <Link href="/stock-counts/results" onClick={() => sessionStorage.setItem(selectionKey, rounds[0].round_id)}
            className="m3-btn m3-btn-outline min-h-[52px] sm:min-h-12">ดูผลตรวจนับ</Link>}
          <Link href="/dashboard" className="m3-btn m3-btn-outline min-h-[52px] sm:min-h-12">กลับหน้าหลัก</Link>
        </div>
      </div>
    )}

    {view === "results" && rounds?.length === 0 && <p className="rounded-2xl bg-white p-6 text-center text-sm text-m3-grey-600 shadow-m3-card">ยังไม่มีรอบตรวจนับในโกดังนี้</p>}
    {view === "results" && selected && <RoundWorkspace key={selected} round={selected} warehouse={id} warehouseName={warehouse.warehouse_name}
      userId={access.userId} canCloseAll={access.canCloseAll} listedOpen={rounds?.find(r => r.round_id === selected)?.closed_at === null}
      canCount={access.canCount} onClosed={reloadRounds} />}
    {view === "results" && (
      <Link href={access.canCount ? "/stock-counts" : "/dashboard"} className="m3-btn m3-btn-outline min-h-[52px] w-full sm:hidden">
        {access.canCount ? "กลับไปตรวจนับ" : "กลับหน้าหลัก"}
      </Link>
    )}
  </>;
}

"use client";

import { useEffect, useState } from "react";
import { errorText, getCount } from "@/app/(dashboard)/stock-counts/_lib/count-client";
import CountScanner from "./CountScanner";
import RoundWorkspace from "./RoundWorkspace";

interface WarehouseOption { warehouse_id: string; warehouse_name: string }
interface Access { warehouses: WarehouseOption[]; userId: string; reviewer: boolean }

export default function StockCountWorkspace() {
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
    <h1 className="sr-only">ตรวจนับสต็อก</h1>
    {error && <p role="alert">{error} <button className="m3-btn m3-btn-outline" onClick={() => setAttempt(n => n + 1)}>ลองใหม่</button></p>}
    {!access && !error && <p role="status">กำลังโหลดโกดัง…</p>}
    {access && !selected && <p>ไม่มีโกดังที่ได้รับสิทธิ์ตรวจนับ</p>}
    {access && selected && <>
      <label className="grid gap-1 rounded-2xl bg-white p-4 text-sm font-semibold shadow-m3-card">โกดังที่ตรวจนับ
        <select className="min-h-11 rounded-xl border border-m3-grey-300 px-3" value={warehouse} onChange={e => {
          sessionStorage.setItem(`stock-count-warehouse:${access.userId}`, e.target.value);
          setWarehouse(e.target.value);
        }}>
          {access.warehouses.map(w => <option key={w.warehouse_id} value={w.warehouse_id}>{w.warehouse_name}</option>)}
        </select>
      </label>
      {access.reviewer
        ? <RoundWorkspace key={warehouse} warehouse={warehouse} warehouseName={selected.warehouse_name} />
        : <div className="mx-auto w-full max-w-2xl"><CountScanner key={warehouse} warehouse={warehouse} /></div>}
    </>}
  </div>;
}

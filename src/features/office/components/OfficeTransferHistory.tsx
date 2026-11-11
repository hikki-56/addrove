"use client";

import { useEffect, useState } from "react";
import type { Warehouse } from "@/types/models";
import type { OfficeHistoryRow } from "@/types/office";
import { matchesOfficeSearch } from "@/lib/office";
import { OfficeError, OfficeLocationBadge, OfficeProductIdentity, OfficeSearch, officeNumber, officeRequest } from "./OfficeUi";

const historyTime = (date: string) => new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(date));

export default function OfficeTransferHistory({ warehouses }: { warehouses: Warehouse[] }) {
  const [rows, setRows] = useState<OfficeHistoryRow[]>([]);
  const [query, setQuery] = useState("");
  const [warehouse, setWarehouse] = useState("");
  const [days, setDays] = useState("7");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const from = days === "all" ? "" : new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() - (Number(days) - 1) * 86400000));
    setLoading(true); setError("");
    officeRequest<OfficeHistoryRow[]>(`/api/office?view=history${days === "all" ? "" : `&date_from=${from}`}`, { signal: controller.signal })
      .then((data) => { setRows(data); setPage(1); }).catch((err: Error) => { if (!controller.signal.aborted) setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [days, reload]);
  const filtered = rows.filter((row) => (!warehouse || row.from_warehouse_id === warehouse) && matchesOfficeSearch(row, query));
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages);
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  return <section className="office-panel" aria-busy={loading}>
    <div className="office-history-filters"><OfficeSearch value={query} onChange={(value) => { setQuery(value); setPage(1); }} placeholder="รหัส, ชื่อ, บาร์โค้ด, ตำแหน่ง" /><div className="office-field"><label htmlFor="office-history-wh">โกดัง</label><select id="office-history-wh" value={warehouse} onChange={(e) => { setWarehouse(e.target.value); setPage(1); }}><option value="">ทุกโกดัง</option>{warehouses.map((wh) => <option key={wh.warehouse_id} value={wh.warehouse_id}>{wh.warehouse_name}</option>)}</select></div><div className="office-field"><label htmlFor="office-history-days">ช่วงเวลา</label><select id="office-history-days" value={days} onChange={(e) => setDays(e.target.value)}><option value="7">7 วันล่าสุด</option><option value="30">30 วันล่าสุด</option><option value="90">90 วันล่าสุด</option><option value="all">ทั้งหมด</option></select></div></div>
    {error && <OfficeError message={error} retry={() => setReload((n) => n + 1)} />}
    {loading ? <div className="office-empty" role="status">กำลังโหลดประวัติ…</div> : !filtered.length ? <div className="office-empty">ไม่พบประวัติการเบิกไปออฟฟิศ</div> : <><div className="office-history-scroll"><table className="office-history-table"><thead><tr>{["เลขที่", "เวลา", "ต้นทาง", "สินค้า", "จำนวน", "ตำแหน่งออฟฟิศ", "ผู้ทำรายการ"].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{visible.map((row, i) => <tr key={`${row.document_id}-${i}`}><td><strong>{row.document_no}</strong></td><td>{historyTime(row.created_at)}</td><td>{row.from_warehouse_name}</td><td><div className="office-product-name">{row.product_name}</div><div className="office-caption">{row.sku}</div></td><td><strong>{officeNumber(row.quantity)}</strong></td><td><OfficeLocationBadge code={row.location_code} /></td><td>{row.created_by_name}</td></tr>)}</tbody></table></div><div className="office-history-mobile">{visible.map((row, i) => <article className="office-history-mobile-row" key={`${row.document_id}-${i}`}><div className="office-stock-top"><strong>{row.document_no}</strong><span className="office-caption">{historyTime(row.created_at)}</span></div><OfficeProductIdentity item={row} /><div className="office-stock-top"><OfficeLocationBadge code={row.location_code} /><strong>{officeNumber(row.quantity)} {row.base_unit}</strong></div><div className="office-caption">{row.from_warehouse_name} · {row.created_by_name}</div></article>)}</div><div className="office-history-footer"><label>แถวต่อหน้า: <select aria-label="แถวต่อหน้า" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>{[10, 20, 50].map((size) => <option key={size}>{size}</option>)}</select></label><span>{(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filtered.length)} จาก {filtered.length}</span><button type="button" aria-label="หน้าก่อนหน้า" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>‹</button><button type="button" aria-label="หน้าถัดไป" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>›</button></div></>}
  </section>;
}

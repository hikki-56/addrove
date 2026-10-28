"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { M3Banner, M3Dialog, M3Empty, M3ErrorState, M3Field, M3Skeleton, M3SubmitLabel, m3Cls } from "@/components/ui/m3";
import { avatarToneClass, userInitials } from "@/components/ui/user-initials";
import { ASSIGN_LOCATION_HREF } from "@/lib/assign-location";
import {
  REQUESTS_API,
  STATUS_LABEL,
  STATUS_TONE,
  batchApi,
  beforeQty,
  driftedSinceRequest,
  fmt,
  groupRequests,
  lineDelta,
  locLabel,
  movedQty,
  signed,
  when,
  type AssignEdit,
  type AssignReq,
  type ReqGroup,
} from "../_lib/requests";

// Minimal UI v3b (L01–L07 / M01–M04): แท็บ + ตัวกรอง · 1 แถว = 1 การย้าย · มือถือ = การ์ด + bottom sheet
type Tab = "PENDING" | "APPROVED" | "REJECTED";
const TABS: { id: Tab; label: string; tone: string }[] = [
  { id: "PENDING", label: "รออนุมัติ", tone: "m3-label-warning" },
  { id: "APPROVED", label: "อนุมัติแล้ว", tone: "m3-label-success" },
  { id: "REJECTED", label: "ปฏิเสธ", tone: "m3-label-error" },
];
const REJECT_REASONS = ["จำนวนไม่ตรง", "ตำแหน่งปลายทางผิด", "สินค้าไม่ตรง", "อื่นๆ"];
const PAGE_SIZE = 10;

type Draft = { group: ReqGroup; note: string; lines: Record<string, { qty: string; code: string }> };
type History = { group: ReqGroup; edits: AssignEdit[] | null; error: string };

const sumLabel = (g: ReqGroup) => `${g.head.sku || g.head.product_id} · ${g.lines.map((l) => locLabel(l.location_code)).join(" / ")}`;

function BoxIcon() {
  return (
    <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-m3-grey-200 text-m3-grey-500">
      <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden="true">
        <path d="M12 2 3 6.5v11L12 22l9-4.5v-11L12 2Zm0 2.2 6.6 3.3L12 10.8 5.4 7.5 12 4.2Z" opacity=".55" />
        <path d="M12 10.8v11.2l9-4.5v-11l-9 4.3Z" />
      </svg>
    </span>
  );
}
const PencilIcon = ({ cls = "size-3.5" }: { cls?: string }) => (
  <svg viewBox="0 0 24 24" className={cls} fill="currentColor" aria-hidden="true">
    <path d="M4 20h4L19 9l-4-4L4 16v4Zm13.6-16.6 3 3-1.6 1.6-3-3 1.6-1.6Z" />
  </svg>
);
const HistoryIcon = () => (
  <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5M12 7v5l3 2" />
  </svg>
);
const Arrow = () => (
  <svg viewBox="0 0 24 24" className="size-4 shrink-0 text-m3-grey-500" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path d="M5 12h14m-5-5 5 5-5 5" />
  </svg>
);

function EditedChip() {
  return (
    <span className="m3-label m3-label-info gap-1">
      <PencilIcon cls="size-3" />
      แก้ไขแล้ว
    </span>
  );
}

function Avatar({ name }: { name?: string | null }) {
  return (
    <span className={`inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${avatarToneClass(name)}`}>
      {userInitials(name)}
    </span>
  );
}

/** บรรทัดตำแหน่ง: รหัส · โกดัง · ±N · ก่อน→หลัง */
function LineCell({ l, compact = false }: { l: AssignReq; compact?: boolean }) {
  const d = lineDelta(l);
  return (
    <div className="min-w-0">
      <div className="font-m3-disp text-sm font-bold text-m3-grey-800">{locLabel(l.location_code)}</div>
      {!compact && <div className="text-xs text-m3-grey-500">{l.warehouse_name || l.warehouse_id}</div>}
      <div className={`font-m3-disp text-sm font-bold ${d < 0 ? "text-m3-error" : d > 0 ? "text-m3-primary" : "text-m3-grey-500"}`}>{signed(d)}</div>
      {!compact && (
        <div className="text-[11px] text-m3-grey-500">
          {fmt(beforeQty(l))} → {fmt(l.target_qty)}
          {driftedSinceRequest(l) && <span className="text-m3-warning-dark"> (ตอนขอ {fmt(l.qty_at_request)})</span>}
        </div>
      )}
    </div>
  );
}

function Moves({ g, compact }: { g: ReqGroup; compact?: boolean }) {
  const minus = g.lines.filter((l) => lineDelta(l) < 0);
  const rest = g.lines.filter((l) => lineDelta(l) >= 0);
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1 space-y-1.5">{minus.length ? minus.map((l) => <LineCell key={l.request_id} l={l} compact={compact} />) : <span className="text-xs text-m3-grey-400">—</span>}</div>
      <Arrow />
      <div className="min-w-0 flex-1 space-y-1.5">{rest.length ? rest.map((l) => <LineCell key={l.request_id} l={l} compact={compact} />) : <span className="text-xs text-m3-grey-400">—</span>}</div>
    </div>
  );
}

/** แผงขวา (≥sm) / bottom sheet (มือถือ) */
function Drawer({ title, subtitle, onClose, children }: { title: string; subtitle?: ReactNode; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-stretch sm:justify-end">
      <div className={m3Cls.overlay} onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex max-h-[88dvh] w-full flex-col rounded-t-2xl bg-white shadow-m3-dropdown sm:max-h-none sm:w-[400px] sm:rounded-none"
      >
        <div className="flex items-start gap-3 px-5 pt-5 pb-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-m3-grey-800">{title}</h2>
            {subtitle ? <p className="mt-0.5 truncate text-xs font-semibold text-m3-grey-500">{subtitle}</p> : null}
          </div>
          <button type="button" aria-label="ปิด" onClick={onClose} className="inline-flex size-8 items-center justify-center rounded-full text-m3-grey-600 hover:bg-m3-grey-200">
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-6">{children}</div>
      </div>
    </div>
  );
}

function TimelineItem({ tone, icon, title, at, by, children }: { tone: string; icon: ReactNode; title: string; at?: string | null; by?: string | null; children?: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className={`inline-flex size-8 shrink-0 items-center justify-center rounded-full ${tone}`}>{icon}</span>
      <div className="min-w-0 flex-1 pb-5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-bold text-m3-grey-800">{title}</span>
          <span className="shrink-0 text-xs text-m3-grey-500">{when(at)}</span>
        </div>
        {by ? <div className="text-xs text-m3-grey-500">โดย {by}</div> : null}
        {children}
      </div>
    </li>
  );
}

function ChangeRow({ label, from, to }: { label: string; from: ReactNode; to: ReactNode }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-m3-grey-200 px-3 py-2 text-sm">
      <span className="w-20 shrink-0 text-xs text-m3-grey-500">{label}</span>
      <span className="text-m3-grey-500 line-through">{from}</span>
      <Arrow />
      <span className="font-bold text-m3-grey-800">{to}</span>
    </div>
  );
}

export default function AssignLocationRequestsPage() {
  const [tab, setTab] = useState<Tab>("PENDING");
  const [rows, setRows] = useState<AssignReq[]>([]);
  const [canApprove, setCanApprove] = useState(false);
  const [me, setMe] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [wh, setWh] = useState("");
  const [page, setPage] = useState(0);
  const [approveFor, setApproveFor] = useState<ReqGroup | null>(null);
  const [rejectFor, setRejectFor] = useState<ReqGroup | null>(null);
  const [rejectText, setRejectText] = useState("");
  const [rejectChip, setRejectChip] = useState("");
  const [rejectTouched, setRejectTouched] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [history, setHistory] = useState<History | null>(null);

  // ดึงทุกสถานะครั้งเดียว แล้วแบ่งแท็บ/นับจำนวนฝั่งหน้าจอ
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const res = await fetch(`${REQUESTS_API}?status=ALL&limit=1000`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.message || "โหลดคำขอไม่สำเร็จ");
      setRows(json.data?.requests || []);
      setCanApprove(!!json.data?.can_approve);
      setMe(json.data?.me || "");
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "โหลดคำขอไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => groupRequests(rows), [rows]);
  const warehouses = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) m.set(r.warehouse_id, r.warehouse_name || r.warehouse_id);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groups.filter((g) => {
      if (wh && g.head.warehouse_id !== wh) return false;
      if (!q) return true;
      const hay = [g.head.product_name, g.head.sku, g.head.barcode, g.head.requested_by_name, ...g.lines.map((l) => l.location_code)]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [groups, search, wh]);

  const inTab = (g: ReqGroup, t: Tab) => (t === "APPROVED" ? g.status === "APPROVED" || g.status === "MIXED" : g.status === t);
  const counts = useMemo(
    () => Object.fromEntries(TABS.map((t) => [t.id, filtered.filter((g) => inTab(g, t.id)).length])) as Record<Tab, number>,
    [filtered]
  );
  const list = useMemo(() => filtered.filter((g) => inTab(g, tab)), [filtered, tab]);
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const pageRows = list.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  useEffect(() => setPage(0), [tab, search, wh]);

  const canEdit = (g: ReqGroup) => g.status === "PENDING" && (canApprove || g.lines.every((l) => l.requested_by === me));

  const decide = async (g: ReqGroup, action: "approve" | "reject", note = "") => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch(batchApi(g.batch_id, action), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.message || "ไม่สำเร็จ");
      setMessage(action === "approve" ? "อนุมัติแล้ว — ปรับยอดทุกตำแหน่งของรายการนี้แล้ว" : "ปฏิเสธแล้ว — ไม่มีการเปลี่ยนสต็อก");
      if (action === "approve") window.dispatchEvent(new Event("stockify-stock-updated"));
      setApproveFor(null);
      setRejectFor(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  const openReject = (g: ReqGroup) => {
    setRejectFor(g);
    setRejectText("");
    setRejectChip("");
    setRejectTouched(false);
    setError("");
  };
  const rejectNote = [rejectChip && rejectChip !== "อื่นๆ" ? rejectChip : "", rejectText.trim()].filter(Boolean).join(": ");
  const rejectInvalid = !rejectText.trim() && (!rejectChip || rejectChip === "อื่นๆ");

  const openEdit = (g: ReqGroup) => {
    setError("");
    setDraft({
      group: g,
      note: g.head.note || "",
      lines: Object.fromEntries(g.lines.map((l) => [l.request_id, { qty: String(l.target_qty), code: l.location_code }])),
    });
  };

  const saveEdit = async () => {
    if (!draft) return;
    const lines = [];
    for (const l of draft.group.lines) {
      const d = draft.lines[l.request_id];
      const qty = Number(d.qty);
      if (d.qty.trim() === "" || !Number.isInteger(qty) || qty < 0) return setError(`จำนวนที่ ${locLabel(l.location_code)} ต้องเป็นจำนวนเต็ม ≥ 0`);
      const code = d.code.trim().toUpperCase();
      if (l.location_code && !code) return setError("กรุณาระบุตำแหน่ง");
      lines.push({
        request_id: l.request_id,
        ...(qty !== l.target_qty ? { target_qty: qty } : {}),
        ...(l.location_code && code !== l.location_code.toUpperCase() ? { location_code: code } : {}),
      });
    }
    const noteChanged = draft.note !== (draft.group.head.note || "");
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch(batchApi(draft.group.batch_id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(noteChanged ? { note: draft.note } : {}), lines }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.message || "แก้ไขไม่สำเร็จ");
      setMessage("แก้ไขคำขอแล้ว");
      setDraft(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "แก้ไขไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  const openHistory = async (g: ReqGroup) => {
    setHistory({ group: g, edits: null, error: "" });
    try {
      const res = await fetch(batchApi(g.batch_id), { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.message || "โหลดประวัติไม่สำเร็จ");
      setHistory({ group: g, edits: json.data?.edits || [], error: "" });
    } catch (e) {
      setHistory({ group: g, edits: [], error: e instanceof Error ? e.message : "โหลดประวัติไม่สำเร็จ" });
    }
  };

  const actions = (g: ReqGroup, mobile = false) => {
    const pending = g.status === "PENDING";
    const btn = mobile ? "h-11 flex-1" : "m3-btn-sm";
    return (
      <>
        {canApprove && pending && (
          <button type="button" disabled={busy} onClick={() => openReject(g)} className={`m3-btn ${btn} bg-[rgba(255,86,48,0.12)] text-m3-error-dark hover:bg-[rgba(255,86,48,0.2)] ${mobile ? "order-1" : "order-2"}`}>
            ปฏิเสธ
          </button>
        )}
        {canEdit(g) && (
          <button type="button" disabled={busy} onClick={() => openEdit(g)} className={`m3-btn m3-btn-outline ${btn} gap-1 order-2 ${mobile ? "" : "order-3"}`}>
            {!mobile && <PencilIcon />}
            แก้ไข
          </button>
        )}
        {canApprove && pending && (
          <button type="button" disabled={busy} onClick={() => { setError(""); setApproveFor(g); }} className={`m3-btn m3-btn-primary ${btn} ${mobile ? "order-3" : "order-1"}`}>
            อนุมัติ
          </button>
        )}
      </>
    );
  };

  const decidedInfo = (g: ReqGroup) =>
    g.head.decided_at ? (
      <div className="text-xs text-m3-grey-500">
        {g.status === "REJECTED" ? "ปฏิเสธโดย" : "อนุมัติโดย"} {g.head.decided_by_name || "-"} · {when(g.head.decided_at)}
      </div>
    ) : null;

  const rejectReason = (g: ReqGroup) =>
    g.status === "REJECTED" && g.head.decision_note ? (
      <div className="mt-1 rounded-lg bg-[rgba(255,86,48,0.08)] px-2.5 py-1 text-xs text-m3-error-dark">เหตุผล: {g.head.decision_note}</div>
    ) : null;

  return (
    <div className="mx-auto w-full max-w-7xl px-2 pb-20 sm:px-4 sm:pb-8">
      <div className="space-y-3">
        {error && !approveFor && !rejectFor && !draft && <M3Banner tone="error" role="alert">{error}</M3Banner>}
        {message && <M3Banner tone="success" role="status">{message}</M3Banner>}
      </div>

      {/* แท็บ — มือถือเป็นเม็ดยา (M01) */}
      <div className="mt-3 flex gap-2 overflow-x-auto md:hidden">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${tab === t.id ? "bg-m3-grey-800 text-white" : "bg-m3-grey-200 text-m3-grey-600"}`}
          >
            {t.label} {counts[t.id]}
          </button>
        ))}
      </div>

      <div className="mt-3 md:m3-card md:bg-white md:mt-0">
        <div className="hidden gap-6 border-b border-[rgba(145,158,171,0.2)] px-6 md:flex" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`-mb-px flex items-center gap-2 border-b-2 py-3.5 text-sm font-semibold ${
                tab === t.id ? "border-m3-grey-800 text-m3-grey-800" : "border-transparent text-m3-grey-500 hover:text-m3-grey-800"
              }`}
            >
              {t.label}
              <span className={`m3-label ${t.tone}`}>{counts[t.id]}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-3 py-3 sm:flex-row md:px-6 md:py-5">
          <M3Field label="โกดัง" className="sm:w-48">
            <select className={m3Cls.input} value={wh} onChange={(e) => setWh(e.target.value)}>
              <option value="">ทุกโกดัง</option>
              {warehouses.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
          </M3Field>
          <div className="relative flex-1">
            <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-m3-grey-500" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input className={`${m3Cls.input} pl-11`} placeholder="ค้นหาสินค้า, SKU, ตำแหน่ง, ผู้ขอ" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>

        {loading && !rows.length ? (
          <M3Skeleton rows={5} label="กำลังโหลดคำขอ" />
        ) : loadError ? (
          <div className="p-4 md:p-6"><M3ErrorState title={loadError} onRetry={() => void load()} /></div>
        ) : !list.length ? (
          <div className="p-4 md:p-6">
            <M3Empty title={tab === "PENDING" ? "ไม่มีคำขอรออนุมัติ" : "ไม่มีรายการ"}>
              {tab === "PENDING" && (
                <Link href={ASSIGN_LOCATION_HREF} className="m3-btn m3-btn-sm m3-btn-outline mt-1">ไปหน้าระบุตำแหน่งสินค้า</Link>
              )}
            </M3Empty>
          </div>
        ) : (
          <>
            {/* ตาราง ≥md (L01/L06) */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead className="bg-m3-grey-200 text-left text-xs font-semibold text-m3-grey-600">
                  <tr>
                    <th className="px-6 py-3.5">สินค้า</th>
                    <th className="px-3 py-3.5">ต้นทาง → ปลายทาง</th>
                    <th className="px-3 py-3.5 text-right">จำนวน</th>
                    <th className="px-3 py-3.5">ผู้ขอ / เวลา</th>
                    <th className="px-3 py-3.5">สถานะ</th>
                    <th className="px-6 py-3.5" />
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((g) => (
                    <tr key={g.key} className="border-t border-dashed border-[rgba(145,158,171,0.2)] align-middle">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <BoxIcon />
                          <div className="min-w-0">
                            <div className="max-w-[220px] truncate font-semibold text-m3-grey-800">{g.head.product_name || g.head.product_id}</div>
                            <div className="flex flex-wrap items-center gap-1.5 text-xs text-m3-grey-500">
                              {g.head.sku}
                              {g.edited && <EditedChip />}
                            </div>
                            {g.head.note && <div className="mt-0.5 max-w-[220px] truncate text-xs text-m3-grey-500">หมายเหตุ: {g.head.note}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="min-w-[260px] px-3 py-4"><Moves g={g} /></td>
                      <td className="px-3 py-4 text-right">
                        <span className="font-m3-disp text-base font-bold text-m3-grey-800">{fmt(movedQty(g))}</span>
                        <span className="ml-1 text-xs text-m3-grey-500">ชิ้น</span>
                      </td>
                      <td className="px-3 py-4">
                        <div className="flex items-center gap-2">
                          <Avatar name={g.head.requested_by_name} />
                          <div className="min-w-0">
                            <div className="truncate text-sm text-m3-grey-800">{g.head.requested_by_name}</div>
                            <div className="text-xs text-m3-grey-500">{when(g.head.requested_at)}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-4">
                        <span className={`m3-label ${STATUS_TONE[g.status]}`}>{STATUS_LABEL[g.status]}</span>
                        {decidedInfo(g)}
                        {rejectReason(g)}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-1.5">
                          {actions(g)}
                          <button type="button" aria-label="ประวัติ" title="ประวัติ" onClick={() => void openHistory(g)} className="m3-btn m3-btn-sm m3-btn-outline order-4 w-8 px-0">
                            <HistoryIcon />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* การ์ดมือถือ (M01/M04) */}
            <div className="space-y-3 md:hidden">
              {pageRows.map((g) => (
                <div key={g.key} className="m3-card space-y-3 bg-white p-4">
                  <div className="flex items-center gap-2">
                    <span className={`m3-label ${STATUS_TONE[g.status]}`}>{STATUS_LABEL[g.status]}</span>
                    {g.edited && <EditedChip />}
                    <button type="button" aria-label="ประวัติ" onClick={() => void openHistory(g)} className="ml-auto inline-flex size-8 items-center justify-center rounded-full text-m3-grey-600 hover:bg-m3-grey-200">
                      <HistoryIcon />
                    </button>
                  </div>
                  <div className="flex items-center gap-3">
                    <BoxIcon />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold text-m3-grey-800">{g.head.product_name || g.head.product_id}</div>
                      <div className="truncate text-xs text-m3-grey-500">
                        {g.head.sku} · {g.head.warehouse_name || g.head.warehouse_id} · {g.head.requested_by_name} {when(g.head.requested_at)}
                      </div>
                    </div>
                    <span className="font-m3-disp text-xl font-bold text-m3-grey-800">{fmt(movedQty(g))}</span>
                  </div>
                  <div className="flex items-stretch gap-2">
                    <div className="min-w-0 flex-1 space-y-2 rounded-xl bg-[rgba(255,86,48,0.08)] p-3">
                      <div className="text-xs text-m3-grey-500">ต้นทาง</div>
                      {g.lines.filter((l) => lineDelta(l) < 0).map((l) => <LineCell key={l.request_id} l={l} compact />)}
                    </div>
                    <span className="self-center"><Arrow /></span>
                    <div className="min-w-0 flex-1 space-y-2 rounded-xl bg-[rgba(0,167,111,0.08)] p-3">
                      <div className="text-xs text-m3-grey-500">ปลายทาง</div>
                      {g.lines.filter((l) => lineDelta(l) >= 0).map((l) => <LineCell key={l.request_id} l={l} compact />)}
                    </div>
                  </div>
                  {g.status === "PENDING" ? (
                    <div className="flex gap-2">{actions(g, true)}</div>
                  ) : (
                    <div>
                      {decidedInfo(g)}
                      {rejectReason(g)}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {pages > 1 && (
              <div className="flex items-center justify-end gap-3 px-6 py-3 text-sm text-m3-grey-600">
                <span>
                  {page * PAGE_SIZE + 1}–{Math.min(list.length, (page + 1) * PAGE_SIZE)} จาก {list.length}
                </span>
                <button type="button" aria-label="ก่อนหน้า" disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="m3-btn m3-btn-sm m3-btn-text">‹</button>
                <button type="button" aria-label="ถัดไป" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)} className="m3-btn m3-btn-sm m3-btn-text">›</button>
              </div>
            )}
          </>
        )}
      </div>

      {/* ยืนยันอนุมัติ (L04) */}
      {approveFor && (
        <M3Dialog
          title="อนุมัติการระบุตำแหน่ง?"
          hint="ระบบจะตั้งยอดตามคำขอทันทีหลังอนุมัติ (คิดจากยอด ณ ตอนอนุมัติ)"
          icon={<svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>}
          onBackdrop={() => !busy && setApproveFor(null)}
          footer={
            <>
              <button type="button" className={m3Cls.btnCancel} disabled={busy} onClick={() => setApproveFor(null)}>ยกเลิก</button>
              <button type="button" className={m3Cls.btnPrimary} disabled={busy} onClick={() => void decide(approveFor, "approve")}>
                <M3SubmitLabel submitting={busy}>ยืนยันอนุมัติ</M3SubmitLabel>
              </button>
            </>
          }
        >
          <div className="flex items-center gap-3 rounded-xl border border-[rgba(145,158,171,0.2)] px-4 py-3">
            <BoxIcon />
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold text-m3-grey-800">{approveFor.head.product_name}</div>
              <div className="truncate text-xs text-m3-grey-500">
                {approveFor.head.sku} · {approveFor.head.warehouse_name || approveFor.head.warehouse_id} · ขอโดย {approveFor.head.requested_by_name}
              </div>
            </div>
            <span className="font-m3-disp text-xl font-bold">{fmt(movedQty(approveFor))}</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {approveFor.lines.map((l) => {
              const d = lineDelta(l);
              return (
                <div key={l.request_id} className="rounded-xl bg-m3-grey-200 px-4 py-3">
                  <div className="text-xs text-m3-grey-500">{d < 0 ? "ต้นทาง" : "ปลายทาง"} {locLabel(l.location_code)}</div>
                  <div className="mt-1 flex items-center gap-2 font-m3-disp text-lg font-bold">
                    <span className="text-m3-grey-600">{fmt(beforeQty(l))}</span>
                    <Arrow />
                    <span className={d < 0 ? "text-m3-error-dark" : "text-m3-primary-dark"}>{fmt(l.target_qty)}</span>
                  </div>
                  <div className={`text-xs font-semibold ${d < 0 ? "text-m3-error" : "text-m3-primary"}`}>{signed(d)}</div>
                  {driftedSinceRequest(l) && <div className="text-[11px] text-m3-warning-dark">ยอดเปลี่ยนตั้งแต่ขอ (ตอนขอ {fmt(l.qty_at_request)})</div>}
                </div>
              );
            })}
          </div>
          {error && <M3Banner tone="error" role="alert">{error}</M3Banner>}
        </M3Dialog>
      )}

      {/* ปฏิเสธ (L05) — ต้องมีเหตุผล */}
      {rejectFor && (
        <M3Dialog
          title="ปฏิเสธคำขอ"
          subtitle={`${sumLabel(rejectFor)} · ${fmt(movedQty(rejectFor))} ชิ้น`}
          onBackdrop={() => !busy && setRejectFor(null)}
          footer={
            <>
              <button type="button" className={m3Cls.btnCancel} disabled={busy} onClick={() => setRejectFor(null)}>ยกเลิก</button>
              <button
                type="button"
                className={m3Cls.btnDanger}
                disabled={busy || rejectInvalid}
                onClick={() => {
                  setRejectTouched(true);
                  if (!rejectInvalid) void decide(rejectFor, "reject", rejectNote);
                }}
              >
                <M3SubmitLabel submitting={busy}>ปฏิเสธคำขอ</M3SubmitLabel>
              </button>
            </>
          }
        >
          <div className="flex flex-wrap gap-2">
            {REJECT_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={rejectChip === r}
                onClick={() => setRejectChip((c) => (c === r ? "" : r))}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${rejectChip === r ? "bg-[rgba(0,167,111,0.16)] text-m3-primary-dark" : "bg-m3-grey-200 text-m3-grey-700"}`}
              >
                {r}
              </button>
            ))}
          </div>
          <M3Field label={rejectChip && rejectChip !== "อื่นๆ" ? "รายละเอียด (ถ้ามี)" : "เหตุผล (จำเป็น)"} error={rejectTouched && rejectInvalid}>
            <textarea
              rows={3}
              maxLength={450}
              className={rejectTouched && rejectInvalid ? m3Cls.inputError : m3Cls.input}
              value={rejectText}
              onBlur={() => setRejectTouched(true)}
              onChange={(e) => setRejectText(e.target.value)}
            />
          </M3Field>
          {rejectTouched && rejectInvalid && <p className="-mt-2 text-xs text-m3-error-dark">ต้องระบุเหตุผลก่อนปฏิเสธ</p>}
          {error && <M3Banner tone="error" role="alert">{error}</M3Banner>}
        </M3Dialog>
      )}

      {/* แก้ไข (L02/M02) — เฉพาะรออนุมัติ */}
      {draft && (
        <M3Dialog
          title="แก้ไขคำขอ"
          subtitle={`${draft.group.head.product_name || ""} · ${draft.group.head.sku || ""}`}
          hint="แก้ได้เฉพาะคำขอที่ยังรออนุมัติ · ค่าเดิมแสดงไว้ใต้ช่อง"
          widthClass="sm:max-w-[560px]"
          onBackdrop={() => !busy && setDraft(null)}
          footer={
            <>
              <button type="button" className={m3Cls.btnCancel} disabled={busy} onClick={() => setDraft(null)}>ยกเลิก</button>
              <button type="button" className={m3Cls.btnPrimary} disabled={busy} onClick={() => void saveEdit()}>
                <M3SubmitLabel submitting={busy}>บันทึกการแก้ไข</M3SubmitLabel>
              </button>
            </>
          }
        >
          {draft.group.lines.map((l) => {
            const d = draft.lines[l.request_id];
            const set = (patch: Partial<{ qty: string; code: string }>) =>
              setDraft({ ...draft, lines: { ...draft.lines, [l.request_id]: { ...d, ...patch } } });
            return (
              <div key={l.request_id} className="grid grid-cols-2 gap-3">
                <div>
                  <M3Field label="ตำแหน่ง">
                    <input
                      className={m3Cls.input}
                      value={l.location_code ? d.code : "ไม่ระบุ"}
                      disabled={!l.location_code}
                      title={l.location_code ? "" : "แถว 'ไม่ระบุ' เปลี่ยนตำแหน่งไม่ได้"}
                      onChange={(e) => set({ code: e.target.value })}
                    />
                  </M3Field>
                  <div className="mt-1 text-[11px] text-m3-grey-500">เดิม {locLabel(l.location_code)}</div>
                </div>
                <div>
                  <M3Field label={`ยอดใหม่ (ชิ้น) · ตอนนี้ ${fmt(beforeQty(l))}`}>
                    <input className={m3Cls.input} type="number" inputMode="numeric" min={0} value={d.qty} onChange={(e) => set({ qty: e.target.value })} />
                  </M3Field>
                  <div className="mt-1 text-[11px] text-m3-grey-500">เดิม {fmt(l.target_qty)}</div>
                </div>
              </div>
            );
          })}
          <div>
            <M3Field label="หมายเหตุ">
              <input className={m3Cls.input} maxLength={500} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
            </M3Field>
            <div className="mt-1 text-[11px] text-m3-grey-500">เดิม {draft.group.head.note || "—"}</div>
          </div>
          {error && <M3Banner tone="error" role="alert">{error}</M3Banner>}
        </M3Dialog>
      )}

      {/* ประวัติ (L03/M03) */}
      {history && (
        <Drawer title="ประวัติคำขอ" subtitle={sumLabel(history.group)} onClose={() => setHistory(null)}>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className={`m3-label ${STATUS_TONE[history.group.status]}`}>{STATUS_LABEL[history.group.status]}</span>
            {!!history.edits?.length && (
              <>
                <EditedChip />
                <span className="text-xs text-m3-grey-500">แก้ไข {history.edits.length} ครั้ง</span>
              </>
            )}
          </div>
          {history.error && <M3Banner tone="error" className="mb-4">{history.error}</M3Banner>}
          {!history.edits ? (
            <M3Skeleton rows={3} label="กำลังโหลดประวัติ" />
          ) : (
            <ol>
              {history.group.head.decided_at && (
                <TimelineItem
                  tone={history.group.status === "REJECTED" ? "bg-[rgba(255,86,48,0.12)] text-m3-error" : "bg-[rgba(0,167,111,0.12)] text-m3-primary"}
                  icon={
                    history.group.status === "REJECTED" ? (
                      <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
                    ) : (
                      <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
                    )
                  }
                  title={history.group.status === "REJECTED" ? "ปฏิเสธ" : "อนุมัติ"}
                  at={history.group.head.decided_at}
                  by={history.group.head.decided_by_name}
                >
                  {history.group.head.decision_note && <div className="mt-1 text-xs text-m3-grey-600">เหตุผล/หมายเหตุ: {history.group.head.decision_note}</div>}
                  {history.group.status !== "REJECTED" &&
                    history.group.lines.map((l) => (
                      <ChangeRow key={l.request_id} label={locLabel(l.location_code)} from={fmt(beforeQty(l))} to={fmt(l.target_qty)} />
                    ))}
                </TimelineItem>
              )}
              {history.edits.map((e) => {
                const line = history.group.lines.find((l) => l.request_id === e.request_id);
                const loc = locLabel(e.new_location_code || line?.location_code);
                const changes: ReactNode[] = [];
                if (e.old_location_code !== e.new_location_code)
                  changes.push(<ChangeRow key="loc" label="ตำแหน่ง" from={locLabel(e.old_location_code)} to={locLabel(e.new_location_code)} />);
                if (e.old_target_qty !== e.new_target_qty)
                  changes.push(<ChangeRow key="qty" label={`จำนวน ${loc}`} from={fmt(e.old_target_qty)} to={fmt(e.new_target_qty)} />);
                if (e.old_note !== e.new_note) changes.push(<ChangeRow key="note" label="หมายเหตุ" from={e.old_note || "—"} to={e.new_note || "—"} />);
                const title =
                  e.old_target_qty !== e.new_target_qty ? "แก้ไขจำนวน" : e.old_location_code !== e.new_location_code ? "แก้ไขตำแหน่ง" : "แก้ไขหมายเหตุ";
                return (
                  <TimelineItem key={e.edit_id} tone="bg-[rgba(0,184,217,0.12)] text-m3-info" icon={<PencilIcon cls="size-4" />} title={title} at={e.edited_at} by={e.edited_by_name}>
                    {changes}
                  </TimelineItem>
                );
              })}
              <TimelineItem
                tone="bg-m3-grey-200 text-m3-grey-600"
                icon={<svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>}
                title="สร้างคำขอ"
                at={history.group.head.requested_at}
                by={history.group.head.requested_by_name}
              >
                <div className="mt-1 space-y-0.5 text-xs text-m3-grey-500">
                  {history.group.lines.map((l) => {
                    // ค่าตอนสร้าง = ค่า "เดิม" ของการแก้ไขครั้งแรก (edits เรียงใหม่→เก่า)
                    const first = [...(history.edits || [])].reverse().find((e) => e.request_id === l.request_id);
                    const code = first ? first.old_location_code : l.location_code;
                    const qty = first ? first.old_target_qty : l.target_qty;
                    return (
                      <div key={l.request_id}>
                        {locLabel(code)}: {fmt(l.qty_at_request)} → {fmt(qty)} ชิ้น
                      </div>
                    );
                  })}
                  {(() => {
                    const firstNote = [...(history.edits || [])].reverse().find((e) => e.old_note !== e.new_note);
                    const n = firstNote ? firstNote.old_note : history.group.head.note;
                    return n ? <div>หมายเหตุ: {n}</div> : null;
                  })()}
                </div>
              </TimelineItem>
            </ol>
          )}
        </Drawer>
      )}
    </div>
  );
}

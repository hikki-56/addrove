"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { useTabAuth } from "@/context/TabAuthContext";
import { useMenuVisibility } from "@/context/MenuVisibilityContext";
import { useWarehouseData } from "@/hooks/use-warehouse-data";
import { useScanFeedback } from "@/hooks/use-scan-feedback";
import BarcodeScanInput from "@/components/scanner/BarcodeScanInput";
import CameraBarcodeScannerModal from "@/components/ui/CameraBarcodeScannerModal";
import { M3Banner, M3Field, m3Cls } from "@/components/ui/m3";
import { ASSIGN_LOCATION_REQUESTS_HREF, getAssignLocationAccess, validateAssignRows } from "@/lib/assign-location";
import { normalizeWarehouseId } from "@/lib/warehouse-utils";
import type { Product } from "@/types/models";
import {
  REQUESTS_API,
  STATUS_LABEL,
  STATUS_TONE,
  fmt,
  groupRequests,
  locLabel,
  movedQty,
  signed,
  when,
  type AssignReq,
} from "./_lib/requests";

type BalanceEntry = { warehouse_id: string; location_id: string; location_name: string; quantity: number };

type LocQty = { location_code: string; quantity: number };
type Row = { key: string; to_location_id: string; qty: string; pcs: string };

const norm = (s?: string | null) => (s || "").trim().toLowerCase();

// Minimal UI v3b (P01–P03 / PM01–PM03): การ์ด 16px เงาอ่อน · ปุ่ม 8px · ลด = แดง #FF5630 · เพิ่ม = เขียว
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

function Step({ n, label, state }: { n: number; label: string; state: "done" | "active" | "todo" }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span
        className={`inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
          state === "done" ? "bg-m3-primary text-white" : state === "active" ? "bg-m3-grey-800 text-white" : "bg-m3-grey-200 text-m3-grey-500"
        }`}
      >
        {state === "done" ? (
          <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={3} aria-hidden="true">
            <path d="m5 12 5 5 9-10" />
          </svg>
        ) : (
          n
        )}
      </span>
      <span className={`truncate text-sm font-semibold ${state === "todo" ? "text-m3-grey-500" : "text-m3-grey-800"}`}>{label}</span>
    </div>
  );
}

export default function AssignLocationPage() {
  const { user } = useTabAuth();
  const { can_manage, menu_hrefs } = useMenuVisibility();
  // ค่าเริ่มต้นตามบทบาท (ADMIN ต้องเป็น ty ที่เซิร์ฟเวอร์ยืนยัน) + ติ๊กเพิ่ม/เอาออกในตั้งค่าเมนูผู้ใช้ — API ตรวจซ้ำอีกชั้น
  const allowed = getAssignLocationAccess(user?.role, user?.email, menu_hrefs, can_manage).assign;

  const { activeWhId, setActiveWhId, warehouses, locations, allLocations, products, refreshData } = useWarehouseData();
  const [scanFeedback, setScanFeedback] = useScanFeedback();
  const [barcode, setBarcode] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  // กล้องตัวเดียว ใช้ได้ทั้งช่องสแกนสินค้าและช่องตำแหน่ง
  const [cameraTarget, setCameraTarget] = useState<"product" | "location">("product");
  const [product, setProduct] = useState<Product | null>(null);
  const [stock, setStock] = useState<LocQty[]>([]);
  const [loadingStock, setLoadingStock] = useState(false);
  const [locInput, setLocInput] = useState("");
  const [qtyInput, setQtyInput] = useState("");
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  // แถวที่ส่งล่าสุด — ใช้พิมพ์หลังส่ง (แถวบนจอถูกล้าง)
  const [lastSaved, setLastSaved] = useState<{ product_id: string; rows: Row[] } | null>(null);
  // คำขอของฉัน (อ่านอย่างเดียว จาก GET เดิม)
  const [myReqs, setMyReqs] = useState<AssignReq[]>([]);
  const [myLoading, setMyLoading] = useState(false);

  // มีจำนวนบรรจุต่อลัง → ใส่เป็นกล่อง แล้วคำนวณเป็นชิ้น
  const perBox = product?.units_per_carton && product.units_per_carton > 0 ? product.units_per_carton : 0;
  const toPieces = useCallback((v: string) => (perBox ? Number(v) * perBox : Number(v)), [perBox]);
  // ชิ้นของแถว: มีจำนวนบรรจุ → ใช้ช่องชิ้น (แก้ได้), ไม่มี → ใช้จำนวนเดิม
  const rowPieces = useCallback((r: Row) => (perBox ? Number(r.pcs) : Number(r.qty)), [perBox]);
  const assigned = rows.reduce((a, r) => a + (rowPieces(r) || 0), 0);

  const loadMine = useCallback(async () => {
    setMyLoading(true);
    try {
      const res = await fetch(`${REQUESTS_API}?status=ALL&limit=300`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) return;
      const me = json.data?.me as string | undefined;
      const list = (json.data?.requests || []) as AssignReq[];
      setMyReqs(me ? list.filter((r) => r.requested_by === me) : list);
    } catch {
      // แสดงรายการว่าง — ไม่บล็อกการทำงานหลัก
    } finally {
      setMyLoading(false);
    }
  }, []);

  useEffect(() => {
    if (allowed) void loadMine();
  }, [allowed, loadMine]);

  const myGroups = useMemo(() => groupRequests(myReqs).slice(0, 8), [myReqs]);

  const loadStock = useCallback(async (p: Product, whId: string) => {
    setLoadingStock(true);
    try {
      const res = await fetch(`/api/stock/${encodeURIComponent(p.product_id)}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      const entries = (json?.data?.by_warehouse || []) as BalanceEntry[];
      const codeById = new Map(allLocations.map((l) => [l.location_id, (l.location_code || "").trim()]));
      const wh = normalizeWarehouseId(whId);
      const list = entries
        .filter((e) => normalizeWarehouseId(e.warehouse_id) === wh)
        .map((e) => {
          const code = codeById.get(e.location_id);
          const unassigned = !e.location_id || code === "" || e.location_name.trim() === "ไม่ระบุ";
          return { location_code: unassigned ? "" : (code || e.location_name || e.location_id).toUpperCase(), quantity: Number(e.quantity) || 0 };
        })
        .filter((l) => l.quantity !== 0 || !l.location_code);
      setStock(list.sort((a, b) => (a.location_code ? 1 : 0) - (b.location_code ? 1 : 0) || a.location_code.localeCompare(b.location_code)));
    } catch {
      setError("โหลดยอดคงเหลือไม่สำเร็จ");
    } finally {
      setLoadingStock(false);
    }
  }, [allLocations]);

  const findLocation = useCallback(
    (code: string) => {
      const c = norm(code);
      return locations.find((l) => norm(l.location_code) === c || norm(l.shelf_code) === c);
    },
    [locations]
  );

  const addRow = useCallback(
    (locCode: string, qtyStr: string) => {
      setError("");
      const loc = findLocation(locCode);
      if (!loc || !loc.location_code.trim()) return setError(`ไม่พบตำแหน่ง "${locCode.trim()}" ในโกดังนี้`), false;
      const code = loc.location_code.trim().toUpperCase();
      if (rows.some((r) => r.to_location_id === code)) return setError(`ตำแหน่ง ${code} มีในรายการแล้ว`), false;
      setRows((rs) => [...rs, { key: uuidv4(), to_location_id: code, qty: qtyStr, pcs: qtyStr.trim() === "" ? "" : String(toPieces(qtyStr)) }]);
      setLocInput("");
      setQtyInput("");
      return true;
    },
    [findLocation, rows, toPieces]
  );

  const handleLocationScan = useCallback(
    (code: string, playSound = false) => {
      const loc = findLocation(code);
      if (!loc || !loc.location_code.trim()) {
        setLocInput("");
        setScanFeedback({ type: "error", message: `✕ ไม่พบตำแหน่ง "${code.trim()}" ในโกดังนี้`, scannedCode: code.trim() }, playSound);
        return;
      }
      setLocInput(loc.location_code.trim().toUpperCase());
      setScanFeedback({ type: "success", message: `✓ ตำแหน่ง ${loc.location_code.trim().toUpperCase()}`, scannedCode: code.trim() }, playSound);
    },
    [findLocation, setScanFeedback]
  );

  const handleScan = useCallback(
    async (code: string, playSound = false) => {
      const c = norm(code);
      setBarcode("");
      if (!c) return;
      if (product && findLocation(code)) {
        // สแกนตำแหน่งหลังเลือกสินค้าแล้ว
        setLocInput(findLocation(code)!.location_code.toUpperCase());
        setScanFeedback({ type: "success", message: `✓ ตำแหน่ง ${code.trim().toUpperCase()}`, scannedCode: code.trim() }, playSound);
        return;
      }
      const p = products.find((x) => norm(x.barcode) === c || norm(x.sku) === c || norm(x.product_id) === c);
      if (!p) {
        setScanFeedback({ type: "error", message: `✕ ไม่พบสินค้า/ตำแหน่ง "${code.trim()}"`, scannedCode: code.trim() }, playSound);
        return;
      }
      setProduct(p);
      setRows([]);
      setNote("");
      setMessage("");
      setError("");
      setScanFeedback({ type: "success", message: `✓ ${p.product_name}`, scannedCode: code.trim() }, playSound);
      await loadStock(p, activeWhId);
    },
    [product, findLocation, products, activeWhId, loadStock, setScanFeedback]
  );

  const errors = useMemo(
    () => validateAssignRows(rows.map((r) => ({ to_location_id: r.to_location_id, qty: rowPieces(r) }))),
    [rows, rowPieces]
  );

  // พรีวิวแบบสแนปช็อต (เหมือนฝั่งเซิร์ฟเวอร์): ตำแหน่งที่กรอก = จำนวนที่กรอก, ตำแหน่งอื่นรวม "ไม่ระบุ" = 0
  const preview = useMemo(() => {
    if (!rows.length) return [];
    const target = new Map(rows.map((r) => [r.to_location_id, rowPieces(r) || 0]));
    const out: { code: string; before: number; after: number; delta: number }[] = [];
    for (const s of stock) {
      const after = target.get(s.location_code) ?? 0;
      out.push({ code: s.location_code, before: s.quantity, after, delta: after - s.quantity });
      target.delete(s.location_code);
    }
    for (const [code, after] of target) out.push({ code, before: 0, after, delta: after });
    return out.filter((p) => p.delta !== 0).sort((a, b) => a.delta - b.delta);
  }, [rows, stock, rowPieces]);

  const save = async () => {
    if (!product || errors.length) return setError(errors.join("\n"));
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/movements/assign-location", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          warehouse_id: activeWhId,
          product_id: product.product_id,
          idempotency_key: uuidv4(),
          note: note.trim(),
          rows: rows.map((r) => ({ to_location_id: r.to_location_id, qty: rowPieces(r) })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.message || "ส่งคำขอไม่สำเร็จ");
      setMessage(`${json.message || "ส่งคำขอแล้ว"} — ยอดจะเปลี่ยนเมื่อได้รับอนุมัติ`);
      setLastSaved({ product_id: product.product_id, rows });
      setRows([]);
      setNote("");
      window.dispatchEvent(new Event("stockify-stock-updated"));
      void refreshData();
      void loadMine();
      await loadStock(product, activeWhId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "ส่งคำขอไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  };

  const clearAll = () => {
    setRows([]);
    setNote("");
    setLocInput("");
    setQtyInput("");
    setError("");
  };

  const sheetRows = rows.length ? rows : lastSaved && product && lastSaved.product_id === product.product_id ? lastSaved.rows : [];
  const sheetTotal = sheetRows.reduce((a, r) => a + (rowPieces(r) || 0), 0);
  const boxText = (pcs: number) => {
    if (!perBox) return "";
    const box = Math.floor(pcs / perBox);
    const rem = pcs - box * perBox;
    return rem ? `${box.toLocaleString()} กล่อง + ${rem.toLocaleString()} ชิ้น` : `${box.toLocaleString()} กล่อง`;
  };

  if (!user) return null;
  if (!allowed) {
    return <div className="max-w-xl mx-auto p-6 text-center text-m3-grey-700">ไม่มีสิทธิ์ใช้เมนูนี้</div>;
  }

  const whName = warehouses.find((w) => w.warehouse_id === activeWhId)?.warehouse_name || activeWhId;
  const stepState = (n: number): "done" | "active" | "todo" => {
    const cur = !product ? 1 : rows.length === 0 ? 2 : 3;
    return n < cur ? "done" : n === cur ? "active" : "todo";
  };

  return (
    <>
    <div className="print:hidden mx-auto w-full min-w-0 max-w-6xl pb-20 sm:px-4 sm:pb-8">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        {/* ฟอร์มหลัก */}
        <div className="m3-card min-w-0 space-y-5 bg-white p-4 sm:p-6">
          <div className="hidden items-center gap-3 sm:flex">
            <Step n={1} label="สินค้า" state={stepState(1)} />
            <span className="h-px flex-1 bg-m3-grey-300" />
            <Step n={2} label="ตำแหน่ง + จำนวน" state={stepState(2)} />
            <span className="h-px flex-1 bg-m3-grey-300" />
            <Step n={3} label="ตรวจยอด + ส่งขออนุมัติ" state={stepState(3)} />
          </div>

          <M3Field label="โกดัง">
            <select
              className={m3Cls.input}
              value={activeWhId}
              onChange={(e) => {
                setActiveWhId(e.target.value);
                setProduct(null);
                setStock([]);
                setRows([]);
              }}
            >
              {warehouses.map((w) => (
                <option key={w.warehouse_id} value={w.warehouse_id}>{w.warehouse_name}</option>
              ))}
            </select>
          </M3Field>

          <BarcodeScanInput
            value={barcode}
            onChange={setBarcode}
            onScanSubmit={(c) => void handleScan(c)}
            onOpenScannerModal={() => {
              setCameraTarget("product");
              setCameraOpen(true);
            }}
            placeholder={product ? "สแกนตำแหน่ง หรือสินค้าตัวใหม่..." : "สแกนบาร์โค้ดสินค้า..."}
          />
          {scanFeedback && (
            <M3Banner tone={scanFeedback.type === "success" ? "success" : "error"}>{scanFeedback.message}</M3Banner>
          )}

          {!product && (
            <div className="rounded-xl border border-dashed border-[rgba(145,158,171,0.32)] px-6 py-10 text-center text-sm font-semibold text-m3-grey-500">
              สแกนหรือพิมพ์บาร์โค้ดสินค้าเพื่อเริ่มระบุตำแหน่ง
            </div>
          )}

          {product && (
            <>
              <div className="flex items-center gap-3 rounded-xl bg-m3-grey-100 px-4 py-3">
                <BoxIcon />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-bold text-m3-grey-800">{product.product_name}</div>
                  <div className="truncate text-xs text-m3-grey-500">
                    {product.sku}
                    {product.barcode && product.barcode !== "-" ? ` · ${product.barcode}` : ""}
                    {perBox > 0 ? ` · ${perBox.toLocaleString()} ชิ้น/กล่อง` : ""}
                  </div>
                </div>
                <span className="m3-label m3-label-success">สินค้าถูกต้อง</span>
              </div>

              <div>
                <div className="mb-2 text-sm font-semibold text-m3-grey-800">ยอดปัจจุบันตามตำแหน่ง {loadingStock && "…"}</div>
                {stock.length === 0 && !loadingStock && <div className="text-sm text-m3-grey-500">ไม่มียอดในโกดังนี้</div>}
                <div className="flex flex-wrap gap-2">
                  {stock.map((s) => (
                    <span
                      key={s.location_code || "-"}
                      className="inline-flex items-center gap-2 rounded-lg border border-[rgba(145,158,171,0.24)] px-3 py-1.5 text-sm"
                    >
                      <span className="font-m3-disp font-bold text-m3-grey-800">{locLabel(s.location_code)}</span>
                      <span className="text-xs text-m3-grey-500">มี {s.quantity.toLocaleString()} ชิ้น</span>
                    </span>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <BarcodeScanInput
                  value={locInput}
                  onChange={setLocInput}
                  onScanSubmit={(c) => handleLocationScan(c)}
                  onOpenScannerModal={() => {
                    setCameraTarget("location");
                    setCameraOpen(true);
                  }}
                  autoFocus={false}
                  placeholder="สแกน / พิมพ์ตำแหน่ง..."
                />
                <div className="flex gap-2">
                  <M3Field label={perBox ? "จำนวน (กล่อง)" : "จำนวน (ชิ้น)"} className="min-w-0 flex-1">
                    <input
                      className={m3Cls.input}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      placeholder={perBox ? "จำนวนกล่อง" : "จำนวน"}
                      value={qtyInput}
                      onChange={(e) => setQtyInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addRow(locInput, qtyInput)}
                    />
                  </M3Field>
                  {perBox > 0 && qtyInput.trim() !== "" && (
                    <span className="shrink-0 self-center whitespace-nowrap text-sm font-semibold text-m3-grey-600">= {toPieces(qtyInput).toLocaleString()} ชิ้น</span>
                  )}
                  <button type="button" className="m3-btn m3-btn-dark h-11 shrink-0 px-4 sm:px-5" onClick={() => addRow(locInput, qtyInput)}>
                    เพิ่ม
                  </button>
                </div>
              </div>

              {rows.length > 0 && (
                <div className="overflow-hidden rounded-xl border border-[rgba(145,158,171,0.2)]">
                  <div className="flex items-center gap-2 bg-m3-grey-200 px-3 py-2 text-xs font-semibold text-m3-grey-600 sm:px-4">
                    <span className="min-w-0 flex-1">ตำแหน่ง</span>
                    {perBox > 0 && <span className="w-20 sm:w-24">กล่อง</span>}
                    <span className="w-20 sm:w-24">{perBox ? "= ชิ้น" : "ชิ้น"}</span>
                    <span className="w-11 sm:w-8" />
                  </div>
                  {rows.map((r) => (
                    <div key={r.key} className="flex items-center gap-2 border-t border-[rgba(145,158,171,0.2)] px-3 py-2 sm:px-4">
                      <span className="min-w-0 flex-1 truncate font-m3-disp font-bold text-m3-grey-800">{r.to_location_id}</span>
                      <input
                        className="h-11 w-20 rounded-lg border border-[rgba(145,158,171,0.32)] px-2 text-base sm:h-9 sm:w-24 sm:text-sm"
                        type="number"
                        inputMode="numeric"
                        min={1}
                        placeholder={perBox ? "กล่อง" : undefined}
                        aria-label={perBox ? "กล่อง" : "ชิ้น"}
                        value={r.qty}
                        onChange={(e) => {
                          const v = e.target.value;
                          setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, qty: v, pcs: v.trim() === "" ? "" : String(toPieces(v)) } : x)));
                        }}
                      />
                      {perBox > 0 && (
                        <input
                          className="h-11 w-20 rounded-lg border border-[rgba(145,158,171,0.32)] px-2 text-base sm:h-9 sm:w-24 sm:text-sm"
                          type="number"
                          inputMode="numeric"
                          min={1}
                          placeholder="ชิ้น"
                          aria-label="ชิ้น"
                          value={r.pcs}
                          onChange={(e) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, pcs: e.target.value } : x)))}
                        />
                      )}
                      <button
                        type="button"
                        aria-label={`ลบ ${r.to_location_id}`}
                        className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-m3-error sm:size-8 hover:bg-[rgba(255,86,48,0.08)]"
                        onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                      >
                        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                          <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                        </svg>
                      </button>
                    </div>
                  ))}
                  <div className="border-t border-[rgba(145,158,171,0.2)] bg-m3-grey-100 px-4 py-2 text-sm text-m3-grey-600">
                    รวมที่นับ <b className="text-m3-grey-800">{assigned.toLocaleString()}</b> ชิ้น · ตำแหน่งที่ไม่ได้กรอก (รวม &quot;ไม่ระบุ&quot;) จะถูกตั้งเป็น 0
                  </div>
                </div>
              )}

              {preview.length > 0 && (
                <div>
                  <div className="mb-2 text-sm font-semibold text-m3-grey-800">ยอดก่อน → หลังอนุมัติ</div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {preview.map((p) => {
                      const minus = p.delta < 0;
                      return (
                        <div
                          key={p.code || "-"}
                          className={`rounded-xl px-4 py-3 ${minus ? "bg-[rgba(255,86,48,0.08)]" : "bg-[rgba(0,167,111,0.08)]"}`}
                        >
                          <div className="text-xs text-m3-grey-500">{minus ? "ลดลง" : "เพิ่มขึ้น"} · {whName}</div>
                          <div className={`font-m3-disp text-2xl font-bold ${minus ? "text-m3-grey-800" : "text-m3-primary-dark"}`}>{locLabel(p.code)}</div>
                          <div className={`font-m3-disp text-lg font-bold ${minus ? "text-m3-error" : "text-m3-primary"}`}>{signed(p.delta)}</div>
                          <div className="text-xs text-m3-grey-500">
                            {fmt(p.before)} → {fmt(p.after)} ชิ้น
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {rows.length > 0 && (
                <M3Field label="หมายเหตุ (ถ้ามี)">
                  <input className={m3Cls.input} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น นับจริงหน้าชั้น" />
                </M3Field>
              )}

              {error && <M3Banner tone="error" role="alert"><span className="whitespace-pre-line">{error}</span></M3Banner>}
              {message && (
                <M3Banner
                  tone="success"
                  role="status"
                  title="ส่งคำขอแล้ว"
                  action={
                    <Link href={ASSIGN_LOCATION_REQUESTS_HREF} className="m3-btn m3-btn-sm m3-btn-outline">
                      ดูคำขอ
                    </Link>
                  }
                >
                  {message}
                </M3Banner>
              )}

              <div className="sticky bottom-0 z-10 -mx-4 grid grid-cols-2 gap-2 border-t border-[rgba(145,158,171,0.2)] bg-white/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:static sm:m-0 sm:flex sm:justify-end sm:gap-3 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
                <button
                  type="button"
                  disabled={sheetRows.length === 0}
                  className="m3-btn m3-btn-outline h-11 px-5"
                  onClick={() => window.print()}
                >
                  พิมพ์ใบระบุตำแหน่ง
                </button>
                <button type="button" disabled={rows.length === 0 || saving} className="m3-btn m3-btn-outline h-11 px-5" onClick={clearAll}>
                  ล้าง
                </button>
                <button
                  type="button"
                  disabled={saving || rows.length === 0 || errors.length > 0}
                  className="m3-btn m3-btn-primary order-first col-span-2 h-12 gap-2 px-5 sm:order-none sm:h-11"
                  onClick={save}
                >
                  <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden="true">
                    <path d="M3 11.5 21 3l-8.5 18-2.2-7.3L3 11.5Z" />
                  </svg>
                  {saving ? "กำลังส่งคำขอ..." : "ส่งขออนุมัติ"}
                </button>
              </div>
              <p className="text-center text-xs text-m3-grey-500 sm:text-right">สต็อกยังไม่เปลี่ยนจนกว่า ADMIN จะอนุมัติ</p>
            </>
          )}
        </div>

        {/* คำขอของฉัน */}
        <aside className="m3-card min-w-0 bg-white p-0">
          <div className="flex items-center gap-2 px-5 pt-5 pb-2">
            <h2 className="text-base font-bold text-m3-grey-800">คำขอของฉัน</h2>
            <span className="m3-label m3-label-default">{groupRequests(myReqs).length}</span>
            <button type="button" className="m3-btn m3-btn-sm m3-btn-text ml-auto" onClick={() => void loadMine()} disabled={myLoading}>
              {myLoading ? "…" : "รีเฟรช"}
            </button>
          </div>
          {!myGroups.length && !myLoading && <div className="px-5 pb-5 text-sm text-m3-grey-500">ยังไม่มีคำขอ</div>}
          <ul>
            {myGroups.map((g) => {
              const minus = g.lines.filter((l) => l.target_qty < (l.qty_at_request ?? 0));
              const plus = g.lines.filter((l) => l.target_qty >= (l.qty_at_request ?? 0));
              return (
                <li key={g.key} className="border-t border-[rgba(145,158,171,0.16)] px-5 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-semibold text-m3-grey-800">{g.head.product_name || g.head.sku}</span>
                    <span className={`m3-label ${STATUS_TONE[g.status]}`}>{STATUS_LABEL[g.status]}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 font-m3-disp text-[13px] font-semibold text-m3-grey-700">
                    <span>{minus.map((l) => locLabel(l.location_code)).join(", ") || "—"}</span>
                    <span className="text-m3-grey-400">→</span>
                    <span>{plus.map((l) => locLabel(l.location_code)).join(", ") || "—"}</span>
                    <span className="ml-auto font-m3 text-xs font-normal text-m3-grey-500">
                      {fmt(movedQty(g))} ชิ้น · {when(g.head.requested_at)}
                    </span>
                  </div>
                  {g.status === "REJECTED" && g.head.decision_note && (
                    <div className="mt-1.5 rounded-lg bg-[rgba(255,86,48,0.08)] px-3 py-1.5 text-xs text-m3-error-dark">
                      เหตุผล: {g.head.decision_note}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="border-t border-[rgba(145,158,171,0.16)] px-5 py-3">
            <Link href={ASSIGN_LOCATION_REQUESTS_HREF} className="text-sm font-semibold text-m3-primary-dark hover:underline">
              ดูคำขอทั้งหมด →
            </Link>
          </div>
        </aside>
      </div>

      <CameraBarcodeScannerModal
        feedbackHandledByCaller
        feedback={scanFeedback}
        isOpen={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onScanSuccess={async (text, playSound) => {
          setCameraOpen(false);
          if (cameraTarget === "location") handleLocationScan(text, playSound);
          else await handleScan(text, playSound);
        }}
      />
    </div>

    {product && sheetRows.length > 0 && (
      <div className="assign-print-area print-sheet hidden print:block font-sans text-black p-4">
        <h1 className="text-xl font-bold mb-1">ระบุตำแหน่งสินค้า</h1>
        <div className="font-bold">{product.product_name}</div>
        <div className="text-sm">รหัส {product.sku}{product.barcode && product.barcode !== "-" ? ` · บาร์โค้ด ${product.barcode}` : ""}</div>
        <div className="text-sm mb-3">โกดัง {whName}</div>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="border border-black px-2 py-1 text-left">ตำแหน่ง</th>
              <th className="border border-black px-2 py-1 text-right">จำนวน (ชิ้น)</th>
              {perBox > 0 && <th className="border border-black px-2 py-1 text-right">กล่อง</th>}
            </tr>
          </thead>
          <tbody>
            {sheetRows.map((r) => (
              <tr key={r.key}>
                <td className="border border-black px-2 py-1">{r.to_location_id}</td>
                <td className="border border-black px-2 py-1 text-right">{(rowPieces(r) || 0).toLocaleString()}</td>
                {perBox > 0 && <td className="border border-black px-2 py-1 text-right">{boxText(rowPieces(r) || 0)}</td>}
              </tr>
            ))}
            <tr className="font-bold">
              <td className="border border-black px-2 py-1">รวม</td>
              <td className="border border-black px-2 py-1 text-right">{sheetTotal.toLocaleString()}</td>
              {perBox > 0 && <td className="border border-black px-2 py-1 text-right">{boxText(sheetTotal)}</td>}
            </tr>
          </tbody>
        </table>
        <div className="text-xs mt-3">พิมพ์เมื่อ {new Date().toLocaleString("th-TH")} · โดย {user.name || user.email}</div>
      </div>
    )}
    <style>{`
      @media print {
        body * { visibility: hidden !important; }
        .assign-print-area, .assign-print-area * { visibility: visible !important; }
        .assign-print-area { position: absolute; left: 0; top: 0; width: 100%; display: block !important; }
      }
    `}</style>
    </>
  );
}

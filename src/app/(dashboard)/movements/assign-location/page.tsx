"use client";

import { useCallback, useMemo, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { useTabAuth } from "@/context/TabAuthContext";
import { useMenuVisibility } from "@/context/MenuVisibilityContext";
import { useWarehouseData } from "@/hooks/use-warehouse-data";
import { useScanFeedback } from "@/hooks/use-scan-feedback";
import BarcodeScanInput from "@/components/scanner/BarcodeScanInput";
import CameraBarcodeScannerModal from "@/components/ui/CameraBarcodeScannerModal";
import { canAssignLocation, validateAssignRows } from "@/lib/assign-location";
import { normalizeWarehouseId } from "@/lib/warehouse-utils";
import type { Product } from "@/types/models";

type BalanceEntry = { warehouse_id: string; location_id: string; location_name: string; quantity: number };

type LocQty = { location_code: string; quantity: number };
type Row = { key: string; to_location_id: string; qty: string };

const norm = (s?: string | null) => (s || "").trim().toLowerCase();

export default function AssignLocationPage() {
  const { user } = useTabAuth();
  const { can_manage } = useMenuVisibility();
  // ADMIN ต้องเป็นบัญชีที่เซิร์ฟเวอร์ยืนยัน (can_manage) ด้วย — API ตรวจซ้ำอีกชั้น
  const allowed = canAssignLocation(user?.role, user?.email) && (user?.role !== "ADMIN" || can_manage);

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
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const available = stock.filter((s) => !s.location_code.trim()).reduce((a, s) => a + s.quantity, 0);
  const assigned = rows.reduce((a, r) => a + (Number(r.qty) || 0), 0);

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
      setRows((rs) => [...rs, { key: uuidv4(), to_location_id: code, qty: qtyStr }]);
      setLocInput("");
      setQtyInput("");
      return true;
    },
    [findLocation, rows]
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
      setMessage("");
      setError("");
      setScanFeedback({ type: "success", message: `✓ ${p.product_name}`, scannedCode: code.trim() }, playSound);
      await loadStock(p, activeWhId);
    },
    [product, findLocation, products, activeWhId, loadStock, setScanFeedback]
  );

  const errors = useMemo(
    () => validateAssignRows(rows.map((r) => ({ to_location_id: r.to_location_id, qty: Number(r.qty) })), available),
    [rows, available]
  );

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
          rows: rows.map((r) => ({ to_location_id: r.to_location_id, qty: Number(r.qty) })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.message || "บันทึกไม่สำเร็จ");
      setMessage(`บันทึกแล้ว ${rows.length} ตำแหน่ง (${assigned.toLocaleString()} ชิ้น)`);
      setRows([]);
      window.dispatchEvent(new Event("stockify-stock-updated"));
      void refreshData();
      await loadStock(product, activeWhId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  };

  if (!user) return null;
  if (!allowed) {
    return <div className="max-w-xl mx-auto p-6 text-center text-m3-grey-700">ไม่มีสิทธิ์ใช้เมนูนี้</div>;
  }

  const card = "bg-white rounded-xl p-4 border border-[rgba(145,158,171,0.2)] shadow-sm space-y-3";
  return (
    <div className="max-w-full sm:max-w-xl md:max-w-2xl mx-auto px-2 sm:px-4 pb-20 sm:pb-8 space-y-4">
      <h1 className="text-lg font-bold text-m3-grey-800">ระบุตำแหน่งสินค้า</h1>

      <div className={card}>
        <label className="text-sm font-semibold text-m3-grey-700">โกดัง</label>
        <select
          className="w-full border rounded-lg px-3 py-2"
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
      </div>

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
        <div className={`text-sm rounded-lg px-3 py-2 ${scanFeedback.type === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
          {scanFeedback.message}
        </div>
      )}

      {product && (
        <div className={card}>
          <div>
            <div className="font-bold text-m3-grey-800">{product.product_name}</div>
            <div className="text-xs text-m3-grey-600">{product.sku}{product.barcode && product.barcode !== "-" ? ` · ${product.barcode}` : ""}</div>
          </div>
          <div className="text-sm">
            <div className="font-semibold text-m3-grey-700 mb-1">ยอดตามตำแหน่ง {loadingStock && "…"}</div>
            {stock.length === 0 && !loadingStock && <div className="text-m3-grey-600">ไม่มียอดในโกดังนี้</div>}
            {stock.map((s) => (
              <div key={s.location_code || "-"} className="flex justify-between border-b last:border-0 py-1">
                <span>{s.location_code || "ไม่ระบุ"}</span>
                <span className="font-semibold">{s.quantity.toLocaleString()}</span>
              </div>
            ))}
          </div>
          <div className="text-sm text-m3-grey-700">
            ระบุได้จาก &quot;ไม่ระบุ&quot;: <b>{available.toLocaleString()}</b> · ใส่แล้ว <b>{assigned.toLocaleString()}</b> · เหลือ <b>{(available - assigned).toLocaleString()}</b>
          </div>

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
            <input
              className="flex-1 min-w-0 border rounded-lg px-3 py-2"
              type="number"
              inputMode="numeric"
              min={1}
              placeholder="จำนวน"
              value={qtyInput}
              onChange={(e) => setQtyInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addRow(locInput, qtyInput)}
            />
            <button type="button" className="px-4 rounded-lg bg-m3-primary text-white font-bold" onClick={() => addRow(locInput, qtyInput)}>
              เพิ่ม
            </button>
          </div>

          {rows.map((r) => (
            <div key={r.key} className="flex items-center gap-2">
              <span className="flex-1 font-semibold">{r.to_location_id}</span>
              <input
                className="w-24 border rounded-lg px-2 py-1"
                type="number"
                inputMode="numeric"
                min={1}
                value={r.qty}
                onChange={(e) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, qty: e.target.value } : x)))}
              />
              <button type="button" className="text-red-600 text-sm" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                ลบ
              </button>
            </div>
          ))}

          {error && <div className="text-sm text-red-700 whitespace-pre-line">{error}</div>}
          {message && <div className="text-sm text-green-700">{message}</div>}
          <button
            type="button"
            disabled={saving || rows.length === 0 || errors.length > 0}
            className="w-full py-3 rounded-lg bg-m3-primary text-white font-bold disabled:opacity-50"
            onClick={save}
          >
            {saving ? "กำลังบันทึก..." : "บันทึก"}
          </button>
        </div>
      )}

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
  );
}

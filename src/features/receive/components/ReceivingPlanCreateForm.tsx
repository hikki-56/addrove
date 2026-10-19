"use client";

import { useEffect, useState } from "react";
import type { Product, Warehouse } from "@/types/models";
import ProductSearchInput from "@/components/ui/ProductSearchInput";
import { M3Banner, M3Field, M3NumberTile, m3Cls } from "@/components/ui/m3";
import { SolarAltArrowDown, SolarClose } from "@/components/icons";
import type { ReceivingPlanCreatePayload } from "@/features/receive/hooks/use-receiving-plans";

const cardClass =
  "m3-card";

interface PlanLineDraft {
  product: Product;
  expectedQty: string;
  expectedBoxes: string;
  note: string;
}

interface ReceivingPlanCreateFormProps {
  warehouses: Warehouse[];
  defaultWarehouseId: string;
  isSubmitting: boolean;
  onSubmit: (payload: ReceivingPlanCreatePayload) => Promise<boolean>;
  onCreated?: () => void;
}

export default function ReceivingPlanCreateForm({
  warehouses,
  defaultWarehouseId,
  isSubmitting,
  onSubmit,
  onCreated,
}: ReceivingPlanCreateFormProps) {
  const [warehouseId, setWarehouseId] = useState(defaultWarehouseId || "");
  const [referenceNo, setReferenceNo] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<PlanLineDraft[]>([]);
  const [formError, setFormError] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState("");
  const [productsRetry, setProductsRetry] = useState(0);

  // A receiving plan can include products with no stock in the destination warehouse.
  useEffect(() => {
    const controller = new AbortController();
    const loadProducts = async () => {
      setProductsLoading(true);
      setProductsError("");
      try {
        const response = await fetch("/api/products?master_only=true", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("โหลดรายการสินค้าทั้งหมดไม่สำเร็จ");
        const json = await response.json();
        if (!json.success) throw new Error(json.message || "โหลดรายการสินค้าทั้งหมดไม่สำเร็จ");
        if (!controller.signal.aborted) {
          setProducts(Array.isArray(json.data) ? json.data : json.data?.items || []);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setProductsError(error instanceof Error ? error.message : "โหลดรายการสินค้าทั้งหมดไม่สำเร็จ");
        }
      } finally {
        if (!controller.signal.aborted) setProductsLoading(false);
      }
    };
    void loadProducts();
    return () => controller.abort();
  }, [productsRetry]);

  const addProduct = (product: Product) => {
    if (lines.some((l) => l.product.product_id === product.product_id)) {
      setFormError(`สินค้า "${product.product_name}" อยู่ในแผนแล้ว`);
      return;
    }
    setFormError("");
    setLines((prev) => [...prev, { product, expectedQty: "", expectedBoxes: "", note: "" }]);
  };

  const updateLine = (index: number, patch: Partial<PlanLineDraft>) => {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  };

  const removeLine = (index: number) => {
    setLines((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    setFormError("");
    if (!warehouseId) {
      setFormError("กรุณาเลือกโกดังปลายทาง");
      return;
    }
    if (lines.length === 0) {
      setFormError("กรุณาเพิ่มสินค้าอย่างน้อย 1 รายการ");
      return;
    }

    const payloadLines: ReceivingPlanCreatePayload["lines"] = [];
    for (const line of lines) {
      const expectedQty = line.expectedQty.trim() === "" ? undefined : Number(line.expectedQty);
      const expectedBoxes = line.expectedBoxes.trim() === "" ? undefined : Number(line.expectedBoxes);
      if (expectedQty !== undefined && (!Number.isInteger(expectedQty) || expectedQty <= 0)) {
        setFormError(`จำนวนที่คาดหวังของ "${line.product.product_name}" ต้องเป็นจำนวนเต็มบวก (เว้นว่างได้ถ้าไม่ตั้งเป้า)`);
        return;
      }
      if (expectedBoxes !== undefined && (!Number.isInteger(expectedBoxes) || expectedBoxes <= 0)) {
        setFormError(`จำนวนกล่องของ "${line.product.product_name}" ต้องเป็นจำนวนเต็มบวก`);
        return;
      }
      payloadLines.push({
        product_id: line.product.product_id || line.product.sku,
        ...(expectedQty !== undefined ? { expected_qty: expectedQty } : {}),
        ...(expectedBoxes !== undefined ? { expected_boxes: expectedBoxes } : {}),
        note: line.note.trim(),
      });
    }

    const ok = await onSubmit({
      warehouse_id: warehouseId,
      reference_no: referenceNo.trim(),
      expected_date: expectedDate,
      note: note.trim(),
      lines: payloadLines,
    });

    if (ok) {
      setLines([]);
      setReferenceNo("");
      setExpectedDate("");
      setNote("");
      onCreated?.();
    }
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className={`${cardClass} space-y-5 p-5 sm:p-6`}>
        <h2 className="text-lg font-bold text-m3-grey-800">สร้างแผนรับสินค้า</h2>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3 sm:gap-4">
          <M3Field label={<>รับเข้าโกดัง <span className="text-m3-error-dark">*</span></>}>
            <div className="relative">
              <select
                id="plan-warehouse"
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
                className={`${m3Cls.input} h-12 cursor-pointer appearance-none pr-10 text-base`}
              >
                {warehouses.map((w) => (
                  <option key={w.warehouse_id} value={w.warehouse_id}>
                    {w.warehouse_name}
                  </option>
                ))}
              </select>
              <SolarAltArrowDown size={18} className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-m3-grey-500" />
            </div>
          </M3Field>

          <M3Field label="เลขที่อ้างอิง (เช่น PO)">
            <input
              id="plan-reference"
              type="text"
              value={referenceNo}
              onChange={(e) => setReferenceNo(e.target.value)}
              maxLength={100}
              placeholder="เลขที่ใบสั่งซื้อ / ใบกำกับ"
              className={`${m3Cls.input} h-12 text-base`}
            />
          </M3Field>

          <M3Field label="คาดว่าจะมาถึง">
            <input
              id="plan-expected-date"
              type="date"
              value={expectedDate}
              onChange={(e) => setExpectedDate(e.target.value)}
              className={`${m3Cls.input} h-12 text-base`}
            />
          </M3Field>
        </div>

        <M3Field label="หมายเหตุ">
          <input
            id="plan-note"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder="เช่น รถบรรทุกทะเบียน… / ผู้ส่ง…"
            className={`${m3Cls.input} h-12 text-base`}
          />
        </M3Field>
      </div>

      <div className={`${cardClass} space-y-4 p-5 sm:p-6`}>
        <div className="space-y-2">
          <h3 className="text-base font-bold text-m3-grey-800">เพิ่มสินค้าเข้าแผน</h3>
          <p className="text-sm text-m3-grey-600">เลือกได้จากสินค้าทั้งหมดในระบบ แม้ยังไม่มีสต็อกในโกดังที่เลือก</p>
          {productsLoading ? (
            <p role="status" className="text-sm text-m3-grey-600">กำลังโหลดรายการสินค้าทั้งหมด…</p>
          ) : productsError ? (
            <M3Banner
              tone="error"
              role="alert"
              action={
                <button type="button" className="m3-btn m3-btn-sm m3-btn-outline" onClick={() => setProductsRetry((retry) => retry + 1)}>
                  ลองโหลดใหม่
                </button>
              }
            >
              {productsError}
            </M3Banner>
          ) : products.length === 0 ? (
            <p className="text-sm text-m3-grey-600">ยังไม่มีสินค้าในระบบ</p>
          ) : (
            <ProductSearchInput
              products={products}
              onSelectProduct={addProduct}
              selectedProductIds={lines.map((l) => l.product.product_id)}
              placeholder="พิมพ์ SKU / ชื่อสินค้า / บาร์โค้ด แล้วเลือกจากรายการ…"
            />
          )}
        </div>

        {formError && (
          <M3Banner tone="error" role="alert">{formError}</M3Banner>
        )}

        {lines.length > 0 && (
          <ul className="space-y-3">
            {lines.map((line, index) => (
              <li
                key={line.product.product_id}
                className="space-y-4 rounded-xl border border-[rgba(145,158,171,0.2)] p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <M3NumberTile>{index + 1}</M3NumberTile>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-m3-grey-800">{line.product.product_name}</p>
                    <p className="text-xs tabular-nums text-m3-grey-500">
                      {line.product.sku}
                      {line.product.barcode && line.product.barcode !== "-" ? ` • ${line.product.barcode}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeLine(index)}
                    className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-m3-grey-500 transition-colors hover:bg-[rgba(255,86,48,0.08)] hover:text-m3-error-dark"
                    aria-label={`ลบ ${line.product.product_name} ออกจากแผน`}
                  >
                    <SolarClose size={18} />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3">
                  <M3Field label={`จำนวนที่คาดหวัง (${line.product.base_unit || "ชิ้น"})`}>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={line.expectedQty}
                      onChange={(e) => updateLine(index, { expectedQty: e.target.value })}
                      placeholder="ไม่ตั้งเป้า"
                      className={`${m3Cls.input} h-11`}
                    />
                  </M3Field>
                  <M3Field label="จำนวนกล่องที่คาดหวัง">
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={line.expectedBoxes}
                      onChange={(e) => updateLine(index, { expectedBoxes: e.target.value })}
                      placeholder="ไม่ระบุ"
                      className={`${m3Cls.input} h-11`}
                    />
                  </M3Field>
                  <M3Field label="หมายเหตุรายการ" className="col-span-2 sm:col-span-1">
                    <input
                      type="text"
                      value={line.note}
                      onChange={(e) => updateLine(index, { note: e.target.value })}
                      maxLength={200}
                      placeholder="เช่น แยกโซน A"
                      className={`${m3Cls.input} h-11`}
                    />
                  </M3Field>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-col gap-3 border-t border-dashed border-[rgba(145,158,171,0.32)] pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-m3-grey-500">
            ไม่ระบุจำนวน = ไม่ตั้งเป้ารับ
          </p>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="m3-btn m3-btn-primary h-12 shrink-0 px-6 text-[15px] disabled:opacity-48"
          >
            {isSubmitting ? "กำลังบันทึก…" : `สร้างแผน (${lines.length} รายการ)`}
          </button>
        </div>
      </div>
    </div>
  );
}

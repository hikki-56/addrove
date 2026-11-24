import { useEffect, useState } from "react";
import { addCountQuantity, countComparisonLabel, productTotals } from "@/lib/count-comparison";
import { errorText, getCount } from "@/app/(dashboard)/stock-counts/_lib/count-client";
import type { ProductComparison, ScannedCountProduct } from "@/types/count-round";

export const mismatchStyle = "rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800";
export const matchStyle = "rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm font-semibold text-green-800";

export default function LiveCountComparison({ warehouse, product, quantity }: {
  warehouse: string; product: ScannedCountProduct; quantity: string;
}) {
  const [data, setData] = useState<ProductComparison>();
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let loading = false;
    async function refresh() {
      if (document.hidden || loading) return;
      loading = true;
      try {
        const next = await getCount<ProductComparison>({ warehouse, compare: product.product_id }, controller.signal);
        setData(next); setError("");
      } catch (e) { if (!controller.signal.aborted) setError(errorText(e)); }
      finally { loading = false; }
    }
    void refresh();
    const timer = window.setInterval(refresh, 5000);
    document.addEventListener("visibilitychange", refresh);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [warehouse, product.product_id]);
  if (error) return <p role="alert" className={mismatchStyle}>โหลดข้อมูลเทียบยอดไม่สำเร็จ · {error}</p>;
  if (!data) return <p className="text-sm">กำลังโหลดข้อมูลเทียบยอด…</p>;
  if (!data.hasReference) return <p className="text-sm text-m3-grey-600">ยังไม่มีไฟล์สำหรับเทียบยอด</p>;
  const { expected, counted } = productTotals(data);
  const entered = Number(quantity);
  const valid = quantity.trim() && Number.isFinite(entered) && entered >= 0 && entered <= 99999999999.999 && entered === Number(entered.toFixed(3));
  const total = addCountQuantity(counted ?? 0, entered);
  return <section className="grid gap-2" aria-label="เทียบกับไฟล์" aria-live="polite">
    <h3 className="text-sm font-semibold">ยอดรวมสินค้าทุกชั้นในโกดัง</h3>
    <p className="text-sm">ในไฟล์ {expected ?? "—"} {product.base_unit} · นับแล้ว {counted ?? 0} {product.base_unit}</p>
    {expected === null ? <p className={mismatchStyle}>ไม่พบสินค้านี้ในไฟล์ของโกดัง</p>
      : valid && <p className={total === expected ? matchStyle : mismatchStyle}>
        หากบันทึก ยอดรวม {total} {product.base_unit} · {countComparisonLabel(expected, total)}
      </p>}
    {data.shelves.some(row => row.shelf_code) && <details className="text-sm text-m3-grey-600">
      <summary className="cursor-pointer">ดูจำนวนแยกตามชั้น</summary>
      {data.shelves.filter(row => row.shelf_code).map(row => <p key={row.shelf_code} className="py-1">
        {row.shelf_code} · ในไฟล์ {row.expected_qty ?? "—"} · นับแล้ว {row.counted_qty ?? "—"} {product.base_unit}
      </p>)}
    </details>}
  </section>;
}

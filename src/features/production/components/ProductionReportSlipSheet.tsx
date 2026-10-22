import React from "react";
import type { ProductionReportSlip } from "@/features/production/lib/production-report-print";
import { formatDateTime, formatQty } from "@/features/production/components/ui";

const signed = (n: number) => `${n > 0 ? "+" : ""}${formatQty(n)}`;

export default function ProductionReportSlipSheet({ slip }: { slip: ProductionReportSlip }) {
  return <div className="production-work-order-sheets">
    <article className="production-work-order-sheet production-report-slip print-sheet">
      <header className="production-work-order-heading">
        <div><p className="production-report-brand">Stockify</p><h1>ใบรายงานผลผลิต</h1><p>{slip.job_no}</p></div>
        <div className="production-work-order-table">โต๊ะผลิต <strong>{slip.table_no}</strong></div>
      </header>
      <div className="production-work-order-meta">
        <span>รอบที่ <strong>{slip.round_label}</strong></span>
        <span>เมื่อ <strong>{formatDateTime(slip.reported_at)}</strong></span>
        <span>ประเภท <strong>{slip.kind_label}</strong></span>
      </div>
      <section className="production-work-order-product">
        <h2>{slip.product_name}</h2><p>SKU: {slip.sku}{slip.barcode ? ` · บาร์โค้ด: ${slip.barcode}` : ""}</p>
        <p>เป้าหมาย {formatQty(slip.target_qty)} {slip.unit} · ผู้รายงาน {slip.reported_by_name}</p>
      </section>
      <table className="production-work-order-materials production-report-qty">
        <thead><tr><th>ดีรอบนี้</th><th>เสียรอบนี้</th><th>ดีสะสม / เป้า</th><th>เสียสะสม</th></tr></thead>
        <tbody><tr>
          <td>{signed(slip.good_qty)} {slip.unit}</td><td>{signed(slip.defect_qty)} {slip.unit}</td>
          <td>{formatQty(slip.cumulative_good)} / {formatQty(slip.target_qty)} {slip.unit}</td><td>{formatQty(slip.cumulative_defect)} {slip.unit}</td>
        </tr></tbody>
      </table>
      {slip.reasons.length > 0 && <dl className="production-report-reasons">
        {slip.reasons.map(r => <div key={r.label}><dt>{r.label}</dt><dd>{r.value}</dd></div>)}
      </dl>}
      {slip.materials.length > 0 && <>
        <h3>วัตถุดิบใช้จริง / ของเสีย{slip.receipt_location_code ? ` · รับสินค้าดี: โกดัง 2 · ${slip.receipt_location_code}` : ""}</h3>
        <table className="production-work-order-materials">
          <thead><tr><th className="production-work-order-index">ลำดับ</th><th>วัตถุดิบ</th><th className="production-report-num">ใช้จริง</th><th className="production-report-num">เสีย</th><th className="production-report-num">รวมตัด</th><th>หน่วย</th><th>สาเหตุ</th></tr></thead>
          <tbody>{slip.materials.map((m, i) => <tr key={`${m.sku}-${i}`}>
            <td className="production-work-order-index">{i + 1}</td>
            <td><strong>{m.sku}</strong>{m.name && <div>{m.name}</div>}</td>
            <td className="production-report-num">{formatQty(m.used_qty)}</td><td className="production-report-num">{formatQty(m.scrap_qty)}</td>
            <td className="production-report-num">{formatQty(m.total_qty)}</td><td>{m.unit}</td><td>{m.cause || "-"}</td>
          </tr>)}</tbody>
        </table>
      </>}
      <footer className="production-report-signatures">
        <div><span>..............................................</span><p>ผู้รายงาน ({slip.reported_by_name})</p></div>
        <div><span>..............................................</span><p>ผู้ตรวจสอบ</p></div>
      </footer>
    </article>
  </div>;
}

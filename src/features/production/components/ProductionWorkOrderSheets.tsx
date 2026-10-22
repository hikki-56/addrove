import type { ProductionPrintJob } from "@/features/production/lib/production-print";
import { PRODUCTION_JOB_STATUS_LABELS } from "@/types/production";

const number = (value: number) => value.toLocaleString("th-TH", { maximumFractionDigits: 3 });
const date = (value: string) => new Date(`${value}T00:00:00+07:00`).toLocaleDateString("th-TH", {
  day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Bangkok",
});

export default function ProductionWorkOrderSheets({ entries }: { entries: ProductionPrintJob[] }) {
  return <div className="production-work-order-sheets">
    {entries.map(({ job, quantity, materials, issues }) => <article className="production-work-order-sheet print-sheet" key={job.job_no}>
      <header className="production-work-order-heading">
        <div><h1>ใบงานผลิต</h1><p>{job.job_no}</p></div>
        <div className="production-work-order-table">โต๊ะผลิต <strong>{job.table_no}</strong></div>
      </header>
      <div className="production-work-order-meta"><span>วันที่ผลิต <strong>{date(job.production_date)}</strong></span><span>สถานะ {PRODUCTION_JOB_STATUS_LABELS[job.status]}</span></div>
      <section className="production-work-order-product">
        <h2>{job.product_name}</h2><p>SKU: {job.sku}{job.barcode ? ` · บาร์โค้ด: ${job.barcode}` : ""}</p>
      </section>
      <h3>วัตถุดิบสำหรับผลิตเพิ่ม {number(quantity)} {job.unit} · โกดัง 2</h3>
      <p className="production-work-order-bom">สูตร {job.material_plan?.snapshot.bom_id || "—"}</p>
      {issues.length > 0 && <p className="production-work-order-error" role="alert">{issues.join(" · ")}</p>}
      <table className="production-work-order-materials">
        <thead><tr><th className="production-work-order-index">ลำดับ</th><th>วัตถุดิบ</th><th className="production-work-order-qty">จำนวนใช้ตามสูตร</th><th>ตำแหน่งวัตถุดิบ · โกดัง 2</th></tr></thead>
        <tbody>{materials.map((item, index) => <tr key={item.item_id}>
          <td className="production-work-order-index">{index + 1}</td>
          <td><strong>{item.sku}</strong><div>{item.name}</div></td>
          <td className="production-work-order-qty">{item.stock_qty === null ? "—" : number(item.stock_qty)} {item.stock_unit}</td>
          <td>{item.locations.length ? item.locations.map(location => <div className="production-work-order-location" key={location.location_id}>
            <strong>{location.location_code || location.location_name || "ไม่ระบุตำแหน่ง"}</strong>
            <span>คงเหลือ {number(location.quantity)} {item.stock_unit}</span>
          </div>) : "ไม่พบสต็อก"}</td>
        </tr>)}</tbody>
      </table>
      <footer className="production-work-order-signature">ผู้ตรวจสอบ..........................</footer>
      {job.note && <p className="production-work-order-note">หมายเหตุ: {job.note}</p>}
    </article>)}
  </div>;
}

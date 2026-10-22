import type { ProductionMaterialPlan, ProductionMaterialStockLocation } from "@/types/production-bom";

export default function MaterialStockLocations({ locations, productId, unit }: {
  locations?: ProductionMaterialStockLocation[];
  productId: string;
  unit: string;
}) {
  const rows = locations?.filter(l => l.product_id === productId) || [];
  return <div className="text-xs">
    <p className="font-semibold text-slate-500">ตำแหน่ง · โกดัง 2</p>
    {rows.length ? <ul className="mt-1 space-y-1">
      {rows.map(l => <li key={l.location_id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded border border-emerald-100 bg-white px-2 py-1">
        <span className="min-w-0 break-all font-mono font-bold text-emerald-900">{l.location_code || l.location_name || "ไม่ระบุตำแหน่ง"}</span>
        <span className="text-slate-600">คงเหลือ <strong className="font-mono">{Number(l.quantity).toLocaleString("th-TH", { maximumFractionDigits: 3 })}</strong> {unit}</span>
      </li>)}
    </ul> : <p className="mt-1 text-slate-400">ไม่พบสต็อก</p>}
  </div>;
}

export function ProductionMaterialSummary({ plan }: { plan: ProductionMaterialPlan }) {
  return <section className="space-y-3 rounded-xl border border-[#E8ECEA] bg-slate-50 p-4">
    <h2 className="text-sm font-bold text-slate-900">วัตถุดิบ · {plan.snapshot.bom_id}</h2>
    {plan.snapshot.items.map(item => <div key={item.item_id} className="space-y-1.5">
      <p className="text-sm font-semibold text-slate-800">{item.sku} · {item.name}</p>
      <MaterialStockLocations locations={plan.stock_locations} productId={item.product_id} unit={item.stock_unit} />
    </div>)}
  </section>;
}

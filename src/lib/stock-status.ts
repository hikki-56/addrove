export type StockStatus = "NORMAL" | "LOW" | "OUT" | "NEGATIVE";

export const STOCK_STATUS_META: Record<
  StockStatus,
  { label: string; badge: string; dot: string }
> = {
  NORMAL: {
    label: "ปกติ",
    badge: "bg-emerald-50 text-emerald-700 border-emerald-200",
    dot: "bg-emerald-500",
  },
  LOW: {
    label: "ต่ำกว่าขั้นต่ำ",
    badge: "bg-amber-50 text-amber-700 border-amber-200",
    dot: "bg-amber-500",
  },
  OUT: {
    label: "หมด",
    badge: "bg-slate-100 text-slate-600 border-slate-200",
    dot: "bg-slate-400",
  },
  NEGATIVE: {
    label: "ติดลบ",
    badge: "bg-rose-50 text-rose-700 border-rose-200",
    dot: "bg-rose-500",
  },
};

export function getStockStatus(
  quantity: number,
  minimumStock: number
): StockStatus {
  if (quantity < 0) return "NEGATIVE";
  if (quantity === 0) return "OUT";
  if (minimumStock > 0 && quantity <= minimumStock) return "LOW";
  return "NORMAL";
}

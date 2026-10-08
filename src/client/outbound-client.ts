"use client";

/**
 * Client helper สำหรับเรียก API ของโมดูลส่งของออก
 * (แนบ x-tab-token ตามระบบ auth แบบ per-tab ของแอป ถ้ามี)
 */

export function tabTokenHeader(): Record<string, string> {
  if (typeof window !== "undefined" && (window as any).__tabToken) {
    return { "x-tab-token": (window as any).__tabToken };
  }
  return {};
}

export async function requestWithMessage<T = Record<string, unknown>>(
  url: string,
  init?: RequestInit
): Promise<{ data: T; message: string }> {
  const res = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...tabTokenHeader(),
      ...(init?.headers || {}),
    },
  });
  const json = await res.json().catch(() => ({ success: false, message: "ตอบกลับไม่ใช่ JSON" }));
  if (!res.ok || json?.success === false) {
    throw new Error(json?.message || `ผิดพลาด (${res.status})`);
  }
  return { data: json.data as T, message: (json.message as string) || "สำเร็จ" };
}

// ---------- ชนิดข้อมูลหน้าจอ (compact ของ note JSON ฝั่ง server) ----------

export interface BillListItem {
  document_id: string;
  document_no: string;
  express_bill_no: string;
  customer?: string;
  warehouse_id: string;
  outbound_status: string;
  status_label: string;
  item_count: number;
  total_qty_required: number;
  total_qty_picked: number;
  problem_count: number;
  box_count: number;
  created_at: string;
  pick_assigned_to_name?: string;
}

export interface BillDetailData {
  doc: {
    document_id: string;
    document_no: string;
    reference_no: string;
    status: string;
    created_at: string;
  };
  note: {
    outbound_status: string;
    express_bill_no: string;
    customer?: string;
    warehouse_id: string;
    items: Array<{
      sku: string;
      product_id?: string;
      barcode?: string;
      product_name?: string;
      qty_required: number;
      qty_picked: number;
      status: string;
      location_hint?: string;
      location_id?: string;
    }>;
    pick_assigned_to_name?: string;
    pick_started_at?: string;
    pick_completed_at?: string;
    issue_document_no?: string;
    approved_by?: string;
    approved_at?: string;
    exceptions: Array<{
      type: string;
      sku: string;
      reported_qty?: number;
      note?: string;
      reported_by?: string;
      reported_by_name?: string;
      reported_at: string;
      resolved_at?: string;
      resolution?: string;
    }>;
    hold_reason?: string;
    cancel_reason?: string;
    box_document_ids: string[];
    q_assignments?: Array<{ q_code: string; items: Array<{ sku: string; qty: number }> }>;
  };
  boxes: Array<{
    document_id: string;
    document_no: string;
    box_no: number;
    box_status: string;
    item_count: number;
    total_qty: number;
    shipment_no?: string;
    sticker_printed: boolean;
  }>;
  availability: Array<{
    sku: string;
    on_hand: number;
    reserved: number;
    available: number;
    requested?: number;
    short?: number;
  }>;
  reserving: boolean;
}

export interface ShipmentListItem {
  document_id: string;
  document_no: string;
  shipment_status: string;
  truck_plate: string;
  destination?: string;
  bill_count: number;
  expected_boxes: number;
  loaded_boxes: number;
  created_at: string;
  closed_at?: string;
}

export interface ShipmentDetailData {
  doc: { document_id: string; document_no: string };
  note: {
    shipment_status: string;
    truck_plate: string;
    destination?: string;
    bill_document_ids: string[];
    expected_box_ids: string[];
    loaded_box_ids: string[];
    skip_confirmations: Array<Record<string, unknown>>;
    express_synced_at?: string;
  };
  bills: Array<{ bill_document_no: string; express_bill_no: string; customer?: string; outbound_status: string }>;
  boxes: Array<{
    box_id: string;
    box_code: string;
    box_no: number;
    box_status: string;
    bill_document_no: string;
    total_qty: number;
    loaded_at?: string;
  }>;
  missing: Array<{ box_id: string; box_code: string; box_no: number; bill_document_no: string }>;
}

// ---------- ใบงานกล่อง Q (WORK_ORDER) ----------

export interface QPickViewItem {
  sku: string;
  product_id?: string;
  barcode?: string;
  product_name?: string;
  qty_required: number;
  qty_picked: number;
  status: string;
  location_id?: string;
  location_wh?: string;
  remaining: number;
}

export interface QPickViewData {
  document_id: string;
  document_no: string;
  q_code: string;
  q_status: string;
  title?: string;
  items: QPickViewItem[];
}

export interface WorkOrderSummaryItem {
  document_id: string;
  document_no: string;
  title?: string;
  outbound_status: string;
  warehouse_id: string;
  q_total: number;
  q_done: number;
  item_total_qty: number;
  item_picked_qty: number;
  created_at: string;
  sent_at?: string;
  cancel_reason?: string;
}

export interface WorkOrderDetailData {
  document_id: string;
  document_no: string;
  created_at: string;
  outbound_status: string;
  warehouse_id: string;
  title?: string;
  items: Array<{ sku: string; qty_required: number; qty_picked: number; status: string }>;
  q_boxes: Array<{
    q_code: string;
    status: string;
    items: QPickViewItem[];
    picked_by_name?: string;
    started_at?: string;
    completed_at?: string;
  }>;
  exceptions: Array<Record<string, unknown>>;
  issue_document_no?: string;
  sent_by?: string;
  sent_at?: string;
  cancel_reason?: string;
}

export interface BusyQItemProduct {
  sku: string;
  product_name?: string;
  barcode?: string;
  qty: number;
  qty_picked?: number;
  status?: string;
  location?: string;
}

export interface BusyQItem {
  q_code: string;
  document_id: string;
  document_no: string;
  document_type?: "WORK_ORDER" | "BILL";
  customer?: string;
  outbound_status?: string;
  items?: BusyQItemProduct[];
}

export interface QHistoryRow {
  document_no: string;
  outbound_status: string;
  q_status: string;
  source?: "WORK_ORDER" | "BILL";
  title?: string;
  item_count: number;
  created_at: string;
  completed_at?: string;
}

export const outboundApi = {
  // ---------- bills ----------
  listBills: () =>
    requestWithMessage<{ bills: BillListItem[]; counts: Record<string, number> }>("/api/outbound/bills"),

  getBill: (idOrNo: string) =>
    requestWithMessage<BillDetailData>(`/api/outbound/bills/${encodeURIComponent(idOrNo)}`),

  billAction: (idOrNo: string, body: Record<string, unknown>) =>
    requestWithMessage<Record<string, unknown>>(`/api/outbound/bills/${encodeURIComponent(idOrNo)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  pickAction: (idOrNo: string, body: Record<string, unknown>) =>
    requestWithMessage<Record<string, unknown>>(`/api/outbound/bills/${encodeURIComponent(idOrNo)}/pick`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  approveBill: (idOrNo: string, body: Record<string, unknown>) =>
    requestWithMessage<Record<string, unknown>>(`/api/outbound/bills/${encodeURIComponent(idOrNo)}/approve`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  boxAction: (idOrNo: string, body: Record<string, unknown>) =>
    requestWithMessage<Record<string, unknown>>(`/api/outbound/bills/${encodeURIComponent(idOrNo)}/boxes`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  getBoxes: (idOrNo: string) =>
    requestWithMessage<{
      boxes: Array<{
        document_id: string;
        document_no: string;
        bill_document_no: string;
        box_no: number;
        box_status: string;
        items: Array<{ sku: string; qty: number }>;
        total_qty: number;
        sticker_printed: boolean;
      }>;
    }>(`/api/outbound/bills/${encodeURIComponent(idOrNo)}/boxes`),

  // ---------- shipments ----------
  listShipments: () =>
    requestWithMessage<{ shipments: ShipmentListItem[] }>("/api/outbound/shipments"),

  getShipment: (idOrNo: string) =>
    requestWithMessage<ShipmentDetailData>(`/api/outbound/shipments/${encodeURIComponent(idOrNo)}`),

  createShipment: (body: { truck_plate: string; destination?: string; bill_ids: string[] }) =>
    requestWithMessage<{ document_no: string; expected_boxes: number; bill_count: number }>("/api/outbound/shipments", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  shipmentAction: (idOrNo: string, body: Record<string, unknown>) =>
    requestWithMessage<Record<string, unknown>>(`/api/outbound/shipments/${encodeURIComponent(idOrNo)}`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // ---------- ใบงานกล่อง Q ----------
  listWorkOrders: () =>
    requestWithMessage<{ workOrders: WorkOrderSummaryItem[]; busy_qs?: BusyQItem[] }>("/api/outbound/work-orders"),

  getQHistory: (qCode: string) =>
    requestWithMessage<{ q_code: string; history: QHistoryRow[] }>(
      `/api/outbound/work-orders?q_code=${encodeURIComponent(qCode)}`
    ),

  createWorkOrder: (body: Record<string, unknown>) =>
    requestWithMessage<{ document_id: string; document_no: string }>("/api/outbound/work-orders", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  getWorkOrder: (idOrNo: string) =>
    requestWithMessage<WorkOrderDetailData>(`/api/outbound/work-orders/${encodeURIComponent(idOrNo)}`),

  workOrderAction: (idOrNo: string, body: Record<string, unknown>) =>
    requestWithMessage<Record<string, unknown>>(`/api/outbound/work-orders/${encodeURIComponent(idOrNo)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  qPickAction: (body: Record<string, unknown>) =>
    requestWithMessage<Record<string, unknown>>("/api/outbound/q/pick", {
      method: "POST",
      body: JSON.stringify(body),
    }),
};

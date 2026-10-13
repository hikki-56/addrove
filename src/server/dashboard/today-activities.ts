import type { Document, Product, StockMovement, TodayActivity, TodayActivityType, Warehouse } from "@/types/models";
import type { AuditLogEntry } from "@/server/repositories/interfaces/audit.repository.interface";
import { cleanSkuCode } from "@/lib/sku";

type Metadata = Record<string, unknown>;

function metadataFor(document: Document): Metadata {
  try {
    const value: unknown = JSON.parse(document.note);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Metadata : {};
  } catch {
    return {};
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function quantity(value: unknown): number {
  const result = Number(value);
  return Number.isFinite(result) ? Math.abs(result) : 0;
}

function warehouseKey(value: string): string {
  return value.toLowerCase().replace(/^wh-?0*(\d+)$/, "wh-$1");
}

interface ActivityInput {
  activities: TodayActivity[];
  documents: Document[];
  movements: StockMovement[];
  products: Product[];
  warehouses: Warehouse[];
  auditLogs: AuditLogEntry[];
  today: string;
  productionDocumentIds: Set<string>;
  warehouseId?: string;
  resolveActor: (id: string, fallback?: string) => { actor_id: string; actor_name: string };
  dateKey: (value: string) => string;
}

// Document timestamps describe submission; successful approval logs describe approval.
// Stock totals remain exclusively calculated from movements by the caller.
export function appendDocumentActivities(input: ActivityInput): void {
  const { activities, documents, auditLogs, today, productionDocumentIds, resolveActor, dateKey } = input;
  const productMap = new Map(input.products.flatMap((product) => [
    [cleanSkuCode(product.product_id), product], [cleanSkuCode(product.sku), product],
  ] as [string, Product][]));
  const warehouseMap = new Map(input.warehouses.map((warehouse) => [warehouseKey(warehouse.warehouse_id), warehouse.warehouse_name]));
  const movementsByDocument = new Map<string, StockMovement[]>();
  for (const movement of input.movements) {
    const rows = movementsByDocument.get(movement.document_id) || [];
    rows.push(movement);
    movementsByDocument.set(movement.document_id, rows);
  }
  const receiveApprovals = new Map<string, AuditLogEntry>();
  for (const audit of [...auditLogs].sort((a, b) => a.timestamp.localeCompare(b.timestamp))) {
    if (audit.outcome === "SUCCESS" && audit.action === "STOCK_RECEIVE" && audit.resource_type === "Document" && audit.resource_id &&
      (typeof audit.metadata?.approved_movements_count === "number" || audit.metadata?.reconciled === true)) {
      // Keep the first successful approval, including one from a previous day, on retries.
      if (!receiveApprovals.has(audit.resource_id)) receiveApprovals.set(audit.resource_id, audit);
    }
  }

  for (const document of documents) {
    if (productionDocumentIds.has(document.document_id)) continue;
    const meta = metadataFor(document);
    const documentMovements = movementsByDocument.get(document.document_id) || [];
    if (input.warehouseId) {
      const key = warehouseKey(input.warehouseId);
      const warehouseIds = [meta.warehouse_id, meta.from_warehouse_id, meta.to_warehouse_id].map(text);
      const approvalWarehouse = receiveApprovals.get(document.document_id)?.warehouse_id;
      if (!warehouseIds.some((id) => warehouseKey(id) === key) &&
        !documentMovements.some((movement) => warehouseKey(movement.warehouse_id) === key) &&
        warehouseKey(approvalWarehouse || "") !== key) continue;
    }
    const productNames = new Set<string>();
    const units = new Set<string>();
    let total = 0;
    const lines = Array.isArray(meta.lines) && meta.lines.length ? meta.lines : Array.isArray(meta.items) ? meta.items : [];
    for (const line of lines) {
      if (!line || typeof line !== "object" || Array.isArray(line)) continue;
      const row = line as Metadata;
      const product = productMap.get(cleanSkuCode(text(row.product_id) || text(row.sku)));
      const name = product?.product_name || text(row.product_name);
      if (name) productNames.add(name);
      units.add(product?.base_unit || text(row.base_unit) || text(row.unit) || "ชิ้น");
      total += quantity(row.qty ?? row.qty_required ?? row.expected_qty);
    }
    if (!lines.length && Array.isArray(meta.rows)) {
      for (const row of meta.rows) {
        if (!Array.isArray(row)) continue;
        const product = productMap.get(cleanSkuCode(text(row[0])));
        const name = product?.product_name || text(row[3]);
        if (name) productNames.add(name);
        units.add(product?.base_unit || text(row[6]) || "ชิ้น");
        total += quantity(row[4] || row[5]);
      }
    }
    if (!lines.length && !Array.isArray(meta.rows)) {
      const product = productMap.get(cleanSkuCode(text(meta.product_id) || text(meta.sku)));
      const name = product?.product_name || text(meta.product_name);
      if (name) productNames.add(name);
      units.add(product?.base_unit || text(meta.base_unit) || "ชิ้น");
      total = quantity(meta.qty);
    }
    const warehouseIds = [text(meta.from_warehouse_id), text(meta.to_warehouse_id), text(meta.warehouse_id)].filter(Boolean);
    const warehouseNames = warehouseIds.map((id) => warehouseMap.get(warehouseKey(id))).filter(Boolean);
    const summary = {
      document_id: document.document_id,
      document_no: document.document_no,
      product_name: productNames.size === 1 ? [...productNames][0] : productNames.size ? `${productNames.size} รายการสินค้า` : undefined,
      quantity: total,
      unit: units.size === 1 ? [...units][0] : "ชิ้น",
      warehouse_name: warehouseNames.join(" → ") || text(meta.target_sheet) || undefined,
    };
    const add = (type: TodayActivityType, label: string, id: string, timestamp: string, fallback?: string) => {
      if (dateKey(timestamp) !== today) return;
      activities.push({ ...summary, id: `activity:${type}:${document.document_id}`,
        ...resolveActor(id, fallback), action_type: type, action_label: label, created_at: timestamp });
    };

    const creatorName = document.created_by_name || text(meta.created_by_name);
    switch (document.document_type) {
      case "RECEIVE":
        add("RECEIVE_REQUEST", "ทำรายการรับเข้า", document.created_by, document.created_at, creatorName);
        break;
      case "ISSUE":
        if (!documentMovements.length) add("ISSUE_REQUEST", "ทำรายการเบิก", document.created_by, document.created_at, creatorName);
        break;
      case "TRANSFER":
        add("DOCUMENT_CREATE", "สร้างใบโอนสินค้า", document.created_by, document.created_at, creatorName);
        add("TRANSFER_REQUEST", "ทำรายการโอนสินค้า (ส่งอนุมัติ)", text(meta.mover_user_id),
          text(meta.moved_at), text(meta.moved_by));
        if (text(meta.moved_at) && text(meta.completed_at)) {
          const posted = activities.filter((entry) => entry.document_id === document.document_id && entry.action_type === "TRANSFER");
          for (const activity of posted) activities.splice(activities.indexOf(activity), 1);
          add("APPROVE_TRANSFER", "อนุมัติโอนสินค้า", text(meta.completed_by) || posted[0]?.actor_id || "",
            text(meta.completed_at), text(meta.completed_by_name));
        }
        // Transfer movements are performed by the completing employee, not the creator.
        for (const activity of activities.filter((entry) => entry.document_id === document.document_id && entry.action_type === "TRANSFER")) {
          const completedBy = text(meta.completed_by) || activity.actor_id;
          Object.assign(activity, resolveActor(completedBy, text(meta.completed_by_name)));
        }
        break;
      case "RECEIVE_PLAN":
        add("DOCUMENT_CREATE", "สร้างใบแผนรับเข้า", document.created_by, document.created_at, creatorName);
        break;
      case "WORK_ORDER":
        add("DOCUMENT_CREATE", "สร้างใบงาน", document.created_by, document.created_at, creatorName);
        break;
      case "OUTBOUND_ORDER":
        add("DOCUMENT_CREATE", "สร้างใบเบิกสินค้า", document.created_by, document.created_at, creatorName);
        add("ISSUE_REQUEST", "ทำรายการเบิก (ส่งอนุมัติ)", text(meta.pick_completed_by) || text(meta.pick_assigned_to),
          text(meta.pick_completed_at), text(meta.pick_completed_by_name) || text(meta.pick_assigned_to_name));
        add("APPROVE_ISSUE", "อนุมัติเบิก", text(meta.approved_by_id) || text(meta.approved_by),
          text(meta.approved_at), text(meta.approved_by));
        // The generated ISSUE document records the same approval, not another employee action.
        if (text(meta.approved_at) && text(meta.issue_document_id)) {
          const issueNos = text(meta.issue_document_no).split(",").map((no) => no.trim()).filter(Boolean);
          const generatedIds = new Set(documents.filter((entry) => entry.document_type === "ISSUE" &&
            (entry.document_id === text(meta.issue_document_id) || issueNos.includes(entry.document_no))).map((entry) => entry.document_id));
          for (let index = activities.length - 1; index >= 0; index--) {
            if (activities[index].action_type === "ISSUE" && generatedIds.has(activities[index].document_id || "")) activities.splice(index, 1);
          }
        }
        break;
    }

    const approval = receiveApprovals.get(document.document_id);
    if (approval && document.document_type === "RECEIVE") {
      const movementActivities = activities.filter((entry) => entry.document_id === document.document_id && entry.action_type === "RECEIVE");
      // Remove the stock posting event even when a retry was reconciled on another day.
      for (const activity of movementActivities) activities.splice(activities.indexOf(activity), 1);
      add("APPROVE_RECEIVE", "อนุมัติรับเข้า", approval.actor_id, approval.timestamp, text(approval.metadata?.actor_name));
      const event = activities.find((entry) => entry.id === `activity:APPROVE_RECEIVE:${document.document_id}`);
      if (event && movementActivities.length) {
        event.quantity = movementActivities.reduce((sum, entry) => sum + entry.quantity, 0);
        event.product_name ||= movementActivities[0].product_name;
        event.warehouse_name ||= movementActivities[0].warehouse_name;
      }
    }
  }
}

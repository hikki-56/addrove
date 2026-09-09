import type {
  DashboardChartPoint,
  DashboardStats,
  Document,
  Product,
  StockMovement,
  TodayActivity,
  TodayActivityType,
  User,
  Warehouse,
} from "@/types/models";
import { cleanSkuCode } from "@/lib/services/stock/shared";

export const DASHBOARD_TIME_ZONE = "Asia/Bangkok";
export const DASHBOARD_CHART_DAYS = 90;

interface ProductionItemMetadata {
  fg_name?: string;
  product_name?: string;
  fg_unit?: string;
  unit?: string;
  quantity?: number | string;
  target_warehouse_id?: string;
  target_warehouse_name?: string;
}

interface ProductionMetadata {
  type?: string;
  order_no?: string;
  status?: string;
  total_fg_qty?: number | string;
  total_qty?: number | string;
  created_at?: string;
  created_by_name?: string;
  target_warehouse_id?: string;
  target_warehouse_name?: string;
  items?: ProductionItemMetadata[];
  rows?: unknown[];
}

interface ActivityAccumulator {
  actionType: TodayActivityType;
  documentId: string;
  documentNo: string;
  actorId: string;
  createdAt: string;
  quantity: number;
  productNames: Set<string>;
  units: Set<string>;
  warehouseNames: Set<string>;
  hasOutbound: boolean;
}

export interface DashboardAggregationInput {
  movements: StockMovement[];
  documents: Document[];
  products: Product[];
  users: User[];
  warehouses: Warehouse[];
  now?: Date;
}

export type OperationalDashboardStats = Pick<
  DashboardStats,
  | "received_today"
  | "received_document_count_today"
  | "issued_today"
  | "issued_document_count_today"
  | "produced_today"
  | "production_order_count_today"
  | "chart_data"
  | "today_activities"
  | "pending_approval_count"
>;

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[\s,]/g, "");
  if (!normalized) return null;
  const result = Number(normalized);
  return Number.isFinite(result) ? result : null;
}

function parseMetadata(note: string): ProductionMetadata {
  if (!note.trim().startsWith("{")) return {};
  try {
    const parsed: unknown = JSON.parse(note);
    return parsed && typeof parsed === "object" ? (parsed as ProductionMetadata) : {};
  } catch {
    return {};
  }
}

function canonicalWarehouseId(value: string): string {
  const match = value.trim().toLowerCase().match(/^wh-?0*(\d+)$/);
  return match ? `wh-${Number(match[1])}` : value.trim().toLowerCase();
}

function canonicalProductionKey(document: Document, metadata: ProductionMetadata): string {
  const orderNo = metadata.order_no || document.reference_no || document.document_no;
  return (orderNo || document.document_id).trim().toLowerCase();
}

function isProductionDocument(document: Document, metadata = parseMetadata(document.note)): boolean {
  const identifiers = [
    document.document_id,
    document.document_no,
    document.reference_no,
    metadata.order_no,
  ]
    .filter(Boolean)
    .map((value) => String(value).toUpperCase());

  return (
    metadata.type?.toUpperCase() === "PRODUCTION_ORDER" ||
    identifiers.some((value) => value.startsWith("PRD-") || value.includes("DOC-PRD-"))
  );
}

function isCompletedProduction(document: Document, metadata: ProductionMetadata): boolean {
  const status = String(metadata.status || document.status || "").toUpperCase();
  return ["COMPLETED", "POSTED", "APPROVED"].includes(status);
}

function productionQuantity(metadata: ProductionMetadata): number {
  const explicit = finiteNumber(metadata.total_fg_qty);
  if (explicit !== null) return explicit;

  const itemsTotal = Array.isArray(metadata.items)
    ? metadata.items.reduce((sum, item) => sum + (finiteNumber(item.quantity) ?? 0), 0)
    : 0;
  if (itemsTotal !== 0) return itemsTotal;

  return finiteNumber(metadata.total_qty) ?? 0;
}

export function getBangkokDateKey(value: string | Date): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DASHBOARD_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const valueFor = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${valueFor("year")}-${valueFor("month")}-${valueFor("day")}`;
}

function dateKeysEndingAt(endDateKey: string, days: number): string[] {
  const [year, month, day] = endDateKey.split("-").map(Number);
  const endUtc = Date.UTC(year, month - 1, day);
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(endUtc - (days - 1 - index) * 86_400_000);
    return date.toISOString().slice(0, 10);
  });
}

function deduplicateMovements(movements: StockMovement[]): StockMovement[] {
  const unique = new Map<string, StockMovement>();
  for (const movement of movements) {
    const key =
      movement.movement_id ||
      movement.idempotency_key ||
      [
        movement.document_id,
        movement.product_id,
        movement.warehouse_id,
        movement.location_id,
        movement.movement_type,
        movement.qty_change,
        movement.created_at,
      ].join("|");
    if (!unique.has(key)) unique.set(key, movement);
  }
  return [...unique.values()];
}

function deduplicateDocuments(documents: Document[]): Document[] {
  const unique = new Map<string, Document>();
  for (const document of documents) {
    const existing = unique.get(document.document_id);
    if (!existing || document.created_at > existing.created_at) {
      unique.set(document.document_id, document);
    }
  }
  return [...unique.values()];
}

function isPendingApproval(document: Document, metadata: ProductionMetadata): boolean {
  if (isProductionDocument(document, metadata)) return false;
  const status = String(document.status || "").trim().toUpperCase();
  const isReceive =
    document.document_type === "RECEIVE" ||
    document.document_no.toUpperCase().startsWith("RCV-") ||
    Array.isArray(metadata.rows);
  return isReceive && ["", "DRAFT", "NEW", "PENDING", "WAITING_APPROVAL"].includes(status);
}

function displayActorName(actorId: string, userMap: Map<string, User>, fallback?: string): string {
  const user = userMap.get(actorId.trim().toLowerCase());
  const fromUser = user?.full_name?.trim() || user?.email?.split("@")[0]?.trim();
  if (fromUser) return fromUser;
  if (fallback?.trim()) return fallback.trim();

  const looksLikeId =
    /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(actorId) ||
    /^(usr|id|user)-/i.test(actorId) ||
    /^admin$/i.test(actorId);
  return actorId && !looksLikeId ? actorId : "ไม่ทราบผู้ทำรายการ";
}

function newestTimestamp(first: string, second: string): string {
  return first > second ? first : second;
}

function actionLabel(actionType: TodayActivityType): string {
  return {
    RECEIVE: "รับสินค้า",
    ISSUE: "เบิกสินค้า",
    TRANSFER: "โอนสินค้า",
    PRODUCTION: "ผลิตสินค้า",
    ADJUST: "ปรับยอด",
  }[actionType];
}

function createActivityAccumulator(
  actionType: TodayActivityType,
  movement: StockMovement,
  document: Document | undefined
): ActivityAccumulator {
  return {
    actionType,
    documentId: movement.document_id,
    documentNo: document?.document_no || "",
    actorId: document?.created_by || movement.created_by,
    createdAt: movement.created_at,
    quantity: 0,
    productNames: new Set<string>(),
    units: new Set<string>(),
    warehouseNames: new Set<string>(),
    hasOutbound: false,
  };
}

export function aggregateDashboardOperations({
  movements,
  documents,
  products,
  users,
  warehouses,
  now = new Date(),
}: DashboardAggregationInput): OperationalDashboardStats {
  const today = getBangkokDateKey(now);
  const dateKeys = dateKeysEndingAt(today, DASHBOARD_CHART_DAYS);
  const chartMap = new Map<string, DashboardChartPoint>(
    dateKeys.map((date) => [date, { date, received: 0, issued: 0, produced: 0 }])
  );
  const uniqueDocuments = deduplicateDocuments(documents);
  const documentMap = new Map(uniqueDocuments.map((document) => [document.document_id, document]));
  const userMap = new Map(users.map((user) => [user.user_id.trim().toLowerCase(), user]));
  const productMap = new Map<string, Product>();
  for (const product of products) {
    productMap.set(product.product_id.trim().toLowerCase(), product);
    productMap.set(cleanSkuCode(product.sku), product);
  }
  const warehouseMap = new Map<string, string>();
  for (const warehouse of warehouses) {
    warehouseMap.set(warehouse.warehouse_id.trim().toLowerCase(), warehouse.warehouse_name);
    warehouseMap.set(canonicalWarehouseId(warehouse.warehouse_id), warehouse.warehouse_name);
  }

  // เอกสารผลิตทุกสถานะต้องถูกแยกออกจากรับเข้า/เบิกปกติเสมอ
  // (แม้คำสั่งผลิตยังไม่ COMPLETED — RECEIVE/ISSUE_OUT ของมันก็ไม่ใช่รายการรับ-เบิกธรรมดา)
  const productionDocumentIds = new Set<string>();
  for (const document of uniqueDocuments) {
    if (isProductionDocument(document)) {
      productionDocumentIds.add(document.document_id);
    }
  }

  // ส่วน "ผลิตวันนี้" นับเฉพาะคำสั่งผลิตที่สำเร็จจริง (COMPLETED/POSTED/APPROVED)
  const productionOrders = new Map<
    string,
    { document: Document; metadata: ProductionMetadata; quantity: number; date: string }
  >();
  for (const document of uniqueDocuments) {
    const metadata = parseMetadata(document.note);
    if (!isProductionDocument(document, metadata) || !isCompletedProduction(document, metadata)) continue;
    const key = canonicalProductionKey(document, metadata);
    const date = getBangkokDateKey(metadata.created_at || document.created_at || document.document_date);
    const candidate = { document, metadata, quantity: productionQuantity(metadata), date };
    const existing = productionOrders.get(key);
    if (!existing || candidate.document.created_at > existing.document.created_at) {
      productionOrders.set(key, candidate);
    }
  }

  let producedToday = 0;
  let productionOrderCountToday = 0;
  const activities: TodayActivity[] = [];
  for (const [key, order] of productionOrders) {
    const chartPoint = chartMap.get(order.date);
    if (chartPoint) chartPoint.produced += order.quantity;
    if (order.date !== today) continue;

    producedToday += order.quantity;
    productionOrderCountToday += 1;
    const items = Array.isArray(order.metadata.items) ? order.metadata.items : [];
    const productNames = items
      .map((item) => item.fg_name || item.product_name || "")
      .filter(Boolean);
    const warehouseNames = [
      order.metadata.target_warehouse_name,
      ...items.map((item) => item.target_warehouse_name),
    ].filter((name): name is string => Boolean(name));
    const unit = items.length === 1 ? items[0].fg_unit || items[0].unit || "ชิ้น" : "ชิ้น";
    const actorId = order.document.created_by;
    activities.push({
      id: `production:${key}`,
      actor_id: actorId,
      actor_name: displayActorName(actorId, userMap, order.metadata.created_by_name),
      action_type: "PRODUCTION",
      action_label: actionLabel("PRODUCTION"),
      document_id: order.document.document_id,
      document_no: order.metadata.order_no || order.document.reference_no || order.document.document_no,
      product_name:
        productNames.length === 1
          ? productNames[0]
          : productNames.length > 1
            ? `${productNames.length} รายการสินค้า`
            : undefined,
      quantity: order.quantity,
      unit,
      warehouse_name: warehouseNames[0] || "โกดัง2",
      created_at: order.metadata.created_at || order.document.created_at,
    });
  }

  let receivedToday = 0;
  let issuedToday = 0;
  const receivedDocumentIds = new Set<string>();
  const issuedDocumentIds = new Set<string>();
  const activityGroups = new Map<string, ActivityAccumulator>();
  const uniqueMovements = deduplicateMovements(movements);

  for (const movement of uniqueMovements) {
    const date = getBangkokDateKey(movement.created_at);
    const isProduction = productionDocumentIds.has(movement.document_id);
    const chartPoint = chartMap.get(date);
    const document = documentMap.get(movement.document_id);
    const quantity = Math.abs(movement.qty_change);

    if (movement.movement_type === "RECEIVE" && !isProduction) {
      if (chartPoint) chartPoint.received += movement.qty_change;
      if (date === today) {
        receivedToday += movement.qty_change;
        receivedDocumentIds.add(movement.document_id || movement.movement_id);
      }
    }

    if (
      ["ISSUE", "ISSUE_OUT", "TRANSFER_OUT"].includes(movement.movement_type) &&
      !isProduction
    ) {
      if (chartPoint) chartPoint.issued += quantity;
      if (date === today) {
        issuedToday += quantity;
        issuedDocumentIds.add(movement.document_id || movement.movement_id);
      }
    }

    if (date !== today || isProduction) continue;

    let type: TodayActivityType | null = null;
    if (movement.movement_type === "RECEIVE") type = "RECEIVE";
    else if (["ISSUE", "ISSUE_OUT"].includes(movement.movement_type)) type = "ISSUE";
    else if (["TRANSFER_OUT", "TRANSFER_IN", "MOVE_OUT", "MOVE_IN"].includes(movement.movement_type)) {
      type = "TRANSFER";
    } else if (movement.movement_type === "ADJUST") type = "ADJUST";
    if (!type) continue;

    const groupKey = `${type}:${movement.document_id || movement.movement_id}`;
    const group =
      activityGroups.get(groupKey) || createActivityAccumulator(type, movement, document);
    const product =
      productMap.get(movement.product_id.trim().toLowerCase()) ||
      productMap.get(cleanSkuCode(movement.product_id));
    if (product?.product_name) group.productNames.add(product.product_name);
    if (product?.base_unit) group.units.add(product.base_unit);
    const warehouseName =
      warehouseMap.get(movement.warehouse_id.trim().toLowerCase()) ||
      warehouseMap.get(canonicalWarehouseId(movement.warehouse_id));
    if (warehouseName) group.warehouseNames.add(warehouseName);
    group.createdAt = newestTimestamp(group.createdAt, movement.created_at);

    const isInboundTransfer = ["TRANSFER_IN", "MOVE_IN"].includes(movement.movement_type);
    if (!isInboundTransfer) {
      group.quantity += quantity;
      if (type === "TRANSFER") group.hasOutbound = true;
    }
    activityGroups.set(groupKey, group);
  }

  for (const [key, group] of activityGroups) {
    if (group.actionType === "TRANSFER" && !group.hasOutbound) continue;
    const productNames = [...group.productNames];
    const units = [...group.units];
    const document = documentMap.get(group.documentId);
    activities.push({
      id: `activity:${key}`,
      actor_id: group.actorId,
      actor_name: displayActorName(group.actorId, userMap),
      action_type: group.actionType,
      action_label: actionLabel(group.actionType),
      document_id: group.documentId || undefined,
      document_no: group.documentNo || document?.document_no || undefined,
      product_name:
        productNames.length === 1
          ? productNames[0]
          : productNames.length > 1
            ? `${productNames.length} รายการสินค้า`
            : undefined,
      quantity: group.quantity,
      unit: units.length === 1 ? units[0] : "ชิ้น",
      warehouse_name: [...group.warehouseNames].join(" → ") || undefined,
      created_at: group.createdAt,
    });
  }

  activities.sort((a, b) => b.created_at.localeCompare(a.created_at));

  return {
    received_today: receivedToday,
    received_document_count_today: receivedDocumentIds.size,
    issued_today: issuedToday,
    issued_document_count_today: issuedDocumentIds.size,
    produced_today: producedToday,
    production_order_count_today: productionOrderCountToday,
    chart_data: dateKeys.map((date) => chartMap.get(date)!),
    today_activities: activities,
    pending_approval_count: uniqueDocuments.filter((document) =>
      isPendingApproval(document, parseMetadata(document.note))
    ).length,
  };
}

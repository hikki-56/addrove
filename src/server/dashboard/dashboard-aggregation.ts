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
import { cleanSkuCode } from "@/server/services/stock/shared";

export const DASHBOARD_TIME_ZONE = "Asia/Bangkok";
export const DASHBOARD_CHART_DAYS = 90;

interface DocumentNoteMetadata {
  type?: string;
  order_no?: string;
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
  | "chart_data"
  | "today_activities"
  | "pending_approval_count"
>;

function parseMetadata(note: string): DocumentNoteMetadata {
  if (!note.trim().startsWith("{")) return {};
  try {
    const parsed: unknown = JSON.parse(note);
    return parsed && typeof parsed === "object" ? (parsed as DocumentNoteMetadata) : {};
  } catch {
    return {};
  }
}

function canonicalWarehouseId(value: string): string {
  const match = value.trim().toLowerCase().match(/^wh-?0*(\d+)$/);
  return match ? `wh-${Number(match[1])}` : value.trim().toLowerCase();
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

function isPendingApproval(document: Document, metadata: DocumentNoteMetadata): boolean {
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
    dateKeys.map((date) => [date, { date, received: 0, issued: 0 }])
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

  // เอกสารใบผลิตเก่า (PRD-) ที่ยังหลงเหลือในชีตต้องถูกแยกออกจากรับเข้า/เบิกปกติเสมอ
  // (RECEIVE/ISSUE_OUT ของใบผลิตไม่ใช่รายการรับ-เบิกธรรมดา)
  const productionDocumentIds = new Set<string>();
  for (const document of uniqueDocuments) {
    if (isProductionDocument(document)) {
      productionDocumentIds.add(document.document_id);
    }
  }

  const activities: TodayActivity[] = [];
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
    chart_data: dateKeys.map((date) => chartMap.get(date)!),
    today_activities: activities,
    pending_approval_count: uniqueDocuments.filter((document) =>
      isPendingApproval(document, parseMetadata(document.note))
    ).length,
  };
}

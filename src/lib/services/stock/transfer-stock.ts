import type { Document, StockMovement, Product } from "@/types/models";
import { withStockLocks, formatStockLockKey } from "@/lib/locking";
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  failIdempotencyKey,
  computePayloadHash,
} from "@/lib/idempotency";
import { logAudit } from "@/lib/audit";
import {
  CreateTransferSchema,
  SubmitTransferSchema,
  ApproveTransferSchema,
  CompleteTransferSchema,
  CancelTransferSchema,
  type CreateTransferInput,
  type SubmitTransferInput,
  type ApproveTransferInput,
  type CompleteTransferInput,
  type CancelTransferInput,
} from "@/types/api";
import {
  StockUseCaseDeps,
  findWarehouse,
} from "./shared";
import {
  StockNotFoundError,
  InvalidTransferStateError,
  InsufficientStockError,
  UnauthorizedStockOperationError,
} from "./stock-errors";
import { hasWarehouseAccess } from "@/lib/api-response";
import { executeAtomicOperation } from "./atomic-stock-executor";
export {
  CreateTransferSchema,
  SubmitTransferSchema,
  ApproveTransferSchema,
  CompleteTransferSchema,
  CancelTransferSchema,
  type CreateTransferInput,
  type SubmitTransferInput,
  type ApproveTransferInput,
  type CompleteTransferInput,
  type CancelTransferInput,
};

export async function createTransfer(
  deps: StockUseCaseDeps,
  input: CreateTransferInput & { user_id: string; role?: string; correlation_id?: string; warehouse_access?: string | string[] }
): Promise<Document> {
  const fromWhKey = formatStockLockKey(input.from_warehouse_id, "*", input.product_id);
  const toWhKey = formatStockLockKey(input.to_warehouse_id, "*", input.product_id);

  if (input.from_warehouse_id === input.to_warehouse_id) {
    throw new InvalidTransferStateError("โกดังต้นทางและโกดังปลายทางต้องไม่ซ้ำกัน");
  }

  // Check warehouse authorization for source warehouse if restricted
  if (input.role && input.role !== "ADMIN" && input.warehouse_access !== undefined) {
    const hasFrom = hasWarehouseAccess(input.warehouse_access, input.from_warehouse_id);
    if (!hasFrom) {
      throw new UnauthorizedStockOperationError("คุณไม่มีสิทธิ์เข้าถึงโกดังต้นทาง");
    }
  }

  return executeAtomicOperation({
    repo: deps.repo,
    operationType: "TRANSFER_CREATE",
    idempotencyKey: input.idempotency_key,
    actorId: input.user_id,
    actorRole: input.role || "STAFF",
    correlationId: input.correlation_id,
    lockKeys: [fromWhKey, toWhKey],
    auditAction: "STOCK_TRANSFER_CREATE",
    warehouseId: input.from_warehouse_id,
    payload: input,
    execute: async ({ repo }) => {
      const fromWh = await findWarehouse(repo, input.from_warehouse_id);
      const toWh = await findWarehouse(repo, input.to_warehouse_id);
      if (!fromWh || !toWh) {
        throw new StockNotFoundError("ไม่พบโกดังต้นทางหรือโกดังปลายทาง");
      }

      // Lookup product by product_id or SKU to snapshot product details
      const cleanProdId = (input.product_id || "").trim();
      let prod = await repo.products.findById(cleanProdId);
      if (!prod) {
        prod = await repo.products.findBySku(cleanProdId);
      }
      if (!prod) {
        // Fallback: check if product_id without 'prod-' prefix matches SKU
        const cleanSku = cleanProdId.replace(/^prod-/, "");
        prod = await repo.products.findBySku(cleanSku);
      }
      if (!prod) {
        throw new StockNotFoundError(`ไม่พบข้อมูลสินค้าสำหรับรหัส "${input.product_id}"`);
      }

      const rawFromLoc = input.from_location_id || "";
      const rawToLoc = input.to_location_id || "";

      const finalFromLocId = rawFromLoc.trim();
      const finalToLocId = rawToLoc.trim();

      // Check TOTAL warehouse stock across all locations in source warehouse
      const currentWarehouseBalance = typeof repo.movements.getWarehouseBalance === "function"
        ? await repo.movements.getWarehouseBalance(prod.product_id, fromWh.warehouse_id)
        : await repo.movements.getBalance(prod.product_id, fromWh.warehouse_id, rawFromLoc);

      if (currentWarehouseBalance < input.qty) {
        throw new InsufficientStockError(
          `ยอดคงเหลือรวมสินค้าในโกดังต้นทาง (${currentWarehouseBalance}) ไม่เพียงพอสำหรับจำนวนที่ต้องการย้าย (${input.qty})`
        );
      }

      const notePayload = JSON.stringify({
        from_warehouse_id: fromWh.warehouse_id,
        to_warehouse_id: toWh.warehouse_id,
        from_location_id: finalFromLocId,
        to_location_id: finalToLocId,
        product_id: prod.product_id,
        sku: prod.sku,
        barcode: prod.barcode || prod.sku,
        product_name: prod.product_name,
        base_unit: prod.base_unit || "ชิ้น",
        qty: input.qty,
        moved_by: input.moved_by || input.assigned_to_name || "พนักงาน",
        assigned_to_user_id: input.assigned_to_user_id || "",
        assigned_to_name: input.assigned_to_name || input.moved_by || "พนักงาน",
        assigned_by_user_id: input.user_id,
        original_note: input.note,
        idempotency_key: input.idempotency_key,
      });

      // Always create document in PENDING status. Stock movements are created when completed by assigned staff.
      const doc = await repo.documents.create({
        document_type: "TRANSFER",
        reference_no: input.reference_no,
        document_date: input.document_date,
        status: "PENDING",
        note: notePayload,
        created_by: input.user_id,
        assigned_to_user_id: input.assigned_to_user_id || "",
        assigned_to_name: input.assigned_to_name || input.moved_by || "พนักงาน",
        assigned_by_user_id: input.user_id,
      });

      return doc;
    },
  });
}

export async function submitTransferMove(
  deps: StockUseCaseDeps,
  docId: string,
  input: {
    fromLocationId?: string;
    toLocationId?: string;
    sourceAllocations?: Array<{ location_id: string; qty: number }>;
    userId?: string;
    userName?: string;
    userRole?: string;
  }
): Promise<Document> {
  const doc =
    (await deps.repo.documents.findById(docId)) ||
    (await deps.repo.documents.findByNo(docId));
  if (!doc) throw new StockNotFoundError("ไม่พบเอกสารใบย้ายสินค้า");
  if (doc.document_type !== "TRANSFER") {
    throw new InvalidTransferStateError("เอกสารนี้ไม่ใช่ใบย้ายสินค้า");
  }

  if (doc.status === "COMPLETED") {
    return doc;
  }
  if (doc.status === "CANCELLED" || doc.status === "REJECTED") {
    throw new InvalidTransferStateError("ไม่สามารถส่งย้ายสินค้าที่ยกเลิกหรือถูกปฏิเสธแล้วได้");
  }

  let meta: any = {};
  try {
    meta = JSON.parse(doc.note || "{}");
  } catch {
    meta = {};
  }

  const rawAllocations = Array.isArray(input.sourceAllocations) && input.sourceAllocations.length > 0
    ? input.sourceAllocations
    : meta.source_allocations || [];

  const finalFromLoc = (input.fromLocationId || meta.from_location_id || (rawAllocations.length > 0 ? rawAllocations[0].location_id : "A1")).trim();
  const finalToLoc = (input.toLocationId || meta.to_location_id || "A1").trim();

  meta.from_location_id = finalFromLoc;
  meta.to_location_id = finalToLoc;
  meta.source_allocations = rawAllocations;
  meta.current_step = 3;
  meta.current_step_text = "ย้ายสินค้าแล้ว (รอ Admin อนุมัติ)";
  meta.moved_at = new Date().toISOString();
  if (input.userName || input.userId) {
    meta.moved_by = input.userName || input.userId;
    meta.mover_user_id = input.userId || "";
  }

  const updatedNote = JSON.stringify(meta);
  await deps.repo.documents.updateNote(doc.document_id, updatedNote);
  await deps.repo.documents.updateStatus(doc.document_id, "WAITING_APPROVAL");

  return {
    ...doc,
    status: "WAITING_APPROVAL",
    note: updatedNote,
  };
}

export async function completeTransfer(
  deps: StockUseCaseDeps,
  docId: string,
  toLocationId?: string,
  fromLocationId?: string,
  userId?: string,
  userRole?: string,
  warehouseAccess?: string | string[],
  sourceAllocations?: Array<{ location_id: string; qty: number }>
): Promise<Document> {
  if (userRole === "VIEWER") {
    throw new UnauthorizedStockOperationError("คุณไม่มีสิทธิ์ในการปิดงานใบย้ายสินค้า");
  }

  const doc =
    (await deps.repo.documents.findById(docId)) ||
    (await deps.repo.documents.findByNo(docId));
  if (!doc) throw new StockNotFoundError("ไม่พบเอกสารใบย้ายสินค้า");
  if (doc.document_type !== "TRANSFER") {
    throw new InvalidTransferStateError("เอกสารนี้ไม่ใช่ใบย้ายสินค้า");
  }

  // Idempotent completion check
  if (doc.status === "COMPLETED") {
    return doc;
  }

  if (doc.status === "CANCELLED" || doc.status === "REJECTED") {
    throw new InvalidTransferStateError("ไม่สามารถเปลี่ยนใบย้ายที่ยกเลิกแล้วเป็น COMPLETED");
  }

  // Fail closed on missing or malformed note
  if (!doc.note || !doc.note.startsWith("{")) {
    throw new InvalidTransferStateError("ข้อมูลเอกสารใบย้ายสินค้าไม่สมบูรณ์หรือไม่ถูกต้อง");
  }

  let meta: {
    from_warehouse_id: string;
    to_warehouse_id: string;
    from_location_id?: string;
    to_location_id?: string;
    source_allocations?: Array<{ location_id: string; qty: number }>;
    product_id: string;
    qty: number;
    moved_by?: string;
    assigned_to_user_id?: string;
    assigned_to_name?: string;
    idempotency_key?: string;
    completed_at?: string;
    completed_by?: string;
  };

  try {
    meta = JSON.parse(doc.note);
  } catch {
    throw new InvalidTransferStateError("ข้อมูลเอกสารใบย้ายสินค้าไม่สมบูรณ์หรือไม่ถูกต้อง");
  }

  if (!meta.from_warehouse_id || !meta.to_warehouse_id || !meta.product_id || typeof meta.qty !== "number" || meta.qty <= 0) {
    throw new InvalidTransferStateError("ข้อมูลเอกสารใบย้ายสินค้าไม่สมบูรณ์หรือไม่ถูกต้อง");
  }

  let realUserId = userId;
  let realUserRole = userRole;
  let realWarehouseAccess = warehouseAccess;
  let rawFromLoc = fromLocationId || "";

  // Handle signature overload when called as completeTransfer(deps, docId, toLocId, userId, userRole, warehouseAccess)
  if (
    fromLocationId &&
    (fromLocationId.startsWith("user-") ||
      fromLocationId.startsWith("usr-") ||
      fromLocationId.startsWith("admin-") ||
      fromLocationId.startsWith("staff-")) &&
    (userId === "WAREHOUSE_STAFF" || userId === "ADMIN" || userId === "VIEWER" || !userId)
  ) {
    realUserId = fromLocationId;
    realUserRole = userId;
    realWarehouseAccess = userRole;
    rawFromLoc = meta.from_location_id || "A1";
  } else if (!rawFromLoc) {
    rawFromLoc = meta.from_location_id || "A1";
  }

  // Warehouse authorization check: receiver MUST have destination warehouse access (unless ADMIN)
  if (realUserRole && realUserRole !== "ADMIN" && realWarehouseAccess !== undefined) {
    const hasTo = hasWarehouseAccess(realWarehouseAccess, meta.to_warehouse_id);
    if (!hasTo) {
      throw new UnauthorizedStockOperationError("คุณไม่มีสิทธิ์ในโกดังปลายทางสำหรับเอกสารใบย้ายสินค้านี้");
    }
  }

  const normId = (id?: string) =>
    (id || "")
      .trim()
      .toLowerCase()
      .replace(/^usr-/, "")
      .replace(/^user-/, "");

  // Assignee authorization check: non-ADMIN user MUST be the assigned staff member
  if (realUserRole && realUserRole !== "ADMIN" && realUserRole !== "MANAGER") {
    const assignedUserId = String(doc.assigned_to_user_id || meta.assigned_to_user_id || "").trim();
    const assignedName = String(doc.assigned_to_name || meta.assigned_to_name || meta.moved_by || "").trim();
    const actorId = String(realUserId || "").trim();
    const normActorId = normId(actorId);

    const cleanAssignedName = assignedName.toLowerCase().replace(/^(?:พนักงาน|มอบหมาย|ย้ายโดย):\s*/i, "").trim();
    const isGenericStaff =
      !cleanAssignedName ||
      cleanAssignedName === "พนักงาน" ||
      cleanAssignedName === "พนักงานโกดัง" ||
      cleanAssignedName === "ผู้ใช้งานระบบ";

    if (assignedUserId) {
      // Primary check by User ID
      const normAssignedId = normId(assignedUserId);
      if (normAssignedId === normActorId) {
        // Direct User ID match -> Authorized
      } else {
        // Fallback for tasks created with dummy IDs (e.g. usr-staff-01) where assigned_to_name matches user
        let isNameAuthorized = false;
        if (!isGenericStaff) {
          if (deps.repo.users && typeof deps.repo.users.findAll === "function") {
            try {
              const allUsers = await deps.repo.users.findAll();
              const matchingUsers = (allUsers || []).filter((u: any) => {
                if (u && u.active === false) return false;
                const uName = String(u.full_name || u.name || "").trim().toLowerCase();
                return uName === cleanAssignedName;
              });

              if (matchingUsers.length === 1) {
                const matchedUserId = matchingUsers[0].user_id || (matchingUsers[0] as any).id;
                if (normId(matchedUserId) === normActorId) {
                  isNameAuthorized = true;
                }
              }
            } catch {}
          }
        }

        if (!isNameAuthorized) {
          throw new UnauthorizedStockOperationError("คุณไม่ใช่ผู้ได้รับมอบหมายให้ปิดงานใบย้ายสินค้านี้");
        }
      }
    } else if (assignedName) {
      // Legacy Fallback when assigned_to_user_id is missing
      if (!isGenericStaff) {
        let matchingUsers: any[] = [];
        if (deps.repo.users && typeof deps.repo.users.findAll === "function") {
          try {
            const allUsers = await deps.repo.users.findAll();
            matchingUsers = (allUsers || []).filter((u: any) => {
              if (u && u.active === false) return false;
              const uName = String(u.full_name || u.name || "").trim().toLowerCase();
              return uName === cleanAssignedName;
            });
          } catch {}
        }

        if (matchingUsers.length === 1) {
          const matchedUserId = matchingUsers[0].id || matchingUsers[0].user_id;
          if (normId(matchedUserId) !== normActorId) {
            throw new UnauthorizedStockOperationError("คุณไม่ใช่ผู้ได้รับมอบหมายให้ปิดงานใบย้ายสินค้านี้");
          }
        } else {
          throw new UnauthorizedStockOperationError(
            "ใบงานนี้ไม่มีรหัสผู้รับมอบหมาย (User ID) และพบพนักงานชื่อนี้หลายคน/ไม่พบในระบบ กรุณาให้ Admin มอบหมายงานใหม่"
          );
        }
      }
    }
  }

  const effectiveAllocations = (Array.isArray(sourceAllocations) && sourceAllocations.length > 0)
    ? sourceAllocations
    : (Array.isArray(meta.source_allocations) && meta.source_allocations.length > 0)
    ? meta.source_allocations
    : [];

  const finalFromLocId = (rawFromLoc || meta.from_location_id || (effectiveAllocations.length > 0 ? effectiveAllocations[0].location_id : "A1")).trim();
  if (!finalFromLocId) {
    throw new InvalidTransferStateError("กรุณาระบุ/สแกนตำแหน่งต้นทางในการย้ายสินค้า");
  }

  const rawToLoc = toLocationId || meta.to_location_id || "";
  const finalToLocId = (rawToLoc || "A1").trim();
  if (!finalToLocId) {
    throw new InvalidTransferStateError("กรุณาระบุ/สแกนตำแหน่งปลายทางในการย้ายสินค้า");
  }

  const executorId = realUserId || doc.created_by || "staff";

  // Validate source and destination location existence and active status if location repository is available
  if (deps.repo.locations) {
    const allLocations = await deps.repo.locations.findAll();
    if (Array.isArray(allLocations) && allLocations.length > 0) {
      const matchedSourceLoc = allLocations.find(
        (l) =>
          (l.location_id === rawFromLoc ||
            l.location_code === rawFromLoc ||
            l.location_id === finalFromLocId ||
            l.location_code === finalFromLocId) &&
          (l.warehouse_id === meta.from_warehouse_id || l.warehouse_id === meta.from_warehouse_id.replace(/^wh-0*/, "wh-"))
      );

      if (matchedSourceLoc && matchedSourceLoc.active === false) {
        throw new InvalidTransferStateError(`ตำแหน่งต้นทาง "${rawFromLoc}" ไม่พร้อมใช้งาน (Inactive)`);
      }

      const matchedDestLoc = allLocations.find(
        (l) =>
          (l.location_id === rawToLoc ||
            l.location_code === rawToLoc ||
            l.location_id === finalToLocId ||
            l.location_code === finalToLocId) &&
          (l.warehouse_id === meta.to_warehouse_id || l.warehouse_id === meta.to_warehouse_id.replace(/^wh-0*/, "wh-"))
      );

      if (matchedDestLoc && matchedDestLoc.active === false) {
        throw new InvalidTransferStateError(`ตำแหน่งปลายทาง "${rawToLoc}" ไม่พร้อมใช้งาน (Inactive)`);
      }
    }
  }

  let product = await deps.repo.products.findById(meta.product_id);
  if (!product) {
    const rawSku = meta.product_id.replace(/^prod-/, "");
    product = await deps.repo.products.findBySku(rawSku);
  }

  const skuVal = product?.sku || meta.product_id.replace(/^prod-/, "");
  const prodObj: Product = product || {
    product_id: meta.product_id,
    sku: skuVal,
    barcode: skuVal,
    product_name: skuVal,
    category: "ทั่วไป",
    base_unit: "ชิ้น",
    minimum_stock: 0,
    supplier: "",
    description: "",
    active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const fromLock = formatStockLockKey(meta.from_warehouse_id, finalFromLocId, meta.product_id);
  const toLock = formatStockLockKey(meta.to_warehouse_id, finalToLocId, meta.product_id);

  const opPayload = {
    docId: doc.document_id,
    toLocationId: finalToLocId,
    fromLocationId: finalFromLocId,
    sourceAllocations: Array.isArray(sourceAllocations) && sourceAllocations.length > 0 ? sourceAllocations : undefined,
  };
  const attemptHash = computePayloadHash(opPayload);

  return executeAtomicOperation({
    repo: deps.repo,
    operationType: "TRANSFER_COMPLETE",
    idempotencyKey: `complete-transfer-${doc.document_id}-${attemptHash}`,
    actorId: executorId,
    actorRole: userRole || "STAFF",
    lockKeys: [fromLock, toLock],
    auditAction: "STOCK_TRANSFER_COMPLETE",
    warehouseId: meta.to_warehouse_id,
    payload: opPayload,
    execute: async ({ repo }) => {
      // Re-check document status after acquiring lock
      const freshDoc =
        (await repo.documents.findById(doc.document_id)) ||
        (await repo.documents.findByNo(doc.document_id));
      if (freshDoc && freshDoc.status === "COMPLETED") {
        return freshDoc;
      }
      if (freshDoc && freshDoc.status === "CANCELLED") {
        throw new InvalidTransferStateError("ไม่สามารถเปลี่ยนใบย้ายที่ยกเลิกแล้วเป็น COMPLETED");
      }

      // Check if multi-source location picking allocations are provided
      const allocations = (Array.isArray(sourceAllocations) && sourceAllocations.length > 0)
        ? sourceAllocations.filter((a) => a && a.location_id && Number(a.qty) > 0)
        : (Array.isArray(meta.source_allocations) && meta.source_allocations.length > 0)
        ? meta.source_allocations.filter((a) => a && a.location_id && Number(a.qty) > 0)
        : [];

      if (allocations.length > 0) {
        const totalAllocatedQty = allocations.reduce((sum, a) => sum + Number(a.qty), 0);
        if (totalAllocatedQty !== meta.qty) {
          throw new InvalidTransferStateError(
            `จำนวนสินค้ารวมที่เลือกจากทุกตำแหน่ง (${totalAllocatedQty.toLocaleString()} ชิ้น) ไม่ตรงกับจำนวนตามใบงาน (${meta.qty.toLocaleString()} ชิ้น)`
          );
        }

        // Validate stock balance for each source location inside atomic lock
        for (const alloc of allocations) {
          const locId = alloc.location_id.trim();
          const allocQty = Number(alloc.qty);
          const bal = await repo.movements.getBalance(
            meta.product_id,
            meta.from_warehouse_id,
            locId
          );
          if (bal < allocQty) {
            throw new InsufficientStockError(
              `ยอดสินค้าในตำแหน่ง "${locId}" มีเพียง ${bal.toLocaleString()} ชิ้น ไม่เพียงพอสำหรับจำนวนที่เลือกหยิบ ${allocQty.toLocaleString()} ชิ้น`
            );
          }
        }
      } else {
        // Single location fallback
        const currentSourceBalance = await repo.movements.getBalance(
          meta.product_id,
          meta.from_warehouse_id,
          finalFromLocId
        );

        if (currentSourceBalance < meta.qty) {
          throw new InsufficientStockError(
            `ยอดสินค้าในตำแหน่ง "${finalFromLocId}" มีเพียง ${currentSourceBalance.toLocaleString()} ชิ้น ซึ่งไม่พอย้ายจำนวน ${meta.qty.toLocaleString()} ชิ้น (หากสินค้ากระจายอยู่หลายตำแหน่ง กรุณาเลือกหยิบจากหลายตำแหน่งให้ครบตามจำนวน)`
          );
        }
      }

      // Check if movements already exist (single stock effect guarantee)
      const existingMovements = await repo.movements.findByDocumentId(doc.document_id);
      const hasIn = existingMovements.some((m: StockMovement) => m.movement_type === "TRANSFER_IN");

      if (!hasIn) {
        const movements: Omit<StockMovement, "movement_id" | "created_at">[] = [];

        if (allocations.length > 0) {
          allocations.forEach((alloc, idx) => {
            movements.push({
              document_id: doc.document_id,
              product_id: meta.product_id,
              warehouse_id: meta.from_warehouse_id,
              location_id: alloc.location_id.trim(),
              qty_change: -Number(alloc.qty),
              movement_type: "TRANSFER_OUT",
              idempotency_key: `${meta.idempotency_key || doc.document_id}-out-${idx}`,
              created_by: executorId,
            });
          });
        } else {
          movements.push({
            document_id: doc.document_id,
            product_id: meta.product_id,
            warehouse_id: meta.from_warehouse_id,
            location_id: finalFromLocId,
            qty_change: -meta.qty,
            movement_type: "TRANSFER_OUT",
            idempotency_key: `${meta.idempotency_key || doc.document_id}-out`,
            created_by: executorId,
          });
        }

        movements.push({
          document_id: doc.document_id,
          product_id: meta.product_id,
          warehouse_id: meta.to_warehouse_id,
          location_id: finalToLocId,
          qty_change: meta.qty,
          movement_type: "TRANSFER_IN",
          idempotency_key: `${meta.idempotency_key || doc.document_id}-in`,
          created_by: executorId,
        });

        const created = await repo.movements.batchCreate(movements);
        await repo.stockSummary.applyChanges(
          created.map((m: StockMovement) => ({
            productId: m.product_id,
            warehouseId: m.warehouse_id,
            locationId: m.location_id,
            delta: m.qty_change,
          }))
        );

        if (repo.warehouseSync) {
          let sourceInfo: any = null;
          if (allocations.length > 0) {
            for (const alloc of allocations) {
              const info = await repo.warehouseSync.syncDeduct(
                meta.from_warehouse_id,
                prodObj.sku,
                alloc.qty,
                alloc.location_id
              );
              if (info) sourceInfo = info;
            }
          } else {
            sourceInfo = await repo.warehouseSync.syncDeduct(
              meta.from_warehouse_id,
              prodObj.sku,
              meta.qty,
              finalFromLocId
            );
          }

          const finalProductSync = {
            sku: sourceInfo?.sku || prodObj.sku,
            barcode: sourceInfo?.barcode || prodObj.barcode || prodObj.sku,
            product_name: sourceInfo?.product_name || prodObj.product_name,
            category: sourceInfo?.category || prodObj.category || "ทั่วไป",
            base_unit: sourceInfo?.base_unit || prodObj.base_unit || "ชิ้น",
            supplier: sourceInfo?.supplier || prodObj.supplier || "ย้ายสินค้าเข้า",
          };

          await repo.warehouseSync.syncAdd(
            meta.to_warehouse_id,
            finalProductSync,
            meta.qty,
            finalToLocId
          );
        }
      }

      meta.from_location_id = finalFromLocId;
      meta.to_location_id = finalToLocId;
      meta.completed_at = new Date().toISOString();
      meta.completed_by = executorId;

      // Mark completed only after all operations succeed
      await repo.documents.updateStatus(doc.document_id, "COMPLETED");

      return { ...doc, status: "COMPLETED", note: JSON.stringify(meta) };
    },
  });
}

export async function cancelTransfer(
  deps: StockUseCaseDeps,
  docId: string,
  note?: string,
  userId?: string,
  userRole?: string,
  warehouseAccess?: string | string[]
): Promise<Document> {
  if (userRole === "VIEWER") {
    throw new UnauthorizedStockOperationError("คุณไม่มีสิทธิ์ในการยกเลิกใบย้ายสินค้า");
  }

  const doc =
    (await deps.repo.documents.findById(docId)) ||
    (await deps.repo.documents.findByNo(docId));
  if (!doc) throw new StockNotFoundError("ไม่พบใบย้ายสินค้า");
  if (doc.document_type !== "TRANSFER") {
    throw new InvalidTransferStateError("เอกสารนี้ไม่ใช่ใบย้ายสินค้า");
  }

  // Idempotent cancel check
  if (doc.status === "CANCELLED") {
    return doc;
  }

  if (doc.status === "COMPLETED") {
    throw new InvalidTransferStateError("ไม่สามารถยกเลิกใบย้ายสินค้าที่เสร็จสมบูรณ์แล้วได้ (กรุณาใช้การกลับยอด)");
  }

  // Fail closed on missing or malformed note
  if (!doc.note || !doc.note.startsWith("{")) {
    throw new InvalidTransferStateError("ข้อมูลเอกสารใบย้ายสินค้าไม่สมบูรณ์หรือไม่ถูกต้อง");
  }

  let meta: {
    from_warehouse_id: string;
    to_warehouse_id: string;
    from_location_id?: string;
    to_location_id?: string;
    product_id?: string;
    qty?: number;
    idempotency_key?: string;
  };

  try {
    meta = JSON.parse(doc.note);
  } catch {
    throw new InvalidTransferStateError("ข้อมูลเอกสารใบย้ายสินค้าไม่สมบูรณ์หรือไม่ถูกต้อง");
  }

  if (!meta.from_warehouse_id || !meta.to_warehouse_id) {
    throw new InvalidTransferStateError("ข้อมูลเอกสารใบย้ายสินค้าไม่สมบูรณ์หรือไม่ถูกต้อง");
  }

  // Warehouse authorization check: canceler MUST have source warehouse access (unless ADMIN)
  if (userRole && userRole !== "ADMIN" && warehouseAccess !== undefined) {
    const hasFrom = hasWarehouseAccess(warehouseAccess, meta.from_warehouse_id);
    if (!hasFrom) {
      throw new UnauthorizedStockOperationError("คุณไม่มีสิทธิ์ในโกดังต้นทางสำหรับเอกสารใบย้ายสินค้านี้");
    }
  }

  return executeAtomicOperation({
    repo: deps.repo,
    operationType: "TRANSFER_CANCEL",
    idempotencyKey: `cancel-transfer-${doc.document_id}`,
    actorId: userId || "system",
    actorRole: userRole || "STAFF",
    lockKeys: [
      formatStockLockKey(meta.from_warehouse_id, meta.from_location_id || "A1", meta.product_id || "unknown"),
      formatStockLockKey(meta.to_warehouse_id, meta.to_location_id || "A1", meta.product_id || "unknown")
    ],
    auditAction: "STOCK_TRANSFER_CANCEL",
    warehouseId: meta.from_warehouse_id,
    payload: { docId, note },
    execute: async ({ repo }) => {
      // Re-check document status before executing reversal
      const freshDoc =
        (await repo.documents.findById(doc.document_id)) ||
        (await repo.documents.findByNo(doc.document_id));
      if (freshDoc && freshDoc.status === "CANCELLED") {
        return freshDoc;
      }
      if (freshDoc && freshDoc.status === "COMPLETED") {
        throw new InvalidTransferStateError("ไม่สามารถยกเลิกใบย้ายสินค้าที่เสร็จสมบูรณ์แล้วได้ (กรุณาใช้การกลับยอด)");
      }

      const existingMovements = await repo.movements.findByDocumentId(doc.document_id);
      if (existingMovements.length > 0) {
        const { reverseStock } = await import("./reverse-stock");
        await reverseStock(deps, {
          original_document_id: doc.document_id,
          note: note || "ยกเลิกโดยผู้ใช้",
          idempotency_key: `cancel-transfer-reversal-${doc.document_id}`,
          user_id: userId || "system",
          role: userRole || "STAFF",
        });
      }

      await repo.documents.updateStatus(doc.document_id, "CANCELLED");

      return { ...doc, status: "CANCELLED" };
    }
  });
}



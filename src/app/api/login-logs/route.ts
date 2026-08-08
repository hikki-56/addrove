import { NextRequest } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import {
  getLoginLogs,
  getProductsAddedByEmployee,
  EmployeeProductAddition,
} from "@/lib/services/login-log.service";
import { getRepository } from "@/lib/repositories";
import { getWarehouseName } from "@/lib/warehouse-utils";
import {
  successResponse,
  unauthorizedResponse,
  forbiddenResponse,
  serverErrorResponse,
} from "@/lib/api-response";

interface LoginLogWithDetails {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  user_role: "ADMIN" | "WAREHOUSE_STAFF" | "VIEWER";
  login_method: "QR_CODE" | "PASSWORD";
  login_at: string;
  ip_address?: string;
  user_agent?: string;
  added_products_count: number;
  added_products: EmployeeProductAddition[];
}

export async function GET(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    if (!session) return unauthorizedResponse();
    if (session.user.role !== "ADMIN") return forbiddenResponse("เฉพาะ Admin เท่านั้นที่ดูประวัติการเข้าระบบได้");

    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("user_id");
    const userEmail = searchParams.get("user_email") || undefined;

    if (userId) {
      const addedProducts = await getProductsAddedByEmployee(userId, userEmail);
      return successResponse(
        addedProducts,
        "ดึงรายการสินค้าที่พนักงานเพิ่มสำเร็จ"
      );
    }

    const repo = getRepository();

    // Fetch all database users to map UUIDs to actual human names
    const allDbUsers = await repo.users.findAll().catch(() => []);

    function resolveUser(uidOrEmail: string, currentName?: string) {
      const raw = (uidOrEmail || "").trim();
      const rawName = (currentName || "").trim();

      const isCurrentNameValid =
        rawName &&
        !/^[0-9a-fA-F-]{16,}$/.test(rawName) &&
        !rawName.includes("@") &&
        rawName.length > 1;

      // 1. Match Database Users by user_id, email, or full_name
      const dbMatch = allDbUsers.find(
        (u: any) =>
          (u.user_id && u.user_id.toLowerCase() === raw.toLowerCase()) ||
          (u.email && u.email.toLowerCase() === raw.toLowerCase()) ||
          (u.full_name && u.full_name.toLowerCase() === raw.toLowerCase()) ||
          (rawName && u.full_name && u.full_name.toLowerCase() === rawName.toLowerCase()) ||
          (rawName && u.user_id && u.user_id.toLowerCase() === rawName.toLowerCase())
      );

      if (dbMatch && dbMatch.full_name) {
        return {
          name: dbMatch.full_name,
          email: dbMatch.email || `${dbMatch.user_id}@stockify.com`,
          role: (dbMatch.role as any) || "WAREHOUSE_STAFF",
        };
      }

      if (isCurrentNameValid) {
        return {
          name: rawName,
          email: raw.includes("@") ? raw : "",
          role: "WAREHOUSE_STAFF" as const,
        };
      }

      // Unknown IDs must never be attributed to an arbitrary real user.
      const isUuid = /^[0-9a-fA-F-]{16,}$/.test(raw) || /^[0-9a-fA-F-]{16,}$/.test(rawName);
      if (isUuid) {
        return {
          name: "ไม่ทราบผู้ใช้งาน",
          email: "",
          role: "WAREHOUSE_STAFF" as const,
        };
      }

      return {
        name: raw.includes("@") ? raw.split("@")[0] : raw || "พนักงานคลังสินค้า",
        email: raw.includes("@") ? raw : "",
        role: "WAREHOUSE_STAFF" as const,
      };
    }

    // 1. Get all login logs
    const logs = await getLoginLogs();

    // 2. Fetch all Documents from repository
    const allDocs = await repo.documents.findAll({ page: 1, limit: 9999 }).catch(() => ({ data: [] }));
    const docRows = allDocs.data || [];

    // Store all document import sessions
    const documentSessions: LoginLogWithDetails[] = [];
    const processedDocIds = new Set<string>();

    if (docRows && docRows.length > 0) {
      for (const d of docRows) {
        const docId = d.document_id;
        const docNo = d.document_no;
        const docType = d.document_type;
        const whId = "wh-1";
        const docStatus = d.status;
        const noteStr = d.note;
        const createdBy = d.created_by || "unknown";
        const createdAt = d.created_at || new Date().toISOString();

        const isApproved = docStatus === "POSTED";

        if (docType === "RECEIVE" && isApproved && !processedDocIds.has(docId)) {
          processedDocIds.add(docId);
          let parsedRows: (string | number)[][] = [];
          let targetWh = whId;
          try {
            if (noteStr && noteStr.startsWith("{")) {
              const parsed = JSON.parse(noteStr);
              parsedRows = parsed.rows || [];
              if (parsed.warehouse_id) targetWh = parsed.warehouse_id;
              else if (parsed.target_sheet) targetWh = parsed.target_sheet;
            }
          } catch {}

          const whName = getWarehouseName(targetWh);
          const items: EmployeeProductAddition[] = [];

          for (const row of parsedRows) {
            const sku = String(row[0] || "-");
            const name = String(row[1] || `สินค้า ${sku}`);
            const cat = String(row[2] || "ทั่วไป");
            const unit = String(row[3] || "ชิ้น");
            const qty = Number(row[4]) || 1;
            const supplier = String(row[6] || "รับสินค้าเข้าคลัง");
            const rowTime = String(row[7] || createdAt);

            items.push({
              product_id: `doc-${docId}-${sku}`,
              sku,
              barcode: "-",
              product_name: name,
              category: cat,
              base_unit: unit,
              quantity: qty,
              warehouse_name: whName,
              created_at: rowTime,
              description: `เอกสาร: ${docNo} (อนุมัติแล้ว) • ${supplier}`,
              action_type: "STOCK_RECEIVE",
              approval_status: "POSTED",
            });
          }

          if (items.length > 0) {
            const resolved = resolveUser(createdBy);

            documentSessions.push({
              id: `session-doc-${docId}`,
              user_id: createdBy,
              user_name: resolved.name,
              user_email: resolved.email,
              user_role: resolved.role,
              login_method: "QR_CODE",
              login_at: createdAt,
              added_products_count: items.length,
              added_products: items,
            });
          }
        }
      }
    }

    // 3. Attach items to login logs or keep standalone document sessions
    const combinedMap = new Map<string, LoginLogWithDetails>();

    // Add document sessions (Permanent records)
    for (const ds of documentSessions) {
      combinedMap.set(ds.id, ds);
    }

    // Add login logs and resolve employee names
    for (let idx = 0; idx < logs.length; idx++) {
      const log = logs[idx];
      const resolved = resolveUser(log.user_id || log.user_email, log.user_name);
      const userItems = await getProductsAddedByEmployee(log.user_id, log.user_email);

      const currentLoginTime = new Date(log.login_at).getTime();
      const newerLog = logs.slice(0, idx).reverse().find((l) => l.user_id === log.user_id || l.user_email === log.user_email);
      const newerTime = newerLog ? new Date(newerLog.login_at).getTime() : undefined;

      const sessionStart = currentLoginTime - 1000 * 60 * 60 * 24;
      const sessionEnd = newerTime ? newerTime : currentLoginTime + 1000 * 60 * 60 * 24;

      const sessionItems = userItems.filter((item) => {
        const itemTime = new Date(item.created_at).getTime();
        return itemTime >= sessionStart && itemTime <= sessionEnd;
      });

      combinedMap.set(log.id, {
        ...log,
        user_name: resolved.name,
        user_email: resolved.email,
        user_role: resolved.role,
        added_products_count: sessionItems.length,
        added_products: sessionItems,
      });
    }

    // Convert map to array and sort chronologically
    const allLogsList = Array.from(combinedMap.values()).sort(
      (a, b) => new Date(b.login_at).getTime() - new Date(a.login_at).getTime()
    );

    const totalLogins = allLogsList.length;
    const staffLogins = allLogsList.filter(
      (l) => l.user_role === "WAREHOUSE_STAFF"
    ).length;

    const allUniqueAdditions = new Set<string>();
    for (const log of allLogsList) {
      for (const p of log.added_products) {
        allUniqueAdditions.add(`${p.sku}:${p.quantity}:${p.created_at}`);
      }
    }

    return successResponse(
      {
        logs: allLogsList,
        stats: {
          total_logins: totalLogins,
          staff_logins: staffLogins,
          total_products_added: allUniqueAdditions.size,
        },
      },
      "โหลดข้อมูลประวัติการนำเข้าสินค้าสำเร็จ"
    );
  } catch (e) {
    return serverErrorResponse(e);
  }
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getWarehouseName } from "@/lib/warehouse-utils";
import {
  parseTransferMetadata,
  getDisplayProductName,
  isTransferCompleted,
  getTransferNotifications,
} from "@/lib/transfer-notification-utils";
import { getAllTaggedExpressItems } from "@/lib/express-tag-utils";

export type WarehouseActionType =
  | "RECEIVE"          // รับสินค้าเข้าโกดัง
  | "APPROVE_RECEIVE"  // อนุมัติสินค้าเข้าโกดัง
  | "EXPRESS_IMPORT"   // นำสินค้าเข้า Express
  | "MOVE"             // จัดตำแหน่งสินค้า
  | "CREATE_TRANSFER"  // สร้างใบเบิกสินค้า
  | "ISSUE"            // เบิกสินค้า
  | "APPROVE_TRANSFER" // อนุมัติการเบิกสินค้า
  | "PRODUCTION";      // ผลิตสินค้า

interface ActivityItem {
  id: string;
  timestamp: string;
  dateKey: string;
  timeFormatted: string;
  dateFormatted: string;
  relativeDayLabel: string;
  actorName: string;
  actionType: WarehouseActionType;
  actionLabel: string;
  documentNo: string;
  documentHref: string;
  productName: string;
  sku: string;
  qty: number;
  qtyChange: number;
  unit: string;
  locationInfo: string;
  status?: string;
}

const DYNAMIC_STAFF_MAP = new Map<string, string>();

export default function AdminDashboard() {
  const [stats, setStats] = useState({
    totalProducts: 0,
    pendingApprovals: 0,
    activeWarehouses: 6,
    totalMovements: 0,
    lowStockCount: 0,
    outOfStockCount: 0,
  });
  const [warehouseQtyMap, setWarehouseQtyMap] = useState<Record<number, number>>({
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
    6: 0,
  });
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [activityFilterDate, setActivityFilterDate] = useState<string>("ALL");
  const [activityFilterActor, setActivityFilterActor] = useState<string>("ALL");
  const [activityFilterAction, setActivityFilterAction] = useState<string>("ALL");
  const [activitySearch, setActivitySearch] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [appRes, prodRes, stockRes, movRes, trfRes, prdRes, userRes] = await Promise.all([
          fetch("/api/approvals?status=ALL").then((r) => r.json()).catch(() => ({ data: [] })),
          fetch("/api/products").then((r) => r.json()).catch(() => ({ data: [] })),
          fetch("/api/stock").then((r) => r.json()).catch(() => ({ data: [] })),
          fetch("/api/movements?limit=300").then((r) => r.json()).catch(() => ({ data: { data: [], total: 0 } })),
          fetch(`/api/movements/transfer?_t=${Date.now()}`).then((r) => (r.ok ? r.json() : { data: [] })).catch(() => ({ data: [] })),
          fetch("/api/production/orders").then((r) => r.json()).catch(() => ({ data: [] })),
          fetch("/api/users").then((r) => r.json()).catch(() => ({ data: [] })),
        ]);

        const allApprovals = Array.isArray(appRes.data) ? appRes.data : [];
        const rawUsers = Array.isArray(userRes.data) ? userRes.data : [];
        rawUsers.forEach((u: any) => {
          const name = u.full_name || u.name;
          if (name) {
            if (u.user_id) DYNAMIC_STAFF_MAP.set(String(u.user_id).toLowerCase(), name);
            if (u.username) DYNAMIC_STAFF_MAP.set(String(u.username).toLowerCase(), name);
            if (u.email) DYNAMIC_STAFF_MAP.set(String(u.email).toLowerCase(), name);
          }
        });
        const products = Array.isArray(prodRes.data)
          ? prodRes.data
          : Array.isArray(prodRes.data?.items)
          ? prodRes.data.items
          : [];
        const balances = Array.isArray(stockRes.data) ? stockRes.data : [];
        const movements = Array.isArray(movRes.data?.data)
          ? movRes.data.data
          : Array.isArray(movRes.data?.items)
          ? movRes.data.items
          : Array.isArray(movRes.data)
          ? movRes.data
          : [];
        const rawTransfers = Array.isArray(trfRes.data) ? trfRes.data : [];
        const rawProduction = Array.isArray(prdRes.data) ? prdRes.data : [];
        const expressItems = getAllTaggedExpressItems();

        const getWhIndex = (str?: string): number => {
          if (!str) return -1;
          const s = String(str).toLowerCase();
          if (s.includes("wh-01") || s.includes("wh-1") || s.includes("wh1") || s.includes("โกดัง 1") || s.includes("โกดัง1")) return 1;
          if (s.includes("wh-02") || s.includes("wh-2") || s.includes("wh2") || s.includes("โกดัง 2") || s.includes("โกดัง2")) return 2;
          if (s.includes("wh-03") || s.includes("wh-3") || s.includes("wh3") || s.includes("โกดัง 3") || s.includes("โกดัง3")) return 3;
          if (s.includes("wh-04") || s.includes("wh-4") || s.includes("wh4") || s.includes("โกดัง 4") || s.includes("โกดัง4")) return 4;
          if (s.includes("wh-05") || s.includes("wh-5") || s.includes("wh5") || s.includes("โกดัง 5") || s.includes("โกดัง5")) return 5;
          if (s.includes("wh-06") || s.includes("wh-6") || s.includes("wh6") || s.includes("สำนักงานใหญ่")) return 6;
          const numMatch = s.match(/\d+/);
          if (numMatch) {
            const n = parseInt(numMatch[0], 10);
            if (n >= 1 && n <= 6) return n;
          }
          return -1;
        };

        const qtyCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };

        // 1. Process product quantities directly from /api/products
        products.forEach((p: any) => {
          const breakdown = p.locations_breakdown || p.locations;
          if (Array.isArray(breakdown) && breakdown.length > 0) {
            breakdown.forEach((loc: any) => {
              const lIdx = getWhIndex(loc.warehouse_id) !== -1 
                ? getWhIndex(loc.warehouse_id) 
                : getWhIndex(loc.warehouse_name);
              const lq = Number(loc.quantity ?? loc.qty ?? 0) || 0;
              if (lIdx >= 1 && lIdx <= 6 && lq > 0) {
                qtyCounts[lIdx] += lq;
              }
            });
          } else {
            const idx = getWhIndex(p.warehouse_id) !== -1 
              ? getWhIndex(p.warehouse_id) 
              : getWhIndex(p.warehouse_name);
            const q = Number(p.quantity ?? p.qty ?? 0) || 0;
            if (idx >= 1 && idx <= 6 && q > 0) {
              qtyCounts[idx] += q;
            }
          }
        });

        // 2. Process stock balances from /api/stock if warehouse counts are not yet populated
        if (Object.values(qtyCounts).every((v) => v === 0) && balances.length > 0) {
          balances.forEach((item: any) => {
            if (Array.isArray(item.by_warehouse) && item.by_warehouse.length > 0) {
              item.by_warehouse.forEach((entry: any) => {
                const idx = getWhIndex(entry.warehouse_id) !== -1 
                  ? getWhIndex(entry.warehouse_id) 
                  : getWhIndex(entry.warehouse_name);
                const entryQ = Number(entry.quantity ?? entry.qty ?? entry.total) || 0;
                if (idx >= 1 && idx <= 6 && entryQ > 0) {
                  qtyCounts[idx] += entryQ;
                }
              });
            }
          });
        }

        const totalWarehouseQty = Object.values(qtyCounts).reduce((acc, curr) => acc + curr, 0);

        // 3. Process Activity History records (ทั้งการเคลื่อนไหวทั่วไปและใบโอนย้าย)
        const prodMapBySku = new Map<string, any>();
        const prodMapById = new Map<string, any>();
        products.forEach((p: any) => {
          if (p.sku) prodMapBySku.set(p.sku.trim().toLowerCase(), p);
          if (p.product_id) prodMapById.set(p.product_id.trim().toLowerCase(), p);
        });

        const activityList: ActivityItem[] = [];
        const processedDocNos = new Set<string>();

        // 3.1 บันทึกรายการเอกสารเบิก/โอนย้าย (TRF-...)
        // ตามลำดับการปฏิบัติงานจริง: สร้างใบเบิก -> เบิกสินค้าจริง -> อนุมัติการเบิก
        for (const doc of rawTransfers) {
          if (!doc) continue;
          const docId = String(doc.document_id || doc.document_no || "").trim();
          const docNo = String(doc.document_no || doc.document_id || "").trim();
          if (!docNo) continue;
          processedDocNos.add(docNo.toLowerCase());
          if (docId) processedDocNos.add(docId.toLowerCase());

          const meta = parseTransferMetadata(doc.note);
          const rawProdId = String(meta.product_id || doc.product_id || "").trim();
          const rawSku = String(meta.sku || doc.sku || (rawProdId.startsWith("prod-") ? rawProdId.replace(/^prod-/, "") : "")).trim();
          const matchedProd = (rawSku ? prodMapBySku.get(rawSku.toLowerCase()) : undefined) ||
                              (rawProdId ? prodMapById.get(rawProdId.toLowerCase()) : undefined);

          const sku = rawSku || matchedProd?.sku || "-";
          const productName = getDisplayProductName({
            product_name: String(meta.product_name || doc.product_name || matchedProd?.product_name || (sku !== "-" ? `สินค้า ${sku}` : "รายการเบิกสินค้า")),
            note: doc.note,
            sku,
          });

          const fromWh = getWarehouseName(meta.from_warehouse_id || doc.from_warehouse_id || "wh-01");
          const toWh = getWarehouseName(meta.to_warehouse_id || doc.to_warehouse_id || "wh-02");
          const qty = Number(meta.qty ?? doc.qty ?? 1);
          const unit = String(meta.base_unit || doc.base_unit || matchedProd?.base_unit || "ชิ้น");
          const createdBy = String(meta.created_by_name || doc.created_by_name || doc.created_by || "ผู้ดูแลระบบ (Admin)").trim();
          const createdAt = String(doc.created_at || meta.created_at || new Date().toISOString());

          let status = String(doc.status || meta.status || "PENDING").trim().toUpperCase();
          const isDone = isTransferCompleted(docId) || isTransferCompleted(doc.document_no) || status === "APPROVED" || status === "DONE" || status === "SUCCESS" || status === "COMPLETED" || status === "สำเร็จ";
          const isWaiting = status === "WAITING_APPROVAL" || status === "WAITING" || status === "รออนุมัติ";
          const isCancelled = status === "CANCELLED" || status === "CANCEL" || status === "REJECTED" || status === "ยกเลิก";

          // 1) สรา้งใบเบิกสินค้า (มีเสมอสำหรับทุกใบเบิกที่ถูกเปิด)
          const dCreate = parseDateSafe(createdAt);
          activityList.push({
            id: `trf-create-${docId}`,
            timestamp: createdAt,
            dateKey: formatDateKey(dCreate),
            timeFormatted: formatTimeThai(dCreate),
            dateFormatted: formatDateThai(dCreate),
            relativeDayLabel: getRelativeDayLabel(dCreate),
            actorName: normalizeStaffName(createdBy),
            actionType: "CREATE_TRANSFER",
            actionLabel: "สร้างใบเบิกสินค้า",
            documentNo: docNo,
            documentHref: "/movements/transfer/history",
            productName,
            sku,
            qty,
            qtyChange: -qty,
            unit,
            locationInfo: `${fromWh} → ${toWh}`,
            status: isDone ? "COMPLETED" : isCancelled ? "CANCELLED" : isWaiting ? "WAITING_APPROVAL" : "PENDING",
          });

          // 2) เบิกสินค้า (มีเฉพาะเมื่อมีการไปปฏิบัติงานเบิกสินค้าจริงแล้วเท่านั้น)
          const hasMoved = meta.moved_at || (meta.moved_by && meta.moved_by !== "พนักงาน" && !isCancelled && status !== "PENDING");
          if (hasMoved) {
            const movedAt = meta.moved_at || meta.completed_at || doc.updated_at || createdAt;
            const dMoved = parseDateSafe(movedAt);
            activityList.push({
              id: `trf-issue-${docId}`,
              timestamp: movedAt,
              dateKey: formatDateKey(dMoved),
              timeFormatted: formatTimeThai(dMoved),
              dateFormatted: formatDateThai(dMoved),
              relativeDayLabel: getRelativeDayLabel(dMoved),
              actorName: normalizeStaffName(meta.moved_by || createdBy),
              actionType: "ISSUE",
              actionLabel: "เบิกสินค้า",
              documentNo: docNo,
              documentHref: "/movements/transfer/history",
              productName,
              sku,
              qty,
              qtyChange: -qty,
              unit,
              locationInfo: `${fromWh} → ${toWh}`,
              status: isDone ? "COMPLETED" : "PENDING",
            });
          }

          // 3) อนุมัติการเบิกสินค้า (มีเฉพาะเมื่อได้รับการอนุมัติสำเร็จแล้วเท่านั้น)
          if (isDone) {
            const approvedAt = meta.approved_at || doc.updated_at || createdAt;
            const dApprove = parseDateSafe(approvedAt);
            activityList.push({
              id: `trf-approve-${docId}`,
              timestamp: approvedAt,
              dateKey: formatDateKey(dApprove),
              timeFormatted: formatTimeThai(dApprove),
              dateFormatted: formatDateThai(dApprove),
              relativeDayLabel: getRelativeDayLabel(dApprove),
              actorName: normalizeStaffName(meta.approved_by || "แก้ว"),
              actionType: "APPROVE_TRANSFER",
              actionLabel: "อนุมัติการเบิกสินค้า",
              documentNo: docNo,
              documentHref: "/movements/transfer/history",
              productName,
              sku,
              qty,
              qtyChange: -qty,
              unit,
              locationInfo: `${fromWh} → ${toWh}`,
              status: "COMPLETED",
            });
          }
        }

        // 3.2 บันทึกรายการเอกสารรับสินค้าเข้า (RCV-...)
        // (รับสินค้าเข้าโกดัง, อนุมัติสินค้าเข้าโกดัง)
        for (const app of allApprovals) {
          if (!app) continue;
          const appDocNo = String(app.document_no || app.document_id || "").trim();
          if (!appDocNo) continue;
          processedDocNos.add(appDocNo.toLowerCase());
          if (app.document_id) processedDocNos.add(String(app.document_id).toLowerCase());

          const appStatus = String(app.status || "").toUpperCase();
          const isAppDone = appStatus === "POSTED" || appStatus === "APPROVED" || appStatus === "COMPLETED" || appStatus === "SUCCESS";
          const firstRow = Array.isArray(app.rows) && app.rows.length > 0 ? app.rows[0] : null;
          const prodName = firstRow ? String(firstRow[3] || firstRow[0]) : "รายการสินค้า";
          const sku = firstRow ? String(firstRow[0] || "-") : "-";
          const qty = firstRow ? Number(firstRow[4] || 1) : 1;
          const unit = firstRow ? String(firstRow[5] || "ชิ้น") : "ชิ้น";
          const whName = app.target_sheet || getWarehouseName(app.warehouse_id) || "โกดัง 1";
          const createdBy = app.created_by || "ผู้ดูแลระบบ (Admin)";
          const createdAt = app.document_date || app.created_at || new Date().toISOString();

          // 1) รับสินค้าเข้าโกดัง
          const dRec = parseDateSafe(createdAt);
          activityList.push({
            id: `rcv-create-${app.document_id || appDocNo}`,
            timestamp: createdAt,
            dateKey: formatDateKey(dRec),
            timeFormatted: formatTimeThai(dRec),
            dateFormatted: formatDateThai(dRec),
            relativeDayLabel: getRelativeDayLabel(dRec),
            actorName: normalizeStaffName(createdBy),
            actionType: "RECEIVE",
            actionLabel: "รับสินค้าเข้าโกดัง",
            documentNo: appDocNo,
            documentHref: "/approvals",
            productName: prodName,
            sku,
            qty,
            qtyChange: qty,
            unit,
            locationInfo: whName,
            status: isAppDone ? "COMPLETED" : appStatus,
          });

          // 2) อนุมัติสินค้าเข้าโกดัง (มีเฉพาะเมื่ออนุมัติแล้วเท่านั้น)
          if (isAppDone) {
            const approvedAt = app.updated_at || app.document_date || createdAt;
            const dApp = parseDateSafe(approvedAt);
            activityList.push({
              id: `rcv-approve-${app.document_id || appDocNo}`,
              timestamp: approvedAt,
              dateKey: formatDateKey(dApp),
              timeFormatted: formatTimeThai(dApp),
              dateFormatted: formatDateThai(dApp),
              relativeDayLabel: getRelativeDayLabel(dApp),
              actorName: normalizeStaffName(app.approved_by || "ผู้ดูแลระบบ (Admin)"),
              actionType: "APPROVE_RECEIVE",
              actionLabel: "อนุมัติสินค้าเข้าโกดัง",
              documentNo: appDocNo,
              documentHref: "/approvals",
              productName: prodName,
              sku,
              qty,
              qtyChange: qty,
              unit,
              locationInfo: whName,
              status: "COMPLETED",
            });
          }
        }

        // 3.3 บันทึกรายการเคลื่อนไหวอื่น ๆ (จัดตำแหน่งสินค้า, หรือรับเข้า/เบิกออกโดยตรงที่ไม่ได้ผูกเอกสารข้างต้น)
        for (const m of movements) {
          if (!m) continue;
          const docNo = String(m.document_no || "").trim();
          const docId = String(m.document_id || "").trim();

          // ป้องกัน Duplicate กับเอกสาร TRF และ RCV ที่ถูกบันทึกไปแล้วข้างต้น
          if (docNo && processedDocNos.has(docNo.toLowerCase())) continue;
          if (docId && processedDocNos.has(docId.toLowerCase())) continue;

          const mType = String(m.movement_type || "").toUpperCase();
          const mId = String(m.movement_id || docId || Math.random());
          const d = parseDateSafe(m.created_at);
          const dateKey = formatDateKey(d);
          const timeFormatted = formatTimeThai(d);
          const dateFormatted = formatDateThai(d);
          const relativeDayLabel = getRelativeDayLabel(d);
          const actor = String(m.created_by_name || m.created_by || "ผู้ดูแลระบบ (Admin)").trim();

          let actionType: WarehouseActionType;
          let actionLabel: string;
          let docHref = "/movements/history";

          if (mType.includes("MOVE") || docNo.startsWith("MOV-")) {
            actionType = "MOVE";
            actionLabel = "จัดตำแหน่งสินค้า";
            docHref = "/movements/history";
          } else if (mType === "RECEIVE" || mType === "OPENING" || docNo.startsWith("RCV-")) {
            actionType = "RECEIVE";
            actionLabel = "รับสินค้าเข้าโกดัง";
            docHref = "/movements/receive/history";
          } else if (mType === "ISSUE" || mType === "ISSUE_OUT" || docNo.startsWith("ISS-")) {
            actionType = "ISSUE";
            actionLabel = "เบิกสินค้า";
            docHref = "/movements/history";
          } else {
            continue; // ข้าม movement อื่นๆ ที่เป็น transfer_in / transfer_out ของเอกสารเก่า
          }

          const locParts = [];
          if (m.warehouse_name) locParts.push(m.warehouse_name);
          if (m.location_code && m.location_code !== m.warehouse_name) locParts.push(`(${m.location_code})`);

          activityList.push({
            id: `mov-${mId}`,
            timestamp: m.created_at || new Date().toISOString(),
            dateKey,
            timeFormatted,
            dateFormatted,
            relativeDayLabel,
            actorName: normalizeStaffName(actor),
            actionType,
            actionLabel,
            documentNo: docNo || "-",
            documentHref: docHref,
            productName: m.product_name || (m.sku ? `สินค้า ${m.sku}` : "รายการสินค้า"),
            sku: m.sku || "-",
            qty: Math.abs(Number(m.qty_change ?? 1)),
            qtyChange: Number(m.qty_change ?? 1),
            unit: "ชิ้น",
            locationInfo: locParts.length > 0 ? locParts.join(" ") : "-",
            status: "COMPLETED",
          });
        }

        // 3.4 บันทึกรายการผลิตสินค้า (Action 8: ผลิตสินค้า จาก Production Orders)
        for (const po of rawProduction) {
          if (!po) continue;
          const poDate = po.created_at || po.document_date || new Date().toISOString();
          const dPo = parseDateSafe(poDate);
          const poItems = Array.isArray(po.items) && po.items.length > 0
            ? po.items
            : [{ fg_name: "สินค้าผลิต", fg_sku: "-", quantity: po.total_fg_qty || 1, fg_unit: "ชิ้น", target_warehouse_name: "แผนกผลิต" }];

          for (const item of poItems) {
            activityList.push({
              id: `prod-${po.id || po.order_no}-${item.fg_sku || Math.random()}`,
              timestamp: poDate,
              dateKey: formatDateKey(dPo),
              timeFormatted: formatTimeThai(dPo),
              dateFormatted: formatDateThai(dPo),
              relativeDayLabel: getRelativeDayLabel(dPo),
              actorName: normalizeStaffName(po.created_by_name || po.created_by || "ผู้ดูแลระบบ (Admin)"),
              actionType: "PRODUCTION",
              actionLabel: "ผลิตสินค้า",
              documentNo: po.order_no || po.document_id || "-",
              documentHref: "/production/history",
              productName: item.fg_name || item.fg_sku || "สินค้าผลิต",
              sku: item.fg_sku || "-",
              qty: Number(item.quantity || 1),
              qtyChange: Number(item.quantity || 1),
              unit: item.fg_unit || "ชิ้น",
              locationInfo: item.target_warehouse_name || "แผนกผลิต",
              status: po.status || "COMPLETED",
            });
          }
        }

        // 3.5 บันทึกรายการนำสินค้าเข้า Express (Action 3: นำสินค้าเข้า Express)
        // บันทึกเฉพาะรายการที่นำเข้าสำเร็จแล้ว (status === "IMPORTED")
        for (const exp of expressItems) {
          if (!exp || exp.status !== "IMPORTED") continue;
          const expDate = exp.imported_at || exp.tagged_at || new Date().toISOString();
          const dExp = parseDateSafe(expDate);

          activityList.push({
            id: `exp-${exp.id}`,
            timestamp: expDate,
            dateKey: formatDateKey(dExp),
            timeFormatted: formatTimeThai(dExp),
            dateFormatted: formatDateThai(dExp),
            relativeDayLabel: getRelativeDayLabel(dExp),
            actorName: normalizeStaffName("ผู้ดูแลระบบ (Admin)"),
            actionType: "EXPRESS_IMPORT",
            actionLabel: "นำสินค้าเข้า Express",
            documentNo: exp.document_no || "-",
            documentHref: "/express-import",
            productName: exp.product_name || (exp.sku ? `สินค้า ${exp.sku}` : "นำเข้า Express"),
            sku: exp.sku || "-",
            qty: Number(exp.quantity || 1),
            qtyChange: Number(exp.quantity || 1),
            unit: "ชิ้น",
            locationInfo: exp.warehouse || "นำเข้า Express",
            status: "IMPORTED",
          });
        }

        activityList.sort(
          (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );

        const pendingCount = allApprovals.filter((app: any) => {
          const s = String(app.status || "").trim().toUpperCase();
          const isDoneOrCancelled = [
            "POSTED",
            "APPROVED",
            "COMPLETED",
            "SUCCESS",
            "REJECTED",
            "REJECT",
            "CANCELLED",
          ].includes(s);
          return !isDoneOrCancelled && (s === "PENDING" || s === "DRAFT" || s === "NEW" || s === "WAITING_APPROVAL" || s === "WAITING" || s === "รออนุมัติ" || !s);
        }).length;

        setActivities(activityList);
        setWarehouseQtyMap(qtyCounts);
        setStats({
          totalProducts: totalWarehouseQty > 0
            ? totalWarehouseQty
            : products.reduce((acc: number, p: any) => acc + (Number(p.quantity ?? p.qty ?? 0) || 0), 0),
          pendingApprovals: pendingCount,
          activeWarehouses: 6,
          totalMovements: movRes.data?.total || movements.length || 0,
          lowStockCount: balances.filter((item: { status?: string }) => item.status === "LOW").length,
          outOfStockCount: balances.filter((item: { status?: string }) => item.status === "OUT" || item.status === "NEGATIVE").length,
        });
      } catch (error) {
        console.error("Admin dashboard fetch error:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const warehouseList = [
    { id: 1, name: "โกดัง 1" },
    { id: 2, name: "โกดัง 2" },
    { id: 3, name: "โกดัง 3" },
    { id: 4, name: "โกดัง 4" },
    { id: 5, name: "โกดัง 5" },
    { id: 6, name: "สำนักงานใหญ่" },
  ];

  const chartData = warehouseList.map((wh) => {
    const qty = warehouseQtyMap[wh.id] ?? 0;
    return {
      name: wh.name,
      "จำนวนสินค้า": qty,
      quantity: qty,
    };
  });

  const now = new Date();
  const todayKey = formatDateKey(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = formatDateKey(yesterday);

  const uniqueActors = Array.from(
    new Set(activities.map((a) => a.actorName).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b, "th"));

  const filteredActivities = activities.filter((act) => {
    if (activityFilterDate === "TODAY") {
      if (act.dateKey !== todayKey) return false;
    } else if (activityFilterDate === "YESTERDAY") {
      if (act.dateKey !== yesterdayKey) return false;
    } else if (activityFilterDate !== "ALL") {
      if (act.dateKey !== activityFilterDate) return false;
    }

    if (activityFilterActor !== "ALL" && act.actorName !== activityFilterActor) {
      return false;
    }

    if (activityFilterAction !== "ALL" && act.actionType !== activityFilterAction) {
      return false;
    }

    if (activitySearch.trim()) {
      const q = activitySearch.toLowerCase().trim();
      const matchDoc = act.documentNo.toLowerCase().includes(q);
      const matchProd = act.productName.toLowerCase().includes(q);
      const matchSku = act.sku.toLowerCase().includes(q);
      const matchActor = act.actorName.toLowerCase().includes(q);
      const matchLoc = act.locationInfo.toLowerCase().includes(q);
      if (!matchDoc && !matchProd && !matchSku && !matchActor && !matchLoc) {
        return false;
      }
    }

    return true;
  });

  const groupedByDate = new Map<
    string,
    { label: string; dateFormatted: string; items: ActivityItem[] }
  >();

  for (const act of filteredActivities) {
    if (!groupedByDate.has(act.dateKey)) {
      groupedByDate.set(act.dateKey, {
        label: act.relativeDayLabel,
        dateFormatted: act.dateFormatted,
        items: [],
      });
    }
    groupedByDate.get(act.dateKey)!.items.push(act);
  }

  return (
    <div className="admin-dashboard min-h-full bg-[#f4f6f8] w-full max-w-full space-y-6">
      <div className="w-full space-y-6 fade-in">
        {/* Top 3 Stat Cards Grid (Fluid 1/3 Columns) */}
        <section className="w-full">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 sm:gap-4 w-full">
            <StatCard
              label="รายการรออนุมัติ"
              value={stats.pendingApprovals}
              href="/approvals"
              loading={loading}
              color="emerald"
              bars={[35, 50, 30, 65, 95, 75, 100]}
            />
            <StatCard
              label="สินค้าทั้งหมด"
              value={stats.totalProducts}
              href="/products"
              loading={loading}
              color="cyan"
              bars={[45, 70, 85, 55, 75, 100, 90]}
            />
            <StatCard
              label="การเคลื่อนไหวทั้งหมด"
              value={stats.totalMovements}
              href="/movements/history"
              loading={loading}
              color="orange"
              bars={[50, 70, 90, 60, 100, 85, 95]}
            />
          </div>
        </section>

        {/* 2-Column Responsive Layout: Left 60% (Chart & Warehouse Summary) | Right 40% (Warehouse Summary Details) */}
        <div className="flex flex-col lg:flex-row gap-5 lg:gap-6 items-stretch w-full">
          {/* Left Column: Warehouse Inventory Chart & Summary Panel (60% width) */}
          <section className="admin-panel p-5 sm:p-6 lg:p-7 w-full lg:w-[60%] shrink-0 flex flex-col justify-between">
            <div>
              <div className="mb-4 flex items-end justify-between">
                <div>
                  <p className="admin-eyebrow">สรุปตามคลังสินค้า</p>
                  <h2 className="admin-panel-title text-base sm:text-lg">ปริมาณสินค้าแยกตามคลังสินค้า</h2>
                </div>
                <div className="hidden items-center gap-2 text-xs font-bold text-emerald-700 sm:flex">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  หน่วย: ชิ้น
                </div>
              </div>

              <div className="h-72 sm:h-80 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 12, right: 12, left: 10, bottom: 20 }} barCategoryGap="20%">
                    <CartesianGrid vertical={false} stroke="#cbd5e1" strokeDasharray="4 4" />
                    <XAxis
                      dataKey="name"
                      axisLine={false}
                      tickLine={false}
                      interval={0}
                      tick={{ fill: "#334155", fontSize: 12, fontWeight: 700 }}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: "#475569", fontSize: 11, fontWeight: 600 }}
                      tickFormatter={(val) => {
                        if (val >= 1000000) return `${(val / 1000000).toFixed(val % 1000000 === 0 ? 0 : 1)}M`;
                        if (val >= 1000) return `${(val / 1000).toFixed(0)}k`;
                        return val;
                      }}
                      allowDecimals={false}
                    />
                    <Tooltip
                      cursor={{ fill: "rgba(226, 232, 240, 0.5)" }}
                      contentStyle={{
                        backgroundColor: "#ffffff",
                        border: "1px solid #cbd5e1",
                        borderRadius: "12px",
                        fontSize: "12px",
                        fontWeight: "600",
                        boxShadow: "0 10px 25px -5px rgba(0,0,0,0.1)",
                        padding: "8px 12px",
                      }}
                      formatter={(val: any) => [`${Number(val).toLocaleString()} ชิ้น`, "จำนวนสินค้าคงเหลือ"]}
                    />
                    <Bar
                      dataKey="จำนวนสินค้า"
                      radius={[8, 8, 0, 0]}
                      maxBarSize={56}
                    >
                      {chartData.map((entry, index) => {
                        const colors = ["#10b981", "#06b6d4", "#6366f1", "#f59e0b", "#8b5cf6", "#ec4899"];
                        return <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />;
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>

          {/* Right Column: Warehouse Inventory Summary (40% width) */}
          <div className="w-full lg:flex-1 min-w-0 flex flex-col">
            {/* Card 1: Warehouse Inventory Summary for All Warehouses */}
            <div className="admin-panel p-5 sm:p-6 lg:p-7 bg-white rounded-2xl border border-slate-200/90 shadow-sm flex-1 flex flex-col justify-between">
              <div className="mb-3 pb-3 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-extrabold text-slate-900 leading-tight">
                    ข้อมูลสินค้าในโกดังทุกโกดัง
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">ภาพรวมสต็อกแยกตามคลัง</p>
                </div>
                <span className="text-[11px] font-bold text-slate-400 bg-slate-50 border border-slate-200 px-2.5 py-0.5 rounded-full">
                  6 คลัง
                </span>
              </div>

              <div className="divide-y divide-slate-100 flex-1 flex flex-col justify-between">
                {chartData.map((item, index) => {
                  const colors = ["#10b981", "#06b6d4", "#6366f1", "#f59e0b", "#8b5cf6", "#ec4899"];
                  const barColor = colors[index % colors.length];
                  const itemQty = item["จำนวนสินค้า"] || 0;

                  return (
                    <div key={item.name} className="py-3.5 sm:py-4 flex items-center justify-between text-xs flex-1 first:pt-1 last:pb-1">
                      <span className="flex items-center gap-2.5 font-bold text-slate-800">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: barColor }}
                        />
                        <span>{item.name}</span>
                      </span>
                      <div className="flex items-center gap-1.5 font-mono">
                        <span className="font-extrabold text-slate-900 text-xs">
                          {itemQty.toLocaleString()}
                        </span>
                        <span className="text-xs text-slate-500 font-sans font-normal">
                          ชิ้น
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Section: Daily Activity & Audit Log (ประวัติกิจกรรมการทำงานแยกตามวัน) */}
        <section className="admin-panel p-5 sm:p-6 lg:p-7 bg-white rounded-2xl border border-slate-200/90 shadow-sm space-y-5">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                <h2 className="admin-panel-title text-base sm:text-lg font-bold text-slate-900">
                  ประวัติการทำงาน (ใครทำอะไรไปบ้าง)
                </h2>
                <span className="text-xs font-extrabold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                  แยกตามวัน
                </span>
                <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                  {filteredActivities.length} รายการ
                </span>
              </div>
              <p className="text-xs sm:text-sm text-slate-600 mt-1 font-medium">
                บันทึกประวัติการทำงานในคลังสินค้า ว่าวันนั้นๆ ใครทำอะไรไปบ้าง
              </p>
            </div>
            <Link
              href="/movements/history"
              className="text-xs sm:text-sm font-bold text-indigo-600 hover:text-indigo-800 hover:underline flex items-center gap-1 shrink-0 self-start sm:self-center"
            >
              ดูประวัติเคลื่อนไหวทั้งหมด →
            </Link>
          </div>

          {/* Filter Toolbar */}
          <div className="space-y-3 p-3.5 bg-slate-50/80 rounded-2xl border border-slate-200/80">
            {/* Quick Date Pills & Date Picker */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-slate-600 mr-1">เลือกวัน:</span>
              <button
                type="button"
                onClick={() => setActivityFilterDate("ALL")}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                  activityFilterDate === "ALL"
                    ? "bg-indigo-600 text-white border-indigo-600 shadow-xs"
                    : "bg-white text-slate-700 border-slate-200 hover:bg-slate-100"
                }`}
              >
                ทั้งหมด
              </button>
              <button
                type="button"
                onClick={() => setActivityFilterDate("TODAY")}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                  activityFilterDate === "TODAY"
                    ? "bg-indigo-600 text-white border-indigo-600 shadow-xs"
                    : "bg-white text-slate-700 border-slate-200 hover:bg-slate-100"
                }`}
              >
                วันนี้
              </button>
              <button
                type="button"
                onClick={() => setActivityFilterDate("YESTERDAY")}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                  activityFilterDate === "YESTERDAY"
                    ? "bg-indigo-600 text-white border-indigo-600 shadow-xs"
                    : "bg-white text-slate-700 border-slate-200 hover:bg-slate-100"
                }`}
              >
                เมื่อวานนี้
              </button>

              <div className="flex items-center gap-1.5 ml-auto sm:ml-2">
                <span className="text-xs text-slate-500 font-medium">ระบุวัน:</span>
                <input
                  type="date"
                  aria-label="เลือกวันที่ต้องการดู"
                  value={
                    activityFilterDate !== "ALL" &&
                    activityFilterDate !== "TODAY" &&
                    activityFilterDate !== "YESTERDAY"
                      ? activityFilterDate
                      : ""
                  }
                  onChange={(e) => setActivityFilterDate(e.target.value || "ALL")}
                  className="px-2.5 py-1 rounded-xl text-xs font-bold bg-white border border-slate-200 text-slate-800 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 cursor-pointer shadow-2xs"
                />
              </div>
            </div>

            {/* Filter by Actor, Action Type, and Search */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
              {/* Actor Filter */}
              <div className="relative">
                <select
                  value={activityFilterActor}
                  onChange={(e) => setActivityFilterActor(e.target.value)}
                  aria-label="กรองตามผู้ทำรายการ"
                  className="w-full pl-3 pr-8 py-2 rounded-xl text-xs font-bold bg-white border border-slate-200 text-slate-800 focus:outline-none focus:border-indigo-500 cursor-pointer shadow-2xs"
                >
                  <option value="ALL">👤 ผู้ทำรายการ: ทุกคน</option>
                  {uniqueActors.map((actor) => (
                    <option key={actor} value={actor}>
                      👤 {actor}
                    </option>
                  ))}
                </select>
              </div>

              {/* Action Type Filter */}
              <div className="relative">
                <select
                  value={activityFilterAction}
                  onChange={(e) => setActivityFilterAction(e.target.value)}
                  aria-label="กรองตามสิ่งที่ทำ"
                  className="w-full pl-3 pr-8 py-2 rounded-xl text-xs font-bold bg-white border border-slate-200 text-slate-800 focus:outline-none focus:border-indigo-500 cursor-pointer shadow-2xs"
                >
                  <option value="ALL">📋 สิ่งที่ทำ: ทั้งหมด</option>
                  <option value="RECEIVE">รับสินค้าเข้าโกดัง</option>
                  <option value="APPROVE_RECEIVE">อนุมัติสินค้าเข้าโกดัง</option>
                  <option value="EXPRESS_IMPORT">นำสินค้าเข้า Express</option>
                  <option value="MOVE">จัดตำแหน่งสินค้า</option>
                  <option value="CREATE_TRANSFER">สร้างใบเบิกสินค้า</option>
                  <option value="ISSUE">เบิกสินค้า</option>
                  <option value="APPROVE_TRANSFER">อนุมัติการเบิกสินค้า</option>
                  <option value="PRODUCTION">ผลิตสินค้า</option>
                </select>
              </div>

              {/* Search Box */}
              <div className="relative">
                <input
                  type="text"
                  value={activitySearch}
                  onChange={(e) => setActivitySearch(e.target.value)}
                  placeholder="ค้นหาสินค้า, SKU, ผู้ทำ, เอกสาร..."
                  className="w-full pl-8 pr-7 py-2 rounded-xl text-xs font-medium bg-white border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500 shadow-2xs"
                />
                <svg
                  className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
                {activitySearch && (
                  <button
                    type="button"
                    onClick={() => setActivitySearch("")}
                    aria-label="ล้างคำค้นหา"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold cursor-pointer"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Activity Content Area */}
          {loading ? (
            <div className="space-y-3 py-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-14 bg-slate-50 animate-pulse rounded-xl" />
              ))}
            </div>
          ) : groupedByDate.size === 0 ? (
            <div className="py-12 text-center flex flex-col items-center justify-center space-y-2 text-slate-400 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
              <span className="text-3xl">📋</span>
              <p className="text-sm font-bold text-slate-700">ไม่พบประวัติการทำงานตามเงื่อนไขที่เลือก</p>
              <p className="text-xs text-slate-500">ลองเปลี่ยนวันที่ หรือล้างตัวกรองเพื่อดูข้อมูลทั้งหมด</p>
              {(activityFilterDate !== "ALL" ||
                activityFilterActor !== "ALL" ||
                activityFilterAction !== "ALL" ||
                activitySearch) && (
                <button
                  type="button"
                  onClick={() => {
                    setActivityFilterDate("ALL");
                    setActivityFilterActor("ALL");
                    setActivityFilterAction("ALL");
                    setActivitySearch("");
                  }}
                  className="mt-2 px-3.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-xs rounded-xl transition-all cursor-pointer border border-indigo-200 shadow-2xs"
                >
                  ล้างตัวกรองทั้งหมด
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              {Array.from(groupedByDate.entries()).map(([dateKey, group]) => (
                <div
                  key={dateKey}
                  className="border border-slate-200/90 rounded-2xl overflow-hidden bg-white shadow-xs"
                >
                  {/* Date Header Ribbon */}
                  <div className="bg-slate-50/90 px-4 py-2.5 border-b border-slate-200/90 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-indigo-600" />
                      <span className="font-extrabold text-slate-900 text-sm sm:text-base tracking-tight">
                        📅 {group.label}
                      </span>
                    </div>
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-white text-slate-700 border border-slate-200 shadow-2xs">
                      {group.items.length} รายการ
                    </span>
                  </div>

                  {/* Desktop Table View */}
                  <div className="hidden sm:block overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-100 bg-slate-50/40 text-slate-500 font-bold">
                          <th className="py-2.5 pl-4 pr-3 whitespace-nowrap">เวลา</th>
                          <th className="py-2.5 px-3 whitespace-nowrap">ผู้ทำรายการ</th>
                          <th className="py-2.5 px-3 whitespace-nowrap">สิ่งที่ทำ</th>
                          <th className="py-2.5 px-3">สินค้า</th>
                          <th className="py-2.5 px-3 text-right whitespace-nowrap">จำนวน</th>
                          <th className="py-2.5 px-3 whitespace-nowrap">โกดัง / ตำแหน่ง</th>
                          <th className="py-2.5 pl-3 pr-4 text-right whitespace-nowrap">เอกสาร</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {group.items.map((item) => (
                          <tr key={item.id} className="hover:bg-slate-50/80 transition-colors group">
                            {/* Time */}
                            <td className="py-3 pl-4 pr-3 whitespace-nowrap font-mono font-bold text-slate-600">
                              {item.timeFormatted}
                            </td>

                            {/* Actor (Who) */}
                            <td className="py-3 px-3 whitespace-nowrap">
                              <div className="flex items-center gap-2">
                                <div className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-800 flex items-center justify-center font-extrabold text-[11px] shrink-0 border border-indigo-200/60">
                                  {item.actorName.slice(0, 1) || "U"}
                                </div>
                                <span className="font-bold text-slate-900 max-w-[120px] truncate">
                                  {item.actorName}
                                </span>
                              </div>
                            </td>

                            {/* Action (What) */}
                            <td className="py-3 px-3 whitespace-nowrap">
                              {renderActionBadge(item.actionType, item.actionLabel)}
                            </td>

                            {/* Product */}
                            <td className="py-3 px-3 max-w-[240px]">
                              <div className="font-bold text-slate-900 truncate" title={item.productName}>
                                {item.productName}
                              </div>
                              <div className="font-mono text-[11px] text-slate-500 font-semibold mt-0.5">
                                {item.sku}
                              </div>
                            </td>

                            {/* Quantity */}
                            <td className="py-3 px-3 text-right whitespace-nowrap font-mono">
                              <span
                                className={`font-black text-xs ${
                                  item.actionType === "RECEIVE"
                                    ? "text-emerald-700"
                                    : item.actionType === "ISSUE"
                                    ? "text-rose-700"
                                    : "text-slate-900"
                                }`}
                              >
                                {item.actionType === "RECEIVE"
                                  ? `+${item.qty.toLocaleString()}`
                                  : item.actionType === "ISSUE"
                                  ? `-${item.qty.toLocaleString()}`
                                  : item.qty.toLocaleString()}
                              </span>
                              <span className="text-[11px] text-slate-500 font-sans ml-1">
                                {item.unit}
                              </span>
                            </td>

                            {/* Location / Warehouse */}
                            <td className="py-3 px-3 whitespace-nowrap">
                              <span className="text-xs font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200/60">
                                {item.locationInfo}
                              </span>
                            </td>

                            {/* Document Link */}
                            <td className="py-3 pl-3 pr-4 text-right whitespace-nowrap font-mono">
                              <Link
                                href={item.documentHref}
                                className="font-bold text-indigo-600 hover:text-indigo-800 hover:underline"
                              >
                                {item.documentNo}
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile Stacked Card View */}
                  <div className="block sm:hidden divide-y divide-slate-100">
                    {group.items.map((item) => (
                      <div key={item.id} className="p-3.5 space-y-2 hover:bg-slate-50/60 transition-colors">
                        {/* Top: Time & Action & Qty */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-xs font-bold text-slate-500">
                              {item.timeFormatted}
                            </span>
                            {renderActionBadge(item.actionType, item.actionLabel)}
                          </div>
                          <span
                            className={`font-mono font-black text-xs ${
                              item.actionType === "RECEIVE"
                                ? "text-emerald-700"
                                : item.actionType === "ISSUE"
                                ? "text-rose-700"
                                : "text-slate-900"
                            }`}
                          >
                            {item.actionType === "RECEIVE"
                              ? `+${item.qty.toLocaleString()}`
                              : item.actionType === "ISSUE"
                              ? `-${item.qty.toLocaleString()}`
                              : item.qty.toLocaleString()}{" "}
                            {item.unit}
                          </span>
                        </div>

                        {/* Product info */}
                        <div>
                          <div className="font-bold text-slate-900 text-sm line-clamp-1">
                            {item.productName}
                          </div>
                          <div className="font-mono text-xs text-slate-500 font-semibold">
                            {item.sku}
                          </div>
                        </div>

                        {/* Bottom: Actor & Location & Document */}
                        <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1 text-xs text-slate-600 border-t border-slate-100">
                          <div className="flex items-center gap-1.5">
                            <div className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-800 flex items-center justify-center font-bold text-[10px] shrink-0">
                              {item.actorName.slice(0, 1) || "U"}
                            </div>
                            <span className="font-bold text-slate-800">{item.actorName}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-semibold bg-slate-100 px-1.5 py-0.5 rounded text-slate-700">
                              {item.locationInfo}
                            </span>
                            <Link
                              href={item.documentHref}
                              className="font-mono text-[11px] font-bold text-indigo-600 hover:underline"
                            >
                              {item.documentNo}
                            </Link>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

      </div>
    </div>
  );
}

function parseDateSafe(dateStr?: string): Date {
  if (!dateStr) return new Date();
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) return d;
  return new Date();
}

function formatDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatTimeThai(d: Date): string {
  return (
    d.toLocaleTimeString("th-TH", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }) + " น."
  );
}

function formatDateThai(d: Date): string {
  return d.toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function getRelativeDayLabel(d: Date): string {
  const now = new Date();
  const todayKey = formatDateKey(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = formatDateKey(yesterday);
  const targetKey = formatDateKey(d);

  if (targetKey === todayKey) {
    return `วันนี้ (${formatDateThai(d)})`;
  }
  if (targetKey === yesterdayKey) {
    return `เมื่อวานนี้ (${formatDateThai(d)})`;
  }
  return `วันที่ ${formatDateThai(d)}`;
}

function renderActionBadge(
  actionType: ActivityItem["actionType"],
  actionLabel: string
) {
  switch (actionType) {
    case "RECEIVE":
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-2xs whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          {actionLabel}
        </span>
      );
    case "APPROVE_RECEIVE":
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-teal-50 text-teal-700 border border-teal-200 shadow-2xs whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-teal-500" />
          {actionLabel}
        </span>
      );
    case "EXPRESS_IMPORT":
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200 shadow-2xs whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
          {actionLabel}
        </span>
      );
    case "MOVE":
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-sky-50 text-sky-700 border border-sky-200 shadow-2xs whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />
          {actionLabel}
        </span>
      );
    case "CREATE_TRANSFER":
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200 shadow-2xs whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
          {actionLabel}
        </span>
      );
    case "ISSUE":
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200 shadow-2xs whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
          {actionLabel}
        </span>
      );
    case "APPROVE_TRANSFER":
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 shadow-2xs whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
          {actionLabel}
        </span>
      );
    case "PRODUCTION":
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-purple-50 text-purple-700 border border-purple-200 shadow-2xs whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
          {actionLabel}
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200 shadow-2xs whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
          {actionLabel}
        </span>
      );
  }
}

const STAFF_NORMALIZATION: Record<string, string> = {
  admin: "ผู้ดูแลระบบ (Admin)",
  แอดมิน: "ผู้ดูแลระบบ (Admin)",
  "ผู้ดูแลระบบ admin": "ผู้ดูแลระบบ (Admin)",
  "ผู้ดูแลระบบ (admin)": "ผู้ดูแลระบบ (Admin)",
  "ผู้ดูแลระบบ": "ผู้ดูแลระบบ (Admin)",
  tak: "ตั๊ก (Admin)",
  "ตั๊ก admin": "ตั๊ก (Admin)",
  "ติ๊ก admin": "ตั๊ก (Admin)",
  "ตั๊ก (admin)": "ตั๊ก (Admin)",
  "ติ๊ก": "ตั๊ก (Admin)",
  "ตั๊ก": "ตั๊ก (Admin)",
  pui: "ปุ๋ย (Admin)",
  "ปุ๋ย admin": "ปุ๋ย (Admin)",
  "ปุ๋ย (admin)": "ปุ๋ย (Admin)",
  "ปุ๋ย": "ปุ๋ย (Admin)",
  kaew: "แก้ว",
  somsak: "ป้าพิส พิสมัย",
  wipada: "น้าดา ณัฐพร",
  "น้ำดา ณัฐพร": "น้าดา ณัฐพร",
  narongdet: "ตา พินตา",
  kanokwan: "พลอย พลอยนภา",
  thanapol: "ธนพล วงศ์สว่าง",
  somchai: "สมชาย (พนักงาน)",
};

function normalizeStaffName(rawName?: string): string {
  if (!rawName) return "ผู้ดูแลระบบ (Admin)";
  const clean = rawName.trim();
  if (!clean || clean === "พนักงาน") return "ผู้ดูแลระบบ (Admin)";
  const lower = clean.toLowerCase();
  if (DYNAMIC_STAFF_MAP.has(lower)) {
    const dyn = DYNAMIC_STAFF_MAP.get(lower)!;
    return STAFF_NORMALIZATION[dyn.toLowerCase()] || dyn;
  }
  if (STAFF_NORMALIZATION[lower]) {
    return STAFF_NORMALIZATION[lower];
  }
  return clean;
}

function MiniBarChart({ bars, barColorClass }: { bars: number[]; barColorClass: string }) {
  return (
    <div className="flex items-end gap-[3px] h-9 w-14 shrink-0 pb-0.5">
      {bars.map((heightPct, idx) => {
        const opacity = idx >= bars.length - 2 ? 1 : 0.4 + idx * 0.09;
        return (
          <span
            key={idx}
            className={`w-[6px] rounded-full transition-all duration-300 ${barColorClass}`}
            style={{
              height: `${Math.max(18, heightPct)}%`,
              opacity: opacity,
            }}
          />
        );
      })}
    </div>
  );
}

function StatCard({
  label,
  value,
  href,
  loading,
  color,
  bars,
}: {
  label: string;
  value: number;
  href: string;
  loading: boolean;
  color: "emerald" | "cyan" | "indigo" | "orange";
  bars: number[];
}) {
  const colorMap = {
    emerald: "bg-emerald-500",
    cyan: "bg-cyan-500",
    indigo: "bg-indigo-500",
    orange: "bg-orange-500",
  };

  return (
    <Link
      href={href}
      className="group relative overflow-hidden rounded-2xl bg-white p-5 shadow-md shadow-slate-200/80 transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:shadow-slate-300/70 sm:p-6"
    >
      <p className="text-sm font-semibold text-slate-600 mb-3">{label}</p>

      <div className="flex items-center justify-between gap-3">
        <p className={`text-3xl font-extrabold tracking-tight text-slate-950 tabular-nums ${loading ? "animate-pulse text-slate-200" : ""}`}>
          {loading ? "—" : value.toLocaleString()}
        </p>
        <MiniBarChart bars={bars} barColorClass={colorMap[color]} />
      </div>
    </Link>
  );
}

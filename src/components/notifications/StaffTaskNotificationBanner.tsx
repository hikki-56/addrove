"use client";

import { useEffect, useState } from "react";
import { useTabAuth } from "@/context/TabAuthContext";
import type { Document, Product, Warehouse } from "@/types/models";

interface AssignedTaskItem {
  doc: Document;
  meta: {
    from_warehouse_id: string;
    to_warehouse_id: string;
    from_location_id?: string;
    to_location_id?: string;
    product_id: string;
    qty: number;
    assigned_to_name?: string;
    original_note?: string;
  };
}

interface StaffTaskNotificationBannerProps {
  products: Product[];
  warehouses: Warehouse[];
  onTaskCompleted?: () => void;
}

export default function StaffTaskNotificationBanner({
  products,
  warehouses,
  onTaskCompleted,
}: StaffTaskNotificationBannerProps) {
  const { token: tabToken } = useTabAuth();
  const [tasks, setTasks] = useState<AssignedTaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [executingDocId, setExecutingDocId] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const getAuthHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const storedToken =
      tabToken ||
      (typeof window !== "undefined"
        ? localStorage.getItem("stockify_tab_token")
        : null);

    if (storedToken) {
      headers["x-tab-token"] = storedToken;
      headers["Authorization"] = `Bearer ${storedToken}`;
    }
    return headers;
  };

  const fetchAssignedTasks = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/movements/transfer/assigned", {
        headers: getAuthHeaders(),
      });
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        const parsedTasks: AssignedTaskItem[] = json.data.map((doc: Document) => {
          let meta = {};
          try {
            meta = JSON.parse(doc.note || "{}");
          } catch {}
          return { doc, meta };
        });
        setTasks(parsedTasks);
      }
    } catch (e) {
      console.error("Failed to fetch assigned transfer tasks", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAssignedTasks();
    const interval = setInterval(fetchAssignedTasks, 10000); // Poll every 10s for new assigned tasks
    return () => clearInterval(interval);
  }, [tabToken]);

  const handleCompleteTask = async (task: AssignedTaskItem) => {
    setSuccessMsg("");
    setErrorMsg("");
    setExecutingDocId(task.doc.document_id);

    try {
      const res = await fetch(`/api/movements/transfer/${task.doc.document_id}/complete`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          to_location_id: task.meta.to_location_id || "A1",
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || json.message || "ดำเนินการย้ายสินค้าไม่สำเร็จ");
      }

      setSuccessMsg(`✓ ดำเนินการย้ายสินค้าตามใบงาน ${task.doc.document_no} เรียบร้อยแล้ว! สต็อกถูกปรับย้ายตำแหน่งทันที`);
      await fetchAssignedTasks();
      if (onTaskCompleted) onTaskCompleted();
    } catch (err: any) {
      setErrorMsg(err.message || "เกิดข้อผิดพลาดในการยืนยันย้ายสินค้า");
    } finally {
      setExecutingDocId(null);
    }
  };

  if (loading && tasks.length === 0) return null;
  if (tasks.length === 0 && !successMsg && !errorMsg) return null;

  const getProductName = (pid: string) => {
    const p = products.find(
      (item) => item.product_id === pid || item.sku === pid || item.sku === pid.replace(/^prod-/, "")
    );
    return p ? `${p.sku} - ${p.product_name}` : pid;
  };

  const getWarehouseName = (wid: string) => {
    const w = warehouses.find((item) => item.warehouse_id === wid);
    return w ? w.warehouse_name : wid;
  };

  return (
    <div className="space-y-3 w-full animate-fadeIn">
      {successMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-semibold flex items-center justify-between shadow-lg shadow-emerald-950/20">
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg("")} className="text-emerald-400 font-bold px-2">✕</button>
        </div>
      )}

      {errorMsg && (
        <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-semibold flex items-center justify-between shadow-lg shadow-rose-950/20">
          <span>⚠️ {errorMsg}</span>
          <button onClick={() => setErrorMsg("")} className="text-rose-400 font-bold px-2">✕</button>
        </div>
      )}

      {tasks.length > 0 && (
        <div className="rounded-2xl p-4 bg-amber-950/30 border border-amber-500/40 text-amber-200 shadow-xl space-y-3">
          <div className="flex items-center justify-between border-b border-amber-500/20 pb-2">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-amber-400 animate-ping" />
              <span className="font-extrabold text-sm text-amber-300 flex items-center gap-1.5">
                🔔 คุณมีใบสั่งย้ายสินค้าที่ได้รับมอบหมาย ({tasks.length} รายการ)
              </span>
            </div>
            <button
              onClick={fetchAssignedTasks}
              className="text-xs text-amber-400 hover:text-amber-200 font-medium underline"
            >
              🔄 อัปเดตรายการ
            </button>
          </div>

          <div className="space-y-3">
            {tasks.map(({ doc, meta }) => {
              const isExecuting = executingDocId === doc.document_id;
              const prodName = getProductName(meta.product_id);
              const fromWhName = getWarehouseName(meta.from_warehouse_id);
              const toWhName = getWarehouseName(meta.to_warehouse_id);

              return (
                <div
                  key={doc.document_id}
                  className="p-3.5 rounded-xl bg-black/40 border border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-100 bg-amber-500/20 px-2 py-0.5 rounded text-[11px] border border-amber-500/30">
                        {doc.document_no}
                      </span>
                      <span className="font-semibold text-slate-200">{prodName}</span>
                      <span className="font-extrabold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">
                        จำนวน {meta.qty} ชิ้น
                      </span>
                    </div>

                    <div className="text-slate-300 flex flex-wrap items-center gap-2 text-[11px]">
                      <span>📍 จาก: <strong className="text-rose-300">{fromWhName} ({meta.from_location_id || "A1"})</strong></span>
                      <span>➡️ ไปยัง: <strong className="text-emerald-300">{toWhName} ({meta.to_location_id || "A1"})</strong></span>
                    </div>

                    {meta.original_note && (
                      <p className="text-slate-400 text-[11px] italic">💬 หมายเหตุ Admin: {meta.original_note}</p>
                    )}
                  </div>

                  <button
                    onClick={() => handleCompleteTask({ doc, meta })}
                    disabled={isExecuting}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-md shadow-emerald-600/30 cursor-pointer shrink-0 disabled:opacity-50"
                  >
                    {isExecuting ? "กำลังบันทึกย้ายสต็อก..." : "✅ สแกน/ยืนยันย้ายสต็อกเสร็จสิ้น"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

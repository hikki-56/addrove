"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTabAuth } from "@/context/TabAuthContext";
import { usePollingWhenVisible } from "@/hooks/use-visibility-polling";
import { useEscapeKey } from "@/hooks/use-escape-key";
import { PRODUCTION_UPDATED_EVENT } from "@/app/(dashboard)/production/_lib/use-production-data";
import type { ProductionNotification } from "@/types/production";

// กระดิ่งแจ้งเตือนระบบผลิต (ADMIN + APPROVER) — อ่าน/ยังไม่อ่านเก็บฝั่งเซิร์ฟเวอร์ (ข้ามอุปกรณ์ได้)
// โพลล์ทุก 30 วิขณะเปิดหน้า + รีเฟรชทันทีเมื่อมี action ในระบบผลิต · กดรายการ = ทำเครื่องหมายอ่าน + เปิดงาน

interface NotifItem extends ProductionNotification {
  is_read: boolean;
}

export default function ProductionBell() {
  const { user } = useTabAuth();
  const router = useRouter();
  const visible = user?.role === "ADMIN" || user?.role === "APPROVER";

  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotifItem[]>([]);
  const [unread, setUnread] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/production/notifications", { cache: "no-store" });
      const json = await res.json();
      if (json.success && json.data) {
        setItems(json.data.items || []);
        setUnread(json.data.unread_count || 0);
      }
    } catch {}
  }, []);

  usePollingWhenVisible(
    useCallback(() => {
      load();
    }, [load]),
    30000
  );

  useEffect(() => {
    const handler = () => load();
    window.addEventListener(PRODUCTION_UPDATED_EVENT, handler);
    return () => window.removeEventListener(PRODUCTION_UPDATED_EVENT, handler);
  }, [load]);

  // ปิดเมื่อคลิกนอกกรอบ
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEscapeKey(open, () => setOpen(false));

  if (!visible) return null;

  const markRead = async (ids: string[] | "all") => {
    try {
      await fetch("/api/production/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
    } catch {}
    load();
  };

  const openJob = (n: NotifItem) => {
    if (!n.is_read) markRead([n.notif_id]);
    setOpen(false);
    if (n.job_no) router.push(`/production/jobs/${encodeURIComponent(n.job_no)}`);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label="การแจ้งเตือนระบบผลิต"
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
      >
        <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-[#B42318] px-1 font-mono text-[10px] font-black leading-none text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-50 w-[min(92vw,22rem)] overflow-hidden rounded-2xl border border-[#E8ECEA] bg-white shadow-[0_20px_60px_rgba(16,24,40,0.18)] animate-in fade-in duration-150">
          <div className="flex items-center justify-between border-b border-[#EEF1EF] px-4 py-3">
            <span className="text-sm font-extrabold text-slate-900">การแจ้งเตือนผลิต</span>
            {unread > 0 && (
              <button
                onClick={() => markRead("all")}
                className="text-xs font-bold text-[#0F5C3F] hover:underline"
              >
                อ่านทั้งหมด
              </button>
            )}
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm font-semibold text-slate-300">ยังไม่มีการแจ้งเตือน</p>
            ) : (
              items.slice(0, 30).map((n) => (
                <button
                  key={n.notif_id}
                  onClick={() => openJob(n)}
                  className={`block w-full border-b border-[#EEF1EF] px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-slate-50 ${
                    n.is_read ? "" : "bg-[#F0F7F3]"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {!n.is_read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#06402B]" />}
                    <div className="min-w-0">
                      <p className={`text-xs leading-5 ${n.is_read ? "font-medium text-slate-500" : "font-bold text-slate-800"}`}>
                        {n.message}
                      </p>
                      <p className="mt-0.5 font-mono text-[10px] text-slate-400">
                        {n.created_by_name} ·{" "}
                        {(() => {
                          const d = new Date(n.created_at);
                          return Number.isNaN(d.getTime())
                            ? ""
                            : d.toLocaleString("th-TH", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
                        })()}
                      </p>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

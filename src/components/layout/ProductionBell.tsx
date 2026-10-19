"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useTabAuth } from "@/context/TabAuthContext";
import { usePollingWhenVisible } from "@/hooks/use-visibility-polling";
import { useEscapeKey } from "@/hooks/use-escape-key";
import { subscribeProductionUpdated } from "@/features/production/lib/events";
import { productionApi } from "@/features/production/lib/api";
import { canViewProductionNotifications } from "@/features/production/lib/permissions";
import type { ProductionNotification } from "@/types/production";
import {
  SolarBell,
  SolarDangerTriangle,
  SolarDocumentCheck,
  SolarFactory,
  SolarTuning,
  type SolarIconProps,
} from "@/components/icons";

// กระดิ่งแจ้งเตือนระบบผลิต (ADMIN + APPROVER) — อ่าน/ยังไม่อ่านเก็บฝั่งเซิร์ฟเวอร์ (ข้ามอุปกรณ์ได้)
// โพลล์ทุก 30 วิขณะเปิดหน้า + รีเฟรชทันทีเมื่อมี action ในระบบผลิต · กดรายการ = ทำเครื่องหมายอ่าน + เปิดงาน
//
// - ตรวจบทบาทก่อน: บทบาทอื่นไม่ mount ตัวที่มี hook → ไม่ poll /api/production/notifications เลย
// - Navbar มีช่องวางกระดิ่ง 2 ที่ (header มือถือ `md:hidden` และ header เดสก์ท็อป `md:flex`)
//   แต่ละช่องส่ง placement มา — mount จริงเพียงช่องที่ตรงกับ breakpoint ปัจจุบัน (instance เดียว = poll ชุดเดียว)

interface NotifItem extends ProductionNotification {
  is_read: boolean;
}

interface NotificationsPayload {
  items?: NotifItem[];
  unread_count?: number;
}

/** ต้องตรงกับ breakpoint `md` ของ Tailwind ที่ Navbar ใช้สลับ header มือถือ/เดสก์ท็อป (48rem = 768px) */
const DESKTOP_MEDIA_QUERY = "(min-width: 48rem)";

function subscribeDesktop(onChange: () => void): () => void {
  const mql = window.matchMedia(DESKTOP_MEDIA_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

/** true = เดสก์ท็อป · false = มือถือ · null = ยังไม่รู้ (SSR/ก่อน hydrate — ไม่ render เพื่อไม่ให้ mount ซ้ำ) */
function useIsDesktop(): boolean | null {
  return useSyncExternalStore<boolean | null>(
    subscribeDesktop,
    () => window.matchMedia(DESKTOP_MEDIA_QUERY).matches,
    () => null
  );
}

export interface ProductionBellProps {
  /** ช่องที่วางใน Navbar — render เฉพาะช่องที่มองเห็นตาม breakpoint */
  placement: "mobile" | "desktop";
}

export default function ProductionBell({ placement }: ProductionBellProps) {
  const { user } = useTabAuth();
  const isDesktop = useIsDesktop();
  if (!canViewProductionNotifications(user?.role)) return null;
  if (isDesktop === null || isDesktop !== (placement === "desktop")) return null;
  return <ProductionBellInner />;
}

function ProductionBellInner() {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotifItem[]>([]);
  const [unread, setUnread] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const res = await productionApi<NotificationsPayload>("/api/production/notifications");
    if (res.success && res.data) {
      setItems(res.data.items || []);
      setUnread(res.data.unread_count || 0);
    }
  }, []);

  usePollingWhenVisible(
    useCallback(() => {
      load();
    }, [load]),
    30000
  );

  useEffect(
    () =>
      subscribeProductionUpdated(() => {
        load();
      }),
    [load]
  );

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

  const markRead = async (ids: string[] | "all") => {
    await productionApi("/api/production/notifications", "PATCH", { ids });
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
        className="relative grid size-10 shrink-0 cursor-pointer place-items-center rounded-full text-m3-grey-600 transition-colors duration-150 hover:bg-[rgba(145,158,171,0.08)]"
      >
        <SolarBell size={24} />
        {unread > 0 && (
          <span className="absolute right-0.5 top-1 flex h-5 min-w-5 items-center justify-center rounded-[10px] border-2 border-white bg-m3-error px-1.5 text-[12px] font-semibold leading-none text-white tabular-nums">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-x-3.5 top-[60px] z-50 overflow-hidden rounded-2xl bg-white shadow-m3-dropdown animate-in fade-in duration-150 sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-[min(92vw,23rem)] sm:rounded-xl">
          <div className="flex items-center justify-between px-4 py-3.5">
            <span className="text-[14px] font-bold text-m3-grey-800">การแจ้งเตือนผลิต</span>
            {unread > 0 && (
              <button
                onClick={() => markRead("all")}
                className="cursor-pointer text-[12px] font-bold text-m3-primary-dark hover:underline"
              >
                อ่านทั้งหมด
              </button>
            )}
          </div>
          <div className="max-h-[60vh] overflow-y-auto border-t border-dashed border-m3-divider">
            {items.length === 0 ? (
              <p className="px-4 py-10 text-center text-[13px] font-medium text-m3-grey-500">ยังไม่มีการแจ้งเตือน</p>
            ) : (
              items.slice(0, 30).map((n) => {
                const tone = notificationTone(n.message);
                const ToneIcon = tone.icon;
                return (
                  <button
                    key={n.notif_id}
                    onClick={() => openJob(n)}
                    className={`flex w-full cursor-pointer items-start gap-3 border-b border-dashed border-m3-divider px-4 py-3 text-left transition-colors duration-150 last:border-b-0 hover:bg-[rgba(145,158,171,0.08)] ${
                      n.is_read ? "" : "bg-[rgba(0,167,111,0.06)]"
                    }`}
                  >
                    <span className={`hidden size-9 shrink-0 place-items-center rounded-[10px] sm:grid ${tone.tile}`}>
                      <ToneIcon size={20} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block text-[13px] leading-5 ${n.is_read ? "font-medium text-m3-grey-600" : "font-semibold text-m3-grey-800"}`}>
                        {n.message}
                      </span>
                      <span className="mt-0.5 block text-[12px] text-m3-grey-500">
                        {n.created_by_name} ·{" "}
                        {(() => {
                          const d = new Date(n.created_at);
                          return Number.isNaN(d.getTime())
                            ? ""
                            : d.toLocaleString("th-TH", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
                        })()}
                      </span>
                    </span>
                    {!n.is_read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-m3-primary" aria-label="ยังไม่อ่าน" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ไอคอน/สีของรายการแจ้งเตือน (D03) — เดาจากคำขึ้นต้นข้อความ เพราะ API ยังไม่ส่งชนิดแจ้งเตือนมา
// (เป็นการตกแต่งเท่านั้น: ข้อความที่ไม่ตรงรูปแบบใช้ไอคอนกระดิ่งสีเทา)
function notificationTone(message: string): { icon: (p: SolarIconProps) => React.ReactNode; tile: string } {
  const text = (message || "").trim();
  if (text.startsWith("เริ่มผลิต")) return { icon: SolarFactory, tile: "bg-[rgba(0,184,217,0.16)] text-m3-info-dark" };
  if (/ต่ำกว่าเป้า|เกินเป้า|ยกเลิก/.test(text)) return { icon: SolarDangerTriangle, tile: "bg-[rgba(255,171,0,0.16)] text-m3-warning-dark" };
  if (text.startsWith("รายงาน")) return { icon: SolarDocumentCheck, tile: "bg-[rgba(34,197,94,0.16)] text-m3-success-dark" };
  if (text.startsWith("ปรับปรุง")) return { icon: SolarTuning, tile: "bg-[rgba(142,51,255,0.16)] text-m3-secondary-dark" };
  return { icon: SolarBell, tile: "bg-[rgba(145,158,171,0.16)] text-m3-grey-600" };
}

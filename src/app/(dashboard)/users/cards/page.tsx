"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { generateCode128PngDataUrl } from "@/lib/barcode-utils";
import { employeeCardCode } from "@/lib/employee-card";
import { feedbackDone } from "@/lib/feedback";

/**
 * พิมพ์บัตรบาร์โค้ดประจำตัวพนักงาน (สำหรับเข้าระบบหน้างาน)
 * บัตร 1 ใบ = รหัส EMP-<user_id> + ชื่อ + บทบาท — สแกนที่หน้า /employee-login
 * แล้วใส่ PIN 4 หลัก (บัตรคือตัวระบุตัวตน PIN คือความลับ สแกนอย่างเดียวเข้าไม่ได้)
 */

interface EmployeeRow {
  user_id: string;
  full_name: string;
  email: string;
  role: string;
  active: boolean;
  warehouse_access?: string;
  has_pin?: boolean;
}

const ROLE_LABELS: Record<string, string> = {
  WAREHOUSE_STAFF: "พนักงานคลัง",
  PACKER: "พนักงานแพ็กของ",
  STAFF: "พนักงาน",
  MANAGER: "ผู้จัดการคลัง",
  APPROVER: "ผู้อนุมัติ",
  VIEWER: "ผู้ดูแลดูข้อมูล",
  ADMIN: "ผู้ดูแลระบบ",
};

function warehouseAccessShort(access?: string): string {
  if (!access) return "ทุกคลังที่ได้รับสิทธิ์";
  const v = access.trim();
  if (v === "*" || v === '["*"]') return "ทุกคลัง";
  try {
    const list = JSON.parse(v);
    if (Array.isArray(list)) {
      if (list.includes("*")) return "ทุกคลัง";
      return list.join(", ");
    }
  } catch {}
  return v;
}

export default function EmployeeCardsPage() {
  const [users, setUsers] = useState<EmployeeRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/users", { cache: "no-store" });
        const json = await res.json();
        if (!res.ok || json?.success === false) throw new Error(json?.message || "โหลดรายชื่อไม่สำเร็จ");
        const list: EmployeeRow[] = json.data?.users ?? json.data ?? [];
        // พิมพ์บัตรให้พนักงานหน้างานเท่านั้น (ไม่รวมแอดมิน/บัญชีปิด)
        const eligible = list.filter((u) => u.active && u.role !== "ADMIN");
        setUsers(eligible);
      } catch (e) {
        setError(e instanceof Error ? e.message : "โหลดไม่สำเร็จ");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const cards = useMemo(
    () =>
      users
        .filter((u) => selected.has(u.user_id))
        .map((u) => ({
          user_id: u.user_id,
          code: employeeCardCode(u.user_id),
          name: u.full_name || u.email,
          role: ROLE_LABELS[u.role] ?? u.role,
          warehouse: warehouseAccessShort(u.warehouse_access),
          has_pin: u.has_pin !== false,
          barcode: null as string | null,
        })),
    [users, selected]
  );

  const printCards = useCallback(() => {
    if (cards.length === 0) return;
    feedbackDone();
    window.print();
  }, [cards]);

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* ส่วนหัว (ซ่อนตอนพิมพ์) */}
      <div className="no-print flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#06402B]">บัตรบาร์โค้ดพนักงาน</h1>
          <p className="text-sm text-slate-500">
            พิมพ์บัตรให้พนักงาน แล้วให้สแกนบัตร + PIN 4 หลักที่หน้าเข้างาน (/employee-login) —
            สแกนบัตรเพียงอย่างเดียวเข้าระบบไม่ได้ ต้องมี PIN เสมอ
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setSelected(new Set(users.filter((u) => u.has_pin !== false).map((u) => u.user_id)))}
            className="px-4 py-2.5 rounded-xl border border-[#E8ECEA] text-slate-700 text-sm font-semibold hover:border-[#06402B]/40"
          >
            เลือกทุกคนที่มี PIN
          </button>
          <button
            onClick={printCards}
            disabled={cards.length === 0}
            className="px-5 py-2.5 rounded-xl bg-[#06402B] text-white text-sm font-semibold disabled:opacity-40"
          >
            🖨 พิมพ์ {cards.length > 0 ? `(${cards.length} ใบ)` : ""}
          </button>
        </div>
      </div>

      {error && (
        <div className="no-print bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">{error}</div>
      )}
      {loading && <div className="no-print p-8 text-center text-slate-400">กำลังโหลดรายชื่อ…</div>}

      {/* รายชื่อให้เลือก (ซ่อนตอนพิมพ์) */}
      <div className="no-print bg-white rounded-2xl border border-[#E8ECEA] overflow-hidden">
        {users.length === 0 && !loading ? (
          <div className="p-8 text-center text-slate-400">ไม่มีพนักงานที่พิมพ์บัตรได้</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#F7F9F8] text-left text-slate-500">
                <th className="px-4 py-3 font-medium w-10"></th>
                <th className="px-4 py-3 font-medium">ชื่อ</th>
                <th className="px-4 py-3 font-medium">บทบาท</th>
                <th className="px-4 py-3 font-medium">รหัสบัตร</th>
                <th className="px-4 py-3 font-medium">PIN</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const code = employeeCardCode(u.user_id);
                const isSel = selected.has(u.user_id);
                return (
                  <tr key={u.user_id} className="border-t border-[#E8ECEA]">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={isSel}
                        onChange={() => toggle(u.user_id)}
                        className="w-4.5 h-4.5 accent-[#06402B]"
                        aria-label={`เลือก ${u.full_name}`}
                      />
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-800">{u.full_name || u.email}</td>
                    <td className="px-4 py-3 text-slate-600">{ROLE_LABELS[u.role] ?? u.role}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{code}</td>
                    <td className="px-4 py-3">
                      {u.has_pin === false ? (
                        <span className="text-orange-600 text-xs font-semibold">ยังไม่ตั้ง PIN — ตั้งก่อนพิมพ์บัตร</span>
                      ) : (
                        <span className="text-emerald-700 text-xs">✓ มี PIN</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* พรีวิวบัตร — ตอนพิมพ์จะแสดงเฉพาะส่วนนี้ */}
      <div className="card-print-area">
        {cards.length === 0 ? (
          <p className="no-print text-sm text-slate-400 text-center py-6">
            ยังไม่ได้เลือกพนักงาน — ติ๊กจากตารางด้านบนแล้วกดพิมพ์
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {cards.map((c) => (
              <div
                key={c.user_id}
                className="employee-id-card print-sheet bg-white rounded-2xl border-2 border-[#06402B] p-4 flex flex-col items-center gap-1.5"
              >
                <div className="self-stretch flex items-center justify-between">
                  <span className="text-[11px] font-black tracking-widest text-[#06402B]">STOCKIFY</span>
                  <span className="text-[10px] text-slate-400">{c.role}</span>
                </div>
                <div className="text-xl font-extrabold text-slate-900 text-center leading-tight">{c.name}</div>
                <div className="text-[11px] text-slate-500">{c.warehouse}</div>
                <div className="mt-1 border border-[#E8ECEA] rounded-lg px-2 py-1.5 bg-white">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={generateCode128PngDataUrl(c.code, { height: 64, scale: 2 })}
                    alt={`บาร์โค้ดบัตร ${c.code}`}
                    className="h-16 w-auto"
                  />
                </div>
                <div className="font-mono text-xs font-bold text-slate-700 tracking-wider">{c.code}</div>
                <div className="text-[9px] text-slate-400">สแกนบัตร + PIN 4 หลัก ที่หน้าเข้างาน</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* CSS โหมดพิมพ์ — พิมพ์เฉพาะบัตร */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .card-print-area, .card-print-area * { visibility: visible !important; }
          .card-print-area {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            display: block !important;
          }
          .employee-id-card {
            break-inside: avoid;
            page-break-inside: avoid;
            border: 1.5px solid #06402B !important;
            box-shadow: none !important;
          }
          .no-print { display: none !important; }
        }
      `}</style>
    </div>
  );
}

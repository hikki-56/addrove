"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { generateCode128PngDataUrl } from "@/lib/barcode-utils";
import { employeeCardCode } from "@/lib/employee-card";
import { feedbackDone } from "@/client/feedback";

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
        // พนักงานและแอดมินที่เปิดใช้งานสามารถใช้บัตรร่วมกับ PIN ได้
        const eligible = list.filter((u) => u.active);
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
          <h1 className="text-2xl font-bold text-m3-primary-dark">บัตรบาร์โค้ดพนักงาน</h1>
          <p className="text-sm text-m3-grey-600">
            ใช้บัตรร่วมกับ PIN 4 หลัก
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setSelected(new Set(users.filter((u) => u.has_pin !== false).map((u) => u.user_id)))}
            className="px-4 py-2.5 rounded-xl border border-[rgba(145,158,171,0.2)] text-m3-grey-700 text-sm font-semibold hover:border-m3-primary/40"
          >
            เลือกทุกคนที่มี PIN
          </button>
          <button
            onClick={printCards}
            disabled={cards.length === 0}
            className="px-5 py-2.5 rounded-xl bg-m3-primary text-white text-sm font-semibold disabled:opacity-40"
          >
            พิมพ์ {cards.length > 0 ? `(${cards.length} ใบ)` : ""}
          </button>
        </div>
      </div>

      {error && (
        <div className="no-print bg-[rgba(255,86,48,0.08)] border border-[rgba(255,86,48,0.24)] text-m3-error-dark rounded-xl px-4 py-3 text-sm">{error}</div>
      )}
      {loading && <div className="no-print p-8 text-center text-m3-grey-500">กำลังโหลดรายชื่อ…</div>}

      {/* รายชื่อให้เลือก (ซ่อนตอนพิมพ์) */}
      <div className="no-print bg-white rounded-xl border border-[rgba(145,158,171,0.2)] overflow-hidden">
        {users.length === 0 && !loading ? (
          <div className="p-8 text-center text-m3-grey-500">ไม่มีพนักงานที่พิมพ์บัตรได้</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-m3-grey-100 text-left text-m3-grey-600">
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
                  <tr key={u.user_id} className="border-t border-[rgba(145,158,171,0.2)]">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={isSel}
                        onChange={() => toggle(u.user_id)}
                        className="w-4.5 h-4.5 accent-m3-primary"
                        aria-label={`เลือก ${u.full_name}`}
                      />
                    </td>
                    <td className="px-4 py-3 font-semibold text-m3-grey-800">{u.full_name || u.email}</td>
                    <td className="px-4 py-3 text-m3-grey-600">{ROLE_LABELS[u.role] ?? u.role}</td>
                    <td className="px-4 py-3 tabular-nums text-xs text-m3-grey-600">{code}</td>
                    <td className="px-4 py-3">
                      {u.has_pin === false ? (
                        <span className="text-m3-warning-dark text-xs font-semibold">ยังไม่ตั้ง PIN — ตั้งก่อนพิมพ์บัตร</span>
                      ) : (
                        <span className="text-m3-primary-dark text-xs">✓ มี PIN</span>
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
          <p className="no-print text-sm text-m3-grey-500 text-center py-6">
            ยังไม่ได้เลือกพนักงาน
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {cards.map((c) => (
              <div
                key={c.user_id}
                className="employee-id-card print-sheet bg-white rounded-xl border-2 border-m3-primary p-4 flex flex-col items-center gap-1.5"
              >
                <div className="self-stretch flex items-center justify-between">
                  <span className="text-[11px] font-extrabold tracking-widest text-m3-primary-dark">STOCKIFY</span>
                  <span className="text-[10px] text-m3-grey-500">{c.role}</span>
                </div>
                <div className="text-xl font-extrabold text-m3-grey-800 text-center leading-tight">{c.name}</div>
                <div className="text-[11px] text-m3-grey-600">{c.warehouse}</div>
                <div className="mt-1 border border-[rgba(145,158,171,0.2)] rounded-lg px-2 py-1.5 bg-white">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={generateCode128PngDataUrl(c.code, { height: 64, scale: 2 })}
                    alt={`บาร์โค้ดบัตร ${c.code}`}
                    className="h-16 w-auto"
                  />
                </div>
                <div className="tabular-nums text-xs font-bold text-m3-grey-700 tracking-wider">{c.code}</div>
                <div className="text-[9px] text-m3-grey-500">สแกนบัตร + PIN 4 หลัก ที่หน้าเข้างาน</div>
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

"use client";

import { useCallback, useEffect, useState } from "react";
import { useTabAuth } from "@/context/TabAuthContext";
import type { UserMenuSettings } from "@/types/menu-settings";
import type { UserRole } from "@/types/models";
import { M3Banner, M3Empty, M3ErrorState, M3Loading } from "@/components/ui/m3";
import { SolarAltArrowRight, SolarCheckCircle, SolarMagnifier } from "@/components/icons";
import { avatarToneClass, userInitials } from "@/components/ui/user-initials";

// ป้ายบทบาท + กลุ่มเมนู ใช้แสดงผลเท่านั้น (ลำดับ/สิทธิ์ยังมาจาก available_menus เดิม)
const ROLE_LABEL: Partial<Record<UserRole, string>> = {
  ADMIN: "ผู้ดูแลระบบ",
  MANAGER: "ผู้จัดการคลัง",
  APPROVER: "ผู้อนุมัติ/ผู้ผลิต",
  WAREHOUSE_STAFF: "พนักงานคลัง",
  PACKER: "พนักงานแพ็ก",
  STAFF: "เจ้าหน้าที่",
  VIEWER: "ผู้ดูข้อมูล",
};
const INVENTORY_HREFS = ["/products", "/approvals", "/stock", "/locations", "/warehouses/qr", "/shelves/qr"];
const SYSTEM_HREFS = ["/users", "/login-logs", "/users/cards", "/menu-settings"];
function menuGroup(href: string): string {
  if (href === "/dashboard") return "ภาพรวม";
  if (INVENTORY_HREFS.includes(href)) return "คลังสินค้า";
  if (href.startsWith("/outbound")) return "ส่งของออก";
  if (href.startsWith("/express-import")) return "นำเข้า Express";
  if (SYSTEM_HREFS.includes(href)) return "ระบบ";
  return "การทำรายการ";
}


export default function MenuSettingsPage() {
  const { token } = useTabAuth();
  const [users, setUsers] = useState<UserMenuSettings[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selectedHrefs, setSelectedHrefs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [authorized, setAuthorized] = useState(false);

  const loadUsers = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/menu-settings", { cache: "no-store", headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || "โหลดข้อมูลไม่สำเร็จ");
      setUsers(json.data);
      setAuthorized(true);
    } catch (err) {
      setAuthorized(false);
      setError(err instanceof Error ? err.message : "โหลดข้อมูลไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void loadUsers(); }, [loadUsers]);

  const selectedUser = users.find(({ user_id }) => user_id === selectedId);
  const chooseUser = (id: string) => {
    const target = users.find(({ user_id }) => user_id === id);
    setSelectedId(id);
    const available = new Set(target?.available_menus.filter(({ locked }) => !locked).map(({ href }) => href));
    setSelectedHrefs((target?.menu_hrefs ?? target?.default_menu_hrefs ?? []).filter((href) => available.has(href)));
    setError("");
    setMessage("");
  };

  const save = async (menuHrefs: string[] | null) => {
    if (!selectedUser || !token) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/menu-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ user_id: selectedUser.user_id, menu_hrefs: menuHrefs }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || "บันทึกไม่สำเร็จ");
      const updated: UserMenuSettings = json.data;
      setUsers((previous) => previous.map((item) => item.user_id === updated.user_id ? updated : item));
      setSelectedHrefs(updated.menu_hrefs ?? updated.default_menu_hrefs);
      setMessage(`บันทึกเมนูของ ${updated.full_name} แล้ว`);
      window.dispatchEvent(new Event("stockify-menu-settings-updated"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setSaving(false);
    }
  };

  const [userQuery, setUserQuery] = useState("");
  const q = userQuery.trim().toLowerCase();
  const listedUsers = q
    ? users.filter((u) => u.full_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
    : users;
  const groups: { name: string; items: { href: string; label: string; outside_role?: boolean; locked?: boolean }[] }[] = [];
  for (const item of selectedUser?.available_menus ?? []) {
    const name = menuGroup(item.href);
    const g = groups.find((x) => x.name === name);
    if (g) g.items.push(item);
    else groups.push({ name, items: [item] });
  }
  const smallBtn = "m3-btn m3-btn-sm m3-btn-outline cursor-pointer disabled:opacity-48 disabled:cursor-not-allowed";

  return (
    <section className="w-full space-y-4">
      {loading ? (
        <M3Loading label="กำลังโหลดข้อมูลพนักงาน..." />
      ) : !authorized ? (
        <M3ErrorState title={error || "โหลดข้อมูลไม่สำเร็จ"} onRetry={() => void loadUsers()} retryLabel="ลองอีกครั้ง" />
      ) : (
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
          {/* รายชื่อพนักงาน (M49) */}
          <div className={`m3-card p-4 ${selectedUser ? "max-lg:hidden" : ""}`}>
            <div className="relative">
              <SolarMagnifier size={20} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-m3-grey-500" />
              <input
                type="search"
                value={userQuery}
                onChange={(event) => setUserQuery(event.target.value)}
                placeholder="ค้นหาพนักงาน"
                aria-label="ค้นหาพนักงาน"
                className="h-12 w-full rounded-lg border border-[rgba(145,158,171,0.32)] bg-white pl-11 pr-3.5 text-sm text-m3-grey-800 placeholder:text-m3-grey-500 hover:border-m3-grey-800 focus:border-m3-grey-800 focus:outline-none focus:ring-1 focus:ring-m3-grey-800"
              />
            </div>
            <p id="menu-user" className="mt-4 mb-2 text-xs font-semibold text-m3-grey-600">เลือกพนักงานที่ต้องการตั้งค่า</p>
            {users.length === 0 ? (
              <M3Empty title="ยังไม่มีข้อมูลพนักงาน" />
            ) : listedUsers.length === 0 ? (
              <M3Empty title="ไม่พบพนักงานตามคำค้น" icon={<SolarMagnifier size={32} />} />
            ) : (
              <ul aria-labelledby="menu-user" className="space-y-2">
                {listedUsers.map((item) => {
                  const active = item.user_id === selectedId;
                  return (
                    <li key={item.user_id}>
                      <button
                        type="button"
                        disabled={saving}
                        aria-pressed={active}
                        onClick={() => chooseUser(item.user_id)}
                        className={`flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors cursor-pointer disabled:cursor-not-allowed ${
                          active
                            ? "border-m3-primary bg-[rgba(0,167,111,0.08)]"
                            : "border-[rgba(145,158,171,0.24)] hover:bg-[rgba(145,158,171,0.08)]"
                        }`}
                      >
                        <span className={`inline-flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${avatarToneClass(item.full_name)}`}>
                          {userInitials(item.full_name)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-bold text-m3-grey-800">{item.full_name}</span>
                          <span className="block truncate text-xs text-m3-grey-500">{ROLE_LABEL[item.role] ?? item.role}</span>
                        </span>
                        {!item.active && <span className="m3-label m3-label-default shrink-0">ปิดใช้งาน</span>}
                        <SolarAltArrowRight size={18} className="shrink-0 text-m3-grey-500 lg:hidden" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* ตัวแก้ไขเมนู (M50) */}
          <div className={`space-y-4 ${selectedUser ? "" : "max-lg:hidden"}`}>
            {error && <M3Banner tone="error" role="alert">{error}</M3Banner>}
            {message && <M3Banner tone="success" role="status">{message}</M3Banner>}
            {!selectedUser ? (
              <div className="m3-card p-5">
                <M3Empty title="เลือกพนักงานทางซ้ายเพื่อตั้งค่าเมนู" />
              </div>
            ) : (
              <>
                <div className="m3-card flex items-center gap-4 p-5">
                  <button type="button" disabled={saving} onClick={() => chooseUser("")} aria-label="กลับไปรายชื่อพนักงาน" className="-ml-1 rounded-full p-1.5 text-m3-grey-600 hover:bg-[rgba(145,158,171,0.08)] lg:hidden cursor-pointer">
                    <SolarAltArrowRight size={20} className="rotate-180" />
                  </button>
                  <span className={`inline-flex size-12 shrink-0 items-center justify-center rounded-full text-base font-bold ${avatarToneClass(selectedUser.full_name)}`}>
                    {userInitials(selectedUser.full_name)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-base font-bold text-m3-grey-800">{selectedUser.full_name}</p>
                    <p className="truncate text-sm text-m3-grey-600">{selectedUser.email} · {ROLE_LABEL[selectedUser.role] ?? selectedUser.role}</p>
                  </div>
                </div>

                <div className="m3-card space-y-5 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-m3-grey-600">แสดง <strong className="text-m3-grey-800">{selectedHrefs.length}</strong> จาก {selectedUser.available_menus.length} เมนู</p>
                    <div className="flex gap-2">
                      <button type="button" disabled={saving} className={smallBtn} onClick={() => { setSelectedHrefs(selectedUser.available_menus.filter(({ locked }) => !locked).map(({ href }) => href)); setMessage(""); }}>เลือกทั้งหมด</button>
                      <button type="button" disabled={saving} className={smallBtn} onClick={() => { setSelectedHrefs([]); setMessage(""); }}>เอาออกทั้งหมด</button>
                    </div>
                  </div>
                  <fieldset disabled={saving} className="space-y-4">
                    <legend className="sr-only">เมนูที่แสดงสำหรับ {selectedUser.full_name}</legend>
                    {groups.map((group) => (
                      <div key={group.name}>
                        <p className="mb-2 text-xs font-bold text-m3-grey-600">{group.name}</p>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          {group.items.map((item) => {
                            const checked = selectedHrefs.includes(item.href);
                            if (item.locked) {
                              return (
                                <div key={item.href} aria-disabled="true" className="flex items-center gap-3 rounded-xl border border-dashed border-[rgba(145,158,171,0.24)] bg-m3-grey-100 px-4 py-3.5 text-m3-grey-500">
                                  <input type="checkbox" checked={false} disabled readOnly className="h-5 w-5 shrink-0" aria-label={`${item.label} (เฉพาะ ty@stockify.com)`} />
                                  <span className="min-w-0 flex-1 text-sm">{item.label}</span>
                                  <span className="m3-label m3-label-default shrink-0">เฉพาะ ty</span>
                                </div>
                              );
                            }
                            return (
                              <label key={item.href} className={`flex items-center gap-3 rounded-xl border px-4 py-3.5 cursor-pointer transition-colors ${checked ? "border-[rgba(145,158,171,0.32)] bg-white" : "border-[rgba(145,158,171,0.16)] bg-m3-grey-100 text-m3-grey-500"} hover:border-m3-grey-800`}>
                                <input type="checkbox" checked={checked} className="h-5 w-5 accent-[#00A76F] shrink-0" onChange={(event) => {
                                  setSelectedHrefs((previous) => event.target.checked ? [...previous, item.href] : previous.filter((href) => href !== item.href));
                                  setMessage("");
                                }} />
                                <span className={`min-w-0 flex-1 text-sm ${checked ? "font-semibold text-m3-grey-800" : ""}`}>{item.label}</span>
                                {item.outside_role && <span className="m3-label m3-label-warning shrink-0" title="นอกสิทธิ์ของบทบาท — ติ๊กแล้วจะให้สิทธิ์ใช้หน้านี้เพิ่ม">ให้สิทธิ์เพิ่ม</span>}
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </fieldset>
                  {selectedUser.available_menus.length === 0 && <M3Empty title="บทบาทนี้ยังไม่มีเมนูที่เลือกแสดงได้" />}
                </div>

                <div className="m3-card flex flex-wrap items-center justify-end gap-3 p-4 sm:px-5 max-sm:sticky max-sm:bottom-3">
                  <button type="button" disabled={saving} onClick={() => void save(null)} className="m3-btn m3-btn-outline h-11 px-5 cursor-pointer disabled:opacity-48 max-sm:flex-1">คืนค่าเมนูเริ่มต้น</button>
                  <button type="button" disabled={saving} onClick={() => void save(selectedHrefs)} className="m3-btn m3-btn-primary h-11 gap-2 px-5 cursor-pointer disabled:opacity-48 max-sm:flex-1">
                    {saving ? <span aria-hidden="true" className="inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent" /> : <SolarCheckCircle size={18} />}
                    {saving ? "กำลังบันทึก..." : "บันทึกเมนู"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

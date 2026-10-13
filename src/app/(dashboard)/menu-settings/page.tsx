"use client";

import { useCallback, useEffect, useState } from "react";
import { useTabAuth } from "@/context/TabAuthContext";
import type { UserMenuSettings } from "@/types/menu-settings";

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
    const available = new Set(target?.available_menus.map(({ href }) => href));
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

  const buttonClass = "rounded-xl border border-[#D0D5DD] px-4 py-2 text-sm font-medium cursor-pointer hover:bg-[#F3F6F4] disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <section className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-[#06402B]">ตั้งค่าเมนูผู้ใช้</h1>
      </div>
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}
      {message && <p role="status" className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">{message}</p>}
      {loading ? <p role="status" className="text-sm text-[#667085]">กำลังโหลดข้อมูลพนักงาน...</p> : !authorized ? (
        <button type="button" className={buttonClass} onClick={() => void loadUsers()}>ลองอีกครั้ง</button>
      ) : (
        <div className="rounded-2xl border border-[#E8ECEA] bg-white p-5 md:p-6 space-y-5">
          <div>
            <label htmlFor="menu-user" className="block text-sm font-medium mb-2">พนักงาน</label>
            <select id="menu-user" value={selectedId} disabled={saving} onChange={(event) => chooseUser(event.target.value)} className="w-full rounded-xl border border-[#D0D5DD] bg-white px-3 py-3">
              <option value="">เลือกพนักงานที่ต้องการตั้งค่า</option>
              {users.map((item) => <option key={item.user_id} value={item.user_id}>{item.full_name} ({item.email}){item.active ? "" : " — ปิดใช้งาน"}</option>)}
            </select>
            {users.length === 0 && <p className="mt-2 text-sm text-[#667085]">ยังไม่มีข้อมูลพนักงาน</p>}
          </div>
          {selectedUser && <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-[#667085]">แสดง {selectedHrefs.length} จาก {selectedUser.available_menus.length} เมนู</p>
              <div className="flex gap-2">
                <button type="button" disabled={saving} className={buttonClass} onClick={() => { setSelectedHrefs(selectedUser.available_menus.map(({ href }) => href)); setMessage(""); }}>เลือกทั้งหมด</button>
                <button type="button" disabled={saving} className={buttonClass} onClick={() => { setSelectedHrefs([]); setMessage(""); }}>เอาออกทั้งหมด</button>
              </div>
            </div>
            <fieldset disabled={saving} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <legend className="sr-only">เมนูที่แสดงสำหรับ {selectedUser.full_name}</legend>
              {selectedUser.available_menus.map((item) => <label key={item.href} className="flex items-center gap-3 rounded-xl border border-[#E8ECEA] p-4 cursor-pointer hover:bg-[#F3F6F4]">
                <input type="checkbox" checked={selectedHrefs.includes(item.href)} className="h-5 w-5 accent-[#06402B] shrink-0" onChange={(event) => {
                  setSelectedHrefs((previous) => event.target.checked ? [...previous, item.href] : previous.filter((href) => href !== item.href));
                  setMessage("");
                }} />
                <span className="text-sm">{item.label}</span>
              </label>)}
            </fieldset>
            {selectedUser.available_menus.length === 0 && <p className="text-sm text-[#667085]">บทบาทนี้ยังไม่มีเมนูที่เลือกแสดงได้</p>}
            <div className="flex flex-wrap gap-3 border-t border-[#E8ECEA] pt-5">
              <button type="button" disabled={saving} onClick={() => void save(selectedHrefs)} className="rounded-xl bg-[#06402B] px-5 py-3 text-sm font-medium text-white cursor-pointer hover:bg-[#0B5740] disabled:opacity-50 disabled:cursor-not-allowed">{saving ? "กำลังบันทึก..." : "บันทึกเมนู"}</button>
              <button type="button" disabled={saving} onClick={() => void save(null)} className={buttonClass}>คืนค่าเมนูเริ่มต้น</button>
            </div>
          </>}
        </div>
      )}
    </section>
  );
}

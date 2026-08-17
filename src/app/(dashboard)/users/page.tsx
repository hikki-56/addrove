"use client";

import { useEffect, useState } from "react";
import type { User, UserRole } from "@/types/models";

const WAREHOUSE_OPTIONS = [
  { id: "wh-1", name: "โกดัง 1" },
  { id: "wh-2", name: "โกดัง 2" },
  { id: "wh-3", name: "โกดัง 3" },
  { id: "wh-4", name: "โกดัง 4" },
  { id: "wh-5", name: "โกดัง 5" },
  { id: "wh-6", name: "สำนักงานใหญ่" },
];

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState<string>("");

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);

  // Add Form State
  const [addFullName, setAddFullName] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [addPassword, setAddPassword] = useState("");
  const [addRole, setAddRole] = useState<UserRole>("WAREHOUSE_STAFF");
  const [addWhAccess, setAddWhAccess] = useState<string[]>(["*"]);
  const [addError, setAddError] = useState("");
  const [addSaving, setAddSaving] = useState(false);

  // Edit Form State
  const [editFullName, setEditFullName] = useState("");
  const [editRole, setEditRole] = useState<UserRole>("WAREHOUSE_STAFF");
  const [editWhAccess, setEditWhAccess] = useState<string[]>([]);
  const [editPassword, setEditPassword] = useState("");
  const [editError, setEditError] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  const loadUsers = () => {
    setLoading(true);
    fetch("/api/users")
      .then((r) => r.json())
      .then((d) => {
        if (d.success && Array.isArray(d.data)) {
          setUsers(d.data);
        }
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError("");
    setAddSaving(true);

    try {
      const whAccessStr = addWhAccess.includes("*")
        ? '["*"]'
        : JSON.stringify(addWhAccess);

      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: addFullName,
          email: addEmail,
          password: addPassword,
          role: addRole,
          warehouse_access: whAccessStr,
        }),
      });

      const json = await res.json();
      if (json.success) {
        setShowAddModal(false);
        setAddFullName("");
        setAddEmail("");
        setAddPassword("");
        setAddRole("WAREHOUSE_STAFF");
        setAddWhAccess(["*"]);
        loadUsers();
      } else {
        setAddError(json.message || "เกิดข้อผิดพลาดในการเพิ่มพนักงาน");
      }
    } catch {
      setAddError("เกิดข้อผิดพลาดในการเชื่อมต่อ");
    } finally {
      setAddSaving(false);
    }
  };

  const openEditModal = (user: User) => {
    setEditingUser(user);
    setEditFullName(user.full_name);
    setEditRole(user.role);
    setEditPassword("");
    setEditError("");

    try {
      const list = JSON.parse(user.warehouse_access);
      setEditWhAccess(Array.isArray(list) ? list : ["*"]);
    } catch {
      setEditWhAccess(user.warehouse_access === "*" ? ["*"] : ["wh-1"]);
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setEditError("");
    setEditSaving(true);

    try {
      const whAccessStr = editWhAccess.includes("*")
        ? '["*"]'
        : JSON.stringify(editWhAccess);

      const payload: Record<string, unknown> = {
        full_name: editFullName,
        role: editRole,
        warehouse_access: whAccessStr,
      };
      if (editPassword.trim()) {
        payload.password = editPassword;
      }

      const res = await fetch(`/api/users/${editingUser.user_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (json.success) {
        setEditingUser(null);
        loadUsers();
      } else {
        setEditError(json.message || "เกิดข้อผิดพลาดในการอัปเดตพนักงาน");
      }
    } catch {
      setEditError("เกิดข้อผิดพลาดในการเชื่อมต่อ");
    } finally {
      setEditSaving(false);
    }
  };

  const handleToggleActive = async (user: User) => {
    const action = user.active ? "ปิดใช้งาน" : "เปิดใช้งาน";
    if (!confirm(`คุณแน่ใจหรือไม่ว่าต้องการ ${action} บัญชีของ ${user.full_name}?`))
      return;

    try {
      const res = await fetch(`/api/users/${user.user_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !user.active }),
      });
      const json = await res.json();
      if (json.success) {
        loadUsers();
      } else {
        alert(json.message || "เกิดข้อผิดพลาดในการเปลี่ยนสถานะ");
      }
    } catch {
      alert("เกิดข้อผิดพลาดในการเชื่อมต่อ");
    }
  };

  const toggleWhAccess = (
    whId: string,
    current: string[],
    setFn: (val: string[]) => void
  ) => {
    if (whId === "*") {
      setFn(["*"]);
      return;
    }
    let updated = current.filter((id) => id !== "*");
    if (updated.includes(whId)) {
      updated = updated.filter((id) => id !== whId);
    } else {
      updated.push(whId);
    }
    if (updated.length === 0) updated = ["*"];
    setFn(updated);
  };

  const filteredUsers = users.filter((u) => {
    const q = search.toLowerCase();
    const matchSearch =
      u.full_name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q);
    const matchRole = !filterRole || u.role === filterRole;
    return matchSearch && matchRole;
  });

  const parseWhDisplay = (whAccessStr: string) => {
    try {
      if (whAccessStr === "*" || whAccessStr === '["*"]') return "ทุกโกดัง";
      const list: string[] = JSON.parse(whAccessStr);
      if (list.includes("*")) return "ทุกโกดัง";
      return list
        .map((id) => WAREHOUSE_OPTIONS.find((w) => w.id === id)?.name || id)
        .join(", ");
    } catch {
      return whAccessStr === "*" ? "ทุกโกดัง" : whAccessStr;
    }
  };

  return (
    <div className="space-y-6 fade-in max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-100 tracking-tight">จัดการพนักงาน</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            จัดการบัญชี สิทธิ์การใช้งาน และโกดังที่รับผิดชอบของพนักงาน
          </p>
        </div>

        <button
          id="btn-add-staff"
          onClick={() => setShowAddModal(true)}
          className="btn-primary flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-semibold cursor-pointer flex-shrink-0"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          เพิ่มพนักงานใหม่
        </button>
      </div>

      {/* Filters Bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <svg className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาชื่อพนักงาน, อีเมล..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.09] text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500/50 text-sm transition-all"
          />
        </div>

        <div className="flex gap-2">
          <select
            value={filterRole}
            onChange={(e) => setFilterRole(e.target.value)}
            className="px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.09] text-slate-300 text-sm font-medium focus:outline-none focus:border-indigo-500/50 cursor-pointer transition-all"
          >
            <option value="" className="bg-[#111118] text-white">ทุกบทบาท</option>
            <option value="ADMIN" className="bg-[#111118] text-white">ผู้ดูแลระบบ (Admin)</option>
            <option value="WAREHOUSE_STAFF" className="bg-[#111118] text-white">พนักงานคลัง (Staff)</option>
            <option value="VIEWER" className="bg-[#111118] text-white">ผู้ชม (Viewer)</option>
          </select>
        </div>
      </div>

      {/* Users Table */}
      <div className="glass-card rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/[0.08]">
                <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">ชื่อ-นามสกุล</th>
                <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">อีเมล</th>
                <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">บทบาท (Role)</th>
                <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">สิทธิ์โกดัง</th>
                <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">สถานะ</th>
                <th className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04] text-xs">
              {loading ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-slate-500">
                    กำลังโหลดข้อมูลพนักงาน...
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-slate-500">
                    ไม่พบข้อมูลพนักงาน
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => (
                  <tr key={u.user_id} className="hover:bg-white/[0.03] transition-colors">
                    <td className="px-5 py-3.5 font-medium text-slate-100 text-sm">
                      {u.full_name}
                    </td>
                    <td className="px-5 py-3.5 text-slate-400 font-mono">
                      {u.email}
                    </td>
                    <td className="px-5 py-3.5">
                      {u.role === "ADMIN" && (
                        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-500/15 text-indigo-400 border border-indigo-500/30">
                          ผู้ดูแลระบบ
                        </span>
                      )}
                      {u.role === "WAREHOUSE_STAFF" && (
                        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                          พนักงานคลัง
                        </span>
                      )}
                      {u.role === "VIEWER" && (
                        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-500/15 text-slate-400 border border-slate-500/30">
                          ผู้ชม
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-slate-300 font-medium">
                      {parseWhDisplay(u.warehouse_access)}
                    </td>
                    <td className="px-5 py-3.5">
                      {u.active ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                          เปิดใช้งาน
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-red-500/10 text-red-400 border border-red-500/30">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-400"></span>
                          ปิดใช้งาน
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openEditModal(u)}
                          className="px-2.5 py-1 rounded-lg text-xs font-medium bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 hover:bg-indigo-500/20 transition-all cursor-pointer"
                        >
                          แก้ไขสิทธิ์
                        </button>
                        <button
                          onClick={() => handleToggleActive(u)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                            u.active
                              ? "bg-red-500/10 text-red-400 border border-red-500/25 hover:bg-red-500/20"
                              : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 hover:bg-emerald-500/20"
                          }`}
                        >
                          {u.active ? "ปิดใช้งาน" : "เปิดใช้งาน"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Staff Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="glass-card rounded-xl p-6 max-w-lg w-full border border-white/[0.12] shadow-2xl bg-[#111118] scale-in">
            <h3 className="text-base font-bold text-slate-100 mb-4">เพิ่มพนักงานใหม่</h3>

            {addError && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
                {addError}
              </div>
            )}

            <form onSubmit={handleAddSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">ชื่อ-นามสกุล</label>
                <input
                  type="text"
                  required
                  value={addFullName}
                  onChange={(e) => setAddFullName(e.target.value)}
                  placeholder="เช่น สมชาย ใจดี"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.09] text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500/50 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">อีเมล (สำหรับเข้าสู่ระบบ)</label>
                <input
                  type="email"
                  required
                  value={addEmail}
                  onChange={(e) => setAddEmail(e.target.value)}
                  placeholder="staff@company.com"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.09] text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500/50 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">รหัสผ่าน (อย่างน้อย 6 ตัวอักษร)</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={addPassword}
                  onChange={(e) => setAddPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.09] text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500/50 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">บทบาท (Role)</label>
                <select
                  value={addRole}
                  onChange={(e) => setAddRole(e.target.value as UserRole)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.09] text-slate-100 focus:outline-none focus:border-indigo-500/50 text-sm"
                >
                  <option value="WAREHOUSE_STAFF" className="bg-[#111118]">พนักงานคลัง (รับ/เบิก/ย้ายสินค้าได้)</option>
                  <option value="ADMIN" className="bg-[#111118]">ผู้ดูแลระบบ (สิทธิ์จัดการเต็มรูปแบบ)</option>
                  <option value="VIEWER" className="bg-[#111118]">ผู้ชม (ดูข้อมูลได้อย่างเดียว)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-2">สิทธิ์เข้าถึงโกดัง</label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setAddWhAccess(["*"])}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      addWhAccess.includes("*")
                        ? "bg-indigo-600 text-white"
                        : "bg-white/[0.04] text-slate-400 border border-white/[0.08] hover:text-white"
                    }`}
                  >
                    ทุกโกดัง (*)
                  </button>
                  {WAREHOUSE_OPTIONS.map((w) => (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => toggleWhAccess(w.id, addWhAccess, setAddWhAccess)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                        !addWhAccess.includes("*") && addWhAccess.includes(w.id)
                          ? "bg-indigo-600 text-white"
                          : "bg-white/[0.04] text-slate-400 border border-white/[0.08] hover:text-white"
                      }`}
                    >
                      {w.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-white/[0.07]">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl text-slate-400 hover:text-white text-sm font-medium"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={addSaving}
                  className="px-5 py-2 rounded-xl btn-primary text-white font-semibold text-sm cursor-pointer"
                >
                  {addSaving ? "กำลังบันทึก..." : "บันทึกพนักงาน"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Staff Modal */}
      {editingUser && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="glass-card rounded-xl p-6 max-w-lg w-full border border-white/[0.12] shadow-2xl bg-[#111118] scale-in">
            <h3 className="text-base font-bold text-slate-100 mb-4">แก้ไขสิทธิ์พนักงาน</h3>

            {editError && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
                {editError}
              </div>
            )}

            <form onSubmit={handleEditSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">ชื่อ-นามสกุล</label>
                <input
                  type="text"
                  required
                  value={editFullName}
                  onChange={(e) => setEditFullName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.09] text-slate-100 focus:outline-none focus:border-indigo-500/50 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">อีเมล (แก้ไขไม่ได้)</label>
                <input
                  type="email"
                  disabled
                  value={editingUser.email}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.02] border border-white/[0.06] text-slate-500 text-sm cursor-not-allowed"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">เปลี่ยนรหัสผ่านใหม่ (เว้นว่างไว้ถ้าไม่ต้องการเปลี่ยน)</label>
                <input
                  type="password"
                  minLength={6}
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.09] text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500/50 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">บทบาท (Role)</label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as UserRole)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.09] text-slate-100 focus:outline-none focus:border-indigo-500/50 text-sm"
                >
                  <option value="WAREHOUSE_STAFF" className="bg-[#111118]">พนักงานคลัง (รับ/เบิก/ย้ายสินค้าได้)</option>
                  <option value="ADMIN" className="bg-[#111118]">ผู้ดูแลระบบ (สิทธิ์จัดการเต็มรูปแบบ)</option>
                  <option value="VIEWER" className="bg-[#111118]">ผู้ชม (ดูข้อมูลได้อย่างเดียว)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-2">สิทธิ์เข้าถึงโกดัง</label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setEditWhAccess(["*"])}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      editWhAccess.includes("*")
                        ? "bg-indigo-600 text-white"
                        : "bg-white/[0.04] text-slate-400 border border-white/[0.08] hover:text-white"
                    }`}
                  >
                    ทุกโกดัง (*)
                  </button>
                  {WAREHOUSE_OPTIONS.map((w) => (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => toggleWhAccess(w.id, editWhAccess, setEditWhAccess)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                        !editWhAccess.includes("*") && editWhAccess.includes(w.id)
                          ? "bg-indigo-600 text-white"
                          : "bg-white/[0.04] text-slate-400 border border-white/[0.08] hover:text-white"
                      }`}
                    >
                      {w.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-white/[0.07]">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="px-4 py-2 rounded-xl text-slate-400 hover:text-white text-sm font-medium"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={editSaving}
                  className="px-5 py-2 rounded-xl btn-primary text-white font-semibold text-sm cursor-pointer"
                >
                  {editSaving ? "กำลังอัปเดต..." : "บันทึกการแก้ไข"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

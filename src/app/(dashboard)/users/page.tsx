"use client";

import { useEffect, useState } from "react";
import type { User, UserRole } from "@/types/models";

const WAREHOUSE_OPTIONS = [
  { id: "wh-1", name: "โกดัง 1" },
  { id: "wh-2", name: "โกดัง 2" },
  { id: "wh-3", name: "โกดัง 3" },
  { id: "wh-4", name: "โกดัง 4" },
  { id: "wh-5", name: "โกดัง 5" },
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
    if (!confirm(`คุณต้องการ${user.active ? "ปิดใช้งาน" : "เปิดใช้งาน"}พนักงาน "${user.full_name}" หรือไม่?`)) return;

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
        alert(json.message || "เกิดข้อผิดพลาด");
      }
    } catch {
      alert("เกิดข้อผิดพลาดในการเชื่อมต่อ");
    }
  };

  const toggleWhAccess = (whId: string, current: string[], setFn: (val: string[]) => void) => {
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
    <div className="space-y-6 fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">จัดการพนักงาน</h1>
          <p className="text-gray-400 text-sm mt-1">
            จัดการบัญชี สิทธิ์การใช้งาน และโกดังที่รับผิดชอบของพนักงาน
          </p>
        </div>

        <button
          id="btn-add-staff"
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm transition-all duration-150 flex items-center gap-2 shadow-lg shadow-emerald-950 flex-shrink-0"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          เพิ่มพนักงานใหม่
        </button>
      </div>

      {/* Filters Bar */}
      <div className="glass-card rounded-2xl p-4 flex flex-col sm:flex-row gap-4 border border-emerald-900/30">
        <div className="relative flex-1">
          <svg className="w-5 h-5 text-gray-500 absolute left-3.5 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาชื่อพนักงาน, อีเมล..."
            className="w-full pl-10 pr-4 py-2 rounded-xl bg-white/5 border border-emerald-900/30 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm"
          />
        </div>

        <div className="flex gap-2">
          <select
            value={filterRole}
            onChange={(e) => setFilterRole(e.target.value)}
            className="px-3 py-2 rounded-xl bg-white/5 border border-emerald-900/30 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
          >
            <option value="">ทุกบทบาท</option>
            <option value="ADMIN">👑 ผู้ดูแลระบบ (Admin)</option>
            <option value="WAREHOUSE_STAFF">📦 พนักงานคลัง (Staff)</option>
            <option value="VIEWER">👁️ ผู้ชม (Viewer)</option>
          </select>
        </div>
      </div>

      {/* Users Table */}
      <div className="glass-card rounded-2xl overflow-hidden border border-emerald-900/30 shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-emerald-900/40 bg-emerald-950/40 text-emerald-300 text-xs font-semibold uppercase tracking-wider">
                <th className="px-6 py-4">ชื่อ-นามสกุล</th>
                <th className="px-6 py-4">อีเมล</th>
                <th className="px-6 py-4">บทบาท (Role)</th>
                <th className="px-6 py-4">สิทธิ์โกดัง</th>
                <th className="px-6 py-4">สถานะ</th>
                <th className="px-6 py-4 text-right">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-emerald-950/20 text-sm">
              {loading ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-emerald-400">
                    <div className="inline-flex items-center gap-2">
                      <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      กำลังโหลดข้อมูลพนักงาน...
                    </div>
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-gray-500">
                    ไม่พบข้อมูลพนักงาน
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => (
                  <tr key={u.user_id} className="transition-colors">
                    <td className="px-6 py-4 font-medium text-white">
                      {u.full_name}
                    </td>
                    <td className="px-6 py-4 text-gray-300 font-mono text-xs">
                      {u.email}
                    </td>
                    <td className="px-6 py-4">
                      {u.role === "ADMIN" && (
                        <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                          👑 ผู้ดูแลระบบ
                        </span>
                      )}
                      {u.role === "WAREHOUSE_STAFF" && (
                        <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                          📦 พนักงานคลัง
                        </span>
                      )}
                      {u.role === "VIEWER" && (
                        <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-500/20 text-slate-300 border border-slate-500/40">
                          👁️ ผู้ชม
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-gray-300 font-medium">
                      {parseWhDisplay(u.warehouse_access)}
                    </td>
                    <td className="px-6 py-4">
                      {u.active ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                          เปิดใช้งาน
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/30">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-400"></span>
                          ปิดใช้งาน
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openEditModal(u)}
                          className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-emerald-600/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-600 hover:text-white transition-all shadow-sm"
                        >
                          ✏️ แก้ไขสิทธิ์
                        </button>
                        <button
                          onClick={() => handleToggleActive(u)}
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                            u.active
                              ? "bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-600 hover:text-white"
                              : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-600 hover:text-white"
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
          <div className="glass-card rounded-2xl p-6 max-w-lg w-full border border-emerald-900/40 shadow-2xl animate-in fade-in">
            <h3 className="text-xl font-bold text-white mb-4">เพิ่มพนักงานใหม่</h3>

            {addError && (
              <div className="mb-4 p-3 rounded-xl bg-red-500/20 border border-red-500/40 text-red-300 text-sm">
                {addError}
              </div>
            )}

            <form onSubmit={handleAddSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">ชื่อ-นามสกุล</label>
                <input
                  type="text"
                  required
                  value={addFullName}
                  onChange={(e) => setAddFullName(e.target.value)}
                  placeholder="เช่น สมชาย ใจดี"
                  className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-emerald-900/30 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">อีเมล (สำหรับเข้าสู่ระบบ)</label>
                <input
                  type="email"
                  required
                  value={addEmail}
                  onChange={(e) => setAddEmail(e.target.value)}
                  placeholder="staff@company.com"
                  className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-emerald-900/30 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">รหัสผ่าน (อย่างน้อย 6 ตัวอักษร)</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={addPassword}
                  onChange={(e) => setAddPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-emerald-900/30 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">บทบาท (Role)</label>
                <select
                  value={addRole}
                  onChange={(e) => setAddRole(e.target.value as UserRole)}
                  className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-emerald-900/30 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm"
                >
                  <option value="WAREHOUSE_STAFF">📦 พนักงานคลัง (รับ/เบิก/ย้ายสินค้าได้)</option>
                  <option value="ADMIN">👑 ผู้ดูแลระบบ (สิทธิ์จัดการเต็มรูปแบบ)</option>
                  <option value="VIEWER">👁️ ผู้ชม (ดูข้อมูลได้อย่างเดียว)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">สิทธิ์เข้าถึงโกดัง</label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setAddWhAccess(["*"])}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                      addWhAccess.includes("*")
                        ? "bg-emerald-600 text-white shadow-md shadow-emerald-950"
                        : "bg-white/5 text-gray-400 border border-white/10 hover:text-white"
                    }`}
                  >
                    ทุกโกดัง (*)
                  </button>
                  {WAREHOUSE_OPTIONS.map((w) => (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => toggleWhAccess(w.id, addWhAccess, setAddWhAccess)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                        !addWhAccess.includes("*") && addWhAccess.includes(w.id)
                          ? "bg-emerald-600 text-white shadow-md shadow-emerald-950"
                          : "bg-white/5 text-gray-400 border border-white/10 hover:text-white"
                      }`}
                    >
                      {w.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-emerald-900/30">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl text-gray-400 hover:text-white text-sm font-medium"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={addSaving}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm shadow-lg shadow-emerald-950 flex items-center gap-2"
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
          <div className="glass-card rounded-2xl p-6 max-w-lg w-full border border-emerald-900/40 shadow-2xl animate-in fade-in">
            <h3 className="text-xl font-bold text-white mb-4">แก้ไขสิทธิ์พนักงาน</h3>

            {editError && (
              <div className="mb-4 p-3 rounded-xl bg-red-500/20 border border-red-500/40 text-red-300 text-sm">
                {editError}
              </div>
            )}

            <form onSubmit={handleEditSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">ชื่อ-นามสกุล</label>
                <input
                  type="text"
                  required
                  value={editFullName}
                  onChange={(e) => setEditFullName(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-emerald-900/30 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">อีเมล (แก้ไขไม่ได้)</label>
                <input
                  type="email"
                  disabled
                  value={editingUser.email}
                  className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-gray-500 text-sm cursor-not-allowed"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">เปลี่ยนรหัสผ่านใหม่ (เว้นว่างไว้ถ้าไม่ต้องการเปลี่ยน)</label>
                <input
                  type="password"
                  minLength={6}
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-emerald-900/30 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">บทบาท (Role)</label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as UserRole)}
                  className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-emerald-900/30 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm"
                >
                  <option value="WAREHOUSE_STAFF">📦 พนักงานคลัง (รับ/เบิก/ย้ายสินค้าได้)</option>
                  <option value="ADMIN">👑 ผู้ดูแลระบบ (สิทธิ์จัดการเต็มรูปแบบ)</option>
                  <option value="VIEWER">👁️ ผู้ชม (ดูข้อมูลได้อย่างเดียว)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">สิทธิ์เข้าถึงโกดัง</label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setEditWhAccess(["*"])}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                      editWhAccess.includes("*")
                        ? "bg-emerald-600 text-white shadow-md shadow-emerald-950"
                        : "bg-white/5 text-gray-400 border border-white/10 hover:text-white"
                    }`}
                  >
                    ทุกโกดัง (*)
                  </button>
                  {WAREHOUSE_OPTIONS.map((w) => (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => toggleWhAccess(w.id, editWhAccess, setEditWhAccess)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                        !editWhAccess.includes("*") && editWhAccess.includes(w.id)
                          ? "bg-emerald-600 text-white shadow-md shadow-emerald-950"
                          : "bg-white/5 text-gray-400 border border-white/10 hover:text-white"
                      }`}
                    >
                      {w.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-emerald-900/30">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="px-4 py-2 rounded-xl text-gray-400 hover:text-white text-sm font-medium"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={editSaving}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm shadow-lg shadow-emerald-950 flex items-center gap-2"
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

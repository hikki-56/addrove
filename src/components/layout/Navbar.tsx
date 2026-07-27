"use client";
import { signOut } from "next-auth/react";
import type { UserRole } from "@/types/models";
import { useTheme } from "@/context/ThemeContext";

const roleLabel: Record<UserRole, string> = {
  ADMIN: "ผู้ดูแลระบบ",
  WAREHOUSE_STAFF: "พนักงานคลัง",
  VIEWER: "ผู้ดูข้อมูล",
};

const roleBadgeClass: Record<UserRole, string> = {
  ADMIN: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  WAREHOUSE_STAFF: "bg-teal-500/20 text-teal-300 border-teal-500/40",
  VIEWER: "bg-gray-500/20 text-gray-400 border-gray-500/30",
};

export default function Navbar({
  user,
}: {
  user: { name: string; email: string; role: UserRole };
}) {
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="h-16 bg-[#080d0a] border-b border-emerald-900/30 flex items-center justify-between px-4 md:px-6 flex-shrink-0 transition-colors">
      {/* Mobile menu placeholder */}
      <button
        className="md:hidden p-2 rounded-lg text-gray-400 hover:text-white hover:bg-emerald-950/40"
        aria-label="เมนู"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      <div className="hidden md:block" />

      {/* Right side */}
      <div className="flex items-center gap-3">
        {/* Theme Toggle Button */}
        <button
          onClick={toggleTheme}
          className="p-2 rounded-xl text-gray-400 hover:text-emerald-300 hover:bg-emerald-950/40 transition-all flex items-center gap-1.5 text-xs font-medium border border-emerald-900/40"
          title={theme === "dark" ? "เปลี่ยนเป็นโหมดสว่าง (กลางวัน)" : "เปลี่ยนเป็นโหมดมืด (กลางคืน)"}
        >
          {theme === "dark" ? (
            <>
              <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
              <span className="hidden sm:inline text-gray-300">โหมดสว่าง</span>
            </>
          ) : (
            <>
              <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
              <span className="hidden sm:inline">โหมดมืด</span>
            </>
          )}
        </button>

        {/* Role badge */}
        <span
          className={`hidden sm:flex px-2.5 py-1 rounded-full text-xs font-medium border ${roleBadgeClass[user.role]}`}
        >
          {roleLabel[user.role]}
        </span>

        {/* User info */}
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-teal-700 flex items-center justify-center text-white text-sm font-semibold shadow-md shadow-emerald-950">
            {user.name?.charAt(0)?.toUpperCase() ?? "?"}
          </div>
          <div className="hidden sm:block">
            <p className="text-sm font-medium text-white leading-none">{user.name}</p>
            <p className="text-xs text-gray-400 mt-0.5">{user.email}</p>
          </div>
        </div>

        {/* Logout */}
        <button
          id="logout-btn"
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="p-2 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
          title="ออกจากระบบ"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
        </button>
      </div>
    </header>
  );
}

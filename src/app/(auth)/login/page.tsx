"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTabAuth } from "@/context/TabAuthContext";

const loginSchema = z.object({
  email: z.string().min(1, "กรุณากรอกอีเมลหรือชื่อผู้ใช้"),
  password: z.string().min(1, "กรุณากรอกรหัสผ่าน"),
});
type LoginForm = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { login: tabLogin } = useTabAuth();

  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginForm) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (json.success) {
        if (json.user && json.token) {
          tabLogin(json.user, json.token, json.expires_at);
        }
        router.replace("/dashboard");
      } else {
        setError(json.message || "กรุณาตรวจสอบ อีเมลหรือรหัสผ่านไม่ถูกต้อง");
        setLoading(false);
      }
    } catch {
      setError("กรุณาลองใหม่อีกครั้ง เกิดข้อผิดพลาดในการเชื่อมต่อ");
      setLoading(false);
    }
  };

  const onInvalid = (formErrors: Record<string, unknown>) => {
    if (formErrors.email) {
      setError(String((formErrors.email as { message?: string }).message || "กรุณาตรวจสอบรูปแบบอีเมล"));
    } else if (formErrors.password) {
      setError(String((formErrors.password as { message?: string }).message || "กรุณากรอกรหัสผ่าน"));
    }
  };

  return (
    <div className="min-h-[100dvh] w-full flex relative bg-slate-950 lg:h-screen lg:overflow-hidden">
      
      {/* Background Subtle Lighting effects (Black Left -> Rich Green Right) */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 -left-20 w-[600px] h-[600px] bg-zinc-800/10 rounded-full blur-[140px]" />
        <div className="absolute bottom-0 -right-20 w-[800px] h-[800px] bg-gradient-to-tl from-emerald-500/25 via-lime-500/15 to-transparent rounded-full blur-[140px]" />
      </div>

      {/* Main Fullscreen Split Layout Card Container (Black Left -> Green Right) */}
      <div className="relative w-full min-h-[100dvh] lg:h-full bg-gradient-to-r from-slate-950 via-slate-950 via-50% to-[#124215] overflow-hidden flex flex-col lg:grid lg:grid-cols-12">

        {/* Mobile Brand Header (จอ < lg): โลโก้ + ชื่อระบบจัดกลาง บนภาพคลังสินค้าจาง ๆ เป็นพื้นหลัง */}
        <div className="lg:hidden relative z-10 overflow-hidden shrink-0 bg-slate-950">
          <div className="absolute inset-0 pointer-events-none">
            <img
              src="/truck-unloading.jpg"
              alt=""
              className="w-full h-full object-cover object-[center_30%] opacity-20"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-slate-950/70 via-slate-950/85 to-slate-950" />
            <div
              className="absolute inset-0 opacity-[0.04]"
              style={{
                backgroundImage: "radial-gradient(#84cc16 1px, transparent 1px)",
                backgroundSize: "28px 28px",
              }}
            />
          </div>

          <div className="relative px-5 pt-9 pb-7 flex flex-col items-center text-center">
            <img
              src="/logo.png"
              alt="A'AMAZON Logo"
              className="h-12 w-auto object-contain max-w-[220px]"
            />
            <h1 className="mt-4 text-4xl font-black text-white tracking-wider uppercase drop-shadow-lg">
              STOCKIFY
            </h1>
            <p className="mt-3 text-xs font-semibold text-lime-400 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-lime-400 animate-ping inline-block shrink-0" />
              ระบบขนย้าย จัดเก็บ และเช็คสต็อกสินค้าเข้าคลัง
            </p>
          </div>
        </div>

        {/* Desktop Brand Panel (จอ lg ขึ้นไป): split-screen แบบเดิม */}
        <div className="hidden lg:flex lg:col-span-7 lg:p-14 flex-col justify-between relative overflow-hidden bg-slate-950">
          
          {/* Warehouse Loading Background Overlay */}
          <div className="absolute inset-0 opacity-25 pointer-events-none overflow-hidden">
            <img
              src="/truck-unloading.jpg"
              alt="Truck Unloading"
              className="w-full h-full object-cover scale-105 filter contrast-125"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/70 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-r from-slate-950 via-transparent to-slate-950" />
          </div>

          {/* Decorative Grid Lines */}
          <div
            className="absolute inset-0 opacity-[0.03] pointer-events-none"
            style={{
              backgroundImage: "radial-gradient(#84cc16 1px, transparent 1px)",
              backgroundSize: "32px 32px",
            }}
          />

          {/* Top Logo / Brand Info */}
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-2">
              <img src="/logo.png" alt="A'AMAZON Logo" className="h-12 w-auto object-contain max-w-[200px]" />
            </div>
          </div>

          {/* Center Title & Warehouse Loading Graphic */}
          <div className="relative z-10 my-auto py-4">
            <h1 className="text-6xl font-black text-white tracking-wider uppercase drop-shadow-lg mb-4">
              STOCKIFY
            </h1>

            {/* Warehouse Loading Illustration Container */}
            <div className="w-full max-w-lg rounded-2xl overflow-hidden border border-lime-500/30 shadow-2xl shadow-black/90 relative group">
              <img
                src="/truck-unloading.jpg"
                alt="การขนสินค้าจากรถเข้าหน้าโกดัง"
                className="w-full h-60 object-cover transition-transform duration-500 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
              <div className="absolute bottom-3 left-4 right-4 text-white">
                <p className="text-sm font-semibold text-lime-400 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-lime-400 animate-ping inline-block" />
                  ระบบขนย้าย จัดเก็บ และเช็คสต็อกสินค้าเข้าคลัง
                </p>
              </div>
            </div>
          </div>

          {/* Footer watermark */}
          <div className="relative z-10 text-lime-400/60 text-[11px] font-mono">
            © Stockify — Warehouse Management Platform
          </div>
        </div>

        {/* Form Section: การ์ดล็อกอินจัดกลางแนวตั้งเสมอ (มือถือ: พื้นดำไล่ลงเขียว, เดสก์ท็อป: คอลัมน์ขวา) */}
        <div className="flex-1 lg:col-span-5 px-4 py-8 sm:p-8 lg:p-12 flex items-center justify-center bg-gradient-to-b lg:bg-gradient-to-r from-[#0a0a0c] via-[#0d260f] to-[#124215]">
          <div className="bg-white rounded-3xl p-5 sm:p-8 lg:p-10 w-full max-w-md shadow-2xl flex flex-col justify-center relative z-10">

            {/* Top Brand Logo inside Circular Frame (แสดงเฉพาะแท็บเล็ตขึ้นไป — บนมือถือโลโก้อยู่ที่เฮดเดอร์แล้ว) */}
            <div className="hidden sm:flex justify-center mb-6">
              <div className="w-24 h-24 sm:w-32 sm:h-32 lg:w-36 lg:h-36 rounded-full bg-gradient-to-br from-lime-50 via-white to-emerald-50 border-4 border-lime-500/40 flex items-center justify-center p-3 sm:p-4 shadow-xl shadow-lime-950/15 transition-transform hover:scale-105">
                <img
                  src="/logo-vertical.png"
                  alt="A'AMAZON Logo"
                  className="w-full h-full object-contain drop-shadow-sm"
                />
              </div>
            </div>

            {/* Admin Title */}
            <div className="text-center mb-5">
              <h2 className="text-base sm:text-lg font-bold text-slate-800 tracking-tight flex items-center justify-center gap-2">
                <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                <span>เข้าสู่ระบบผู้ดูแลระบบ (Admin)</span>
              </h2>
              <p className="text-xs text-slate-500 mt-1">กรอกอีเมลและรหัสผ่านเพื่อจัดการคลังสินค้า</p>
            </div>

            {/* Error message */}
            {error && (
              <div className="mb-5 p-3 rounded-2xl bg-red-50 border border-red-200 text-red-600 text-xs flex items-start gap-2 animate-fadeIn">
                <svg className="w-4 h-4 flex-shrink-0 mt-0.5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit(onSubmit as any, onInvalid)} className="space-y-5 pt-1" suppressHydrationWarning>
              
              {/* Username / Email Pill Input */}
              <div>
                <div className="relative">
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    {...register("email")}
                    placeholder="Username / Email"
                    suppressHydrationWarning
                    className="w-full bg-[#f4f6f3] border border-slate-200 rounded-full px-5 py-3 text-slate-800 text-base sm:text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-lime-500 focus:bg-white transition-all shadow-inner"
                  />
                </div>
                {errors.email && <p className="mt-1 ml-4 text-[11px] text-red-500">{(errors.email as any).message}</p>}
              </div>

              {/* Password Pill Input */}
              <div>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    {...register("password")}
                    placeholder="Password"
                    suppressHydrationWarning
                    className="w-full bg-[#f4f6f3] border border-slate-200 rounded-full pl-5 pr-12 py-3 text-slate-800 text-base sm:text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-lime-500 focus:bg-white transition-all shadow-inner"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    suppressHydrationWarning
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-1"
                    title={showPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
                  >
                    {showPassword ? (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858-5.908a10.015 10.015 0 014.122-.863c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21f-9-9" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    )}
                  </button>
                </div>
                {errors.password && <p className="mt-1 ml-4 text-[11px] text-red-500">{(errors.password as any).message}</p>}
              </div>

              {/* Sign In Button */}
              <div className="pt-2 flex justify-center">
                <button
                  id="login-submit"
                  type="submit"
                  disabled={loading}
                  suppressHydrationWarning
                  className="w-full sm:w-4/5 py-3 px-6 rounded-full bg-gradient-to-r from-[#65a30d] via-[#4d7c0f] to-[#3f6212] hover:from-[#84cc16] hover:to-[#4d7c0f] text-white font-bold text-sm shadow-md shadow-lime-950/30 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all cursor-pointer transform hover:-translate-y-0.5 active:translate-y-0"
                >
                  {loading ? (
                    <>
                      <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                      </svg>
                      <span>กำลังเข้าสู่ระบบ...</span>
                    </>
                  ) : (
                    <span>Sign In</span>
                  )}
                </button>
              </div>

            </form>
          </div>
        </div>

        {/* Mobile Footer (จอ < lg) */}
        <p className="lg:hidden relative z-10 shrink-0 pb-5 text-center text-lime-400/60 text-[11px] font-mono">
          © Stockify — Warehouse Management Platform
        </p>

      </div>
    </div>
  );
}


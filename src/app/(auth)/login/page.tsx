"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTabAuth } from "@/context/TabAuthContext";
import AuthShell from "@/components/layout/AuthShell";
import { M3Banner, m3Cls } from "@/components/ui/m3";

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
    <AuthShell>
      <h1 className="font-m3-disp text-[22px] font-bold text-m3-grey-800">เข้าสู่ระบบผู้ดูแลระบบ (Admin)</h1>

      {/* Error message */}
      {error && (
        <M3Banner tone="error" role="alert" className="mt-5">
          {error}
        </M3Banner>
      )}

      <form onSubmit={handleSubmit(onSubmit as any, onInvalid)} className="mt-6 space-y-4" suppressHydrationWarning>
        {/* Username / Email */}
        <div>
          <div className="relative">
            <label htmlFor="email" className="absolute -top-2 left-2.5 bg-white px-1 text-xs font-semibold text-m3-grey-600">
              อีเมลหรือชื่อผู้ใช้
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              {...register("email")}
              placeholder="Username / Email"
              suppressHydrationWarning
              className={`${errors.email ? m3Cls.inputError : m3Cls.input} h-12`}
            />
          </div>
          {errors.email && <p className="mt-1.5 ml-1 text-xs font-medium text-m3-error">{(errors.email as any).message}</p>}
        </div>

        {/* Password */}
        <div>
          <div className="relative">
            <label htmlFor="password" className="absolute -top-2 left-2.5 z-10 bg-white px-1 text-xs font-semibold text-m3-grey-600">
              รหัสผ่าน
            </label>
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              {...register("password")}
              placeholder="Password"
              suppressHydrationWarning
              className={`${errors.password ? m3Cls.inputError : m3Cls.input} h-12 pr-12`}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              suppressHydrationWarning
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-m3-grey-600 transition-colors hover:bg-[rgba(145,158,171,0.08)] hover:text-m3-grey-800"
              title={showPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
            >
              {showPassword ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858-5.908a10.015 10.015 0 014.122-.863c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21f-9-9" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              )}
            </button>
          </div>
          {errors.password && <p className="mt-1.5 ml-1 text-xs font-medium text-m3-error">{(errors.password as any).message}</p>}
        </div>

        {/* Sign In Button */}
        <button
          id="login-submit"
          type="submit"
          disabled={loading}
          suppressHydrationWarning
          className="m3-btn m3-btn-dark h-12 w-full gap-2 text-[15px] disabled:opacity-48 disabled:cursor-not-allowed cursor-pointer"
        >
          {loading ? (
            <>
              <span aria-hidden="true" className={m3Cls.spinner} />
              <span>กำลังเข้าสู่ระบบ...</span>
            </>
          ) : (
            <span>Sign In</span>
          )}
        </button>
      </form>
    </AuthShell>
  );
}

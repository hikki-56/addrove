import { NextResponse } from "next/server";

export async function POST() {
  const response = NextResponse.json({ success: true, message: "ออกจากระบบสำเร็จ" });
  const cookieOptions = {
    httpOnly: true,
    path: "/",
    maxAge: 0,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };

  for (const name of [
    "authjs.session-token",
    "next-auth.session-token",
    "__Secure-authjs.session-token",
    "__Secure-next-auth.session-token",
  ]) {
    response.cookies.set(name, "", cookieOptions);
  }

  return response;
}

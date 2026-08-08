import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  url.pathname = "/login-logs";
  return NextResponse.redirect(url, 308);
}

import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  url.pathname = "/movements/transfer";
  return NextResponse.redirect(url, 308);
}

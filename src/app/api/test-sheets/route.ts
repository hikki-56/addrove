import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-session";

async function requireAdmin(req: NextRequest) {
  const session = await getAuthSession(req);
  if (!session) {
    return NextResponse.json({ success: false, message: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ success: false, message: "เฉพาะ Admin เท่านั้น" }, { status: 403 });
  }
  return null;
}

export async function GET(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const sheetId = process.env.GOOGLE_SHEET_ID || "";
  const scriptUrl = process.env.GOOGLE_SCRIPT_URL || "";

  let scriptStatus = "NOT_CONFIGURED";
  let scriptMessage = "ยังไม่ได้ตั้งค่า GOOGLE_SCRIPT_URL";

  if (scriptUrl) {
    try {
      const res = await fetch(scriptUrl, { method: "GET", redirect: "follow", cache: "no-store" });
      if (res.ok) {
        scriptStatus = "CONNECTED";
        scriptMessage = "เชื่อมต่อ Google Apps Script Web App สำเร็จ!";
      } else {
        scriptStatus = "ERROR_404";
        scriptMessage = `URL ไม่ถูกต้อง (HTTP Status: ${res.status}). กรุณาคัดลอก Web App URL จาก Google Apps Script มาวางใหม่`;
      }
    } catch (e) {
      scriptStatus = "FETCH_FAILED";
      scriptMessage = `เกิดข้อผิดพลาดในการเชื่อมต่อ: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  return NextResponse.json({
    sheetIdConfigured: Boolean(sheetId),
    scriptUrlConfigured: Boolean(scriptUrl),
    scriptStatus,
    scriptMessage,
  });
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  return NextResponse.json(
    { success: false, message: "API นี้ใช้ตรวจการเชื่อมต่อเท่านั้น กรุณาตั้งค่าผ่าน server environment" },
    { status: 405, headers: { Allow: "GET" } }
  );
}

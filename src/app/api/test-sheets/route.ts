import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function GET() {
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
    sheetId,
    scriptUrl,
    scriptStatus,
    scriptMessage,
  });
}

export async function POST(req: Request) {
  try {
    const { scriptUrl, sheetId } = await req.json();
    const envPath = path.join(process.cwd(), ".env.local");

    let envText = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf-8") : "";

    if (sheetId !== undefined) {
      if (envText.includes("GOOGLE_SHEET_ID=")) {
        envText = envText.replace(/GOOGLE_SHEET_ID=.*/g, `GOOGLE_SHEET_ID="${sheetId}"`);
      } else {
        envText += `\nGOOGLE_SHEET_ID="${sheetId}"`;
      }
    }

    if (scriptUrl !== undefined) {
      if (envText.includes("GOOGLE_SCRIPT_URL=")) {
        envText = envText.replace(/GOOGLE_SCRIPT_URL=.*/g, `GOOGLE_SCRIPT_URL="${scriptUrl}"`);
      } else {
        envText += `\nGOOGLE_SCRIPT_URL="${scriptUrl}"`;
      }
    }

    fs.writeFileSync(envPath, envText, "utf-8");
    process.env.GOOGLE_SCRIPT_URL = scriptUrl ?? process.env.GOOGLE_SCRIPT_URL;
    if (sheetId) process.env.GOOGLE_SHEET_ID = sheetId;

    return NextResponse.json({ success: true, message: "อัปเดตการตั้งค่าสำเร็จ" });
  } catch (e) {
    return NextResponse.json(
      { success: false, message: e instanceof Error ? e.message : "เกิดข้อผิดพลาด" },
      { status: 500 }
    );
  }
}

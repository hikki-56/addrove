import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth-session";
import { unauthorizedResponse } from "@/lib/api-response";
import os from "os";

export async function GET(req: NextRequest) {
  const session = await getAuthSession(req);
  if (!session) return unauthorizedResponse();

  try {
    const nets = os.networkInterfaces();
    let localIp = "";

    for (const name of Object.keys(nets)) {
      const netList = nets[name];
      if (!netList) continue;
      for (const net of netList) {
        // Skip internal (i.e. 127.0.0.1) and non-IPv4 addresses
        if (net.family === "IPv4" && !net.internal) {
          localIp = net.address;
          break;
        }
      }
    }

    return NextResponse.json({
      success: true,
      ip: localIp,
      port: 3000,
      url: localIp ? `http://${localIp}:3000` : "",
    });
  } catch (e) {
    return NextResponse.json({
      success: false,
      ip: "",
      port: 3000,
      url: "",
    });
  }
}

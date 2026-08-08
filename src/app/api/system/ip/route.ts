import { NextResponse } from "next/server";
import os from "os";

export async function GET() {
  try {
    const nets = os.networkInterfaces();
    let localIp = "192.168.1.54"; // fallback

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
      url: `http://${localIp}:3000`,
    });
  } catch (e) {
    return NextResponse.json({
      success: false,
      ip: "192.168.1.54",
      port: 3000,
      url: "http://192.168.1.54:3000",
    });
  }
}

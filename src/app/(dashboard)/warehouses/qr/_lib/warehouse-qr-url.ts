const FALLBACK_PRODUCTION_ORIGIN = "https://addrove.vercel.app";

function parseHttpOrigin(value: string | undefined): string | null {
  if (!value) return null;

  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function getWarehouseQrProductionOrigin(
  configuredOrigin = process.env.NEXT_PUBLIC_APP_URL
): string {
  const origin = parseHttpOrigin(configuredOrigin);
  if (!origin) return FALLBACK_PRODUCTION_ORIGIN;

  const hostname = new URL(origin).hostname;
  const fallbackHostname = new URL(FALLBACK_PRODUCTION_ORIGIN).hostname;
  if (
    (hostname.endsWith(".vercel.app") && hostname !== fallbackHostname) ||
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0"
  ) {
    return FALLBACK_PRODUCTION_ORIGIN;
  }

  return origin;
}

/**
 * แปลง URL ปกติเป็น Android Chrome Intent URL เพื่อบังคับให้กล้อง Android
 * เปิดลิงก์ใน Chrome โดยตรงแม้เบราว์เซอร์เริ่มต้นของเครื่องไม่ใช่ Chrome
 * (iOS ไม่รองรับ intent:// — iPhone จะเปิดตามเบราว์เซอร์เริ่มต้นของเครื่องเสมอ)
 *
 * ตัวอย่าง:
 *   https://addrove.vercel.app/w/wh-01
 *     -> intent://addrove.vercel.app/w/wh-01#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=...;end
 *
 * S.browser_fallback_url = ถ้าเครื่องไม่มี Chrome จะเปิด URL ต้นฉบับด้วยเบราว์เซอร์ที่มีแทน
 */
export function toChromeIntentUrl(targetUrl: string): string {
  try {
    const url = new URL(targetUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return targetUrl;

    const scheme = url.protocol.replace(":", "");
    const pathAndQuery = `${url.pathname}${url.search}`;
    const fallback = encodeURIComponent(targetUrl);

    return `intent://${url.host}${pathAndQuery}#Intent;scheme=${scheme};package=com.android.chrome;S.browser_fallback_url=${fallback};end`;
  } catch {
    return targetUrl;
  }
}

export function resolveWarehouseQrBaseUrl(
  candidate: string,
  configuredOrigin = process.env.NEXT_PUBLIC_APP_URL
): string {
  const productionOrigin = getWarehouseQrProductionOrigin(configuredOrigin);
  const candidateOrigin = parseHttpOrigin(candidate);
  if (!candidateOrigin) return productionOrigin;

  const hostname = new URL(candidateOrigin).hostname;
  if (
    hostname.endsWith(".vercel.app") ||
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0"
  ) {
    return productionOrigin;
  }

  return candidateOrigin;
}

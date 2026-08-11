const FALLBACK_PRODUCTION_ORIGIN = "https://addrove-app.vercel.app";

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
  if (hostname.endsWith(".vercel.app") && hostname !== fallbackHostname) {
    return FALLBACK_PRODUCTION_ORIGIN;
  }

  return origin;
}

export function resolveWarehouseQrBaseUrl(
  candidate: string,
  configuredOrigin = process.env.NEXT_PUBLIC_APP_URL
): string {
  const productionOrigin = getWarehouseQrProductionOrigin(configuredOrigin);
  const candidateOrigin = parseHttpOrigin(candidate);
  if (!candidateOrigin) return productionOrigin;

  if (new URL(candidateOrigin).hostname.endsWith(".vercel.app")) {
    return productionOrigin;
  }

  return candidateOrigin;
}

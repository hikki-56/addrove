interface RateLimitEntry {
  failures: number;
  windowStartedAt: number;
  blockedUntil: number;
}

export interface RateLimitOptions {
  maxFailures: number;
  windowMs: number;
  blockMs: number;
}

const entries = new Map<string, RateLimitEntry>();

function cleanExpiredEntries(now: number) {
  if (entries.size < 500) return;
  for (const [key, entry] of entries) {
    if (entry.blockedUntil <= now && now - entry.windowStartedAt > 24 * 60 * 60 * 1000) {
      entries.delete(key);
    }
  }
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

export function getRateLimitRetryAfter(key: string): number {
  const now = Date.now();
  const entry = entries.get(key);
  if (!entry || entry.blockedUntil <= now) return 0;
  return Math.max(1, Math.ceil((entry.blockedUntil - now) / 1000));
}

export function recordFailedAttempt(key: string, options: RateLimitOptions): number {
  const now = Date.now();
  cleanExpiredEntries(now);

  const current = entries.get(key);
  const entry =
    !current || now - current.windowStartedAt >= options.windowMs
      ? { failures: 0, windowStartedAt: now, blockedUntil: 0 }
      : current;

  entry.failures += 1;
  if (entry.failures >= options.maxFailures) {
    entry.blockedUntil = now + options.blockMs;
  }
  entries.set(key, entry);
  return getRateLimitRetryAfter(key);
}

export function clearFailedAttempts(key: string) {
  entries.delete(key);
}

import { createHmac, timingSafeEqual } from "crypto";
import { getQrTokenSecret } from "@/lib/server-secrets";

interface QrTokenPayload {
  employee_id: string;
  issued_at: number;
  expires_at: number;
}

const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60;

function sign(encodedPayload: string): string {
  return createHmac("sha256", getQrTokenSecret())
    .update(encodedPayload)
    .digest("base64url");
}

export function generateEmployeeQrToken(
  employeeId: string,
  ttlSeconds = DEFAULT_TTL_SECONDS
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: QrTokenPayload = {
    employee_id: employeeId,
    issued_at: now,
    expires_at: now + ttlSeconds,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encodedPayload}.${sign(encodedPayload)}`;
}

export function verifyEmployeeQrToken(token: string): QrTokenPayload | null {
  const [encodedPayload, receivedSignature, extra] = token.split(".");
  if (!encodedPayload || !receivedSignature || extra) return null;

  const expectedSignature = sign(encodedPayload);
  const received = Buffer.from(receivedSignature);
  const expected = Buffer.from(expectedSignature);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf-8")
    ) as Partial<QrTokenPayload>;
    const now = Math.floor(Date.now() / 1000);
    if (
      typeof payload.employee_id !== "string" ||
      !payload.employee_id ||
      typeof payload.issued_at !== "number" ||
      typeof payload.expires_at !== "number" ||
      payload.expires_at <= now
    ) {
      return null;
    }
    return payload as QrTokenPayload;
  } catch {
    return null;
  }
}

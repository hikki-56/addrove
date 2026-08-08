import { IAuditRepository, AuditLogEntry, AuditOutcome } from "./audit.repository";
import { AuditAction } from "./audit.types";

const SENSITIVE_KEYS = new Set([
  "password",
  "token",
  "secret",
  "qr_token",
  "apikey",
  "authorization",
  "credential",
  "privatekey",
]);

export function sanitizeMetadata(metadata?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!metadata || typeof metadata !== "object") return undefined;

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.has(lowerKey) || lowerKey.includes("password") || lowerKey.includes("secret")) {
      sanitized[key] = "[REDACTED]";
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      sanitized[key] = sanitizeMetadata(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export interface AuditLogOptions {
  correlationId?: string;
  idempotencyKey?: string;
  actorId: string;
  actorRole: string;
  action: AuditAction;
  resourceType: string;
  resourceId?: string;
  warehouseId?: string;
  outcome: AuditOutcome;
  errorCode?: string;
  metadata?: Record<string, unknown>;
}

export async function logAudit(
  repo?: IAuditRepository,
  options?: AuditLogOptions
): Promise<AuditLogEntry | null> {
  if (!repo || !options || typeof repo.append !== "function") return null;

  try {
    const correlationId =
      options.correlationId || `corr-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const entry = await repo.append({
      correlation_id: correlationId,
      idempotency_key: options.idempotencyKey,
      actor_id: options.actorId || "unknown",
      actor_role: options.actorRole || "UNKNOWN",
      action: options.action,
      resource_type: options.resourceType,
      resource_id: options.resourceId,
      warehouse_id: options.warehouseId,
      outcome: options.outcome,
      error_code: options.errorCode,
      metadata: sanitizeMetadata(options.metadata),
    });

    return entry;
  } catch (err) {
    // Fail-safe audit logging: log locally to prevent blocking core operations if audit repository is transiently unavailable
    console.error("[AuditService] Failed to record audit log:", err);
    return null;
  }
}

import {
  logAudit,
  sanitizeMetadata,
} from "@/lib/audit";
import { InMemoryAuditRepository } from "@/lib/repositories/in-memory/in-memory-stock.repository";

describe("Append-Only Audit Logging Tests", () => {
  let repo: InMemoryAuditRepository;

  beforeEach(() => {
    repo = new InMemoryAuditRepository();
  });

  test("logAudit records structured audit log entry successfully", async () => {
    const entry = await logAudit(repo, {
      correlationId: "corr-100",
      idempotencyKey: "idem-100",
      actorId: "usr-01",
      actorRole: "ADMIN",
      action: "STOCK_RECEIVE",
      resourceType: "Document",
      resourceId: "doc-100",
      warehouseId: "wh-1",
      outcome: "SUCCESS",
      metadata: { quantity: 50, sku: "SKU01" },
    });

    expect(entry).not.toBeNull();
    expect(entry?.audit_id).toBeDefined();
    expect(entry?.correlation_id).toBe("corr-100");
    expect(entry?.outcome).toBe("SUCCESS");

    const allLogs = await repo.findAll({ actor_id: "usr-01" });
    expect(allLogs.length).toBe(1);
    expect(allLogs[0].metadata).toEqual({ quantity: 50, sku: "SKU01" });
  });

  test("Sensitive data such as password, token, and secrets are 100% redacted from audit metadata", () => {
    const raw = {
      user_id: "usr-1",
      password: "SuperSecretPassword123!",
      token: "jwt-token-xyz",
      secretKey: "secret_12345",
      nested: {
        apiKey: "api-secret-key",
        normalData: "allowed",
      },
    };

    const sanitized = sanitizeMetadata(raw);
    expect(sanitized?.password).toBe("[REDACTED]");
    expect(sanitized?.token).toBe("[REDACTED]");
    expect(sanitized?.secretKey).toBe("[REDACTED]");
    expect((sanitized?.nested as any)?.apiKey).toBe("[REDACTED]");
    expect((sanitized?.nested as any)?.normalData).toBe("allowed");
  });

  test("Audit log failure does not crash core operation (fail-safe audit logging)", async () => {
    const faultyRepo = {
      append: async () => {
        throw new Error("Disk Full");
      },
      findAll: async () => [],
    };

    const entry = await logAudit(faultyRepo as any, {
      actorId: "usr-01",
      actorRole: "STAFF",
      action: "STOCK_ISSUE",
      resourceType: "Document",
      outcome: "FAILURE",
    });

    expect(entry).toBeNull();
  });
});

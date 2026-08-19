import { executeAtomicStockOperation, AtomicStockRequest, AtomicStockResult } from '@/lib/google-sheets/atomic-operations';
import { withStockLocks, formatStockLockKey } from '@/lib/locking';
import { claimIdempotencyKey, completeIdempotencyKey, failIdempotencyKey } from '@/lib/idempotency';
import { executeWithJournal } from '@/lib/recovery';
import { logAudit } from '@/lib/audit';
import type { IStockRepository } from '@/lib/repositories/interfaces';
import type { Document } from '@/types/models';

export interface AtomicOperationConfig {
  repo: IStockRepository;
  operationType: string;
  idempotencyKey: string;
  actorId: string;
  actorRole: string;
  correlationId?: string;
  lockKeys: string[];
  auditAction: string;
  warehouseId: string;
  payload: unknown;
  execute: (deps: { repo: IStockRepository }) => Promise<Document>;
}

/**
 * Executes a stock operation with:
 * 1. Local in-memory lock (optimization for single instance)
 * 2. Distributed Apps Script lock (correctness across instances)
 * 3. Atomic idempotency check + mutation (within distributed lock)
 * 4. Operation journal for recovery
 * 5. Audit logging
 */
export async function executeAtomicOperation(config: AtomicOperationConfig): Promise<Document> {
  return withStockLocks(config.lockKeys, async () => {
    // Local idempotency check (fast path)
    const claim = await claimIdempotencyKey<Document>(
      config.repo.idempotency,
      config.idempotencyKey,
      config.operationType,
      config.actorId,
      config.payload
    );
    if (claim.isReplay && claim.cachedResult) {
      return claim.cachedResult;
    }

    // Execute with journal for recovery if journal repository is available
    try {
      const result = config.repo?.journal
        ? await executeWithJournal<Document>({
            journalRepo: config.repo.journal,
            operationType: config.operationType,
            idempotencyKey: config.idempotencyKey,
            actorId: config.actorId,
            payload: config.payload,
            steps: [
              {
                name: `execute_${config.operationType.toLowerCase()}`,
                execute: async () => config.execute({ repo: config.repo }),
              },
            ],
          })
        : await config.execute({ repo: config.repo });

      // Fire-and-forget idempotency completion (caches result for replays, not critical path)
      completeIdempotencyKey(config.repo.idempotency, config.idempotencyKey, result)
        .catch((e) => console.warn('[AtomicOperation] idempotency complete error (non-fatal):', e));

      // Fire-and-forget audit log — do not block response waiting for Sheets write
      logAudit(config.repo.audit, {
        correlationId: config.correlationId,
        idempotencyKey: config.idempotencyKey,
        actorId: config.actorId,
        actorRole: config.actorRole,
        action: config.auditAction,
        resourceType: 'Document',
        resourceId: result.document_id,
        warehouseId: config.warehouseId,
        outcome: 'SUCCESS',
      }).catch((e) => console.warn('[AtomicOperation] audit log error (non-fatal):', e));

      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await failIdempotencyKey(config.repo.idempotency, config.idempotencyKey, msg);

      await logAudit(config.repo.audit, {
        correlationId: config.correlationId,
        idempotencyKey: config.idempotencyKey,
        actorId: config.actorId,
        actorRole: config.actorRole,
        action: config.auditAction,
        resourceType: 'Document',
        warehouseId: config.warehouseId,
        outcome: 'FAILURE',
        errorCode: err instanceof Error ? err.name : 'UNKNOWN_ERROR',
        metadata: { error: msg },
      });

      throw err;
    }
  });
}

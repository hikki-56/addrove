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
 * 1. Local in-memory lock (FIFO mutual exclusion within a single process)
 * 2. Atomic idempotency check + mutation (within the in-process lock)
 * 3. Operation journal for recovery
 * 4. Audit logging
 *
 * NOTE — distributed locking is NOT implemented yet:
 * `withStockLocks` only guarantees mutual exclusion within ONE Node.js
 * process / serverless instance. Two serverless instances operating on the
 * same stock location concurrently (with different idempotency keys) can
 * still race. The unused import of `executeAtomicStockOperation`
 * (@/lib/google-sheets/atomic-operations) has been removed because the Apps
 * Script side currently exposes no standalone acquire/release lock API —
 * its LockService lock lives only inside a single `atomicStockOperation`
 * request and cannot wrap this local critical section.
 *
 * TODO(distributed-lock): to make this correct across instances, pick one of:
 * (a) add `acquireLock` / `releaseLock` actions (with owner token + expiry)
 *     to the Apps Script and its client allowlist, then wrap `withStockLocks`
 *     best-effort: try to acquire with a short timeout, release in `finally`,
 *     and fall back to the in-process lock with a console.warn on any failure;
 * (b) push the whole critical section into a single `atomicStockOperation`
 *     request so Apps Script's LockService covers it end-to-end; or
 * (c) use a dedicated lock store (Redis/Redlock, or a DB advisory lock) via
 *     the `ILockProvider` interface in @/lib/locking/lock-provider.
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

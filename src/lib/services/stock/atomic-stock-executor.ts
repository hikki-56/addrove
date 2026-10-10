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
  const startedAt = performance.now();
  return withStockLocks(config.lockKeys, async () => {
    const lockWaitMs = performance.now() - startedAt;
    let claimMs = 0;
    let businessMs = 0;
    let journalAndBusinessMs = 0;
    let timingLogged = false;
    const logTiming = (outcome: "success" | "failure" | "replay") => {
      if (timingLogged || process.env.NODE_ENV === "test") return;
      timingLogged = true;
      console.info(
        "[StockAtomicTiming]",
        JSON.stringify({
          operation: config.operationType,
          warehouse_id: config.warehouseId,
          outcome,
          lock_count: config.lockKeys.length,
          lock_wait_ms: Number(lockWaitMs.toFixed(1)),
          idempotency_ms: Number(claimMs.toFixed(1)),
          business_ms: Number(businessMs.toFixed(1)),
          journal_overhead_ms: Number(
            Math.max(0, journalAndBusinessMs - businessMs).toFixed(1)
          ),
          duration_ms: Number((performance.now() - startedAt).toFixed(1)),
        })
      );
    };

    // Local idempotency check (fast path)
    try {
      const claimStartedAt = performance.now();
      const claim = await claimIdempotencyKey<Document>(
        config.repo.idempotency,
        config.idempotencyKey,
        config.operationType,
        config.actorId,
        config.payload
      );
      claimMs = performance.now() - claimStartedAt;
      if (claim.isReplay && claim.cachedResult) {
        logTiming("replay");
        return claim.cachedResult;
      }

      // Execute with journal for recovery if journal repository is available
      try {
        const runBusinessOperation = async () => {
          const businessStartedAt = performance.now();
          try {
            return await config.execute({ repo: config.repo });
          } finally {
            businessMs = performance.now() - businessStartedAt;
          }
        };
        const journalStartedAt = performance.now();
        let result: Document;
        try {
          result = config.repo?.journal
            ? await executeWithJournal<Document>({
                journalRepo: config.repo.journal,
                operationType: config.operationType,
                idempotencyKey: config.idempotencyKey,
                actorId: config.actorId,
                payload: config.payload,
                steps: [
                  {
                    name: `execute_${config.operationType.toLowerCase()}`,
                    execute: runBusinessOperation,
                  },
                ],
              })
            : await runBusinessOperation();
        } finally {
          journalAndBusinessMs = performance.now() - journalStartedAt;
        }

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

        logTiming("success");
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

        logTiming("failure");
        throw err;
      }
    } catch (err) {
      logTiming("failure");
      throw err;
    }
  });
}

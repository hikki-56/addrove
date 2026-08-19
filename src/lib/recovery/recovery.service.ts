import {
  IOperationJournalRepository,
  OperationRecord,
  JournalStep,
  ManualReviewRequiredError,
} from "./operation-journal";
import { getCompensator } from "./compensation";
import { computePayloadHash } from "@/lib/idempotency/idempotency.service";

export interface JournalExecutableStep<T = unknown> {
  name: string;
  execute: (prevResults: Record<string, unknown>) => Promise<T>;
  compensate?: (stepData: Record<string, unknown>, context: Record<string, unknown>) => Promise<void>;
}

export async function executeWithJournal<T>(options: {
  journalRepo: IOperationJournalRepository;
  operationType: string;
  idempotencyKey: string;
  actorId: string;
  payload: unknown;
  steps: JournalExecutableStep[];
}): Promise<T> {
  const { journalRepo, operationType, idempotencyKey, actorId, payload, steps } = options;
  const payloadHash = computePayloadHash(payload);
  const operationId = `op-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const journalSteps: JournalStep[] = steps.map((s) => ({
    step_name: s.name,
    status: "PENDING",
  }));

  const operation = await journalRepo.create({
    operation_id: operationId,
    idempotency_key: idempotencyKey,
    operation_type: operationType,
    payload_hash: payloadHash,
    actor_id: actorId,
    steps: journalSteps,
    completed_steps: [],
    status: "IN_PROGRESS",
    retry_count: 0,
  });

  const stepResults: Record<string, unknown> = {};
  const completedStepNames: string[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    try {
      const result = await step.execute(stepResults);
      stepResults[step.name] = result;
      completedStepNames.push(step.name);

      journalSteps[i] = {
        step_name: step.name,
        status: "COMPLETED",
        executed_at: new Date().toISOString(),
        data: typeof result === "object" && result !== null ? (result as Record<string, unknown>) : { result },
      };

      // Fire-and-forget journal step update — do not block on Sheets write
      journalRepo.update(operation.operation_id, {
        steps: journalSteps,
        completed_steps: completedStepNames,
      }).catch((e) => console.warn('[Recovery] journal step update error (non-fatal):', e));
    } catch (stepErr) {
      const errorMessage = stepErr instanceof Error ? stepErr.message : String(stepErr);
      journalSteps[i] = {
        step_name: step.name,
        status: "FAILED",
        executed_at: new Date().toISOString(),
        error: errorMessage,
      };

      await journalRepo.update(operation.operation_id, {
        steps: journalSteps,
        status: "COMPENSATING",
        last_error: errorMessage,
      });

      // Run compensation in reverse order for completed steps
      let compensationFailed = false;
      for (let j = completedStepNames.length - 1; j >= 0; j--) {
        const compStepName = completedStepNames[j];
        const stepDef = steps.find((s) => s.name === compStepName);
        const compFn = stepDef?.compensate || getCompensator(compStepName);

        if (compFn) {
          try {
            await compFn(
              (stepResults[compStepName] as Record<string, unknown>) || {},
              { operationId, actorId, payload }
            );
            const stepIdx = journalSteps.findIndex((s) => s.step_name === compStepName);
            if (stepIdx !== -1) {
              journalSteps[stepIdx].status = "COMPENSATED";
            }
          } catch (compErr) {
            console.error(`[RecoveryService] Compensation failed for step ${compStepName}:`, compErr);
            compensationFailed = true;
            break;
          }
        }
      }

      if (compensationFailed) {
        await journalRepo.update(operation.operation_id, {
          steps: journalSteps,
          status: "MANUAL_REVIEW",
          last_error: `Compensation failed after step "${step.name}" error: ${errorMessage}`,
        });
        throw new ManualReviewRequiredError(
          `การย้อนกลับข้อมูลล้มเหลว กรุณาตรวจสอบโดย Admin (Operation ID: ${operation.operation_id})`,
          operation.operation_id,
          { failedStep: step.name, originalError: errorMessage, completedSteps: completedStepNames }
        );
      } else {
        await journalRepo.update(operation.operation_id, {
          steps: journalSteps,
          status: "COMPENSATED",
          last_error: errorMessage,
        });
        throw stepErr;
      }
    }
  }

  // Fire-and-forget final journal completion — do not block response
  journalRepo.update(operation.operation_id, {
    status: "COMPLETED",
  }).catch((e) => console.warn('[Recovery] journal final update error (non-fatal):', e));

  return stepResults[steps[steps.length - 1].name] as T;
}

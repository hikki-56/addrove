import {
  executeWithJournal,
  ManualReviewRequiredError,
} from "@/lib/recovery";
import { InMemoryOperationJournalRepository } from "@/lib/repositories/in-memory/in-memory-stock.repository";

describe("Operation Journal & Saga Recovery Tests", () => {
  let journalRepo: InMemoryOperationJournalRepository;

  beforeEach(() => {
    journalRepo = new InMemoryOperationJournalRepository();
  });

  test("Successful multi-step operation completes all steps in journal", async () => {
    const executedSteps: string[] = [];

    const result = await executeWithJournal({
      journalRepo,
      operationType: "STOCK_MOVE",
      idempotencyKey: "idem-move-1",
      actorId: "usr-1",
      payload: { from: "A", to: "B", qty: 10 },
      steps: [
        {
          name: "deduct_source",
          execute: async () => {
            executedSteps.push("deduct_source");
            return { deducted: 10 };
          },
        },
        {
          name: "add_destination",
          execute: async () => {
            executedSteps.push("add_destination");
            return { added: 10 };
          },
        },
      ],
    });

    expect(result).toEqual({ added: 10 });
    expect(executedSteps).toEqual(["deduct_source", "add_destination"]);

    const op = await journalRepo.findByIdempotencyKey("idem-move-1");
    expect(op?.status).toBe("COMPLETED");
    expect(op?.completed_steps).toEqual(["deduct_source", "add_destination"]);
  });

  test("Step failure triggers automatic compensation in reverse order", async () => {
    const compensatedSteps: string[] = [];

    await expect(
      executeWithJournal({
        journalRepo,
        operationType: "STOCK_TRANSFER",
        idempotencyKey: "idem-transfer-fail",
        actorId: "usr-1",
        payload: { from: "wh-1", to: "wh-2", qty: 20 },
        steps: [
          {
            name: "deduct_from_wh1",
            execute: async () => ({ deductedWh1: 20 }),
            compensate: async () => {
              compensatedSteps.push("deduct_from_wh1");
            },
          },
          {
            name: "add_to_wh2",
            execute: async () => {
              throw new Error("Network error writing destination warehouse");
            },
          },
        ],
      })
    ).rejects.toThrow(/Network error/);

    expect(compensatedSteps).toEqual(["deduct_from_wh1"]);

    const op = await journalRepo.findByIdempotencyKey("idem-transfer-fail");
    expect(op?.status).toBe("COMPENSATED");
  });

  test("Failed compensation marks operation as MANUAL_REVIEW with diagnostics", async () => {
    await expect(
      executeWithJournal({
        journalRepo,
        operationType: "STOCK_CRITICAL_MOVE",
        idempotencyKey: "idem-critical-fail",
        actorId: "usr-1",
        payload: { step: 1 },
        steps: [
          {
            name: "step_one",
            execute: async () => ({ step: 1 }),
            compensate: async () => {
              throw new Error("Compensation crash: unable to restore balance");
            },
          },
          {
            name: "step_two",
            execute: async () => {
              throw new Error("Step two crashed");
            },
          },
        ],
      })
    ).rejects.toThrow(ManualReviewRequiredError);

    const pending = await journalRepo.findPendingRecovery();
    expect(pending.length).toBe(1);
    expect(pending[0].status).toBe("MANUAL_REVIEW");
    expect(pending[0].last_error).toContain("Compensation failed");
  });
});

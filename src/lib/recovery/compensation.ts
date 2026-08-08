export type StepCompensator = (
  stepData: Record<string, unknown>,
  context: Record<string, unknown>
) => Promise<void>;

const compensatorRegistry = new Map<string, StepCompensator>();

export function registerCompensator(stepName: string, compensator: StepCompensator): void {
  compensatorRegistry.set(stepName, compensator);
}

export function getCompensator(stepName: string): StepCompensator | undefined {
  return compensatorRegistry.get(stepName);
}

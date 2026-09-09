export type StorageDriver = "sheets" | "postgres";

const DEFAULT_STORAGE_DRIVER: StorageDriver = "sheets";

export function getStorageDriver(): StorageDriver {
  const rawDriver = process.env.STORAGE_DRIVER?.trim().toLowerCase();
  if (!rawDriver) return DEFAULT_STORAGE_DRIVER;

  if (rawDriver === "sheets" || rawDriver === "postgres") {
    return rawDriver;
  }

  throw new Error(
    `Invalid STORAGE_DRIVER "${process.env.STORAGE_DRIVER}". Expected "sheets" or "postgres".`
  );
}

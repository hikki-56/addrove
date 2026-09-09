export function assertPostgresRepositoryConfig(): void {
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error(
      "STORAGE_DRIVER=postgres requires DATABASE_URL. Keep STORAGE_DRIVER=sheets until Supabase Postgres is configured."
    );
  }
}

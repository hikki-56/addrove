export function assertPostgresRepositoryConfig(): void {
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error(
      "STORAGE_DRIVER=postgres requires DATABASE_URL. Configure the server's pooled PostgreSQL connection."
    );
  }
}

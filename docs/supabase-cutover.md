# Stockify: Google Sheets to Supabase

## Completed cutover: 2026-10-13 (Asia/Bangkok)

- Production: https://addrove.vercel.app
- Deployment: `dpl_6vA1Dz69ZSLczXD5wYju9cBFxG1M` (Ready).
- Public health check at 08:18 Thailand time: HTTP 200, `HEALTHY`, environment
  valid, `postgres` / `CONNECTED`, Apps Script `SKIPPED`.
- Production and local configuration use PostgreSQL. Maintenance is disabled.
- Final snapshot checksum:
  `e80f54bd38cbd817a1fae686dc2a58433bb129d0a8213c05c3e5a01bbd59cbd4`.
- All 26 source tabs, 20,895 original rows, and formulas were archived and
  verified before committing. Native data includes 2,984 products, 13 users,
  1,072 documents (including historical reference records), 1,903 movements,
  614 locations, and 3,594 balance rows.
- Physical-stock totals match the source: wh-01 370,544; wh-02 5,547,159;
  wh-03 607,954; wh-04 49,474; wh-05 491,598; wh-06 329,428.
- Live repositories read all six dashboards. A document and stock-write smoke
  test rolled back successfully, leaving business data unchanged.
- All 55 test suites passed: 526 tests passed, one skipped. TypeScript, scoped
  ESLint, and the production build passed. Supabase security advisors reported
  no findings after restricting the internal event function.
- Existing Google Sheets is retained as the pre-cutover backup. New business
  writes now go to Supabase; direct spreadsheet edits do not update Stockify.
- The local application connects to the same database. Use disposable PostgreSQL
  tests for experiments that should not affect live inventory.

The prior production deployment is
`https://amazonstock-ip615b3ta-tys-projects-afb98477.vercel.app`.
Environment backups and final source snapshot are under ignored `data/migrations/`.
The daily backup workflow still needs its GitHub database secret configured;
this migration did not enable scheduled backups.

The PostgreSQL backend implements all stock repositories. Production jobs,
reports, history, and notifications use dedicated tables. Express/Q integrations
use `storage_tabs` / `storage_rows`; the compatibility API routes all reads and
writes to PostgreSQL when `STORAGE_DRIVER=postgres`.

Warehouse screens read `stock_summary`; there is one balance per product,
warehouse, and location. `warehouseSync` no longer writes a second copy.
`opening_quantity` preserves physical stock that predates the movement ledger,
so rebuilding the summary includes the imported opening balance.

## Connection and security

- Use the approved server login `stockify_app` through the Supabase transaction
  pooler. Its randomly generated credential is in ignored server configuration.
- Keep `DATABASE_URL` server-only. Do not use a `NEXT_PUBLIC_` variable.
- TLS certificate and hostname verification are enabled. The official Supabase
  CA is bundled; `DATABASE_SSL_CA` permits a replacement CA during rotation.
- All 23 application tables have RLS. Only the server login has a policy;
  anonymous and authenticated Data API users have no application-table access.
- Application authorization still verifies the signed session and warehouse
  access. Existing user IDs, bcrypt passwords, PIN hashes, and access lists are
  retained.
- Requests share one PostgreSQL transaction. Stock writes use an advisory lock
  across serverless instances. A failed request or swallowed database/business
  failure rolls back all changes. All essential writes are awaited.
- The initial writer lock is global, prioritizing correctness for the legacy row
  integrations. It can later be split into resource locks with concurrency tests.
- The internal `rls_auto_enable` event function is not callable by public API
  roles. See [Supabase's advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable).

Functions run in Singapore (`sin1`) beside the database, following
[Vercel's region guidance](https://vercel.com/docs/regions).

## Export, preflight, and import

1. Export while the application still uses Sheets:
   `npm run database:export -- data/migrations/sheets-snapshot.json`.
   The file includes evaluated cells and original formulas for every tab.
2. Run `npm run database:preflight`. It validates the SHA-256 checksum and
   constructs the relational model without writing to the database.
3. Test the complete snapshot against a disposable PostgreSQL database before
   importing into Supabase.
4. Deploy the maintenance guard with `STORAGE_DRIVER=sheets` and
   `STORAGE_MAINTENANCE=1`. Verify POST requests return 503; reads remain available.
5. Export a fresh final snapshot. No one should edit the source spreadsheet
   directly during this interval.
6. Import using `npm run database:import -- <snapshot.json>`. The importer refuses
   to overwrite non-empty domain tables and commits only after every domain-table
   count, warehouse total, original cell, and original formula matches.
7. Set `STORAGE_DRIVER=postgres` and `STORAGE_MAINTENANCE=0`, then deploy. Check
   `/api/system/health`, which must report `storage.driver=postgres`,
   `storage.status=CONNECTED`, `appsScript.status=SKIPPED`.

Snapshots, import reports, environment backups, and credentials live under
ignored `data/` and `.env*` paths and must not be committed or published.

## Legacy data preserved during migration

- Every original row, including blanks and duplicates, is archived with formulas.
- Source headers identify the PRODUCTS layout. Old product IDs from the earlier
  cell-based layout heuristic remain aliases so pending documents still resolve.
- Duplicate location IDs are separated by warehouse/location, retaining aliases.
- Historical duplicate document numbers remain visible unchanged. New document
  numbers use a durable sequence and a database uniqueness constraint.
- Duplicate idempotency and journal records use the first source record, matching
  the old repository lookup; all duplicates remain in the archive.
- The second duplicate **draft** production number gets a new number. Its CREATE
  history is matched using SKU, table, and target quantity. Posted reports are
  never reassigned automatically.
- Eight physical-stock cells (`-` / `(2.00)`) retain the old app's effective zero
  quantity. Their original contents remain archived for later reconciliation.
- Missing historical document references receive explicit legacy reference
  records, retaining original movement IDs and all archived source data.

## Rollback

Before any new PostgreSQL business writes, restore the old deployment/configuration
with the Sheets driver. The original spreadsheet remains available unchanged.
After PostgreSQL business writes begin, first enable maintenance and reconcile or
export those new writes before switching back. Simply selecting Sheets at that
point would omit transactions recorded after cutover. Do not drop PostgreSQL tables
or delete the migration archive as part of a configuration rollback.

Production reports are immutable. A draft job is hidden with `deleted_at` while
its history remains available; corrections to posted production use adjustments.

## Validation

The PostgreSQL integration tests exercise real SQL in PGlite: RLS, numbering,
multi-step rollback, insufficient stock, durable idempotency, user credential
preservation, production reporting/replays, draft deletion, legacy range reads,
and dashboard minimum-stock settings. The actual source snapshot is also imported
and verified in a disposable database before cutover.

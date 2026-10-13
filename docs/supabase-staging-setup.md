# Supabase Staging Setup - Stockify

This runbook records the original staging setup for Stockify. The user authorized
using this project for the complete application migration on 2026-10-13.
The current implementation and cutover procedure are in [supabase-cutover.md](supabase-cutover.md).
Do not put
passwords, connection strings, API keys, access tokens, service role keys, or
recovery codes in this file.

## Staging Project

| Field | Value |
| :--- | :--- |
| Organization | Stockify |
| Project name | stockify-staging |
| Project ref | imiqvhqjlsvfgzdwaolq |
| Project URL | https://supabase.com/dashboard/project/imiqvhqjlsvfgzdwaolq |
| Database API URL | https://imiqvhqjlsvfgzdwaolq.supabase.co |
| Region | ap-southeast-1 - Southeast Asia (Singapore) |
| Plan | Free |

## Safety Rules

- The original staging-only restriction was superseded by the user's explicit
  authorization to migrate the entire application to this project.
- Do not paste secrets into chat, issue trackers, docs, screenshots, or commits.
- Concrete PostgreSQL repositories are implemented and tested. The maintenance
  deployment keeps Sheets until the final snapshot is imported and verified.
- Store any future `DATABASE_URL` only in local `.env.local` or the target
  deployment environment's secret manager.
- Use the Supabase pooled connection string for serverless deployments when the
  app is ready for Postgres.

## Phase 0 Hardening (applied 2026-09-09)

Migration `supabase/migrations/20260909120000_phase0_constraints_triggers.sql`
was applied to staging via the SQL Editor and verified against `pg_constraint` /
`pg_trigger` (18 rows returned). It adds:

- `stock_summary.quantity >= 0` (spec: ห้ามสต็อกติดลบ — เคลียร์ด้วยเอกสาร ADJ เท่านั้น)
- Per-type sign rules on `stock_movements.qty_change`:
  `RECEIVE`/`MOVE_IN`/`TRANSFER_IN`/`OPENING` > 0,
  `ISSUE`/`ISSUE_OUT`/`MOVE_OUT`/`TRANSFER_OUT` < 0.
  `ADJUST`/`REVERSAL` intentionally unconstrained (either sign is legitimate —
  verified against app services `issue-stock`, `transfer-stock`, `reverse-stock`,
  `stock-count`).
- `stock_counts.system_qty/counted_qty >= 0`, `products.minimum_stock >= 0`
- `bom_formulas.base_qty > 0`, `bom_formula_items.rm_qty_required > 0`,
  `waste_percentage` between 0 and 100
- Missing `updated_at` triggers on `bom_formulas` and `bom_formula_items`

The original 15-table schema now has 23 application tables. RLS is enabled on
all tables. The approved `stockify_app` server login has scoped policies and
privileges; public Data API roles have no application-table policies.

## Daily Backup (GitHub Actions)

Free-plan Supabase has no automatic backups. Workflow
`.github/workflows/backup-supabase.yml` runs daily at 01:30 Thailand time and
stores a logical dump (roles + schema + data) as a 30-day workflow artifact.

One-time setup: add the repository secret `SUPABASE_DB_URL` (GitHub ->
Settings -> Secrets and variables -> Actions) with the **direct** connection
string including the database password. Restore order if ever needed:
`roles.sql` -> `schema.sql` -> `data.sql` (apply with `psql` in that order).

## Apply The Initial Schema

The staging schema lives at:

```text
supabase/migrations/20260909000000_initial_stockify_schema.sql
```

Recommended dashboard flow:

1. Open the staging project URL above.
2. Confirm the header shows `stockify-staging` under the `Stockify`
   organization.
3. Open `SQL Editor`.
4. Create a new query.
5. Paste the contents of
   `supabase/migrations/20260909000000_initial_stockify_schema.sql`.
6. Review that the SQL only creates extensions, types, tables, indexes,
   functions, and triggers for the staging schema.
7. Run the query.
8. In `Table Editor`, confirm the expected tables exist.

Expected tables:

- `warehouses`
- `locations`
- `shelves`
- `products`
- `users`
- `documents`
- `stock_movements`
- `stock_summary`
- `stock_counts`
- `idempotency_records`
- `audit_logs`
- `operation_journal`
- `login_logs`
- `bom_formulas`
- `bom_formula_items`

## Next Implementation Gate

PostgreSQL repositories are implemented under `src/server/repositories/postgres/`.
Real SQL integration tests cover rollback, stock limits, production reporting,
idempotency, RLS, numbering, and credential preservation. Follow the current
cutover runbook to validate the final snapshot before switching the driver.

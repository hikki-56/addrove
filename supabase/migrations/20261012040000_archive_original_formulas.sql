alter table storage_rows add column if not exists formulas jsonb;
comment on column storage_rows.formulas is 'Original Google Sheets formulas retained for migration verification and rollback';

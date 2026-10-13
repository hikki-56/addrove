-- A draft can disappear from active screens while its history remains auditable.
alter table production_jobs add column if not exists deleted_at timestamptz;

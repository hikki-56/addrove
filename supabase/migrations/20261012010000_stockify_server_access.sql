-- stockify_app is a server-only LOGIN created with explicit user approval.
-- Grant no membership in anon/authenticated and no DDL/role administration.
do $$
declare tbl text;
begin
  if not exists (select 1 from pg_roles where rolname='stockify_app') then
    raise exception 'Create the approved stockify_app server login first';
  end if;
  foreach tbl in array array['warehouses','locations','shelves','products','users','documents',
    'stock_movements','stock_summary','stock_counts','idempotency_records','audit_logs','operation_journal',
    'login_logs','bom_formulas','bom_formula_items','production_jobs','production_reports',
    'production_history','production_notifications','storage_tabs','storage_rows','migration_snapshots','document_sequences']
  loop
    execute format('grant select,insert,update,delete on public.%I to stockify_app',tbl);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=tbl and policyname='stockify_server_access') then
      execute format('create policy stockify_server_access on public.%I for all to stockify_app using (true) with check (true)',tbl);
    end if;
  end loop;
end $$;
revoke update,delete on stock_movements,audit_logs,login_logs,production_reports,production_history from stockify_app;
grant usage,select,update on all sequences in schema public to stockify_app;

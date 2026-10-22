create table if not exists public.production_material_plans (
  job_no text primary key references public.production_jobs(job_no),
  snapshot jsonb not null,
  selection jsonb not null,
  parent_job_no text references public.production_jobs(job_no),
  backorder_report_id text unique references public.production_reports(report_id),
  created_at timestamptz not null default now()
);
create table if not exists public.production_material_reservations (
  job_no text not null references public.production_jobs(job_no),
  product_id text not null references public.products(product_id),
  warehouse_id text not null references public.warehouses(warehouse_id),
  quantity numeric(14,3) not null check (quantity >= 0),
  primary key (job_no,product_id,warehouse_id)
);
create index if not exists production_material_reservations_stock_idx
  on public.production_material_reservations(product_id,warehouse_id);
create table if not exists public.production_material_reports (
  report_id text primary key references public.production_reports(report_id),
  receipt_location_id text references public.locations(location_id),
  materials jsonb not null,
  request jsonb not null,
  reason text not null default '',
  created_at timestamptz not null default now()
);
do $$
declare tbl text;
begin
  foreach tbl in array array['production_material_plans','production_material_reservations','production_material_reports'] loop
    execute format('alter table public.%I enable row level security',tbl);
    execute format('grant select,insert,update,delete on public.%I to stockify_app',tbl);
    if not exists(select 1 from pg_policies where schemaname='public' and tablename=tbl and policyname='stockify_server_access') then
      execute format('create policy stockify_server_access on public.%I for all to stockify_app using (true) with check (true)',tbl);
    end if;
  end loop;
end $$;
revoke update,delete on public.production_material_reports from stockify_app;

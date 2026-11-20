create table if not exists public.stock_count_rounds (
  round_id uuid primary key,
  warehouse_id text not null references public.warehouses(warehouse_id),
  opened_by text not null,
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);
create unique index if not exists stock_count_open_warehouse on public.stock_count_rounds(warehouse_id) where closed_at is null;
create index if not exists stock_count_round_history on public.stock_count_rounds(warehouse_id, opened_at desc);

create table if not exists public.stock_count_shelves (
  round_id uuid not null references public.stock_count_rounds,
  shelf_code text not null,
  counted_by text not null,
  counter_name text not null,
  expires_at timestamptz not null,
  finished_at timestamptz,
  primary key (round_id, shelf_code)
);

-- Each operator submission has one immutable receipt. The latest revision
-- gives the reported total for a product on a shelf.
create table if not exists public.stock_count_entries (
  request_id uuid primary key,
  round_id uuid not null,
  shelf_code text not null,
  product_id text not null references public.products,
  sku text not null,
  product_name text not null,
  base_unit text not null,
  quantity numeric(14,3) not null check (quantity >= 0),
  entered_qty numeric(14,3) not null check (entered_qty >= 0),
  mode text not null check (mode in ('set','add')),
  previous_id uuid references public.stock_count_entries,
  revision integer not null,
  counted_by text not null,
  counter_name text not null,
  counted_at timestamptz not null default now(),
  foreign key (round_id, shelf_code) references public.stock_count_shelves,
  unique (round_id, shelf_code, product_id, revision)
);

do $$ declare tbl text; begin
  foreach tbl in array array['stock_count_rounds','stock_count_shelves','stock_count_entries'] loop
    execute format('alter table public.%I enable row level security', tbl);
    execute format('revoke all on public.%I from public, anon, authenticated', tbl);
    execute format('grant select,insert,update on public.%I to stockify_app', tbl);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=tbl and policyname='stockify_server_access') then
      execute format('create policy stockify_server_access on public.%I for all to stockify_app using (true) with check (true)', tbl);
    end if;
  end loop;
end $$;

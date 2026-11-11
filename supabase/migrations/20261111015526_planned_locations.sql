-- Preparation only: this table is deliberately separate from live locations.
-- Do not seed guessed lock ranges or copy these rows into locations at this stage.
create table if not exists public.planned_locations (
  planned_location_id text primary key default ('planned-loc-' || gen_random_uuid()::text),
  warehouse_id text not null references public.warehouses(warehouse_id)
    on update cascade on delete restrict,
  warehouse_prefix text not null,
  block_number integer not null check (block_number > 0),
  rack_side text not null check (rack_side in ('A', 'B', 'C')),
  shelf_level smallint not null check (shelf_level between 1 and 3),
  location_code text generated always as (
    warehouse_prefix || '-' || block_number::text || '-' || rack_side || 'L' || shelf_level::text
  ) stored not null,
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint planned_locations_warehouse_prefix_check check (
    warehouse_prefix ~ '^K[1-6]$'
    and warehouse_id = 'wh-0' || substring(warehouse_prefix from 2)
  ),
  constraint planned_locations_code_unique unique (location_code),
  constraint planned_locations_position_unique unique (warehouse_id, block_number, rack_side, shelf_level)
);

comment on table public.planned_locations is
  'Future location catalogue only. Not used by current stock workflows; activation requires a separate reviewed cutover.';
comment on column public.planned_locations.warehouse_prefix is
  'K6 = office (wh-06); K1-K5 reserved for matching warehouse IDs. No warehouse or lock rows are seeded.';
comment on column public.planned_locations.block_number is 'เลขล็อก: positive integer; actual ranges are not yet specified.';
comment on column public.planned_locations.rack_side is 'A = ซ้าย, B = ขวา, C = กลาง';
comment on column public.planned_locations.shelf_level is 'ชั้น 1-3, rendered as L1, L2, L3';
comment on column public.planned_locations.location_code is 'Generated code, for example K6-22-AL1.';

create or replace trigger planned_locations_updated_at
  before update on public.planned_locations
  for each row execute function public.set_stockify_updated_at();

alter table public.planned_locations enable row level security;
revoke all on public.planned_locations from public, anon, authenticated;
grant select, insert, update, delete on public.planned_locations to stockify_app;
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'planned_locations'
      and policyname = 'stockify_server_access'
  ) then
    create policy stockify_server_access on public.planned_locations
      for all to stockify_app using (true) with check (true);
  end if;
end $$;

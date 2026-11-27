-- Carton over/short fields for production reports.
-- Not applied automatically: existing production_reports.note already stores a
-- short Thai summary, and production_material_reports.request keeps the raw payload.
-- Apply only after explicit approval.

alter table public.production_reports
  add column if not exists carton_over_qty numeric(14,3) not null default 0,
  add column if not exists carton_short_qty numeric(14,3) not null default 0,
  add column if not exists carton_over_item_id text,
  add column if not exists leftover_location_id text references public.locations(location_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'production_reports_carton_over_check'
  ) then
    alter table public.production_reports
      add constraint production_reports_carton_over_check
      check (carton_over_qty >= 0 and carton_short_qty >= 0);
  end if;
end $$;

comment on column public.production_reports.carton_over_qty is 'จำนวนที่เกินจากลัง (ชิ้น)';
comment on column public.production_reports.carton_short_qty is 'จำนวนที่ขาดจากลัง (ชิ้น)';
comment on column public.production_reports.carton_over_item_id is 'ตัวที่เกินจากลัง เช่น fg หรือ rm:<item_id>';
comment on column public.production_reports.leftover_location_id is 'ตำแหน่งเก็บของเกิน จำกัดเฉพาะโกดัง 2';
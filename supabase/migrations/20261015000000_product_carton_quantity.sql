-- Base units per carton are unknown until supplied by the product owner.
-- Do not backfill a guessed value or change any inventory quantities.
alter table public.products add column if not exists units_per_carton integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_units_per_carton_positive' and conrelid = 'public.products'::regclass) then
    alter table public.products add constraint products_units_per_carton_positive
      check (units_per_carton is null or units_per_carton > 0);
  end if;
end $$;

comment on column public.products.units_per_carton is
  'Number of base_unit units per carton. NULL = not configured. Inventory and document quantities remain in base units.';

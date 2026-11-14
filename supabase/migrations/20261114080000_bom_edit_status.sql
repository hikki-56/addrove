-- Imports start as unedited. Successful BOM saves set this timestamp in the
-- same transaction as the material changes; failed saves cannot mark a formula.
alter table public.bom_formulas
  add column if not exists edited_at timestamptz;

comment on column public.bom_formulas.edited_at is
  'Last successful manual BOM save; null for formulas not yet edited';

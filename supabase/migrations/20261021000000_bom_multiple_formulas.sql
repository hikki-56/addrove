-- One finished product may have multiple active recipes (for example OS and JHC).
-- bom_id remains the recipe identity and the foreign key for its material rows.
drop index if exists public.bom_formulas_fg_sku_active_unique;

create index if not exists bom_formulas_fg_sku_active_idx
  on public.bom_formulas (fg_sku)
  where active = true;

-- Phase 0 hardening: CHECK constraints + missing updated_at triggers
-- Applied to stockify-staging (imiqvhqjlsvfgzdwaolq) on 2026-09-09.
--
-- Sign semantics for stock_movements.qty_change (verified against app code):
--   RECEIVE / MOVE_IN / TRANSFER_IN / OPENING  > 0
--   ISSUE / ISSUE_OUT / MOVE_OUT / TRANSFER_OUT < 0
--   ADJUST / REVERSAL                          any sign (diff / mirrored),
--     left unconstrained on purpose.

-- 1) Non-negative stock on hand (spec: ห้ามสต็อกติดลบ — ต้องเคลียร์ด้วยเอกสาร ADJ)
alter table stock_summary drop constraint if exists stock_summary_quantity_non_negative;
alter table stock_summary
  add constraint stock_summary_quantity_non_negative check (quantity >= 0);

-- 2) Per-movement-type sign rules for the types with certain semantics
alter table stock_movements drop constraint if exists stock_movements_qty_change_sign_valid;
alter table stock_movements
  add constraint stock_movements_qty_change_sign_valid check (
    case
      when movement_type in ('RECEIVE', 'MOVE_IN', 'TRANSFER_IN', 'OPENING')
        then qty_change > 0
      when movement_type in ('ISSUE', 'ISSUE_OUT', 'MOVE_OUT', 'TRANSFER_OUT')
        then qty_change < 0
      else true -- ADJUST, REVERSAL: either sign allowed
    end
  );

-- 3) Stock counts quantities are physical counts — never negative
alter table stock_counts drop constraint if exists stock_counts_system_qty_non_negative;
alter table stock_counts
  add constraint stock_counts_system_qty_non_negative check (system_qty >= 0);
alter table stock_counts drop constraint if exists stock_counts_counted_qty_non_negative;
alter table stock_counts
  add constraint stock_counts_counted_qty_non_negative check (counted_qty is null or counted_qty >= 0);

-- 4) Product minimum stock is a threshold — never negative
alter table products drop constraint if exists products_minimum_stock_non_negative;
alter table products
  add constraint products_minimum_stock_non_negative check (minimum_stock >= 0);

-- 5) BOM quantities must be positive; waste percentage in 0..100
alter table bom_formulas drop constraint if exists bom_formulas_base_qty_positive;
alter table bom_formulas
  add constraint bom_formulas_base_qty_positive check (base_qty > 0);
alter table bom_formula_items drop constraint if exists bom_formula_items_rm_qty_required_positive;
alter table bom_formula_items
  add constraint bom_formula_items_rm_qty_required_positive check (rm_qty_required > 0);
alter table bom_formula_items drop constraint if exists bom_formula_items_waste_percentage_range;
alter table bom_formula_items
  add constraint bom_formula_items_waste_percentage_range check (waste_percentage >= 0 and waste_percentage <= 100);

-- 6) Missing updated_at triggers on BOM tables (function already exists from initial schema)
drop trigger if exists set_bom_formulas_updated_at on bom_formulas;
create trigger set_bom_formulas_updated_at
before update on bom_formulas
for each row execute function set_stockify_updated_at();

drop trigger if exists set_bom_formula_items_updated_at on bom_formula_items;
create trigger set_bom_formula_items_updated_at
before update on bom_formula_items
for each row execute function set_stockify_updated_at();

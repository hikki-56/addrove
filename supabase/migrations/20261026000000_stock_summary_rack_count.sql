-- จำนวนราง (rack count) per product-location, entered on ระบุตำแหน่งสินค้า.
-- NULL = not entered. Additive only; no backfill, quantities unchanged.
alter table public.stock_summary add column if not exists rack_count integer;

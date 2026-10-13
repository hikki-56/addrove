-- Old product parsing guessed the layout from populated cells. Retain aliases
-- for old document references while using the actual SKU column for new data.
alter table products add column if not exists legacy_ids jsonb not null default '[]'::jsonb;
create index if not exists products_legacy_ids_idx on products using gin(legacy_ids);
alter table locations add column if not exists legacy_ids jsonb not null default '[]'::jsonb;
create index if not exists locations_legacy_ids_idx on locations using gin(legacy_ids);

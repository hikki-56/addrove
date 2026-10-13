-- Physical stock existed before a complete movement ledger. Keep that baseline
-- explicitly so rebuilding does not erase imported warehouse balances.
alter table stock_summary add column if not exists opening_quantity numeric(14,3) not null default 0;
comment on column stock_summary.opening_quantity is 'Reconciled opening balance: physical quantity at cutover minus historical ledger quantity';
alter function set_stockify_updated_at() set search_path = public;

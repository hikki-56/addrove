-- Historical ledger-only zero balances should not create phantom warehouse SKUs.
alter table stock_summary add column if not exists listed_in_warehouse boolean not null default true;

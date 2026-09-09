create extension if not exists pgcrypto;

do $$
begin
  create type stockify_document_type as enum (
    'OPENING',
    'RECEIVE',
    'ISSUE',
    'MOVE',
    'TRANSFER',
    'ADJUST',
    'REVERSAL'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type stockify_document_status as enum (
    'DRAFT',
    'PENDING',
    'PROCESSING',
    'WAITING_APPROVAL',
    'POSTED',
    'COMPLETED',
    'REJECTED',
    'CANCELLED'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type stockify_movement_type as enum (
    'RECEIVE',
    'ISSUE',
    'ISSUE_OUT',
    'MOVE_OUT',
    'MOVE_IN',
    'TRANSFER_OUT',
    'TRANSFER_IN',
    'ADJUST',
    'OPENING',
    'REVERSAL'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type stockify_stock_count_status as enum (
    'PENDING',
    'COUNTED',
    'APPROVED',
    'REJECTED'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type stockify_user_role as enum (
    'ADMIN',
    'MANAGER',
    'APPROVER',
    'WAREHOUSE_STAFF',
    'STAFF',
    'VIEWER'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type stockify_idempotency_status as enum (
    'PROCESSING',
    'COMPLETED',
    'FAILED'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type stockify_audit_outcome as enum (
    'SUCCESS',
    'FAILURE'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type stockify_operation_status as enum (
    'PENDING',
    'IN_PROGRESS',
    'COMPLETED',
    'COMPENSATING',
    'COMPENSATED',
    'RECOVERABLE',
    'MANUAL_REVIEW'
  );
exception
  when duplicate_object then null;
end $$;

create or replace function set_stockify_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists warehouses (
  warehouse_id text primary key default ('wh-' || gen_random_uuid()::text),
  warehouse_code text not null,
  warehouse_name text not null,
  address text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint warehouses_code_unique unique (warehouse_code)
);

create table if not exists locations (
  location_id text primary key default ('loc-' || gen_random_uuid()::text),
  warehouse_id text not null references warehouses (warehouse_id) on update cascade on delete restrict,
  location_code text not null,
  location_name text,
  shelf_code text,
  shelf_name text,
  zone text,
  aisle text,
  rack text,
  shelf text,
  bin text,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint locations_warehouse_code_unique unique (warehouse_id, location_code)
);

create table if not exists shelves (
  shelf_id text primary key default ('sh-' || gen_random_uuid()::text),
  location_id text not null references locations (location_id) on update cascade on delete restrict,
  shelf_code text not null,
  shelf_name text not null,
  shelf_level text not null default '1',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shelves_location_code_unique unique (location_id, shelf_code)
);

create table if not exists products (
  product_id text primary key default ('prod-' || gen_random_uuid()::text),
  sku text not null,
  barcode text not null default '',
  product_name text not null,
  category text not null default 'ทั่วไป',
  base_unit text not null default 'ชิ้น',
  minimum_stock numeric(14, 3) not null default 0,
  description text not null default '',
  supplier text,
  location text,
  active boolean not null default true,
  created_by text,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_sku_unique unique (sku)
);

create unique index if not exists products_barcode_unique
  on products (barcode)
  where barcode <> '';

create table if not exists users (
  user_id text primary key default ('usr-' || gen_random_uuid()::text),
  full_name text not null,
  email text not null,
  password_hash text not null,
  pin_hash text not null default '',
  role stockify_user_role not null default 'STAFF',
  warehouse_access jsonb not null default '"*"'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists users_email_lower_unique
  on users (lower(email));

create table if not exists documents (
  document_id text primary key default ('doc-' || gen_random_uuid()::text),
  document_no text not null,
  document_type stockify_document_type not null,
  reference_no text not null default '',
  document_date date not null default current_date,
  status stockify_document_status not null default 'DRAFT',
  note text not null default '',
  created_by text not null,
  created_by_name text,
  created_at timestamptz not null default now(),
  assigned_to_user_id text,
  assigned_to_name text,
  assigned_by_user_id text,
  constraint documents_no_unique unique (document_no)
);

create table if not exists stock_movements (
  movement_id text primary key default ('mov-' || gen_random_uuid()::text),
  document_id text not null references documents (document_id) on update cascade on delete restrict,
  product_id text not null references products (product_id) on update cascade on delete restrict,
  warehouse_id text not null references warehouses (warehouse_id) on update cascade on delete restrict,
  location_id text not null references locations (location_id) on update cascade on delete restrict,
  qty_change numeric(14, 3) not null,
  movement_type stockify_movement_type not null,
  idempotency_key text not null,
  created_by text not null,
  created_at timestamptz not null default now()
);

create index if not exists stock_movements_document_id_idx on stock_movements (document_id);
create index if not exists stock_movements_product_warehouse_location_idx
  on stock_movements (product_id, warehouse_id, location_id);
create index if not exists stock_movements_idempotency_key_idx on stock_movements (idempotency_key);
create index if not exists stock_movements_created_at_idx on stock_movements (created_at desc);

create table if not exists stock_summary (
  product_id text not null references products (product_id) on update cascade on delete restrict,
  warehouse_id text not null references warehouses (warehouse_id) on update cascade on delete restrict,
  location_id text not null references locations (location_id) on update cascade on delete restrict,
  quantity numeric(14, 3) not null default 0,
  last_updated timestamptz not null default now(),
  primary key (product_id, warehouse_id, location_id)
);

create table if not exists stock_counts (
  count_id text primary key default ('cnt-' || gen_random_uuid()::text),
  count_no text not null,
  product_id text not null references products (product_id) on update cascade on delete restrict,
  warehouse_id text not null references warehouses (warehouse_id) on update cascade on delete restrict,
  location_id text not null references locations (location_id) on update cascade on delete restrict,
  system_qty numeric(14, 3) not null default 0,
  counted_qty numeric(14, 3),
  difference numeric(14, 3),
  status stockify_stock_count_status not null default 'PENDING',
  counted_by text,
  counted_at timestamptz,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stock_counts_no_unique unique (count_no)
);

create table if not exists idempotency_records (
  key text primary key,
  operation_type text not null,
  actor_id text not null,
  payload_hash text not null,
  status stockify_idempotency_status not null,
  response_payload text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists audit_logs (
  audit_id text primary key default ('audit-' || gen_random_uuid()::text),
  correlation_id text not null,
  idempotency_key text,
  actor_id text not null,
  actor_role text not null,
  action text not null,
  resource_type text not null,
  resource_id text,
  warehouse_id text,
  timestamp timestamptz not null default now(),
  outcome stockify_audit_outcome not null,
  error_code text,
  metadata jsonb
);

create index if not exists audit_logs_timestamp_idx on audit_logs (timestamp desc);
create index if not exists audit_logs_actor_id_idx on audit_logs (actor_id);
create index if not exists audit_logs_warehouse_id_idx on audit_logs (warehouse_id);

create table if not exists operation_journal (
  operation_id text primary key,
  idempotency_key text not null,
  operation_type text not null,
  payload_hash text not null,
  actor_id text not null,
  steps jsonb not null default '[]'::jsonb,
  completed_steps jsonb not null default '[]'::jsonb,
  status stockify_operation_status not null,
  retry_count integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operation_journal_idempotency_key_unique unique (idempotency_key)
);

create index if not exists operation_journal_status_idx on operation_journal (status);

create table if not exists login_logs (
  id text primary key default ('login-' || gen_random_uuid()::text),
  user_id text not null,
  user_name text not null,
  user_email text not null,
  user_role stockify_user_role not null,
  login_method text not null check (login_method in ('PASSWORD', 'QR_CODE')),
  login_at timestamptz not null default now(),
  ip_address text,
  user_agent text
);

create index if not exists login_logs_login_at_idx on login_logs (login_at desc);
create index if not exists login_logs_user_id_idx on login_logs (user_id);

create table if not exists bom_formulas (
  bom_id text primary key,
  fg_sku text not null,
  fg_barcode text not null default '',
  fg_name text not null,
  fg_unit text not null default 'ชุด',
  base_qty numeric(14, 3) not null default 1,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create unique index if not exists bom_formulas_fg_sku_active_unique
  on bom_formulas (fg_sku)
  where active = true;

create table if not exists bom_formula_items (
  bom_item_id bigint generated always as identity primary key,
  bom_id text not null references bom_formulas (bom_id) on update cascade on delete cascade,
  rm_sku text not null,
  rm_barcode text not null default '',
  rm_name text not null,
  rm_wh text not null default 'โกดัง2',
  rm_qty_required numeric(14, 3) not null default 1,
  rm_unit text not null default 'ชิ้น',
  waste_percentage numeric(6, 3) not null default 0,
  note text not null default '',
  updated_at timestamptz not null default now()
);

create index if not exists bom_formula_items_bom_id_idx on bom_formula_items (bom_id);

drop trigger if exists set_warehouses_updated_at on warehouses;
create trigger set_warehouses_updated_at
before update on warehouses
for each row execute function set_stockify_updated_at();

drop trigger if exists set_locations_updated_at on locations;
create trigger set_locations_updated_at
before update on locations
for each row execute function set_stockify_updated_at();

drop trigger if exists set_shelves_updated_at on shelves;
create trigger set_shelves_updated_at
before update on shelves
for each row execute function set_stockify_updated_at();

drop trigger if exists set_products_updated_at on products;
create trigger set_products_updated_at
before update on products
for each row execute function set_stockify_updated_at();

drop trigger if exists set_users_updated_at on users;
create trigger set_users_updated_at
before update on users
for each row execute function set_stockify_updated_at();

drop trigger if exists set_stock_counts_updated_at on stock_counts;
create trigger set_stock_counts_updated_at
before update on stock_counts
for each row execute function set_stockify_updated_at();

drop trigger if exists set_idempotency_records_updated_at on idempotency_records;
create trigger set_idempotency_records_updated_at
before update on idempotency_records
for each row execute function set_stockify_updated_at();

drop trigger if exists set_operation_journal_updated_at on operation_journal;
create trigger set_operation_journal_updated_at
before update on operation_journal
for each row execute function set_stockify_updated_at();

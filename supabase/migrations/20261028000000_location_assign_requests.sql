-- คำขอระบุตำแหน่งสินค้า (รออนุมัติ) — 1 แถว = 1 สินค้า+ตำแหน่ง
-- ยังไม่มีการเขียนสต็อกจนกว่าจะอนุมัติ; อนุมัติแล้วจึงสร้าง ADJUST ตั้งยอด = target_qty
-- Additive only. Run with the owner account in Supabase SQL editor.
create table if not exists public.location_assign_requests (
  request_id      text primary key,
  batch_id        text not null,                 -- คำขอที่บันทึกพร้อมกันจากหน้าจอเดียว
  warehouse_id    text not null references public.warehouses(warehouse_id),
  product_id      text not null references public.products(product_id),
  location_id     text not null,                 -- location_id จริง หรือรหัสตำแหน่งใหม่ (resolve ตอนอนุมัติ)
  location_code   text not null default '',      -- '' = ไม่ระบุ
  target_qty      numeric not null check (target_qty >= 0),
  qty_at_request  numeric not null default 0,    -- ยอด ณ ตอนขอ (ไว้เทียบตอนอนุมัติ)
  status          text not null default 'PENDING'
                  check (status in ('PENDING','APPROVED','REJECTED','CANCELLED')),
  note            text not null default '',
  requested_by    text not null,
  requested_at    timestamptz not null default now(),
  decided_by      text,
  decided_at      timestamptz,
  decision_note   text not null default '',
  qty_at_decision numeric,
  document_id     text,                          -- ADJUST ที่สร้างตอนอนุมัติ (null ถ้าส่วนต่าง = 0)
  idempotency_key text not null unique
);
create index if not exists location_assign_requests_status_idx
  on public.location_assign_requests(status, warehouse_id, requested_at desc);
create index if not exists location_assign_requests_batch_idx
  on public.location_assign_requests(batch_id);
-- กันคำขอค้างซ้ำซ้อนสำหรับสินค้า+ตำแหน่งเดียวกัน
create unique index if not exists location_assign_requests_one_pending
  on public.location_assign_requests(warehouse_id, product_id, location_id)
  where status = 'PENDING';
grant select, insert, update, delete on public.location_assign_requests to stockify_app;
-- RLS is on (project default); same server-only policy as the other tables (see 20261012010000_stockify_server_access.sql)
alter table public.location_assign_requests enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='location_assign_requests' and policyname='stockify_server_access') then
    create policy stockify_server_access on public.location_assign_requests for all to stockify_app using (true) with check (true);
  end if;
end $$;

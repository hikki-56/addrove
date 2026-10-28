-- ประวัติการแก้ไขคำขอระบุตำแหน่ง (แก้ได้เฉพาะสถานะ PENDING) — ไม่แตะสต็อก
-- Additive only. Run with the owner account in Supabase SQL editor.
create table if not exists public.location_assign_request_edits (
  edit_id            text primary key,
  request_id         text not null references public.location_assign_requests(request_id),
  edited_by          text not null,
  edited_at          timestamptz not null default now(),
  old_target_qty     numeric not null,
  new_target_qty     numeric not null,
  old_note           text not null default '',
  new_note           text not null default '',
  old_location_id    text not null,
  new_location_id    text not null,
  old_location_code  text not null default '',
  new_location_code  text not null default '',
  old_qty_at_request numeric,
  new_qty_at_request numeric
);
create index if not exists location_assign_request_edits_request_idx
  on public.location_assign_request_edits(request_id, edited_at desc);
grant select, insert, update, delete on public.location_assign_request_edits to stockify_app;
alter table public.location_assign_request_edits enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='location_assign_request_edits' and policyname='stockify_server_access') then
    create policy stockify_server_access on public.location_assign_request_edits for all to stockify_app using (true) with check (true);
  end if;
end $$;

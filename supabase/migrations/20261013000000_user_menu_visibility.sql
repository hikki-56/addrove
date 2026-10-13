-- NULL retains the existing role/account defaults; [] hides all optional menus.
alter table public.users add column if not exists menu_hrefs jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'users_menu_hrefs_array' and conrelid = 'public.users'::regclass) then
    alter table public.users add constraint users_menu_hrefs_array
      check (menu_hrefs is null or jsonb_typeof(menu_hrefs) = 'array');
  end if;
end $$;

-- NACOSS Attendance: online database setup (Supabase)
-- Supabase dashboard -> SQL Editor -> New query -> paste all of this -> Run

create table if not exists public.nacoss_records (
  collection text        not null,
  id         text        not null,
  data       jsonb,
  deleted    boolean     not null default false,
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);

create index if not exists nacoss_records_updated_idx on public.nacoss_records (updated_at);

create or replace function public.nacoss_touch() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

drop trigger if exists nacoss_touch_t on public.nacoss_records;
create trigger nacoss_touch_t before insert or update on public.nacoss_records
  for each row execute function public.nacoss_touch();

alter table public.nacoss_records enable row level security;
drop policy if exists nacoss_app_access on public.nacoss_records;
create policy nacoss_app_access on public.nacoss_records
  for all to anon using (true) with check (true);

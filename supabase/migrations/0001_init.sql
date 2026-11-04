-- Volejbal Statistika: data patří vždy jednomu uživateli, přístup hlídá Row Level Security.

create table public.matches (
  id          text primary key check (char_length(id) between 1 and 64),
  user_id     uuid not null references auth.users (id) on delete cascade,
  data        jsonb not null check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 2000000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index matches_user_idx on public.matches (user_id);

create table public.rosters (
  user_id     uuid not null references auth.users (id) on delete cascade,
  team        text not null check (char_length(team) between 1 and 200),
  data        jsonb not null check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 200000),
  updated_at  timestamptz not null default now(),
  primary key (user_id, team)
);

alter table public.matches enable row level security;
alter table public.rosters enable row level security;

-- Anonymní (nepřihlášení) nemají k datům žádný přístup.
revoke all on public.matches, public.rosters from anon, public;
grant select, insert, update, delete on public.matches, public.rosters to authenticated;

create policy matches_select on public.matches for select to authenticated using ((select auth.uid()) = user_id);
create policy matches_insert on public.matches for insert to authenticated with check ((select auth.uid()) = user_id);
create policy matches_update on public.matches for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy matches_delete on public.matches for delete to authenticated using ((select auth.uid()) = user_id);

create policy rosters_select on public.rosters for select to authenticated using ((select auth.uid()) = user_id);
create policy rosters_insert on public.rosters for insert to authenticated with check ((select auth.uid()) = user_id);
create policy rosters_update on public.rosters for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy rosters_delete on public.rosters for delete to authenticated using ((select auth.uid()) = user_id);

-- updated_at nastavuje databáze, ne klient.
create function public.touch_updated_at() returns trigger language plpgsql
set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger matches_touch before update on public.matches for each row execute function public.touch_updated_at();
create trigger rosters_touch before update on public.rosters for each row execute function public.touch_updated_at();
